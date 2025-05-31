# services/protocol.py

from __future__ import annotations

from functools import partial
from typing import Dict, Optional, Callable, List, Any

from flask_backend.models import (
    DomesticationResult,
    SequenceToDomesticate,
    Mutation,
    MutationSet,
    MutationSetCollection,
)
from flask_backend.services import (
    SequencePreparator,
    RestrictionSiteDetector,
    MutationAnalyzer,
    MutationOptimizer,
    PrimerDesigner,
    ReactionOrganizer,
)
from flask_backend.services.utils import GoldenGateUtils
import json
import os
from datetime import datetime

# -----------------------------------------------------------------------------
# Helper typing
# -----------------------------------------------------------------------------
SendUpdateFn = Callable[..., None]


class ProtocolMaker:
    """
    Orchestrates the Golden Gate protocol by managing sequence preparation,
    primer design, mutation analysis, and optimization.
    """

    def __init__(
        self,
        request_idx: int,
        sequence_to_domesticate: SequenceToDomesticate,
        codon_usage_dict: Dict[str, Dict[str, float]],
        max_mutations: int,
        template_seq: Optional[str] = None,
        kozak: str = "MTK",
        output_tsv_path: str = "designed_primers.tsv",
        verbose: bool = False,
        debug: bool = False,
        job_id: Optional[str] = None,
    ) -> None:
        self.debug = debug

        # Core utilities / sub‑services --------------------------------------
        self.utils = GoldenGateUtils()
        self.sequence_preparator = SequencePreparator()
        self.rs_analyzer = RestrictionSiteDetector(codon_dict=codon_usage_dict)
        self.mutation_analyzer = MutationAnalyzer(
            codon_usage_dict=codon_usage_dict,
            max_mutations=max_mutations,
            verbose=verbose,
            debug=True,
        )
        self.mutation_optimizer = MutationOptimizer(verbose=verbose, debug=True)
        self.primer_designer = PrimerDesigner(verbose=verbose, debug=True)
        self.reaction_organizer = ReactionOrganizer(
            seq_to_dom=sequence_to_domesticate.sequence,
            utils=self.utils,
            verbose=verbose,
            debug=True,
        )

        # Instance metadata ---------------------------------------------------
        self.request_idx = request_idx
        self.seq_to_dom: SequenceToDomesticate = sequence_to_domesticate
        self.template_seq = template_seq
        self.kozak = kozak
        self.verbose = verbose
        self.codon_usage_dict = codon_usage_dict
        self.max_mutations = max_mutations
        self.output_tsv_path = output_tsv_path
        self.job_id = job_id

    # ---------------------------------------------------------------------
    # Public API
    # ---------------------------------------------------------------------
    def create_gg_protocol(self, send_update: SendUpdateFn) -> dict:
        """Run all stages for a single sequence and return a DomesticationResult dict."""

        def step(name):
            return partial(send_update, step=name)

        # ---------- Stage 0: book‑keeping -----------------------------------
        seq_name = getattr(
            self.seq_to_dom, "primer_name", f"Sequence_{self.request_idx + 1}"
        )
        print(f"Processing sequence {self.request_idx + 1}: {seq_name}")

        dom_result = DomesticationResult(
            sequence_index=self.request_idx,
            mtk_part_left=self.seq_to_dom.mtk_part_left,
            mtk_part_right=self.seq_to_dom.mtk_part_right,
        )

        # ---------- Stage 1: Pre‑process & validate -------------------------
        processed_seq, prep_msg, is_valid = (
            self.sequence_preparator.preprocess_sequence(
                self.seq_to_dom.sequence,
                self.seq_to_dom.mtk_part_left,
                step("Preprocessing"),
            )
        )
        print("Processed sequence:", processed_seq)
        print("sequence_prep_msg:", prep_msg)
        print("Valid sequence:", is_valid)
        if not is_valid:
            return dom_result.__dict__
        dom_result.processed_sequence = processed_seq

        # ---------- Stage 2: Restriction‑site detection ----------------------
        restriction_sites = self.rs_analyzer.find_restriction_sites(
            processed_seq,
            step("Restriction Sites"),
        )
        print("Restriction sites:", restriction_sites)
        if not restriction_sites:
            return dom_result.__dict__  # nothing to mutate

        # ---------- Stage 3: Mutation analysis ------------------------------
        mutation_options = self.mutation_analyzer.get_all_mutations(
            restriction_sites,
            step("Mutation Analysis"),
        )  # Dict[str, List[Mutation]]
        print("Mutation options:", mutation_options)

        # Flatten all *MutationCodon* objects just for summary output
        mutation_codons_flat: List[Any] = [
            mut_codon
            for muts in mutation_options.values()
            for mut in muts
            for mut_codon in mut.mut_codons
        ]
        dom_result.mutation_options = mutation_codons_flat  # type: ignore[attr-defined]

        # ---------- Stage 4: Pick a ‘best’ mutation per site ---------------
        if mutation_options:
            best_mutations: Dict[str, Mutation] = self._select_best_mutations(
                mutation_options
            )
            # Build a real compatibility matrix for exactly those “best” mutations:
            #    - create_compatibility_matrix expects a list of entries, each of which
            #      is a dict with key "overhangs" → {"overhang_options": [...]}
            #    - here, `m.overhang_options` is already a List[OverhangOption]
            compat_matrix = MutationOptimizer().create_compatibility_matrix(
                [
                    {"overhangs": {"overhang_options": mut.overhang_options}}
                    for mut in best_mutations.values()
                ]
            )

            mutation_set = MutationSet(
                alt_codons=best_mutations,
                compatibility=compat_matrix,
                mut_primer_sets=[],
            )

            mutation_collection = MutationSetCollection(
                rs_keys=list(best_mutations.keys()),
                sets=[mutation_set],
            )
            print(
                "Created MutationSetCollection with rs_keys:",
                mutation_collection.rs_keys,
            )
            # Debug: Write out the mutation collection to JSON for inspection

            # Create debug directory if it doesn't exist
            debug_dir = "debug_output"
            os.makedirs(debug_dir, exist_ok=True)

            # Create filename with timestamp and sequence info
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"mutation_collection_{seq_name}_{timestamp}.json"
            filepath = os.path.join(debug_dir, filename)

            # Convert mutation collection to dict for JSON serialization
            mutation_collection_dict = mutation_collection.model_dump()

            # Write to JSON file
            with open(filepath, "w") as f:
                json.dump(mutation_collection_dict, f, indent=2)

            print(f"Mutation collection written to: {filepath}")
            # ---------- Stage 5: Primer design -----------------------------
            self.primer_designer.design_mutation_primers(
                mutation_sets=mutation_collection,
                primer_name="",  # will use default naming
                send_update=step("Primer Design"),
                batch_update_interval=1,
            )

        return dom_result

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _select_best_mutations(
        self, mutation_options: Dict[str, List[Mutation]]
    ) -> Dict[str, Mutation]:
        """Pick the mutation with the highest *codon‑usage score* at each site."""
        best_mut: Dict[str, Mutation] = {}
        for site_key, mut_list in mutation_options.items():
            best_mut[site_key] = max(
                mut_list,
                key=lambda m: m.mut_codons[0].codon.usage if m.mut_codons else 0.0,
            )
        return best_mut
