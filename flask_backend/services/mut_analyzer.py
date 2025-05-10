import logging
from typing import Dict, List

from flask_backend.models import RestrictionSite, Codon, MutationCodon
from flask_backend.services.utils import GoldenGateUtils

# Get a logger instance for this module
module_logger = logging.getLogger("flask_backend.services.mut_analyzer") # Renamed to avoid conflict if 'logger' is used as a var name

class MutationAnalyzer:
    """
    MutationAnalyzer Module

    This module provides functionality for analyzing DNA sequences to generate
    mutation options for Golden Gate assembly. The main entry and exit point
    is the get_all_mutations function.
    """

    def __init__(
        self,
        codon_usage_dict: Dict[str, Dict[str, float]],
        max_mutations: int = 1,
        verbose: bool = False,
        debug: bool = False,
    ):
        self.utils = GoldenGateUtils()
        self.state = {"current_codon": "", "current_position": 0, "mutations_found": []}
        self.codon_usage_dict = codon_usage_dict
        self.max_mutations = max_mutations
        self.verbose = verbose
        self.debug = debug

        module_logger.info(
            f"Initializing MutationAnalyzer with verbose={verbose} and debug={debug}"
        )
        # if self.verbose:
        #     logger.log_step("Debug Mode", "Debug mode enabled for MutationAnalyzer")
        #     logger.validate(
        #         codon_usage_dict and isinstance(codon_usage_dict, dict),
        #         "Codon usage dictionary is valid",
        #     )
        
        
        #     logger.validate(
        #         isinstance(max_mutations, int) and max_mutations > 0,
        #         f"Max mutations set to {max_mutations}",
        #         {"valid_range": "1+"},
        #     )

    def _estimate_total_mutations(
        self, restriction_sites: List[RestrictionSite]
    ) -> int:
        """
        Returns a fast upper‑bound estimate of the total number of valid mutation combinations
        across all given restriction sites (non‑empty subsets of codon alternatives that overlap
        the recognition site).
        """
        total = 0
        for site in restriction_sites:
            alt_counts = []
            for codon in site.codons:
                alt_seqs = self.utils.get_codon_seqs_for_amino_acid(codon.amino_acid)
                count = sum(
                    1
                    for seq in alt_seqs
                    if seq != codon.codon_sequence
                    and any(
                        i in codon.rs_overlap
                        for i in [
                            idx
                            for idx in range(3)
                            if seq[idx] != codon.codon_sequence[idx]
                        ]
                    )
                )
                alt_counts.append(count)
            if alt_counts:
                # Now treat each site as a single unit with multiple options
                total += sum(alt_counts)
        return total

    def get_mutation_for_choice(
        self, site_key, chosen_codon_sequence, site_mutation_options
    ):
        """
        Helper function to retrieve a specific mutation for a given choice.
        Args:
            site_key (str): The key of the restriction site.
            chosen_codon_sequence (str): The chosen codon sequence.
            site_mutation_options (list): List of mutation options for the site.

        Returns:
            Mutation: The selected mutation object.
        """
        for mutation in site_mutation_options:
            if mutation.mut_codons[0].codon.codon_sequence == chosen_codon_sequence:
                return mutation
        raise ValueError(
            f"No mutation found for site {site_key} with codon sequence {chosen_codon_sequence}"
        )

    def get_all_mutations(
        self, restriction_sites: List[RestrictionSite], send_update: callable
    ) -> Dict[str, List[dict]]:
        # logger.log_step(
        #     "Mutation Analysis",
        #     f"Starting mutation analysis for {len(restriction_sites)} site(s)",
        # )
        mutation_options = {}

        total_estimated_operations = self._estimate_total_mutations(restriction_sites)
        completed_operations = 0

        try:
            send_update(
                message=f"Starting mutation analysis for {len(restriction_sites)} site(s)",
                prog=0,
            )

            for site_idx, site in enumerate(restriction_sites):
                rs_key = f"mutation_{site.position}"
                valid_mutations = []

                for codon_idx, codon in enumerate(site.codons):
                    alt_codon_seqs = self.utils.get_codon_seqs_for_amino_acid(
                        codon.amino_acid
                    )
                    for alt_codon_seq in alt_codon_seqs:
                        if alt_codon_seq == codon.codon_sequence:
                            continue

                        muts = [
                            i
                            for i in range(3)
                            if alt_codon_seq[i] != codon.codon_sequence[i]
                        ]
                        mutations_in_rs = list(set(muts) & set(codon.rs_overlap))
                        if not mutations_in_rs:
                            continue

                        usage = self.utils.get_codon_usage(
                            alt_codon_seq, codon.amino_acid, self.codon_usage_dict
                        )
                        valid_alternative = Codon(
                            amino_acid=codon.amino_acid,
                            context_position=codon.context_position,
                            codon_sequence=alt_codon_seq,
                            rs_overlap=codon.rs_overlap,
                            usage=usage,
                        )
                        mutation_codon = MutationCodon(
                            codon=valid_alternative, nth_codon_in_rs=codon_idx + 1
                        )
                        valid_mutations.append(
                            {
                                "mutCodons": [mutation_codon],
                                "mutContext": site.context_seq,
                                "overhangOptions": [],
                            }
                        )

                        # Integrate progress update here
                        completed_operations += 1
                        prog = min(
                            99,
                            int(
                                (completed_operations / total_estimated_operations)
                                * 100
                            ),
                        )
                        send_update(
                            message=f"Analyzing site {site_idx + 1}/{len(restriction_sites)}",
                            prog=prog,
                        )

                if valid_mutations:
                    mutation_options[rs_key] = valid_mutations

            send_update(
                message="Mutation Analysis Complete",
                prog=100,
                mutation_options=mutation_options,
            )
            return mutation_options

        except Exception as e:
            # logger.error(f"Critical error in mutation analysis: {e}", exc_info=True)
            raise e

    def _calculate_sticky_ends_with_context(
        self, mutated_ctx: str, first_mut_idx: int, last_mut_idx: int
    ) -> Dict:
        # logger.log_step(
        #     "Calculate Sticky Ends", "Calculating sticky ends for the mutated context"
        # )
        # logger.debug(f"first_mut_idx: {first_mut_idx}")
        # logger.debug(f"last_mut_idx: {last_mut_idx}")
        sticky = {}
        for pos in sorted({first_mut_idx, last_mut_idx}):
            pos_sticky = {"top_strand": [], "bottom_strand": []}
            ranges = [
                range(pos - 3, pos + 1),
                range(pos - 2, pos + 2),
                range(pos - 1, pos + 3),
                range(pos, pos + 4),
            ]
            for r in ranges:
                if 0 <= min(r) and max(r) < len(mutated_ctx):
                    top = "".join(mutated_ctx[i] for i in r)
                    bottom = self.utils.reverse_complement(top)
                    pos_sticky["top_strand"].append(
                        {"seq": top, "overhang_start_index": r.start}
                    )
                    pos_sticky["bottom_strand"].append(
                        {"seq": bottom, "overhang_start_index": r.start}
                    )
            sticky[f"position_{pos}"] = pos_sticky
            # logger.log_step(
            #     "Sticky Ends Calculated",
            #     f"Calculated sticky ends for position {pos} with {len(pos_sticky['top_strand'])} option(s)",
            # )
        return sticky

    def _get_combined_mutated_context(
        self, context_sequence: str, mutations_info: List[Dict]
    ) -> tuple:
        """
        Generate a mutated context sequence by applying multiple codon substitutions and
        calculate the first and last mutation indices within the overall context.

        Args:
            context_sequence (str): The full context sequence.
            mutations_info (List[Dict]): Each dictionary should include:
                - 'codon_context_position' (int): The starting index of the codon in the context sequence.
                - 'new_codon_sequence' (str): The new codon sequence (must be exactly 3 nucleotides).
                - 'muts' (List[int]): List of indices (0-indexed within the codon) that have been mutated.

        Returns:
            tuple: A tuple containing:
                - mutated_context (str): The updated context sequence after all substitutions.
                - mutated_context_first_mutation_index (int): Global position of the first mutated base.
                - mutated_context_last_mutation_index (int): Global position of the last mutated base.

        Raises:
            ValueError: If any new codon is not 3 nucleotides long or if no mutated bases are provided for a mutation.
        """
        # Convert the context sequence to a list for in-place modifications.
        seq_list = list(context_sequence)

        # Lists to hold global positions of each mutation.
        global_mutation_positions = []

        for mutation in mutations_info:
            codon_pos = mutation["codon_context_position"]
            new_codon = mutation["new_codon_sequence"]
            muts = mutation["muts"]

            if len(new_codon) != 3:
                raise ValueError("New codon must be 3 nucleotides long.")
            if not muts:
                raise ValueError(
                    "No mutated bases provided in new_codon_mutated_bases."
                )
            if codon_pos < 0 or codon_pos + 3 > len(context_sequence):
                raise ValueError(
                    "Invalid codon_context_position or context_sequence too short for the swap."
                )

            # Replace the codon in the sequence.
            seq_list[codon_pos : codon_pos + 3] = list(new_codon)

            # Calculate global mutation indices for this codon.
            local_first = min(muts)
            local_last = max(muts)
            global_first = codon_pos + local_first
            global_last = codon_pos + local_last
            global_mutation_positions.extend([global_first, global_last])

        # The overall first mutation index is the minimum of all global mutation positions,
        # and the overall last mutation index is the maximum.
        mutated_context_first_mutation_index = min(global_mutation_positions)
        mutated_context_last_mutation_index = max(global_mutation_positions)

        mutated_context = "".join(seq_list)
        return (
            mutated_context,
            mutated_context_first_mutation_index,
            mutated_context_last_mutation_index,
        )
