import React, { useState, useEffect } from "react";
import { toast } from "react-toastify";
import { designPrimers } from "../../api/goldenGateApi";
import MutationExplorerContainer from "./MutationExplorerContainer";

/**
 * Group and de-duplicate codon options for a given site.
 * In addition to the original grouping by codon.contextPosition,
 * the function now marks a codon as "recommended" if it matches
 * the recommended mutation (if available for this site).
 */
const groupUniqueCodons = (site) => {
  const groups = {};
  site.mutations.forEach((mutation, mIndex) => {
    if (mutation.mutCodons) {
      mutation.mutCodons.forEach((mutCodon) => {
        const codon = mutCodon.codon;
        if (codon.contextPosition === undefined) return;
        const groupKey = `Position ${codon.contextPosition}`;
        if (!groups[groupKey]) {
          groups[groupKey] = {};
        }
        const seq = codon.codonSequence;
        if (!groups[groupKey][seq]) {
          groups[groupKey][seq] = {
            codon,
            mutationIndices: [mIndex],
            isRecommended:
              site.recommendedMutations &&
              site.recommendedMutations[site.siteKey] &&
              site.recommendedMutations[site.siteKey].codon_sequence === seq,
          };
        } else {
          groups[groupKey][seq].mutationIndices.push(mIndex);
        }
      });
    }
  });
  return groups;
};

// Find the original codon from the context sequence based on position
const getOriginalCodon = (site, position) => {
  if (
    !site.originalSequence ||
    position === undefined ||
    position < 0 ||
    position + 2 >= site.originalSequence.length
  ) {
    return null;
  }
  return site.originalSequence.substring(position, position + 3);
};

// Get the recognition site sequence from a mutation
const getRecognitionSiteSequence = (mutation) => {
  if (!mutation.contextRsIndices || !mutation.nativeContext) {
    return null;
  }

  // Find the continuous range of recognition site indices
  let startIdx = Math.min(...mutation.contextRsIndices);
  let endIdx = Math.max(...mutation.contextRsIndices) + 1;

  return {
    original: mutation.nativeContext.substring(startIdx, endIdx),
    mutated: mutation.mutContext?.substring(startIdx, endIdx),
  };
};

/**
 * MutationExplorer component
 *
 * This component processes mutation data coming either in the new mutationOptions
 * format or the legacy mutationSets format. It retains all the original functionality,
 * including:
 *   - Organizing mutations by site and codon grouping
 *   - Rendering detailed codon options with original and mutated context sequences
 *   - "Copy Original" / "Copy Mutated" buttons for context sequences
 *   - Sticky summary and detailed mutation information
 *   - Primer design request (with toast notifications) and recommended mutation highlighting
 */
const MutationExplorer = ({ stepSseData, selectedMutationSetIndex = 0 }) => {
  // State management (selection indices, codon options, UI state, etc.)
  const [selectedMutations, setSelectedMutations] = useState({});
  const [selectedCodonOption, setSelectedCodonOption] = useState({});
  const [mutationOptions, setMutationOptions] = useState({});
  const [recommendedMutations, setRecommendedMutations] = useState({});
  const [isDesigning, setIsDesigning] = useState(false);
  const [restrictionSites, setRestrictionSites] = useState([]);
  const [copiedStates, setCopiedStates] = useState({});

  useEffect(() => {
    if (!stepSseData) return;

    // If recommended mutations are provided, save them
    if (stepSseData.recommendedMutations) {
      setRecommendedMutations(stepSseData.recommendedMutations);
    }

    let sitesData = [];

    // Process mutationOptions (new format) if available
    const mutationOptionsData =
      stepSseData.mutationOptions || stepSseData.mutation_options || {};
    if (Object.keys(mutationOptionsData).length > 0) {
      setMutationOptions(mutationOptionsData);
      // Expected format: { [siteKey]: [mutation, ...] }
      sitesData = Object.entries(mutationOptionsData).map(
        ([siteKey, mutations]) => {
          return {
            siteKey,
            mutations,
            contextSequences: new Set(mutations.map((m) => m.mutContext)),
            originalSequence: mutations[0]?.nativeContext || null,
            recommendedMutations: recommendedMutations,
          };
        }
      );
    } else if (
      stepSseData.mutationSets &&
      stepSseData.mutationSets.sets &&
      stepSseData.mutationSets.sets.length > 0
    ) {
      // Process legacy mutationSets using the original organizeBySite logic
      const { sets, rsKeys } = stepSseData.mutationSets;
      const organizeBySite = (sets, rsKeys) => {
        if (!sets || !Array.isArray(sets) || sets.length === 0) return [];
        const siteMap = {};
        if (rsKeys && Array.isArray(rsKeys)) {
          rsKeys.forEach((key) => {
            siteMap[key] = {
              siteKey: key,
              mutations: [],
              contextSequences: new Set(),
              originalSequence: null,
              recommendedMutations: recommendedMutations,
            };
          });
        }
        sets.forEach((set) => {
          if (!set.altCodons) return;
          Object.keys(set.altCodons).forEach((siteKey) => {
            if (!siteMap[siteKey]) {
              siteMap[siteKey] = {
                siteKey,
                mutations: [],
                contextSequences: new Set(),
                originalSequence: null,
                recommendedMutations: recommendedMutations,
              };
            }
            const mutation = set.altCodons[siteKey];
            if (!mutation) return;
            if (!siteMap[siteKey].originalSequence) {
              siteMap[siteKey].originalSequence = mutation.nativeContext;
            }
            // Only add unique mutations (by comparing key properties)
            const exists = siteMap[siteKey].mutations.findIndex(
              (m) =>
                m.mutContext === mutation.mutContext &&
                m.firstMutIdx === mutation.firstMutIdx &&
                m.lastMutIdx === mutation.lastMutIdx
            );
            if (exists === -1) {
              siteMap[siteKey].mutations.push(mutation);
              siteMap[siteKey].contextSequences.add(mutation.mutContext);
            }
          });
        });
        return Object.values(siteMap).filter(
          (site) => site.mutations.length > 0
        );
      };
      sitesData = organizeBySite(sets, rsKeys);
    }

    // Save the organized data
    setRestrictionSites(sitesData);

    // Initialize selected mutation indices and default codon options for each site
    const initSelected = {};
    const initCodonOptions = {};
    sitesData.forEach((site) => {
      initSelected[site.siteKey] = 0;
      if (
        site.mutations.length > 0 &&
        site.mutations[0].mutCodons &&
        site.mutations[0].mutCodons.length > 0
      ) {
        const groups = groupUniqueCodons(site);
        const firstGroupKey = Object.keys(groups).sort((a, b) => {
          const posA = parseInt(a.replace("Position ", ""));
          const posB = parseInt(b.replace("Position ", ""));
          return posA - posB;
        })[0];
        if (firstGroupKey && Object.values(groups[firstGroupKey]).length > 0) {
          initCodonOptions[site.siteKey] = `${firstGroupKey}:0`;
        }
      }
    });
    setSelectedMutations(initSelected);
    setSelectedCodonOption(initCodonOptions);
  }, [stepSseData, recommendedMutations]);

  // Copies text to clipboard and shows feedback
  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedStates((prev) => ({ ...prev, [id]: true }));
      setTimeout(() => {
        setCopiedStates((prev) => ({ ...prev, [id]: false }));
      }, 2000);
    });
  };

  // Handler for primer design request
  const handleDesignPrimers = async () => {
    if (Object.keys(selectedMutations).length === 0) {
      toast.warning("Please select mutations for all sites");
      return;
    }
    setIsDesigning(true);
    try {
      const jobId = sessionStorage.getItem("jobId");
      const sequenceIdx = sessionStorage.getItem("currentSequenceIdx");

      // Prepare selected mutations for primer design:
      // iterate over each site and pick the codon sequence based on the selected codon option.
      const mutationSelections = {};
      Object.keys(selectedCodonOption).forEach((siteKey) => {
        if (selectedCodonOption[siteKey]) {
          const [positionKey, optionIndexStr] =
            selectedCodonOption[siteKey].split(":");
          const optionIndex = parseInt(optionIndexStr);
          const site = restrictionSites.find((s) => s.siteKey === siteKey);
          if (site) {
            const groups = groupUniqueCodons(site);
            if (groups[positionKey]) {
              const options = Object.values(groups[positionKey]);
              if (options.length > optionIndex && options[optionIndex].codon) {
                mutationSelections[siteKey] =
                  options[optionIndex].codon.codonSequence;
              }
            }
          }
        }
      });

      await designPrimers({
        job_id: jobId,
        sequence_idx: sequenceIdx,
        selected_mutations: mutationSelections,
      });
      toast.success("Primer design started");
    } catch (error) {
      console.error("Failed to request primer design:", error);
      toast.error("Failed to request primer design");
    } finally {
      setIsDesigning(false);
    }
  };

  const handleCodonSelect = (siteKey, groupKey, optionIndex) => {
    setSelectedCodonOption((prev) => ({
      ...prev,
      [siteKey]: `${groupKey}:${optionIndex}`,
    }));
  };

  if (
    restrictionSites.length === 0 &&
    Object.keys(mutationOptions).length === 0
  ) {
    return (
      <div className="p-4 bg-yellow-100 dark:bg-yellow-900 border border-yellow-400 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200 rounded-sm">
        No mutation data available to explore
      </div>
    );
  }

  return (
    <MutationExplorerContainer
      stepSseData={stepSseData}
      selectedMutationSetIndex={selectedMutationSetIndex}
      restrictionSites={restrictionSites}
      selectedMutations={selectedMutations}
      selectedCodonOption={selectedCodonOption}
      handleDesignPrimers={handleDesignPrimers}
      isDesigning={isDesigning}
      setSelectedMutations={setSelectedMutations}
      setSelectedCodonOption={handleCodonSelect}
      getOriginalCodon={getOriginalCodon}
      getRecognitionSiteSequence={getRecognitionSiteSequence}
      copyToClipboard={copyToClipboard}
      copiedStates={copiedStates}
    />
  );
};

export default MutationExplorer;
