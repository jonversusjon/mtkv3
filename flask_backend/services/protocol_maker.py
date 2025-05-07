# services/protocol.py

from typing import Dict, Optional
from functools import partial

from flask_backend.models import (
    DomesticationResult,
    SequenceToDomesticate,
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
        max_results: str = "one",
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
        self.primer_designer = PrimerDesigner(kozak=kozak, verbose=verbose, debug=True)
        self.reaction_organizer = ReactionOrganizer(
            seq_to_dom=sequence_to_domesticate,
            utils=self.utils,
            verbose=verbose,
            debug=True,
        )

        # logger.debug(
        #     f"Protocol maker for sequence {request_idx + 1} initialized with codon_usage_dict: {codon_usage_dict}"
        # )
        # if verbose:
            # logger.log_step(
            #     "Verbose Mode", "Protocol maker is running in verbose mode."
            # )

        self.request_idx = request_idx
        self.seq_to_dom: SequenceToDomesticate = sequence_to_domesticate
        self.template_seq = template_seq
        self.kozak = kozak
        self.verbose = verbose
        self.codon_usage_dict = codon_usage_dict
        self.max_mutations = max_mutations
        self.output_tsv_path = output_tsv_path
        self.max_results = max_results
        self.job_id = job_id

    def create_gg_protocol(self, send_update) -> dict:
        """
        Main function to orchestrate the Golden Gate protocol creation in stages.
        """
        # logger.log_step("Protocol Start", f"Processing sequence {self.request_idx + 1}")
        dom_result = DomesticationResult(
            sequence_index=self.request_idx,
            mtk_part_left=self.seq_to_dom.mtk_part_left,
            mtk_part_right=self.seq_to_dom.mtk_part_right,
        )

        # Stage 1: Preprocessing and Restriction Site Detection
        processed_seq, valid_seq = self.sequence_preparator.preprocess_sequence(
            self.seq_to_dom.sequence,
            self.seq_to_dom.mtk_part_left,
            partial(send_update, step="Preprocessing"),
        )
        if not valid_seq:
            return dom_result
        dom_result.processed_sequence = str(processed_seq)

        restriction_sites = self.rs_analyzer.find_restriction_sites(
            processed_seq, partial(send_update, step="Restriction Sites")
        )
        dom_result.restriction_sites = restriction_sites

        if restriction_sites:
            # Stage 2: Mutation Analysis
            mutation_options = self.mutation_analyzer.get_all_mutations(
                restriction_sites, partial(send_update, step="Mutation Analysis")
            )
            dom_result.mutation_options = mutation_options

            # Stage 3: Primer Design (Background)
            if mutation_options:
                best_mutations = self._select_best_mutations(mutation_options)
                dom_result.recommended_primers = (
                    self.primer_designer.design_mutation_primers(
                        mutation_sets=best_mutations,
                        primer_name="",
                        max_results_str=self.max_results,
                        send_update=partial(send_update, step="Primer Design"),
                        batch_update_interval=1,
                    )
                )

        return dom_result

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
