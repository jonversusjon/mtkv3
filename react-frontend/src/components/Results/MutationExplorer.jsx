import React, { useState, useEffect } from "react";
import { toast } from "react-toastify";
import { designPrimers } from "../../api/api";
import MutationExplorerContainer from "./MutationExplorerContainer";
import {
  groupUniqueCodons,
  getOriginalCodon,
  getRecognitionSiteSequence,
  processMutationOptions,
  initializeSelections,
} from "../../utils/mutationUtils";

const MutationExplorer = ({ stepSseData }) => {
  const [selectedCodonOption, setSelectedCodonOption] = useState({});
  const [recommendedMutations, setRecommendedMutations] = useState({});
  const [isDesigning, setIsDesigning] = useState(false);
  const [restrictionSites, setRestrictionSites] = useState([]);
  const [copiedStates, setCopiedStates] = useState({});

  useEffect(() => {
    if (!stepSseData) return;

    if (stepSseData.recommendedMutations) {
      setRecommendedMutations(stepSseData.recommendedMutations);
    }

    const sitesData = processMutationOptions(
      stepSseData,
      stepSseData.recommendedMutations
    );
    setRestrictionSites(sitesData);
    setSelectedCodonOption(initializeSelections(sitesData) || {});
  }, [stepSseData]);

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedStates((prev) => ({ ...prev, [id]: true }));
      setTimeout(
        () => setCopiedStates((prev) => ({ ...prev, [id]: false })),
        2000
      );
    });
  };

  const handleDesignPrimers = async () => {
    if (!restrictionSites.length || !Object.keys(selectedCodonOption).length) {
      toast.warning("No mutations selected for primer design.");
      return;
    }

    const mutationSelections = {};
    restrictionSites.forEach((site) => {
      const selectedOption = selectedCodonOption[site.siteKey];
      if (!selectedOption) return;

      const [groupKey, optionIndex] = selectedOption.split(":");
      const groups = groupUniqueCodons(site); // Cache the grouped codons
      const group = groups[groupKey];
      if (!group) return;

      const codonSequences = Object.keys(group);
      const codon = group[codonSequences[optionIndex]]?.codon;
      if (codon) mutationSelections[site.siteKey] = codon.codonSequence;
    });

    if (!Object.keys(mutationSelections).length) {
      toast.error("Could not determine selected mutations.");
      return;
    }

    setIsDesigning(true);
    try {
      await designPrimers({
        job_id: sessionStorage.getItem("jobId"),
        sequence_idx: sessionStorage.getItem("currentSequenceIdx"),
        selected_mutations: mutationSelections,
      });
      toast.success("Primer design started");
    } catch (error) {
      toast.error(`Primer design failed: ${error.message || "Unknown error"}`);
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

  if (!restrictionSites.length) {
    return (
      <div className="p-4 bg-yellow-100 dark:bg-yellow-900 border border-yellow-400 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200 rounded-sm">
        No mutation data available to explore
      </div>
    );
  }

  return (
    <MutationExplorerContainer
      restrictionSites={restrictionSites}
      selectedCodonOption={selectedCodonOption ?? {}} // explicit nullish coalescing safeguard
      handleDesignPrimers={handleDesignPrimers}
      isDesigning={isDesigning}
      setSelectedCodonOption={handleCodonSelect}
      getOriginalCodon={getOriginalCodon}
      getRecognitionSiteSequence={getRecognitionSiteSequence}
      copyToClipboard={copyToClipboard}
      copiedStates={copiedStates}
      recommendedMutations={recommendedMutations}
    />
  );
};

export default MutationExplorer;
