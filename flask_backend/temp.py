    def design_mutation_primers(
        self,
        mutation_sets: MutationSetCollection,
        primer_name: str,
        max_results_str: str,
        send_update: callable
    ):
        """
        Designs mutation primers for the provided mutation sets using compatibility matrices.
        Returns a list of MutationPrimerSet objects.
        """
        logger.log_step(
            "Design Mutation Primers",
            "Starting primer design process",
            {"mutation_sets": mutation_sets, "primer_name": primer_name, "max_results": max_results_str}
        )
        
        # Calculate number of restriction sites.
        num_restriction_sites = len(mutation_sets.rs_keys)
        
        # Precompute total valid coordinates across all mutation sets.
        total_valid_coords = sum(
            np.argwhere(np.array(mut_set.compatibility) == 1).shape[0]
            for mut_set in mutation_sets.sets
        )
        
        max_results = RESULT_MAPPING.get(max_results_str, lambda num_sites, total_coords: 1)(
            num_restriction_sites, total_valid_coords
        )
        
        all_primers: List[MutationPrimerSet] = []
        mut_rs_keys = mutation_sets.rs_keys
        
        for idx, mut_set in enumerate(mutation_sets.sets):
            comp_matrix = mut_set.compatibility

            # Validate and log valid overhang combinations.
            valid_coords = np.argwhere(np.array(comp_matrix) == 1)
            logger.validate(
                valid_coords.size > 0,
                f"Found {np.count_nonzero(comp_matrix)} valid overhang combination(s)",
                {"matrix_size": np.array(comp_matrix).size}
            )
            logger.log_step(
                "Valid Coordinates",
                f"Mutation set {idx+1}: Valid coordinates: {valid_coords.tolist()}"
            )
            logger.log_step(
                "Matrix Visualization",
                f"Compatibility matrix for set {idx+1}",
                logger.visualize_matrix(comp_matrix)
            )

            # Determine which coordinate combinations to process.
            if max_results == 0:
                coords_to_process = valid_coords.tolist()
                logger.log_step(
                    "Processing All Coordinates",
                    f"Processing all {len(coords_to_process)} valid coordinate combination(s)."
                )
            else:
                sample_size = min(max_results, valid_coords.shape[0])
                selected_indices = np.random.choice(valid_coords.shape[0], size=sample_size, replace=False)
                coords_to_process = [valid_coords[i].tolist() for i in selected_indices]
                logger.log_step(
                    "Random Coordinate Selection",
                    f"Randomly selected {sample_size} coordinate combination(s): {coords_to_process}"
                )

            mut_set_primer_pairs = []
            for coords in coords_to_process:
                # Use the new _construct_mutation_primer_set that operates on alt_codons.
                primer_pairs: List[MutationPrimerPair] = self._construct_mutation_primer_set(
                    mut_rs_keys=mut_rs_keys,
                    mutation_set=mut_set,
                    selected_coords=coords,
                    primer_name=primer_name
                )
                
                logger.validate(
                    primer_pairs is not None,
                    "Successfully constructed mutation primers",
                    {"primer_count": len(primer_pairs) if primer_pairs else 0}
                )
                
                if primer_pairs:
                    logger.log_step(
                        "Constructed Primers",
                        f"Constructed mutation primer pairs for combination {coords}: {primer_pairs}"
                    )
                    mut_set_primer_pairs.extend(primer_pairs)

            logger.log_step(
                "Set Summary",
                f"Total primer pairs constructed for mutation set {idx+1}: {len(mut_set_primer_pairs)}"
            )
            
            # Create a MutationPrimerSet object for this mutation set.
            if mut_set_primer_pairs:
                # Wrap the list of MutationPrimerPair objects in a MutationPrimerSet.
                primer_set = MutationPrimerSet(mut_primer_pairs=mut_set_primer_pairs)
                # Save the primer pairs back to the mutation set.
                mut_set.mut_primer_sets = mut_set_primer_pairs
                all_primers.append(primer_set)
            
        if not all_primers:
            if self.debug:
                logger.log_step(
                    "Design Failure",
                    "Failed to design primers for any mutation set",
                    level=logging.WARNING
                )
            send_update(
                message="No valid primer sets found",
                prog=100,
                notification_count=1,
                callout="ERROR: No valid primer sets found for mutations."
            )
            return None

        send_update(message=f"{len(all_primers)} mutation primer sets designed successfully", prog=100)
        
        return all_primers


    def _construct_mutation_primer_set(
        self,
        mut_rs_keys: List[str],
        mutation_set: MutationSet,
        selected_coords: list,
        primer_name: str = None,
        min_binding_length: int = 10
    ) -> list[MutationPrimerPair]:
        """
        Constructs forward and reverse mutation primers for each mutation in the mutation_set.
        Expects mutation_set.alt_codons to be a dict mapping each rsKey to a Mutation object.
        """
        logger.log_step(
            "Construct Primers",
            f"Binding length: {min_binding_length}",
            {"selected_coords": selected_coords}
        )
        mutation_primers = []
        # Iterate in the order provided by mut_rs_keys.
        for i, rs_key in enumerate(mut_rs_keys):
            # Get the corresponding Mutation from the alt_codons mapping.
            mutation = mutation_set.alt_codons[rs_key]
            # The selected_coords list must provide one index per restriction site.
            selected_overhang = selected_coords[i]
            # Access overhang_options as a list of OverhangOption objects.
            overhang_options = mutation.overhang_options
            if selected_overhang >= len(overhang_options):
                raise IndexError(f"Selected overhang index {selected_overhang} out of range for restriction site {rs_key}")
            overhang_data: OverhangOption = overhang_options[selected_overhang]
            mutated_context = mutation.mut_context
            overhang_start = overhang_data.overhang_start_index

            tm_threshold = self.default_params["tm_threshold"]

            # Design forward primer.
            f_5prime = overhang_start - 1
            f_seq_length = min_binding_length
            f_anneal = mutated_context[f_5prime:f_5prime + f_seq_length]
            while self.utils.calculate_tm(f_anneal) < tm_threshold and f_seq_length < self.max_binding_length:
                f_seq_length += 1
                f_anneal = mutated_context[f_5prime:f_5prime + f_seq_length]

            logger.log_step(
                "Forward Primer",
                f"Annealing region: {f_anneal[1:5]} vs expected: {overhang_data.top_overhang}"
            )
            logger.validate(
                f_anneal[1:5].strip().upper() == overhang_data.top_overhang.strip().upper(),
                f"Forward annealing region mismatch: got {f_anneal[1:5]}"
            )
            f_primer_seq = self.spacer + self.bsmbi_site + f_anneal

            # Design reverse primer.
            r_5prime = overhang_start + 5
            r_seq_length = min_binding_length
            r_anneal = mutated_context[r_5prime:r_5prime + r_seq_length]
            while self.utils.calculate_tm(r_anneal) < tm_threshold and r_seq_length < self.max_binding_length:
                r_seq_length += 1
                r_anneal = mutated_context[r_5prime - r_seq_length:r_5prime]
            r_anneal = self.utils.reverse_complement(r_anneal)
            r_primer_seq = self.spacer + self.bsmbi_site + r_anneal

            logger.log_step(
                "Reverse Primer",
                f"Annealing region: {r_anneal[1:5]} vs expected: {overhang_data.bottom_overhang}"
            )
            logger.validate(
                r_anneal[1:5].strip().upper() == overhang_data.bottom_overhang.strip().upper(),
                f"Reverse annealing region mismatch: got {r_anneal[1:5]}"
            )

            # Create Primer objects.
            f_primer = Primer(
                name=(primer_name + "_forward") if primer_name else f"primer_{i}_forward",
                sequence=f_primer_seq,
                binding_region=f_anneal,
                tm=self.utils.calculate_tm(f_anneal),
                gc_content=self.utils.gc_content(f_anneal),
                length=len(f_primer_seq)
            )
            r_primer = Primer(
                name=(primer_name + "_reverse") if primer_name else f"primer_{i}_reverse",
                sequence=r_primer_seq,
                binding_region=r_anneal,
                tm=self.utils.calculate_tm(r_anneal),
                gc_content=self.utils.gc_content(r_anneal),
                length=len(r_primer_seq)
            )

            # For MutationPrimerPair, we need site and position.
            # Use the current rs_key and the mutation's first_mut_idx as fallbacks.
            site_val = rs_key
            position_val = mutation.first_mut_idx

            # Construct the MutationPrimerPair using the Mutation object as mutation_info.
            mutation_primer_pair = MutationPrimerPair(
                site=site_val,
                position=position_val,
                forward=f_primer,
                reverse=r_primer,
                mutation=mutation
            )
            logger.log_step(
                "Primer Pair Constructed",
                f"Designed primer pair for site {site_val} at position {position_val}"
            )
            mutation_primers.append(mutation_primer_pair)
            
            # Validation: Enforce that all primer pairs are in order of restriction site position (low to high)
            sites = [mp.site for mp in mutation_primers]
            sorted_sites = sorted(sites, key=lambda k: int(k.split('_')[1]))
            logger.validate(
                sorted_sites == sites,
                f"Mutation primer positions are not in increasing order: {sites}"
            )
        return mutation_primers
