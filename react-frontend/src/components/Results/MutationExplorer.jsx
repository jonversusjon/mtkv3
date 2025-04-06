import React, { useState, useEffect } from "react";
import { toast } from "react-toastify";
import { designPrimers } from "../../api/goldenGateApi";

/**
 * Helper to group and de-duplicate codon options for a site.
 * Groups by codon.contextPosition (e.g. "Position 30")
 * and uses the codonSequence as the unique identifier.
 */
const groupUniqueCodons = (siteKey, mutations, recommendedMutations = {}) => {
  const groups = {};

  // Process each mutation independently
  mutations.forEach((mutation, mIndex) => {
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
            mutationIndex: mIndex,
            // Check if this is the recommended mutation
            isRecommended:
              recommendedMutations[siteKey] &&
              recommendedMutations[siteKey].codon_sequence === seq,
          };
        }
      });
    }
  });

  return groups;
};

const MutationExplorer = ({ stepSseData }) => {
  // State for tracking selected mutations at each restriction site
  const [selectedMutations, setSelectedMutations] = useState({});
  // State to store mutation options and recommended mutations
  const [mutationOptions, setMutationOptions] = useState({});
  const [recommendedMutations, setRecommendedMutations] = useState({});
  // Track copy button states for copied confirmation
  const [copiedStates, setCopiedStates] = useState({});
  // State for tracking primer design requests
  const [isDesigning, setIsDesigning] = useState(false);

  // Initialize data on component load
  useEffect(() => {
    if (!stepSseData) return;

    // Look for mutation_options directly in SSE data (from Stage 1)
    if (stepSseData.mutation_options) {
      setMutationOptions(stepSseData.mutation_options);
    }

    // Handle recommendation data (from Stage 2)
    if (stepSseData.recommended && stepSseData.recommended.selected_mutations) {
      setRecommendedMutations(stepSseData.recommended.selected_mutations);
    }
  }, [stepSseData]);

  // Handler for selecting a codon for a specific site
  const handleCodonSelect = (siteKey, codonSequence) => {
    // Update the selected mutations state
    setSelectedMutations((prev) => ({
      ...prev,
      [siteKey]: codonSequence,
    }));
  };

  // Handler for requesting primer design
  const handleDesignPrimers = async () => {
    if (Object.keys(selectedMutations).length === 0) {
      toast.warning("Please select mutations for all sites");
      return;
    }

    setIsDesigning(true);
    try {
      const jobId = sessionStorage.getItem("jobId");
      const sequenceIdx = sessionStorage.getItem("currentSequenceIdx");

      await designPrimers({
        job_id: jobId,
        sequence_idx: sequenceIdx,
        selected_mutations: selectedMutations,
      });

      // Success notification
      toast.success("Primer design started");
    } catch (error) {
      console.error("Failed to request primer design:", error);
      toast.error("Failed to request primer design");
    } finally {
      setIsDesigning(false);
    }
  };

  // Copies text to clipboard and shows feedback
  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedStates((prev) => ({ ...prev, [id]: true }));
      setTimeout(() => {
        setCopiedStates((prev) => ({ ...prev, [id]: false }));
      }, 2000);
    });
  };

  // Render the context sequence with aligned codon substitution visualization
  const renderEnhancedContextSequence = (
    siteKey,
    mutations,
    selectedCodonSeq
  ) => {
    // Find the mutation that matches the selected codon sequence
    const selectedMutation = mutations.find(
      (mutation) =>
        mutation.mutCodons &&
        mutation.mutCodons.some(
          (mc) => mc.codon.codonSequence === selectedCodonSeq
        )
    );

    if (!selectedMutation || !selectedMutation.nativeContext) return null;

    const originalSequence = selectedMutation.nativeContext;
    const substitutionRow = new Array(originalSequence.length).fill(" ");
    const underlineRow = new Array(originalSequence.length).fill(" ");
    const originalRow = originalSequence.split("");

    // Find the codon for the selected mutation
    let codonForSubstitution = null;
    if (selectedMutation.mutCodons && selectedMutation.mutCodons.length > 0) {
      codonForSubstitution = selectedMutation.mutCodons.find(
        (mc) => mc.codon.codonSequence === selectedCodonSeq
      )?.codon;
    }

    if (
      codonForSubstitution &&
      codonForSubstitution.contextPosition !== undefined
    ) {
      const start = codonForSubstitution.contextPosition;
      for (let i = 0; i < 3; i++) {
        if (start + i < substitutionRow.length) {
          substitutionRow[start + i] = codonForSubstitution.codonSequence[i];
          underlineRow[start + i] = "‾";
        }
      }
    }

    const highlightedRow = originalRow.map((base, index) => {
      const isInRS =
        selectedMutation.contextRsIndices &&
        selectedMutation.contextRsIndices.includes(index);
      return (
        <span
          key={`orig-${index}`}
          className={`font-mono text-lg ${
            isInRS ? "text-purple-600 dark:text-purple-400 font-semibold" : ""
          }`}
        >
          {base}
        </span>
      );
    });

    const originalId = `original-${siteKey}`;
    const mutatedId = `mutated-${siteKey}`;
    const mutatedSequence = originalRow
      .map((char, i) =>
        substitutionRow[i] !== " " ? substitutionRow[i] : char
      )
      .join("");

    return (
      <div className="mb-3">
        <div className="font-medium mb-1 flex justify-between items-center dark:text-gray-200">
          <span>Context Sequence:</span>
          <div className="flex space-x-2">
            <button
              className="text-xs text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 px-2 py-1 rounded-sm border border-gray-300 dark:border-gray-600"
              onClick={() => copyToClipboard(originalSequence, originalId)}
            >
              {copiedStates[originalId] ? "Copied!" : "Copy Original"}
            </button>
            <button
              className="text-xs text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 px-2 py-1 rounded-sm border border-gray-300 dark:border-gray-600"
              onClick={() => copyToClipboard(mutatedSequence, mutatedId)}
            >
              {copiedStates[mutatedId] ? "Copied!" : "Copy Mutated"}
            </button>
          </div>
        </div>
        <div className="p-2 border rounded-sm bg-gray-50 dark:bg-gray-800 dark:border-gray-700 overflow-x-auto">
          <pre className="font-mono text-lg text-green-600 dark:text-green-400 whitespace-pre">
            {substitutionRow.join("")}
          </pre>
          <div className="dark:text-gray-200 select-all">{highlightedRow}</div>
          <pre className="font-mono text-lg text-red-500 dark:text-red-400 whitespace-pre">
            {underlineRow.join("")}
          </pre>
        </div>
      </div>
    );
  };

  // Render codon options grouped by unique codon context position
  const renderCodonOptions = (siteKey, mutations) => {
    const groupsObj = groupUniqueCodons(
      siteKey,
      mutations,
      recommendedMutations
    );
    const flatOptions = [];

    Object.keys(groupsObj)
      .sort((a, b) => {
        const posA = parseInt(a.replace("Position ", ""));
        const posB = parseInt(b.replace("Position ", ""));
        return posA - posB;
      })
      .forEach((groupKey) => {
        // Get the first option in this group to extract the amino acid
        const firstOption = Object.values(groupsObj[groupKey])[0];
        const aminoAcid = firstOption?.codon?.aminoAcid;

        flatOptions.push({ header: groupKey, aminoAcid });

        const options = Object.values(groupsObj[groupKey]).sort((a, b) =>
          a.codon.codonSequence.localeCompare(b.codon.codonSequence)
        );

        options.forEach((option, index) => {
          flatOptions.push({
            ...option,
            group: groupKey,
            optionIndex: index,
          });
        });
      });

    return (
      <div className="mt-4 space-y-4">
        {flatOptions.map((option, idx) => {
          if (option.header) {
            return (
              <div
                key={`header-${option.header}-${idx}`}
                className="font-medium dark:text-gray-200"
              >
                Alternative codons for aa: {option.aminoAcid}
              </div>
            );
          } else {
            const isSelected =
              selectedMutations[siteKey] === option.codon.codonSequence;
            return (
              <div
                key={`${siteKey}-${option.codon.codonSequence}-${idx}`}
                className={`p-2 border rounded cursor-pointer transition-colors ${
                  isSelected
                    ? "bg-blue-100 border-blue-300 dark:bg-blue-800 dark:border-blue-600"
                    : option.isRecommended
                    ? "bg-green-50 border-green-300 dark:bg-green-900/30 dark:border-green-700"
                    : "bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600"
                }`}
                onClick={() =>
                  handleCodonSelect(siteKey, option.codon.codonSequence)
                }
              >
                <div className="flex justify-between items-center">
                  <span className="font-mono bg-yellow-100 dark:bg-yellow-800 dark:text-white px-2 py-1">
                    {option.codon.codonSequence}
                  </span>
                  <span className="text-sm dark:text-gray-200">
                    Amino Acid:{" "}
                    <span className="font-medium">
                      {option.codon.aminoAcid}
                    </span>
                  </span>
                  <span className="text-sm dark:text-gray-200">
                    Usage:{" "}
                    <span className="font-medium">{option.codon.usage}%</span>
                  </span>
                  {option.isRecommended && (
                    <span className="ml-2 text-xs text-green-600 dark:text-green-400 font-medium">
                      Recommended
                    </span>
                  )}
                </div>
              </div>
            );
          }
        })}
      </div>
    );
  };

  const renderMutationDetails = (mutation) => {
    if (!mutation || !mutation.mutCodons) return null;
    return (
      <div className="mt-4">
        <div className="font-medium mb-1 dark:text-gray-200">
          Mutation Details:
        </div>
        <div className="space-y-2">
          {mutation.mutCodons.map((mutCodon, idx) => {
            const codon = mutCodon.codon;
            return (
              <div
                key={idx}
                className="p-2 border rounded-sm bg-gray-50 dark:bg-gray-800 dark:border-gray-700"
              >
                <div className="flex justify-between">
                  <div>
                    <span className="font-semibold dark:text-gray-200">
                      Codon {idx + 1}:
                    </span>
                    <span className="font-mono ml-2 bg-yellow-100 dark:bg-yellow-800 dark:text-white px-1">
                      {codon.codonSequence}
                    </span>
                  </div>
                  <div>
                    <span className="text-sm dark:text-gray-300">
                      Amino Acid:
                    </span>
                    <span className="font-mono ml-1 bg-blue-100 dark:bg-blue-800 dark:text-white px-1">
                      {codon.aminoAcid}
                    </span>
                  </div>
                  <div>
                    <span className="text-sm dark:text-gray-300">Usage:</span>
                    <span className="ml-1 dark:text-gray-200">
                      {codon.usage}%
                    </span>
                  </div>
                </div>
                <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  <span>Position in context: {codon.contextPosition}</span>
                  {codon.rsOverlap && (
                    <span className="ml-4">
                      RS Overlap: {codon.rsOverlap.join(", ")}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  if (Object.keys(mutationOptions).length === 0) {
    return (
      <div className="p-4 bg-yellow-100 dark:bg-yellow-900 border border-yellow-400 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200 rounded-sm">
        No mutation data available to explore
      </div>
    );
  }

  return (
    <div className="mt-1">
      <div className="sticky top-14 z-20 bg-white dark:bg-gray-900 p-2 border-b border-gray-300 dark:border-gray-700 shadow-sm">
        <h2 className="text-xl font-bold dark:text-gray-100">
          Mutation Explorer
        </h2>
      </div>

      {/* Add design button container */}
      <div className="my-4 flex justify-end">
        <button
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
          onClick={handleDesignPrimers}
          disabled={isDesigning || Object.keys(selectedMutations).length === 0}
        >
          {isDesigning
            ? "Designing Primers..."
            : "Design Primers for Selected Mutations"}
        </button>
      </div>

      <div className="mt-4 space-y-6">
        {Object.entries(mutationOptions).map(
          ([siteKey, mutations], siteIndex) => {
            const selectedCodonSeq = selectedMutations[siteKey];
            return (
              <div
                key={siteIndex}
                className="p-4 border border-gray-300 dark:border-gray-700 rounded-sm shadow-xs dark:bg-gray-800"
              >
                <div className="sticky top-50 z-20 bg-gray-50 dark:bg-gray-800 p-2 mb-4 border-b border-gray-300 dark:border-gray-700 shadow-sm">
                  <h3 className="text-lg font-semibold mb-2 dark:text-gray-200">
                    Restriction Site {siteIndex + 1} ({siteKey})
                  </h3>
                  {selectedCodonSeq &&
                    renderEnhancedContextSequence(
                      siteKey,
                      mutations,
                      selectedCodonSeq
                    )}
                </div>
                {renderCodonOptions(siteKey, mutations)}
                {selectedCodonSeq &&
                  renderMutationDetails(
                    mutations.find(
                      (m) =>
                        m.mutCodons &&
                        m.mutCodons.some(
                          (mc) => mc.codon.codonSequence === selectedCodonSeq
                        )
                    )
                  )}
              </div>
            );
          }
        )}
      </div>
    </div>
  );
};

export default MutationExplorer;
