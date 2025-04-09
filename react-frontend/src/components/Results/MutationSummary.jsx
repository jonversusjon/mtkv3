import React, { useState } from "react";
import EnhancedSequenceViewer from "./EnhancedSequenceViewer";

const MutationSummary = ({
  restrictionSites,
  selectedMutations,
  selectedCodonOption,
  setSelectedCodonOption,
  getOriginalCodon,
  getRecognitionSiteSequence,
}) => {
  // Add state for tracking copied sequences
  const [copiedStates, setCopiedStates] = useState({});

  // Function to copy sequence to clipboard
  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedStates((prev) => ({ ...prev, [id]: true }));
      setTimeout(() => {
        setCopiedStates((prev) => ({ ...prev, [id]: false }));
      }, 2000);
    });
  };

  // Helper to find the selected codon based on the composite key
  const findSelectedCodon = (site, compositeKey) => {
    if (!compositeKey) return null;

    if (!site.mutations) return null;

    const selectedMutationIndex = selectedMutations[site.siteKey] || 0;
    const selectedMutation = site.mutations[selectedMutationIndex];
    if (!selectedMutation || !selectedMutation.mutCodons) return null;

    return null;
  };

  // Navigate to a specific restriction site section
  const navigateToSite = (siteIndex) => {
    document
      .getElementById(`restriction-site-${siteIndex}`)
      ?.scrollIntoView({ behavior: "smooth" });
  };

  // Handle click on a codon in the summary to select an alternative if available
  const handleCodonClick = (site, siteIndex) => {
    const compositeKey = selectedCodonOption[site.siteKey];
    if (!compositeKey) return;

    const [groupKey, optionIndexStr] = compositeKey.split(":");
    const optionIndex = parseInt(optionIndexStr);

    // Find how many options are available for this position
    const selectedMutationIndex = selectedMutations[site.siteKey] || 0;
    const selectedMutation = site.mutations[selectedMutationIndex];
    if (!selectedMutation || !selectedMutation.mutCodons) return;

    // Count unique codon options at this position
    const uniqueCodons = new Set();
    selectedMutation.mutCodons.forEach((mutCodon) => {
      if (
        mutCodon.codon.contextPosition ===
        parseInt(groupKey.replace("Position ", ""))
      ) {
        uniqueCodons.add(mutCodon.codon.codonSequence);
      }
    });

    // Select next option in rotation
    const nextOptionIndex = (optionIndex + 1) % uniqueCodons.size;

    // This is the corrected line - calls setSelectedCodonOption with the required parameters
    // in the right format as expected by the parent component
    setSelectedCodonOption(site.siteKey, groupKey, nextOptionIndex);

    // Show visual feedback
    const element = document.getElementById(`codon-card-${siteIndex}`);
    if (element) {
      element.classList.add("bg-blue-50", "dark:bg-blue-900");
      setTimeout(() => {
        element.classList.remove("bg-blue-50", "dark:bg-blue-900");
      }, 300);
    }
  };

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
        {restrictionSites.map((site, siteIndex) => {
          const compositeKey = selectedCodonOption[site.siteKey];
          const selectedMutationIndex = selectedMutations[site.siteKey] || 0;
          const selectedMutation = site.mutations[selectedMutationIndex];

          if (!compositeKey || !selectedMutation)
            return (
              <div
                key={siteIndex}
                className="p-2 border rounded-sm bg-gray-50 dark:bg-gray-800 dark:border-gray-700"
              >
                <div className="text-xs font-medium dark:text-gray-300">
                  RS {siteIndex + 1}: {site.siteKey}
                </div>
                <span>selectedMutation</span>

                <div className="text-xs text-gray-500 dark:text-gray-400">
                  No selection
                </div>
              </div>
            );

          // Find the selected codon
          const selectedCodon = findSelectedCodon(site, compositeKey);
          if (!selectedCodon)
            return (
              <div
                key={siteIndex}
                className="p-2 border rounded-sm bg-gray-50 dark:bg-gray-800 dark:border-gray-700"
              >
                <div className="text-xs font-medium dark:text-gray-300">
                  RS {siteIndex + 1}: {site.siteKey}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Invalid selection
                </div>
              </div>
            );

          // Get original codon and recognition site sequences
          const originalCodon = getOriginalCodon(
            site,
            selectedCodon.contextPosition
          );
          const rsSites = getRecognitionSiteSequence(selectedMutation);

          return (
            <div
              id={`codon-card-${siteIndex}`}
              key={siteIndex}
              className="p-2 border rounded-sm bg-gray-50 dark:bg-gray-800 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 cursor-pointer transition-all duration-200"
            >
              <div className="text-xs font-medium dark:text-gray-300 flex justify-between">
                <span>
                  RS {siteIndex + 1}: {site.siteKey}
                </span>
                <div className="flex space-x-2">
                  <button
                    className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCodonClick(site, siteIndex);
                    }}
                    title="Cycle through alternative codons"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-3 w-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                  </button>
                  <button
                    className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigateToSite(siteIndex);
                    }}
                    title="Navigate to this site"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-3 w-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Codon Change */}
              <div className="flex items-center mt-1">
                <span className="text-xs mr-1 dark:text-gray-300">Codon:</span>
                <span className="font-mono text-xs bg-red-100 dark:bg-red-900 dark:text-white px-1 py-0.5 line-through">
                  {originalCodon || "---"}
                </span>
                <span className="text-xs mx-1 dark:text-gray-300">→</span>
                <span className="font-mono text-xs bg-green-100 dark:bg-green-900 dark:text-white px-1 py-0.5">
                  {selectedCodon.codonSequence}
                </span>
                <span className="ml-1 text-xs dark:text-gray-300">
                  ({selectedCodon.usage}%)
                </span>
              </div>

              {/* Amino acid */}
              <div className="flex items-center mt-1">
                <span className="text-xs mr-1 dark:text-gray-300">AA:</span>
                <span className="font-mono text-xs bg-blue-100 dark:bg-blue-800 dark:text-white px-1">
                  {selectedCodon.aminoAcid}
                </span>
                <span className="ml-1 text-xs dark:text-gray-300">
                  Pos: {selectedCodon.contextPosition}
                </span>
              </div>

              {/* Recognition site sequence */}
              {rsSites && (
                <div className="mt-2 pt-1 border-t border-gray-200 dark:border-gray-700">
                  <div className="text-xs font-medium dark:text-gray-300">
                    RS Sequence:
                  </div>
                  <div className="flex items-center">
                    <span className="text-xs mr-1 dark:text-gray-400">
                      Pre → Post:
                    </span>
                    <div className="flex">
                      {rsSites.original.split("").map((base, idx) => {
                        const changed =
                          rsSites.mutated &&
                          rsSites.original[idx] !== rsSites.mutated[idx];
                        return (
                          <span
                            key={idx}
                            className={`font-mono text-xs px-0.5 ${
                              changed
                                ? "bg-red-100 dark:bg-red-900 line-through text-red-600 dark:text-red-200"
                                : "bg-purple-100 dark:bg-purple-900 dark:text-white"
                            }`}
                            style={
                              changed
                                ? {
                                    textDecorationStyle: "solid",
                                    textDecorationColor: "red",
                                  }
                                : {}
                            }
                          >
                            {base}
                          </span>
                        );
                      })}
                    </div>
                    <span className="mx-1 dark:text-gray-300">→</span>
                    <div className="flex">
                      {rsSites.mutated?.split("").map((base, idx) => (
                        <span
                          key={idx}
                          className={`font-mono text-xs px-0.5 ${
                            rsSites.original[idx] !== base
                              ? "bg-green-100 dark:bg-green-900 dark:text-white"
                              : "bg-gray-100 dark:bg-gray-800 dark:text-white"
                          }`}
                        >
                          {base}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Sequence Viewer Section */}
              {selectedMutation.contextSequence && (
                <div className="mb-6 p-4 border rounded-lg shadow-sm bg-white dark:bg-gray-800 dark:border-gray-700">
                  <h3 className="font-medium mb-3 text-gray-800 dark:text-gray-200">
                    Sequence Visualization
                  </h3>
                  <EnhancedSequenceViewer
                    originalSequence={selectedMutation.contextSequence}
                    highlightIndices={selectedMutation.contextRsIndices || []}
                    codonChanges={{
                      position: selectedCodon.contextPosition,
                      newCodon: selectedCodon.codonSequence,
                    }}
                    copyToClipboard={copyToClipboard}
                    copiedStates={copiedStates}
                    sequenceId={`seq-${site.siteKey}`}
                    site={site}
                    selectedMutation={selectedMutation}
                    selectedCodonOption={selectedCodonOption}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MutationSummary;
