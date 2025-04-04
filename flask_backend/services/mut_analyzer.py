import logging
from typing import Dict, List

from flask_backend.models import RestrictionSite, Codon, MutationCodon, Mutation, OverhangOption
from flask_backend.services.utils import GoldenGateUtils
from flask_backend.logging import logger

class MutationAnalyzer():
    """
    MutationAnalyzer Module

    This module provides functionality for analyzing DNA sequences to generate
    mutation options for Golden Gate assembly. The main entry and exit point
    is the get_all_mutations function.
    """

    def __init__(self,
                 codon_usage_dict: Dict[str, Dict[str, float]],
                 max_mutations: int = 1,
                 verbose: bool = False,
                 debug: bool = False):
        self.utils = GoldenGateUtils()
        self.state = {'current_codon': '',
                      'current_position': 0, 'mutations_found': []}
        self.codon_usage_dict = codon_usage_dict
        self.max_mutations = max_mutations
        self.verbose = verbose
        self.debug = debug

        logger.log_step("Initialization", f"Initializing MutationAnalyzer with verbose={verbose} and debug={debug}")
        if self.verbose:
            logger.log_step("Debug Mode", "Debug mode enabled for MutationAnalyzer")
            logger.validate(codon_usage_dict and isinstance(codon_usage_dict, dict),
                            "Codon usage dictionary is valid")
            logger.validate(isinstance(max_mutations, int) and max_mutations > 0,
                            f"Max mutations set to {max_mutations}",
                            {"valid_range": "1+"})

    def _estimate_total_mutations(
        self,
        restriction_sites: List[RestrictionSite]
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
                        for i in [idx for idx in range(3) if seq[idx] != codon.codon_sequence[idx]]
                    )
                )
                alt_counts.append(count)
            if alt_counts:
                # Now treat each site as a single unit with multiple options
                total += sum(alt_counts)
        return total

    def get_all_mutations(
        self,
        restriction_sites: List[RestrictionSite],
        send_update: callable
        ) -> Dict[str, List[Mutation]]:
        logger.log_step("Mutation Analysis", f"Starting mutation analysis for {len(restriction_sites)} site(s)")
        mutation_options = {}
        
        # Estimate total operations for tracking progress
        total_estimated_operations = self._estimate_total_mutations(restriction_sites)
        completed_operations = 0
        
        # Helper function to update progress
        def update_progress(message, increment, **kwargs):
            nonlocal completed_operations
            completed_operations += increment
            prog = min(99, int((completed_operations / total_estimated_operations) * 100))
            send_update(message=message, prog=prog, **kwargs)
        
        try:
            # Initialize progress
            send_update(message=f"Starting mutation analysis for {len(restriction_sites)} site(s)", prog=0)
            
            for site_idx, site in enumerate(restriction_sites):
                rs_key = f"mutation_{site.position}"
                logger.log_step("Process Site",
                                f"Analyzing site {site_idx+1}/{len(restriction_sites)} at position {site.position}",
                                {"site_details": site})
                update_progress(f"Processing site {site_idx+1}/{len(restriction_sites)}", 1, rs_key=rs_key)
                
                valid_mutations = []
                alternatives_by_codon = []
                
                # Process each codon in the site and collect all valid alternatives.
                for codon_idx, codon in enumerate(site.codons):
                    logger.log_step("Process Codon",
                                    f"Analyzing codon {codon_idx+1}/{len(site.codons)}: {codon.codon_sequence} at context position {codon.context_position}")
                    update_progress(f"Analyzing codon {codon_idx+1}/{len(site.codons)} in site {site_idx+1}", 1, 
                                    rs_key=rs_key, codon_index=codon_idx)
                    
                    # Retrieve all synonymous codon sequences for the given amino acid.
                    alt_codon_seqs = self.utils.get_codon_seqs_for_amino_acid(codon.amino_acid)
                    alternatives = []
                    
                    # Count number of alternatives being processed
                    alt_count = 0
                    
                    for alt_codon_seq in alt_codon_seqs:
                        alt_count += 1
                        # Skip candidate if identical to original codon
                        if alt_codon_seq == codon.codon_sequence:
                            continue

                        # Identify the positions where the alternative codon differs from the original.
                        muts = [i for i in range(3) if alt_codon_seq[i] != codon.codon_sequence[i]]
                        
                        # Only consider alternatives that affect the recognition site.
                        mutations_in_rs = list(set(muts) & set(codon.rs_overlap))
                        if not mutations_in_rs:
                            logger.debug(f"Skipping alternative {alt_codon_seq} as mutations {muts} fall outside recognition site bases {codon.rs_overlap}.")
                            continue

                        # Retrieve codon usage information.
                        usage = self.utils.get_codon_usage(alt_codon_seq, codon.amino_acid, self.codon_usage_dict)
                        valid_alternative = Codon(
                            amino_acid=codon.amino_acid,
                            context_position=codon.context_position,
                            codon_sequence=alt_codon_seq,
                            rs_overlap=codon.rs_overlap,
                            usage=usage,
                        )
                        # Wrap in MutationCodon with the appropriate codon order.
                        mutation_codon = MutationCodon(codon=valid_alternative, nth_codon_in_rs=codon_idx + 1)
                        alternatives.append({
                            'mutation_codon': mutation_codon,
                            'muts': muts,
                            'mutations_in_rs': mutations_in_rs,
                            'context_position': codon.context_position,
                        })
                    
                    # Update progress after processing all alternatives for this codon
                    update_progress(f"Processed {alt_count} alternatives for codon {codon_idx+1}", alt_count,  
                                    rs_key=rs_key, codon_index=codon_idx)
                    
                    if alternatives:
                        alternatives_by_codon.append((codon_idx, alternatives))
                
                # Generate site-level mutations treating each alternative as a separate mutation option
                # rather than generating combinations of codon changes
                combination_count = 0
                valid_mutation_count = 0
                
                if alternatives_by_codon:
                    # Process each codon position's alternatives as independent mutation options for the site
                    for codon_idx, alternatives in alternatives_by_codon:
                        for alternative in alternatives:
                            combination_count += 1
                            
                            # Treat each alternative as a single mutation
                            mutation_codons = [alternative['mutation_codon']]
                            combined_mut_indices_codon = alternative['muts']
                            combined_mut_indices_rs = alternative['mutations_in_rs']
                            
                            # Enforce the global max_mutations per restriction site.
                            if len(combined_mut_indices_codon) > self.max_mutations:
                                continue

                            # Prepare mutation details for combining the context.
                            mutations_info = [{
                                'codon_context_position': alternative['context_position'],
                                'new_codon_sequence': alternative['mutation_codon'].codon.codon_sequence,
                                'muts': alternative['muts']
                            }]
                            
                            # Use helper to get mutated context.
                            mutated_context, first_mut, last_mut = self._get_combined_mutated_context(
                                context_sequence=site.context_seq,
                                mutations_info=mutations_info
                            )
                            logger.log_step("Mutated Context",
                                            f"Calculated mutated context with first mutation index {first_mut} and last mutation index {last_mut}")
                            
                            # Calculate sticky end options.
                            overhang_options_raw = self._calculate_sticky_ends_with_context(mutated_context, first_mut, last_mut)
                            overhang_options = []
                            if isinstance(overhang_options_raw, dict):
                                for pos_key, pos_options in overhang_options_raw.items():
                                    top_options = pos_options.get("top_strand", [])
                                    bottom_options = pos_options.get("bottom_strand", [])
                                    for top_option, bottom_option in zip(top_options, bottom_options):
                                        mapped_option = {
                                            "top_overhang": top_option.get("seq", ""),
                                            "bottom_overhang": bottom_option.get("seq", ""),
                                            "overhang_start_index": top_option.get("overhang_start_index")
                                        }
                                        if mapped_option["overhang_start_index"] is None:
                                            raise ValueError("overhang_start_index is missing in the overhang option")
                                        overhang_options.append(OverhangOption(**mapped_option))
                            elif isinstance(overhang_options_raw, list):
                                overhang_options = overhang_options_raw
                            else:
                                raise ValueError("Unexpected type returned for overhang options.")
                            
                            valid_mutation = Mutation(
                                mut_codons=mutation_codons,
                                mut_codons_context_start_idx=alternative['context_position'],
                                mut_indices_rs=combined_mut_indices_rs,
                                mut_indices_codon=combined_mut_indices_codon,
                                mut_context=mutated_context,
                                native_context=site.context_seq,
                                first_mut_idx=first_mut,
                                last_mut_idx=last_mut,
                                overhang_options=overhang_options,
                                context_rs_indices=site.context_rs_indices,
                                recognition_seq=site.recognition_seq,
                                enzyme=site.enzyme
                            )
                            valid_mutations.append(valid_mutation)
                            valid_mutation_count += 1
                            
                            # Update progress for each valid mutation generated
                            if valid_mutation_count % 5 == 0:
                                update_progress(f"Generated {valid_mutation_count} valid mutations for site {site.position}", 5,
                                            rs_key=rs_key)
                            
                            logger.log_step("Valid Mutation",
                                        f"Added valid mutation for site {site.position}",
                                        {"mutation_codons": [mc.nth_codon_in_rs for mc in mutation_codons]})
                
                # Update progress for completing site processing
                if valid_mutations:
                    mutation_options[rs_key] = valid_mutations
                    logger.log_step("Site Completed", f"Site {site.position}: {len(valid_mutations)} valid mutation(s) found")
                    send_update(message="Site Completed", prog=50, rs_key=rs_key, mutation_count=len(valid_mutations))
                else:
                    logger.log_step("No Alternatives Found",
                                    f"Site {site.position}: No alternative codons found",
                                    {"site": site.position}, level=logging.WARNING)
                    logger.debug(f"Site {site.position}: Mutation analysis skipped due to absence of alternatives.")
                    update_progress(1, "No Alternatives Found", rs_key=rs_key, mutation_count=0)

            # Final update to ensure we reach 100%
            send_update(message="Mutation Analysis Complete", prog=60, mutation_options=mutation_options)
                
            logger.debug(f"Mutation options collected: {mutation_options}")
            if self.verbose:
                logger.log_step("Mutation Summary", f"Found {len(mutation_options)} site(s) with valid mutations")
            logger.validate(
                mutation_options,
                f"Generated mutation options for {len(mutation_options)} site(s)",
                {"rs_keys": list(mutation_options.keys())}
            )
            return mutation_options

        except Exception as e:
            logger.error(f"Critical error in mutation analysis: {e}", exc_info=True)
            raise e

    def _calculate_sticky_ends_with_context(self, mutated_ctx: str, first_mut_idx: int, last_mut_idx: int) -> Dict:
        logger.log_step("Calculate Sticky Ends", "Calculating sticky ends for the mutated context")
        logger.debug(f"first_mut_idx: {first_mut_idx}")
        logger.debug(f"last_mut_idx: {last_mut_idx}")
        sticky = {}
        for pos in sorted({first_mut_idx, last_mut_idx}):
            pos_sticky = {"top_strand": [], "bottom_strand": []}
            ranges = [
                range(pos - 3, pos + 1),
                range(pos - 2, pos + 2),
                range(pos - 1, pos + 3),
                range(pos, pos + 4)
            ]
            for r in ranges:
                if 0 <= min(r) and max(r) < len(mutated_ctx):
                    top = "".join(mutated_ctx[i] for i in r)
                    bottom = self.utils.reverse_complement(top)
                    pos_sticky["top_strand"].append({
                        "seq": top,
                        "overhang_start_index": r.start
                    })
                    pos_sticky["bottom_strand"].append({
                        "seq": bottom,
                        "overhang_start_index": r.start
                    })
            sticky[f"position_{pos}"] = pos_sticky
            logger.log_step("Sticky Ends Calculated", f"Calculated sticky ends for position {pos} with {len(pos_sticky['top_strand'])} option(s)")
        return sticky

    def _get_combined_mutated_context(self, context_sequence: str, mutations_info: List[Dict]) -> tuple:
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
            codon_pos = mutation['codon_context_position']
            new_codon = mutation['new_codon_sequence']
            muts = mutation['muts']
            
            if len(new_codon) != 3:
                raise ValueError("New codon must be 3 nucleotides long.")
            if not muts:
                raise ValueError("No mutated bases provided in new_codon_mutated_bases.")
            if codon_pos < 0 or codon_pos + 3 > len(context_sequence):
                raise ValueError("Invalid codon_context_position or context_sequence too short for the swap.")
            
            # Replace the codon in the sequence.
            seq_list[codon_pos:codon_pos+3] = list(new_codon)
            
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
        
        mutated_context = ''.join(seq_list)
        return mutated_context, mutated_context_first_mutation_index, mutated_context_last_mutation_index

