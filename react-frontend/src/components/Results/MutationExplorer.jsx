import React, { useState, useEffect } from "react";
import { toast } from "react-toastify";
import { designPrimers, getTaskStatus } from "../../api/api";
import MutationExplorerContainer from "./MutationExplorerContainer";
import {
  groupUniqueCodons,
  sortedCodonSequences,
  getOriginalCodon,
  getRecognitionSiteSequence,
  processMutationOptions,
  initializeSelections,
} from "../../utils/mutationUtils";

export const PRIMER_POLL_INTERVAL_MS = 1500;
export const PRIMER_POLL_TIMEOUT_MS = 5 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// jobId / sequenceIdx identify the tab this explorer belongs to; onPrimersDesigned
// receives the finished result (same shape as the SSE event) for display.
const MutationExplorer = ({ stepSseData, jobId, sequenceIdx, onPrimersDesigned }) => {
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

      const codonSequences = sortedCodonSequences(group);
      const codon = group[codonSequences[optionIndex]]?.codon;
      if (codon) mutationSelections[site.siteKey] = codon.codonSequence;
    });

    if (!Object.keys(mutationSelections).length) {
      toast.error("Could not determine selected mutations.");
      return;
    }

    const idx = Number(sequenceIdx);
    if (!jobId || !Number.isInteger(idx) || idx < 0) {
      toast.error("Primer design failed: this result is not linked to a submission.");
      return;
    }

    setIsDesigning(true);
    try {
      const accepted = await designPrimers({
        job_id: jobId,
        sequence_idx: idx,
        selected_mutations: mutationSelections,
      });
      toast.info("Primer design started");

      // Consume the asynchronous result (the SSE event may also deliver it; the
      // results view de-duplicates by task id).
      const deadline = Date.now() + PRIMER_POLL_TIMEOUT_MS;
      for (;;) {
        const status = await getTaskStatus(accepted.task_id);
        if (status.state === "SUCCESS") {
          const result = status.result;
          if (!result || !result.primerSet) {
            throw new Error("The server returned no primers.");
          }
          if (onPrimersDesigned) {
            onPrimersDesigned({
              jobId,
              sequenceIdx: idx,
              step: "Primer Design",
              message: "Custom primers designed for the selected mutations",
              stepProgress: 100,
              customPrimers: result,
            });
          }
          toast.success("Custom primers designed");
          break;
        }
        if (status.state === "FAILURE") {
          throw new Error(status.error || "Primer design failed.");
        }
        if (Date.now() > deadline) {
          throw new Error("Primer design is taking too long; check again later.");
        }
        await sleep(PRIMER_POLL_INTERVAL_MS);
      }
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
