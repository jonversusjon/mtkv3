import logging
from typing import Dict, List, Tuple, Any, Callable

from flask_backend.models import (
    RestrictionSite,
    Codon,
    MutationCodon,
    Mutation,
    OverhangOption,
)
from flask_backend.services.utils import GoldenGateUtils

# Module‑level logger (avoid name collision with any `logger` variable in calling scope)
module_logger: logging.Logger = logging.getLogger("flask_backend.services.mut_analyzer")


class MutationAnalyzer:
    """Analyse restriction‑site contexts and generate codon‑level mutation options
    that satisfy Golden‑Gate cloning constraints.  The public entry‑point is
    :py:meth:`get_all_mutations`, which returns **Pydantic** :class:`~flask_backend.models.Mutation`
    objects ready for downstream optimisation.
    """

    def __init__(
        self,
        codon_usage_dict: Dict[str, Dict[str, float]],
        max_mutations: int = 1,
        verbose: bool = False,
        debug: bool = False,
    ) -> None:
        self.utils: GoldenGateUtils = GoldenGateUtils()
        self.codon_usage_dict: Dict[str, Dict[str, float]] = codon_usage_dict
        self.max_mutations: int = max_mutations
        self.verbose: bool = verbose
        self.debug: bool = debug

        module_logger.info(
            "Initialised MutationAnalyzer | verbose=%s | debug=%s | max_mutations=%s",
            verbose,
            debug,
            max_mutations,
        )

    # ---------------------------------------------------------------------
    # Helper — progress estimation
    # ---------------------------------------------------------------------
    def _estimate_total_mutations(self, restriction_sites: List[RestrictionSite]) -> int:
        """Crude upper bound of how many *alternative* codons overlap an RS.
        Used purely for progress‑bar scaling."""
        total = 0
        for site in restriction_sites:
            for codon in site.codons:
                alt_count = sum(
                    1
                    for alt in self.utils.get_codon_seqs_for_amino_acid(codon.amino_acid)
                    if alt != codon.codon_sequence
                    and any(
                        i in codon.rs_overlap
                        for i in (idx for idx in range(3) if alt[idx] != codon.codon_sequence[idx])
                    )
                )
                total += alt_count
        return max(total, 1)  # avoid division by zero later

    # ---------------------------------------------------------------------
    # Public helpers
    # ---------------------------------------------------------------------
    @staticmethod
    def get_mutation_for_choice(
        site_key: str,
        chosen_codon_sequence: str,
        site_mutation_options: List[Mutation],
    ) -> Mutation:
        """Return the *Mutation* whose first (and only) mutated codon matches
        ``chosen_codon_sequence`` – convenience for UI lookup."""
        for mut in site_mutation_options:
            if mut.mut_codons[0].codon.codon_sequence == chosen_codon_sequence:
                return mut
        raise ValueError(
            f"No mutation found for {site_key} with codon {chosen_codon_sequence!r}"
        )

    # ---------------------------------------------------------------------
    # Core routine
    # ---------------------------------------------------------------------
    def get_all_mutations(
        self,
        restriction_sites: List[RestrictionSite],
        send_update: Callable[..., None],
    ) -> Dict[str, List[Mutation]]:
        """Generate *single‑codon* mutation options for every restriction site.

        Returns
        -------
        dict
            Mapping ``rs_key`` → ``List[Mutation]`` where ``rs_key`` is of the form
            ``mutation_<context‑position>``.
        """

        mutation_options: Dict[str, List[Mutation]] = {}
        total_estimated_ops = self._estimate_total_mutations(restriction_sites)
        completed_ops = 0

        # Helper for throttled progress updates --------------------------------
        def _progress(msg: str, inc: int = 1, **extra):
            nonlocal completed_ops
            completed_ops += inc
            percent = min(99, int(completed_ops / total_estimated_ops * 100))
            send_update(message=msg, prog=percent, progress=percent, **extra)

        # Kick‑off ----------------------------------------------------------------
        send_update(
            message=f"Starting mutation analysis for {len(restriction_sites)} site(s)",
            prog=0,
            progress=0,
        )

        # ---------------------------------------------------------------------
        for site_idx, site in enumerate(restriction_sites, start=1):
            rs_key = f"mutation_{site.position}"
            valid_mutations: List[Mutation] = []

            # Collect *alternative* codons for **each** codon slot -------------
            alternatives_by_codon: List[Tuple[int, List[Dict[str, Any]]]] = []
            for codon_idx, codon in enumerate(site.codons):
                alt_codon_seqs = self.utils.get_codon_seqs_for_amino_acid(codon.amino_acid)
                codon_alternatives: List[Dict[str, Any]] = []
                for alt_seq in alt_codon_seqs:
                    if alt_seq == codon.codon_sequence:
                        continue

                    muts = [i for i in range(3) if alt_seq[i] != codon.codon_sequence[i]]
                    mutations_in_rs = list(set(muts) & set(codon.rs_overlap))
                    if not mutations_in_rs:
                        continue  # doesn’t impact RS; skip

                    usage = self.utils.get_codon_usage(alt_seq, codon.amino_acid, self.codon_usage_dict)
                    alt_codon = Codon(
                        amino_acid=codon.amino_acid,
                        context_position=codon.context_position,
                        codon_sequence=alt_seq,
                        rs_overlap=codon.rs_overlap,
                        usage=usage,
                    )
                    codon_alternatives.append(
                        {
                            "mutation_codon": MutationCodon(codon=alt_codon, nth_codon_in_rs=codon_idx + 1),
                            "muts": muts,
                            "mutations_in_rs": mutations_in_rs,
                            "context_position": codon.context_position,
                        }
                    )

                if codon_alternatives:
                    alternatives_by_codon.append((codon_idx, codon_alternatives))
                    _progress(
                        msg=f"Site {site_idx}: analysed {len(codon_alternatives)} alternatives for codon {codon_idx + 1}",
                        inc=len(codon_alternatives),
                        rs_key=rs_key,
                    )

            # -----------------------------------------------------------------
            # Treat each *alternative* as its own independent Mutation option.
            # (Full combinatorial generation is handled later by MutationOptimizer.)
            # -----------------------------------------------------------------
            for codon_idx, alternatives in alternatives_by_codon:
                for alt in alternatives:
                    if len(alt["muts"]) > self.max_mutations:
                        continue  # respects global max‑mut setting

                    # Build mutated context (single‑codon case) ----------------
                    mutated_ctx, first_mut, last_mut = self._get_combined_mutated_context(
                        context_sequence=site.context_seq,
                        mutations_info=[
                            {
                                "codon_context_position": alt["context_position"],
                                "new_codon_sequence": alt["mutation_codon"].codon.codon_sequence,
                                "muts": alt["muts"],
                            }
                        ],
                    )

                    # Build overhang options ----------------------------------
                    oh_raw = self._calculate_sticky_ends_with_context(mutated_ctx, first_mut, last_mut)
                    overhang_options: List[OverhangOption] = []
                    if isinstance(oh_raw, dict):
                        for pos_opts in oh_raw.values():
                            tops = pos_opts.get("top_strand", [])
                            bots = pos_opts.get("bottom_strand", [])
                            for t, b in zip(tops, bots):
                                overhang_options.append(
                                    OverhangOption(
                                        bottom_overhang=b["seq"],
                                        top_overhang=t["seq"],
                                        overhang_start_index=int(t["overhang_start_index"]),
                                    )
                                )
                    elif isinstance(oh_raw, list):
                        overhang_options = oh_raw  # pragma: no cover (legacy path)
                    else:
                        raise TypeError("Unexpected return type from _calculate_sticky_ends_with_context")

                    # Assemble the Mutation object ---------------------------
                    mutation = Mutation(
                        mut_codons=[alt["mutation_codon"]],
                        mut_codons_context_start_idx=alt["context_position"],
                        mut_indices_rs=alt["mutations_in_rs"],
                        mut_indices_codon=alt["muts"],
                        mut_context=mutated_ctx,
                        native_context=site.context_seq,
                        first_mut_idx=first_mut,
                        last_mut_idx=last_mut,
                        overhang_options=overhang_options,
                        context_rs_indices=site.context_rs_indices,
                        recognition_seq=site.recognition_seq,
                        enzyme=site.enzyme,
                    )
                    valid_mutations.append(mutation)

            if valid_mutations:
                mutation_options[rs_key] = valid_mutations
                _progress(
                    msg=f"Site {site_idx}: generated {len(valid_mutations)} valid mutation(s)",
                    inc=0,
                    rs_key=rs_key,
                    mutation_count=len(valid_mutations),
                )
            else:
                _progress(
                    msg=f"Site {site_idx}: no viable alternatives found", inc=0, rs_key=rs_key, mutation_count=0
                )

        # -----------------------------------------------------------------
        send_update(message="Mutation analysis complete", prog=100, progress=100, mutation_options=mutation_options)
        return mutation_options

    # ---------------------------------------------------------------------
    # Sticky‑end helpers (unchanged from previous implementation)
    # ---------------------------------------------------------------------
    def _calculate_sticky_ends_with_context(
        self, mutated_ctx: str, first_mut_idx: int, last_mut_idx: int
    ) -> Dict[str, Dict[str, List[Dict[str, Any]]]]:
        sticky: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}
        for pos in sorted({first_mut_idx, last_mut_idx}):
            pos_sticky = {"top_strand": [], "bottom_strand": []}
            for r in [
                range(pos - 3, pos + 1),
                range(pos - 2, pos + 2),
                range(pos - 1, pos + 3),
                range(pos, pos + 4),
            ]:
                if 0 <= min(r) < len(mutated_ctx) and max(r) < len(mutated_ctx):
                    top = "".join(mutated_ctx[i] for i in r)
                    bottom = self.utils.reverse_complement(top)
                    pos_sticky["top_strand"].append({"seq": top, "overhang_start_index": r.start})
                    pos_sticky["bottom_strand"].append({"seq": bottom, "overhang_start_index": r.start})
            sticky[f"position_{pos}"] = pos_sticky
        return sticky

    def _get_combined_mutated_context(
        self, context_sequence: str, mutations_info: List[Dict[str, Any]]
    ) -> Tuple[str, int, int]:
        """Apply one or more codon substitutions to *context_sequence* and return the
        mutated string plus first/last global mutation indices."""
        seq_list = list(context_sequence)
        global_positions: List[int] = []

        for mut in mutations_info:
            codon_pos = mut["codon_context_position"]
            new_codon = mut["new_codon_sequence"]
            muts = mut["muts"]

            if len(new_codon) != 3:
                raise ValueError("new_codon_sequence must be 3 nt long")
            if codon_pos < 0 or codon_pos + 3 > len(context_sequence):
                raise ValueError("codon_context_position out of bounds for context_sequence")
            if not muts:
                raise ValueError("muts list cannot be empty")

            seq_list[codon_pos : codon_pos + 3] = list(new_codon)
            global_first = codon_pos + min(muts)
            global_last = codon_pos + max(muts)
            global_positions.extend([global_first, global_last])

        return "".join(seq_list), min(global_positions), max(global_positions)
