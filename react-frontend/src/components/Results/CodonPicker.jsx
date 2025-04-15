import React from "react";

const CodonPicker = ({ site, selectedCodonOption, setSelectedCodonOption }) => {
  const handleCodonSelect = (groupKey, optionIndex) => {
    if (site && site.siteKey) {
      setSelectedCodonOption(site.siteKey, groupKey, optionIndex);
    }
  };

  // Group codons by position and remove duplicates
  const groupUniqueCodons = (site) => {
    const groups = {};
    if (!site || !Array.isArray(site.mutations)) return groups;
    site.mutations.forEach((mutation) => {
      if (!mutation || !Array.isArray(mutation.mutCodons)) return;
      mutation.mutCodons.forEach((mutCodon) => {
        if (!mutCodon || !mutCodon.codon) return;
        const codon = mutCodon.codon;
        if (codon.contextPosition === undefined) return;
        const groupKey = `Position ${codon.contextPosition}`;
        if (!groups[groupKey]) {
          groups[groupKey] = {};
        }
        const seq = codon.codonSequence;
        // More defensive checks for recommendedMutations
        const isRecommended =
          site.recommendedMutations &&
          typeof site.recommendedMutations === "object" &&
          site.siteKey &&
          site.recommendedMutations[site.siteKey] &&
          site.recommendedMutations[site.siteKey].codon_sequence === seq;
        if (!groups[groupKey][seq]) {
          groups[groupKey][seq] = {
            codon,
            isRecommended,
          };
        }
      });
    });
    return groups;
  };

  const groups = groupUniqueCodons(site);
  // Add defensive check for selectedCodonOption and site.siteKey
  const currentSelection =
    selectedCodonOption && site && site.siteKey
      ? selectedCodonOption[site.siteKey]
      : null;

  // Extract amino acid information
  const getAminoAcidForPosition = (groupKey) => {
    const options = Object.values(groups[groupKey]);
    if (options.length > 0) {
      return options[0].codon.aminoAcid;
    }
    return "";
  };

  return (
    <div className="mt-4 space-y-4">
      {Object.keys(groups)
        .sort((a, b) => {
          const posA = parseInt(a.replace("Position ", ""));
          const posB = parseInt(b.replace("Position ", ""));
          return posA - posB;
        })
        .map((groupKey) => {
          const aminoAcid = getAminoAcidForPosition(groupKey);
          return (
            <div key={groupKey} className="p-2 border rounded-md">
              <h5 className="font-medium text-sm dark:text-gray-200">
                {groupKey} - Alternative codons for aa: {aminoAcid}
              </h5>
              <div className="space-y-2 mt-2">
                {Object.values(groups[groupKey])
                  .sort((a, b) =>
                    a.codon.codonSequence.localeCompare(b.codon.codonSequence)
                  )
                  .map((option, index) => {
                    const compositeKey = `${groupKey}:${index}`;
                    const isSelected = currentSelection === compositeKey;
                    return (
                      <div
                        key={index}
                        className={`p-2 border rounded cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-blue-100 border-blue-300 dark:bg-blue-800 dark:border-blue-600"
                            : "bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600"
                        }`}
                        onClick={() => handleCodonSelect(groupKey, index)}
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
                            <span className="font-medium">
                              {option.codon.usage}%
                            </span>
                          </span>
                          {option.isRecommended && (
                            <span className="text-xs bg-green-100 text-green-700 dark:bg-green-800 dark:text-green-200 px-2 py-0.5 rounded-full">
                              Recommended
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          );
        })}
    </div>
  );
};

export default CodonPicker;
