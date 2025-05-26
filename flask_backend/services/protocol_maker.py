# services/protocol.py

from typing import Dict, Optional
from functools import partial
import numpy as np

from flask_backend.models import (
    DomesticationResult,
    SequenceToDomesticate,
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
# from flask_backend.logging import logger


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
    ):
        self.debug = debug

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

        self.request_idx = request_idx
        self.seq_to_dom: SequenceToDomesticate = sequence_to_domesticate
        self.template_seq = template_seq
        self.kozak = kozak
        self.verbose = verbose
        self.codon_usage_dict = codon_usage_dict
        self.max_mutations = max_mutations
        self.output_tsv_path = output_tsv_path
        self.job_id = job_id

    def create_gg_protocol(self, send_update) -> dict:
        """
        Main function to orchestrate the Golden Gate protocol creation in stages.
        """
        # Use primer_name as identifier, or fallback to sequence index if not available
        sequence_identifier = getattr(
            self.seq_to_dom, "primer_name", f"Sequence_{self.request_idx + 1}"
        )

        print(
            f"Processing sequence {self.request_idx + 1} with name: {sequence_identifier}"
        )

        dom_result = DomesticationResult(
            sequence_index=self.request_idx,
            mtk_part_left=self.seq_to_dom.mtk_part_left,
            mtk_part_right=self.seq_to_dom.mtk_part_right,
        )
        # Stage 1: Preprocessing and Restriction Site Detection
        processed_seq, sequence_prep_msg, valid_seq = (
            self.sequence_preparator.preprocess_sequence(
                self.seq_to_dom.sequence,
                self.seq_to_dom.mtk_part_left,
                partial(send_update, step="Preprocessing"),
            )
        )
        print(f"Processed sequence: {processed_seq}")
        print(f"sequence_prep_msg: {sequence_prep_msg}")
        print(f"Valid sequence: {valid_seq}")
        if not valid_seq:
            return dom_result.__dict__

        dom_result.processed_sequence = processed_seq

        restriction_sites = self.rs_analyzer.find_restriction_sites(
            sequence_prep_msg, partial(send_update, step="Restriction Sites")
        )
        print(f"Restriction sites: {restriction_sites}")
        if restriction_sites:
            # Stage 2: Mutation Analysis
            mutation_options = self.mutation_analyzer.get_all_mutations(
                restriction_sites, partial(send_update, step="Mutation Analysis")
            )
            print(f"Mutation options: {mutation_options}")
            # Convert mutation_options dict to list of Mutation objects
            mutation_list = []
            for site_key, mutations in mutation_options.items():
                for mutation_dict in mutations:
                    # Assuming mutation_dict contains the necessary data to create a Mutation object
                    # You may need to adjust this based on your Mutation class structure
                    mutation_list.extend(mutation_dict.get("mutCodons", []))
            dom_result.mutation_options = mutation_list

            # Stage 3: Primer Design (Background)
            if mutation_options:
                best_mutations = self._select_best_mutations(mutation_options)

                # Convert best_mutations dictionary to a MutationSetCollection object
                # Get the restriction site keys (rs_keys)
                # Create a MutationSet object with the best mutations
                mutation_set = MutationSet(
                    alt_codons=best_mutations,
                    compatibility=np.array([[1]]),  # Convert to numpy array
                    mut_primer_sets=[],
                )

                # Create the MutationSetCollection with correct parameter names
                rs_keys = list(mutation_options.keys())
                mutation_collection = MutationSetCollection(
                    rs_keys=rs_keys, sets=[mutation_set]
                )
                print(f"Created MutationSetCollection with rs_keys: {rs_keys}")
                self.primer_designer.design_mutation_primers(
                    mutation_sets=mutation_collection,
                    primer_name="",
                    send_update=partial(send_update, step="Primer Design"),
                    batch_update_interval=1,
                )
                # Convert primer results to proper format if needed
                # dom_result.recommended_primers = primer_results  # Commented out due to type mismatch

        return dom_result
        # return dom_result.__dict__

    def _select_best_mutations(self, mutation_options):
        """
        Select the best mutations based on a heuristic (e.g., highest codon usage).
        """
        best_mutations = {}
        for site_key, mutations in mutation_options.items():
            best_mutations[site_key] = max(
                mutations, key=lambda m: m["mutCodons"][0].codon.usage
            )
        return best_mutations
