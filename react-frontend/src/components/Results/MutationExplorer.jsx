import React, { useState, useEffect } from "react";

/**
 * Refactored component for exploring mutation options at different restriction sites
 */
const MutationExplorer = ({ stepSseData }) => {
  // State for tracking selected mutations at each restriction site
  const [selectedMutations, setSelectedMutations] = useState({});
  // New state for tracking selected codon options per site (grouped by codon position)
  const [selectedCodonOption, setSelectedCodonOption] = useState({});
  // State to hold parsed and organized data
  const [restrictionSites, setRestrictionSites] = useState([]);
  // Track copy button states for copied confirmation
  const [copiedStates, setCopiedStates] = useState({});

  // Initialize data on component load
  useEffect(() => {
    const organizeBySite = (sets, rsKeys) => {
      const siteMap = {};
      rsKeys.forEach((key) => {
        siteMap[key] = {
          siteKey: key,
          mutations: [],
          contextSequences: new Set(),
          originalSequence: null,
        };
      });

      sets.forEach((set) => {
        if (!set.mutations) return;
        set.mutations.forEach((mutation) => {
          const siteKey = determineSiteKey(mutation, rsKeys);
          if (!siteKey || !siteMap[siteKey]) return;
          if (!siteMap[siteKey].originalSequence) {
            siteMap[siteKey].originalSequence = mutation.nativeContext;
          }
          const existingMutation = siteMap[siteKey].mutations.find(
            (m) =>
              m.mutContext === mutation.mutContext &&
              m.firstMutIdx === mutation.firstMutIdx &&
              m.lastMutIdx === mutation.lastMutIdx
          );
          if (!existingMutation) {
            siteMap[siteKey].mutations.push(mutation);
            siteMap[siteKey].contextSequences.add(mutation.mutContext);
          }
        });
      });
      return Object.values(siteMap).filter((site) => site.mutations.length > 0);
    };

    if (!stepSseData || !stepSseData.mutationSets) return;
    const { sets, rsKeys } = stepSseData.mutationSets;
    if (!sets || !sets.length) return;
    const sitesData = organizeBySite(sets, rsKeys);
    setRestrictionSites(sitesData);

    const initialSelected = {};
    sitesData.forEach((site) => {
      initialSelected[site.siteKey] = 0;
    });
    setSelectedMutations(initialSelected);
  }, [stepSseData]);

  // Helper to determine which restriction site a mutation belongs to
  const determineSiteKey = (mutation, rsKeys) => {
    return rsKeys && rsKeys.length > 0 ? rsKeys[0] : null;
  };

  // New handler for selecting codon options grouped by codon position
  const handleOptionSelect = (siteKey, groupKey, optionIndex) => {
    setSelectedCodonOption((prev) => ({
      ...prev,
      [siteKey]: `${groupKey}:${optionIndex}`,
    }));
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

  // Get the mutated sequence with mutations applied
  const getMutatedSequence = (originalSequence, mutation) => {
    if (!mutation || !mutation.mutCodons || !originalSequence)
      return originalSequence;
    let mutatedSeq = originalSequence;
    mutation.mutCodons.forEach((mutCodon) => {
      const codon = mutCodon.codon;
      if (codon && codon.contextPosition !== undefined) {
        const position = codon.contextPosition;
        mutatedSeq =
          mutatedSeq.substring(0, position) +
          codon.codonSequence +
          mutatedSeq.substring(position + 3);
      }
    });
    return mutatedSeq;
  };

  // Render the context sequence with aligned proposed codon swap visualization
  const renderEnhancedContextSequence = (site, selectedMutation) => {
    if (!selectedMutation || !site.originalSequence) return null;
    const originalSequence = site.originalSequence;

    // Prepare arrays for three rows (one element per base).
    const substitutionRow = new Array(originalSequence.length).fill(" ");
    const underlineRow = new Array(originalSequence.length).fill(" ");
    const originalRow = originalSequence.split("");

    // --- Determine which codon to use based on the selected codon option ---
    let codonForSubstitution;
    const selectedOptionCompositeKey = selectedCodonOption[site.siteKey]; // from state
    if (selectedOptionCompositeKey) {
      // Group codon options similar to renderCodonOptions.
      const groups = {};
      site.mutations.forEach((mutation) => {
        if (mutation.mutCodons) {
          mutation.mutCodons.forEach((mutCodon) => {
            const codon = mutCodon.codon;
            let groupKey;
            if (codon.nthCodonInRs !== undefined) {
              groupKey = `Codon ${codon.nthCodonInRs}`;
            } else if (mutation.mutCodonsContextStartIdx !== undefined) {
              groupKey = `Context Start ${mutation.mutCodonsContextStartIdx}`;
            } else {
              groupKey = "Ungrouped";
            }
            if (!groups[groupKey]) {
              groups[groupKey] = [];
            }
            groups[groupKey].push(codon);
          });
        }
      });
      // Flatten groups in sorted order.
      const flatOptions = [];
      Object.keys(groups)
        .sort((a, b) => {
          if (a.startsWith("Codon") && b.startsWith("Codon")) {
            const numA = parseInt(a.replace("Codon ", ""));
            const numB = parseInt(b.replace("Codon ", ""));
            return numA - numB;
          }
          return a.localeCompare(b);
        })
        .forEach((groupKey) => {
          groups[groupKey].forEach((codon, index) => {
            flatOptions.push({
              compositeKey: `${groupKey}:${index}`,
              codon: codon,
            });
          });
        });
      const selectedOption = flatOptions.find(
        (opt) => opt.compositeKey === selectedOptionCompositeKey
      );
      if (selectedOption) {
        codonForSubstitution = selectedOption.codon;
      }
    }
    // Fallback: if no selected option, use the first mutated codon.
    if (
      !codonForSubstitution &&
      selectedMutation.mutCodons &&
      selectedMutation.mutCodons.length > 0
    ) {
      codonForSubstitution = selectedMutation.mutCodons[0].codon;
    }

    // --- Use the context position of the selected codon for substitution ---
    if (
      codonForSubstitution &&
      codonForSubstitution.contextPosition !== undefined
    ) {
      const start = codonForSubstitution.contextPosition;
      for (let i = 0; i < 3; i++) {
        if (start + i < substitutionRow.length) {
          substitutionRow[start + i] = codonForSubstitution.codonSequence[i];
          underlineRow[start + i] = "‾"; // Underline symbol
        }
      }
    }

    // RS highlighting: use contextRsIndices from the mutation.
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

    const originalId = `original-${site.siteKey}`;
    const mutatedId = `mutated-${site.siteKey}`;
    const mutatedSequence = getMutatedSequence(
      originalSequence,
      selectedMutation
    );

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
          {/* Top row: Proposed substitution (new codon) */}
          <pre className="font-mono text-lg text-green-600 dark:text-green-400 whitespace-pre">
            {substitutionRow.join("")}
          </pre>
          {/* Middle row: Original context with RS highlighting */}
          <div className="dark:text-gray-200 select-all">{highlightedRow}</div>
          {/* Bottom row: Underline for mutated codon */}
          <pre className="font-mono text-lg text-red-500 dark:text-red-400 whitespace-pre">
            {underlineRow.join("")}
          </pre>
        </div>

        <div className="text-xs mt-1 space-y-1">
          <div>
            <span className="inline-block px-1 bg-red-500 dark:bg-red-400 mr-1"></span>
            <span className="text-gray-600 dark:text-gray-300">
              Mutated Codon Underline
            </span>
          </div>
          <div>
            <span className="inline-block px-1 text-green-600 dark:text-green-400 font-semibold mr-1">
              New Base
            </span>
            <span className="text-gray-600 dark:text-gray-300">
              Proposed substitution (aligned above)
            </span>
          </div>
          <div>
            <span className="inline-block px-1 text-purple-600 dark:text-purple-400 font-semibold mr-1">
              RS Region
            </span>
            <span className="text-gray-600 dark:text-gray-300">
              Restriction site recognition sequence
            </span>
          </div>
        </div>
      </div>
    );
  };

  // Render codon options grouped by codon position (nthCodonInRs)
  const renderCodonOptions = (site) => {
    // Group options by codon position: prefer nthCodonInRs; otherwise use mutCodonsContextStartIdx.
    const groups = {};
    site.mutations.forEach((mutation, mIndex) => {
      if (mutation.mutCodons) {
        mutation.mutCodons.forEach((mutCodon) => {
          const codon = mutCodon.codon;
          let groupKey;
          if (codon.nthCodonInRs !== undefined) {
            groupKey = `Codon ${codon.nthCodonInRs}`;
          } else if (mutation.mutCodonsContextStartIdx !== undefined) {
            groupKey = `Context Start ${mutation.mutCodonsContextStartIdx}`;
          } else {
            groupKey = "Ungrouped";
          }
          if (!groups[groupKey]) {
            groups[groupKey] = [];
          }
          groups[groupKey].push({
            mutationIndex: mIndex,
            codon: codon,
          });
        });
      }
    });

    // Flatten groups into one array while preserving headers.
    const flatOptions = [];
    Object.keys(groups)
      .sort((a, b) => {
        if (a.startsWith("Codon") && b.startsWith("Codon")) {
          const numA = parseInt(a.replace("Codon ", ""));
          const numB = parseInt(b.replace("Codon ", ""));
          return numA - numB;
        }
        return a.localeCompare(b);
      })
      .forEach((groupKey) => {
        // Optionally, insert a header into the flat list.
        flatOptions.push({ header: groupKey });
        groups[groupKey].forEach((option, index) => {
          flatOptions.push({
            compositeKey: `${groupKey}:${index}`,
            ...option,
            group: groupKey,
            optionIndex: index,
          });
        });
      });

    return (
      <div className="mt-4 space-y-4">
        {flatOptions.map((option) => {
          if (option.header) {
            return (
              <div
                key={`header-${option.header}`}
                className="font-medium dark:text-gray-200"
              >
                {option.header} Options:
              </div>
            );
          } else {
            const compositeKey = option.compositeKey;
            const isSelected =
              selectedCodonOption[site.siteKey] === compositeKey;
            return (
              <div
                key={compositeKey}
                className={`p-2 border rounded cursor-pointer transition-colors ${
                  isSelected
                    ? "bg-blue-100 border-blue-300 dark:bg-blue-800 dark:border-blue-600"
                    : "bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600"
                }`}
                onClick={() =>
                  handleOptionSelect(
                    site.siteKey,
                    option.group,
                    option.optionIndex
                  )
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
                </div>
              </div>
            );
          }
        })}
      </div>
    );
  };

  // Render mutation details
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

  if (!restrictionSites.length) {
    return (
      <div className="p-4 bg-yellow-100 dark:bg-yellow-900 border border-yellow-400 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200 rounded-sm">
        No mutation data available to explore
      </div>
    );
  }

  return (
    <div className="mt-4">
      {/* Make the title sticky with Tailwind */}
      <div className="sticky top-14 z-40 bg-white dark:bg-gray-900 p-2 border-b border-gray-300 dark:border-gray-700 shadow-sm">
        <h2 className="text-xl font-bold dark:text-gray-100">
          Mutation Explorer
        </h2>
      </div>

      <div className="mt-4 space-y-6">
        {restrictionSites.map((site, siteIndex) => {
          const selectedMutationIndex = selectedMutations[site.siteKey] || 0;
          const selectedMutation = site.mutations[selectedMutationIndex];
          if (!selectedMutation) return null;
          return (
            <div
              key={siteIndex}
              className="p-4 border border-gray-300 dark:border-gray-700 rounded-sm shadow-xs dark:bg-gray-800"
            >
              <h3 className="text-lg font-semibold mb-2 dark:text-gray-200">
                Restriction Site {siteIndex + 1} ({site.siteKey})
              </h3>
              {/* Make the context sequence sticky with Tailwind */}
              <div className="sticky top-28 z-20 bg-gray-50 dark:bg-gray-800 p-2 mb-4 border-b border-gray-300 dark:border-gray-700 shadow-sm">
                {renderEnhancedContextSequence(site, selectedMutation)}
              </div>

              {renderCodonOptions(site)}
              {renderMutationDetails(selectedMutation)}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MutationExplorer;
