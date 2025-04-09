import React from "react";
import CodonPicker from "./CodonPicker";
import EnhancedSequenceViewer from "./EnhancedSequenceViewer";

const RestrictionSite = ({
  site,
  siteIndex,
  selectedCodonOption,
  setSelectedCodonOption,
  selectedMutation,
  getOriginalCodon,
  getRecognitionSiteSequence,
  copyToClipboard,
  copiedStates,
}) => {
  // Get the selected codon based on the selectedCodonOption
  const getSelectedCodon = () => {
    if (
      !selectedMutation ||
      !selectedMutation.mutCodons ||
      !selectedCodonOption[site.siteKey]
    ) {
      return null;
    }

    const [groupKey, optionIndexStr] =
      selectedCodonOption[site.siteKey].split(":");
    const groupPosition = parseInt(groupKey.replace("Position ", ""));
    const optionIndex = parseInt(optionIndexStr);

    // Find the matching codon by position and option index
    let matchingCodons = [];

    // Collect all codons that match the position
    for (const mutCodon of selectedMutation.mutCodons) {
      if (mutCodon.codon.contextPosition === groupPosition) {
        matchingCodons.push(mutCodon.codon);
      }
    }

    // If we have options at this position, return the one that matches the optionIndex
    // This assumes the codons are sorted the same way as when the optionIndex was assigned
    if (matchingCodons.length > 0) {
      // Sort codons the same way they were sorted when creating options
      matchingCodons.sort((a, b) =>
        a.codonSequence.localeCompare(b.codonSequence)
      );

      // Return the codon at the option index if it exists
      return optionIndex < matchingCodons.length
        ? matchingCodons[optionIndex]
        : matchingCodons[0];
    }

    return null;
  };

  // Get the recognition site sequence info using the helper function
  const getRsSequenceInfo = () => {
    if (!selectedMutation) return null;
    return getRecognitionSiteSequence(selectedMutation);
  };

  // Render mutation details
  const renderMutationDetails = () => {
    if (!selectedMutation || !selectedMutation.mutCodons) return null;
    return (
      <div className="mt-4">
        <div className="font-medium mb-1 dark:text-gray-200">
          Mutation Details:
        </div>
        <div className="space-y-2">
          {selectedMutation.mutCodons.map((mutCodon, idx) => {
            const codon = mutCodon.codon;
            const originalCodon = getOriginalCodon(site, codon.contextPosition);

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
                    {originalCodon && (
                      <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">
                        (Original: {originalCodon})
                      </span>
                    )}
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

  // Get the selected codon and recognition site information
  const selectedCodon = getSelectedCodon();
  const rsSequenceInfo = getRsSequenceInfo();

  // Get the sequence to display in the viewer - checking multiple possible properties
  const getSequenceToDisplay = () => {
    if (!selectedMutation) return null;

    // Check different possible property names for the sequence
    return (
      selectedMutation.contextSequence ||
      selectedMutation.nativeContext ||
      selectedMutation.mutContext ||
      site.originalSequence
    );
  };

  const sequenceToDisplay = getSequenceToDisplay();

  // Debug: log sequence data
  console.log("Selected mutation:", selectedMutation);
  console.log("Sequence to display:", sequenceToDisplay);

  return (
    <div
      id={`restriction-site-${siteIndex}`}
      className="p-4 border border-gray-300 dark:border-gray-700 rounded-sm shadow-xs dark:bg-gray-800"
    >
      <div className="sticky top-43 z-20 bg-gray-50 dark:bg-gray-800 mb-4 border-b border-gray-300 dark:border-gray-700 shadow-sm">
        <h4 className="text-lg font-semibold mb-2 dark:text-gray-200">
          Restriction Site {siteIndex + 1}: {site.siteKey}
        </h4>

        {/* Recognition Site Sequence Info Display */}
        {rsSequenceInfo && (
          <div className="mb-3 p-2 bg-gray-100 dark:bg-gray-700 rounded-sm">
            <div className="text-xs font-medium dark:text-gray-300">
              RS Sequence:
            </div>
            <div className="flex items-center">
              <span className="text-xs mr-1 dark:text-gray-400">
                Pre → Post:
              </span>
              <div className="flex">
                {rsSequenceInfo.original.split("").map((base, idx) => {
                  const changed =
                    rsSequenceInfo.mutated &&
                    rsSequenceInfo.original[idx] !==
                      rsSequenceInfo.mutated[idx];
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
                {rsSequenceInfo.mutated?.split("").map((base, idx) => (
                  <span
                    key={idx}
                    className={`font-mono text-xs px-0.5 ${
                      rsSequenceInfo.original[idx] !== base
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

        {/* Integrated EnhancedSequenceViewer - Modified condition */}
        {selectedMutation && sequenceToDisplay && (
          <EnhancedSequenceViewer
            originalSequence={sequenceToDisplay}
            highlightIndices={selectedMutation.contextRsIndices || []}
            codonChanges={{
              position: selectedCodon?.contextPosition,
              newCodon: selectedCodon?.codonSequence,
            }}
            copyToClipboard={copyToClipboard}
            copiedStates={copiedStates}
            sequenceId={`seq-${site.siteKey}`}
            site={site}
            selectedMutation={selectedMutation}
            selectedCodonOption={selectedCodonOption}
          />
        )}
      </div>
      <CodonPicker
        site={site}
        selectedCodonOption={selectedCodonOption}
        setSelectedCodonOption={setSelectedCodonOption}
      />
      {renderMutationDetails()}
    </div>
  );
};

export default RestrictionSite;
