# services/reactions.py

from typing import List, Any

from flask_backend.logging import logger
from flask_backend.models import (
    DomesticationResult,
    Primer,
    MutationPrimerSet,
    PCRReaction,
)


class ReactionOrganizer:
    """
    Organizes mutation primer sets into PCR reactions.
    """

    def __init__(
        self, seq_to_dom: str, utils: Any, verbose: bool = False, debug: bool = False
    ):
        self.seq_to_dom = seq_to_dom
        self.verbose = verbose
        self.debug = debug
        self.utils = utils

    def create_pcr_reaction(
        self, name: str, forward_primer: Primer, reverse_primer: Primer
    ) -> PCRReaction:
        """
        Create a PCRReaction object with all required fields.
        """
        with logger.timer_context(f"Calculate amplicon size for {name}"):
            amplicon_size = self.utils.calculate_amplicon_size(
                forward_primer.sequence, reverse_primer.sequence, self.seq_to_dom
            )

        return PCRReaction(
            name=name,
            forward_primer=forward_primer,
            reverse_primer=reverse_primer,
            amplicon_size=amplicon_size,
        )

    def group_primers_into_pcr_reactions(
        self, domestication_result: DomesticationResult, send_update: callable
    ) -> dict:
        """
        Groups primers into nested PCR reactions using chaining logic for each mutation solution.
        Expects domestication_result to have:
            - edge_primers: an object with properties "forward" and "reverse" (both Primer objects)
            - mut_primers: a list of MutationPrimerSet objects.
        The nested dictionary structure returned is:
            {
                "mutation_sets": [
                    {
                        "set_id": int,
                        "solutions": [
                            {
                                "solution_id": int,
                                "reactions": [<PCRReaction>, ...]
                            }
                        ]
                    },
                    ...
                ]
            }
        Sends progress updates to the frontend through send_update.
        The final update sends the complete results.
        """
        nested_reactions = {"mutation_sets": []}
        logger.log_step(
            "Group PCR Reactions",
            "Starting grouping of primers into nested PCR reactions.",
        )
        send_update(message="Starting PCR Reaction Grouping", prog=0)

        with logger.timer_context("Retrieve edge primers"):
            edge_fw: Primer = domestication_result.edge_primers.forward
            edge_rv: Primer = domestication_result.edge_primers.reverse
            logger.log_step(
                "Edge Primers Retrieved",
                "Edge primers obtained.",
                {"edge_forward": edge_fw.sequence, "edge_reverse": edge_rv.sequence},
            )
        send_update(message="Edge primers retrieved", prog=10)

        with logger.timer_context("Retrieve mutation primer sets"):
            mut_primers_collection: List[MutationPrimerSet] = (
                domestication_result.mut_primers
            )
            logger.log_step(
                "Mutation Primers Retrieved",
                "Mutation primers data obtained.",
                {"mutation_set_count": len(mut_primers_collection)},
            )
            logger.log_step(
                "Mutation Primers Data",
                "Mutation primers data details.",
                {"mutation_primers": mut_primers_collection},
            )
        send_update(message="Mutation primer sets retrieved", prog=20)

        if not mut_primers_collection:
            with logger.timer_context(
                "Create edge-only reaction - no mutation primers"
            ):
                reaction_label = "reaction_1"
                pcr_reaction = self.create_pcr_reaction(
                    name=reaction_label, forward_primer=edge_fw, reverse_primer=edge_rv
                )
            logger.log_step(
                "No Mutation Primers",
                "No mutation primers found; created edge-only reaction.",
                {"reaction": reaction_label},
            )
            default_mutation_set = {
                "set_id": 0,
                "solutions": [{"solution_id": 0, "reactions": [pcr_reaction]}],
            }
            nested_reactions["mutation_sets"].append(default_mutation_set)
            send_update(
                message="Edge-only reaction created", prog=100, results=nested_reactions
            )
            return nested_reactions

        total_sets = len(mut_primers_collection)
        for set_idx, mut_primer_set in enumerate(mut_primers_collection):
            with logger.timer_context(f"Process mutation set {set_idx}"):
                logger.log_step(
                    "Process Mutation Set",
                    f"Processing mutation set {set_idx + 1} of {total_sets}",
                    "",
                )
                logger.log_step(
                    "Mutation Primer Set",
                    "Mutation primer set details.",
                    {"mutation_primer_set": mut_primer_set},
                )
                solution_data = {"solution_id": 0, "reactions": []}
                reaction_num = 1

                mut_primer_pairs = mut_primer_set.mut_primer_pairs

                if not mut_primer_pairs:
                    with logger.timer_context(
                        f"Create edge-only reaction for set {set_idx}"
                    ):
                        reaction_label = f"set{set_idx}_sol0_reaction_{reaction_num}"
                        pcr_reaction = self.create_pcr_reaction(
                            name=reaction_label,
                            forward_primer=edge_fw,
                            reverse_primer=edge_rv,
                        )
                        solution_data["reactions"].append(pcr_reaction)
                        logger.log_step(
                            "PCR Reaction Created",
                            f"{reaction_label} (edge-only) created for set {set_idx}, solution 0",
                            {"forward": edge_fw.sequence, "reverse": edge_rv.sequence},
                        )
                else:
                    logger.log_step(
                        "Mutation Primer Pairs",
                        "Data available",
                        f"mut_primer_pairs count: {len(mut_primer_pairs)} pairs",
                    )

                    with logger.timer_context(
                        f"Sort and chain reactions for set {set_idx}"
                    ):
                        ordered_mut_primer_pairs = sorted(
                            mut_primer_pairs, key=lambda k: k.position
                        )

                        reaction_label = f"set{set_idx}_sol0_reaction_{reaction_num}"
                        first_rev_primer = ordered_mut_primer_pairs[0].reverse
                        pcr_reaction = self.create_pcr_reaction(
                            name=reaction_label,
                            forward_primer=edge_fw,
                            reverse_primer=first_rev_primer,
                        )
                        solution_data["reactions"].append(pcr_reaction)
                        logger.log_step(
                            "PCR Reaction Created",
                            f"{reaction_label} created for set {set_idx}, solution 0",
                            {
                                "forward": edge_fw.sequence,
                                "reverse": first_rev_primer.sequence,
                                "mutation_reverse_position": ordered_mut_primer_pairs[
                                    0
                                ].position,
                            },
                        )
                        reaction_num += 1

                        for i in range(1, len(ordered_mut_primer_pairs)):
                            reaction_label = (
                                f"set{set_idx}_sol0_reaction_{reaction_num}"
                            )
                            forward_primer = ordered_mut_primer_pairs[i - 1].forward
                            reverse_primer = ordered_mut_primer_pairs[i].reverse
                            pcr_reaction = self.create_pcr_reaction(
                                name=reaction_label,
                                forward_primer=forward_primer,
                                reverse_primer=reverse_primer,
                            )
                            solution_data["reactions"].append(pcr_reaction)
                            logger.log_step(
                                "PCR Reaction Created",
                                f"{reaction_label} created for set {set_idx}, solution 0",
                                {
                                    "forward": forward_primer.sequence,
                                    "reverse": reverse_primer.sequence,
                                    "from_mutation_position": ordered_mut_primer_pairs[
                                        i - 1
                                    ].position,
                                    "to_mutation_position": ordered_mut_primer_pairs[
                                        i
                                    ].position,
                                },
                            )
                            reaction_num += 1

                        reaction_label = f"set{set_idx}_sol0_reaction_{reaction_num}"
                        last_forward_primer = ordered_mut_primer_pairs[-1].forward
                        pcr_reaction = self.create_pcr_reaction(
                            name=reaction_label,
                            forward_primer=last_forward_primer,
                            reverse_primer=edge_rv,
                        )
                        solution_data["reactions"].append(pcr_reaction)
                        logger.log_step(
                            "PCR Reaction Created",
                            f"{reaction_label} created for set {set_idx}, solution 0",
                            {
                                "forward": last_forward_primer.sequence,
                                "reverse": edge_rv.sequence,
                                "from_mutation_position": ordered_mut_primer_pairs[
                                    -1
                                ].position,
                            },
                        )

                logger.log_step(
                    "Mutation Set Processed",
                    f"Completed grouping for set {set_idx}, solution 0",
                    {"total_reactions": reaction_num},
                )
                # Calculate and send progress update for this mutation set.
                current_progress = 20 + int(
                    (set_idx + 1) / total_sets * 70
                )  # progress between 20 and 90
                send_update(
                    message=f"Processed mutation set {set_idx + 1} of {total_sets}",
                    prog=current_progress,
                )

                mutation_set_data = {"set_id": set_idx, "solutions": [solution_data]}
                nested_reactions["mutation_sets"].append(mutation_set_data)

        # Final update with the complete results.
        send_update(
            message="Mutation Analysis Complete",
            prog=100,
            mutation_options=mutation_options,
        )
        return nested_reactions
