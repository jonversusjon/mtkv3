import React from "react";
import RestrictionSite from "./RestrictionSite";
import { groupUniqueCodons } from "../../utils/mutationUtils";
const MutationExplorerContainer = ({
  restrictionSites,
  selectedCodonOption = {}, // safeguard default value
  setSelectedCodonOption,
  isDesigning,
  getOriginalCodon,
  getRecognitionSiteSequence,
  copyToClipboard,
  copiedStates,
  recommendedMutations,
  handleDesignPrimers, // ensure this is passed from parent or remove if unused
}) => {
  console.log("DEBUG MutationExplorerContainer - Component rendering");
  console.log(
    "DEBUG MutationExplorerContainer - restrictionSites:",
    restrictionSites
  );

  return (
    <div className="mt-1">
      <div className="sticky top-0 z-30 bg-white dark:bg-gray-900 p-2 border-b border-gray-300 dark:border-gray-700 shadow-sm">
        <h2 className="text-xl font-bold dark:text-gray-100">
          Mutation Explorer
        </h2>
        <button
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
          onClick={handleDesignPrimers}
          disabled={isDesigning || !Object.keys(selectedCodonOption).length}
        >
          {isDesigning ? "Designing..." : "Design Primers"}
        </button>
      </div>

      {restrictionSites.map((site, siteIndex) => {
        const selectedOption = selectedCodonOption[site.siteKey] || "";
        const [groupKey, optionIndex] = selectedOption.split(":");
        const groups = groupUniqueCodons(site);
        const group = groups[groupKey] || {};
        const codonSequences = Object.keys(group);
        const codon =
          group && codonSequences[optionIndex]
            ? group[codonSequences[optionIndex]].codon
            : null;

        return (
          <RestrictionSite
            key={site.siteKey}
            site={site}
            siteIndex={siteIndex}
            selectedCodon={codon}
            setSelectedCodonOption={setSelectedCodonOption}
            getOriginalCodon={getOriginalCodon}
            getRecognitionSiteSequence={getRecognitionSiteSequence}
            copyToClipboard={copyToClipboard}
            copiedStates={copiedStates}
            recommendedMutations={recommendedMutations}
          />
        );
      })}
    </div>
  );
};

export default MutationExplorerContainer;
