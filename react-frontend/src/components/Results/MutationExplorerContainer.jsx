import React from "react";
import RestrictionSite from "./RestrictionSite";

const MutationExplorerContainer = ({
  selectedMutationSetIndex,
  restrictionSites,
  selectedMutations,
  selectedCodonOption,
  handleDesignPrimers,
  isDesigning,
  // setSelectedMutations,
  setSelectedCodonOption,
  getOriginalCodon,
  getRecognitionSiteSequence,
  copyToClipboard,
  copiedStates,
}) => {
  return (
    <div className="mt-1">
      <div className="sticky top-0 z-30 bg-white dark:bg-gray-900 p-2 border-b border-gray-300 dark:border-gray-700 shadow-sm">
        <h2 className="text-xl font-bold dark:text-gray-100">
          Mutation Explorer{" "}
          {selectedMutationSetIndex > 0
            ? `(Set ${selectedMutationSetIndex + 1})`
            : ""}
        </h2>
      </div>

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
        {restrictionSites.map((site, siteIndex) => {
          const selectedMutationIndex = selectedMutations[site.siteKey] || 0;
          const selectedMutation = site.mutations[selectedMutationIndex];

          return (
            <RestrictionSite
              key={siteIndex}
              site={site}
              siteIndex={siteIndex}
              selectedMutations={selectedMutations}
              selectedCodonOption={selectedCodonOption}
              setSelectedCodonOption={setSelectedCodonOption}
              selectedMutation={selectedMutation}
              getOriginalCodon={getOriginalCodon}
              getRecognitionSiteSequence={getRecognitionSiteSequence}
              copyToClipboard={copyToClipboard}
              copiedStates={copiedStates}
            />
          );
        })}
      </div>
    </div>
  );
};

export default MutationExplorerContainer;
