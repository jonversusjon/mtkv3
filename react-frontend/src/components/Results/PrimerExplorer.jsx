import React, { useState, useEffect } from "react";

/**
 * PrimerExplorer Component
 *
 * This component displays primer set options from SSE data.
 * Updated to support both recommended and custom primer sets.
 */
const PrimerExplorer = ({ stepSseData }) => {
  // State to store multiple primer sets (recommended and custom)
  const [primerSets, setPrimerSets] = useState([]);
  const [selectedSetIndex, setSelectedSetIndex] = useState(0);

  // State to track copy button confirmation
  const [copiedStates, setCopiedStates] = useState({});

  // On component mount or when stepSseData updates, extract primer data
  useEffect(() => {
    if (!stepSseData) return;

    // Handle recommended primers (from Stage 2)
    if (stepSseData.recommended && stepSseData.recommended.primer_set) {
      const primerSet = stepSseData.recommended.primer_set;

      // Add as a new set with metadata
      setPrimerSets((prevSets) => {
        // Check if we already have this set
        if (prevSets.some((set) => set.id === "recommended")) {
          return prevSets;
        }

        const newSet = {
          id: "recommended",
          name: "Recommended Primers",
          isRecommended: true,
          mutPrimerPairs: primerSet.mutPrimerPairs || [],
          timestamp: Date.now(),
        };

        // Set as selected if it's the first set
        if (prevSets.length === 0) {
          setSelectedSetIndex(0);
        }

        return [...prevSets, newSet];
      });
    }

    // Handle custom designed primers (from Stage 3)
    if (stepSseData.custom_primers && stepSseData.custom_primers.primer_set) {
      const primerSet = stepSseData.custom_primers.primer_set;

      // Add as a new set with metadata
      setPrimerSets((prevSets) => {
        const setId = `custom-${Date.now()}`;
        const newSet = {
          id: setId,
          name: `Custom Primer Set ${prevSets.length}`,
          isCustom: true,
          selected_mutations: stepSseData.custom_primers.selected_mutations,
          mutPrimerPairs: primerSet.mutPrimerPairs || [],
          timestamp: Date.now(),
        };

        // Auto-select the new custom set
        setSelectedSetIndex(prevSets.length);

        return [...prevSets, newSet];
      });
    }

    // Legacy support for older data format
    if (stepSseData.primers && Array.isArray(stepSseData.primers)) {
      setPrimerSets((prevSets) => {
        if (prevSets.some((set) => set.id === "legacy")) {
          return prevSets;
        }

        return [
          ...prevSets,
          {
            id: "legacy",
            name: "Primer Set",
            mutPrimerPairs: stepSseData.primers[0]?.mutPrimerPairs || [],
            timestamp: Date.now(),
          },
        ];
      });
    }
  }, [stepSseData]);

  // Helper function: Copy text to clipboard and set a temporary copied state
  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedStates((prev) => ({ ...prev, [id]: true }));
      setTimeout(() => {
        setCopiedStates((prev) => ({ ...prev, [id]: false }));
      }, 2000);
    });
  };

  // Helper function: Format primer set data for SnapGene import
  const formatPrimersForSnapGene = (primerSet) => {
    // Create TSV data with 3 columns: primer name, sequence, notes (empty)
    // No headers as per SnapGene import format
    let tsvContent = "";

    primerSet.mutPrimerPairs.forEach((pair) => {
      // Add forward primer
      tsvContent += `${pair.forward.name}\t${pair.forward.sequence}\t\n`;
      // Add reverse primer
      tsvContent += `${pair.reverse.name}\t${pair.reverse.sequence}\t\n`;
    });

    return tsvContent;
  };

  // Helper function: Copy all primers in a set to clipboard in SnapGene format
  const copyPrimerSetForSnapGene = (primerSet, setIndex) => {
    const tsvContent = formatPrimersForSnapGene(primerSet);
    copyToClipboard(tsvContent, `primer-set-${setIndex}`);
  };

  // Primer Set Selector Component
  const PrimerSetSelector = ({ sets, selectedIndex, onSelect }) => (
    <div className="mb-4 border-b border-gray-200 dark:border-gray-700">
      <div className="flex overflow-x-auto">
        {sets.map((set, index) => (
          <button
            key={set.id}
            className={`px-4 py-2 text-sm whitespace-nowrap font-medium border-b-2 focus:outline-none ${
              index === selectedIndex
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
            }`}
            onClick={() => onSelect(index)}
          >
            {set.name}
            {set.isRecommended && (
              <span className="ml-2 text-green-500 text-xs">✓</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );

  // Render a primer set
  const renderPrimerSet = (primerSet) => {
    if (
      !primerSet ||
      !primerSet.mutPrimerPairs ||
      primerSet.mutPrimerPairs.length === 0
    ) {
      return (
        <div className="p-4 bg-yellow-100 dark:bg-yellow-900 border border-yellow-400 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200 rounded-sm">
          No primer data available in this set
        </div>
      );
    }

    const setIndex = primerSets.findIndex((set) => set.id === primerSet.id);

    return (
      <div
        key={`primer-set-${primerSet.id}`}
        className="p-4 border border-gray-300 dark:border-gray-700 rounded-sm shadow-xs dark:bg-gray-800"
      >
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-lg font-semibold dark:text-gray-200">
            {primerSet.name}
            {primerSet.isRecommended && (
              <span className="ml-2 text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 px-2 py-1 rounded">
                System Recommended
              </span>
            )}
            {primerSet.isCustom && (
              <span className="ml-2 text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 px-2 py-1 rounded">
                Custom Design
              </span>
            )}
          </h3>
          <button
            className="text-sm text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 px-3 py-1 rounded-sm flex items-center gap-1"
            onClick={() => copyPrimerSetForSnapGene(primerSet, setIndex)}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2v3m2 4H10m0 0l3-3m-3 3l3 3"
              />
            </svg>
            {copiedStates[`primer-set-${setIndex}`]
              ? "Copied for SnapGene!"
              : "Copy All for SnapGene"}
          </button>
        </div>
        {primerSet.mutPrimerPairs.map((pair, pairIndex) => (
          <div
            key={`primer-pair-${primerSet.id}-${pairIndex}`}
            className="p-3 mb-3 border rounded-sm bg-gray-50 dark:bg-gray-700"
          >
            <div className="mb-2">
              <span className="font-medium dark:text-gray-200">
                Site: {pair.site}
              </span>
              <span className="ml-4 text-sm text-gray-600 dark:text-gray-400">
                Position: {pair.position}
              </span>
            </div>

            {/* Forward Primer with additional details */}
            <div className="mb-3 border-l-4 border-blue-400 dark:border-blue-600 pl-3 py-1">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <strong className="dark:text-gray-200">Forward Primer:</strong>
                <div className="font-mono bg-blue-100 dark:bg-blue-800 px-2 py-1 inline-block">
                  {pair.forward.sequence}
                </div>
                <button
                  className="text-xs text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 px-2 py-1 rounded-sm border border-gray-300 dark:border-gray-600"
                  onClick={() =>
                    copyToClipboard(
                      pair.forward.sequence,
                      `forward-${primerSet.id}-${pairIndex}`
                    )
                  }
                >
                  {copiedStates[`forward-${primerSet.id}-${pairIndex}`]
                    ? "Copied!"
                    : "Copy"}
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm mt-1">
                <div>
                  <span className="text-gray-600 dark:text-gray-400">
                    Name:
                  </span>{" "}
                  <span className="font-medium dark:text-gray-300">
                    {pair.forward.name}
                  </span>
                </div>
                <div>
                  <span className="text-gray-600 dark:text-gray-400">Tm:</span>{" "}
                  <span className="font-medium dark:text-gray-300">
                    {pair.forward.tm}°C
                  </span>
                </div>
                <div>
                  <span className="text-gray-600 dark:text-gray-400">GC%:</span>{" "}
                  <span className="font-medium dark:text-gray-300">
                    {Math.round(pair.forward.gcContent * 100)}%
                  </span>
                </div>
                <div>
                  <span className="text-gray-600 dark:text-gray-400">
                    Length:
                  </span>{" "}
                  <span className="font-medium dark:text-gray-300">
                    {pair.forward.length} bp
                  </span>
                </div>
              </div>
              <div className="mt-1">
                <span className="text-gray-600 dark:text-gray-400 text-sm">
                  Binding Region:
                </span>{" "}
                <div className="font-mono text-xs mt-1 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-sm overflow-x-auto">
                  {pair.forward.bindingRegion}
                </div>
              </div>
            </div>

            {/* Reverse Primer with additional details */}
            <div className="border-l-4 border-green-400 dark:border-green-600 pl-3 py-1">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <strong className="dark:text-gray-200">Reverse Primer:</strong>
                <div className="font-mono bg-green-100 dark:bg-green-800 px-2 py-1 inline-block">
                  {pair.reverse.sequence}
                </div>
                <button
                  className="text-xs text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 px-2 py-1 rounded-sm border border-gray-300 dark:border-gray-600"
                  onClick={() =>
                    copyToClipboard(
                      pair.reverse.sequence,
                      `reverse-${primerSet.id}-${pairIndex}`
                    )
                  }
                >
                  {copiedStates[`reverse-${primerSet.id}-${pairIndex}`]
                    ? "Copied!"
                    : "Copy"}
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm mt-1">
                <div>
                  <span className="text-gray-600 dark:text-gray-400">
                    Name:
                  </span>{" "}
                  <span className="font-medium dark:text-gray-300">
                    {pair.reverse.name}
                  </span>
                </div>
                <div>
                  <span className="text-gray-600 dark:text-gray-400">Tm:</span>{" "}
                  <span className="font-medium dark:text-gray-300">
                    {pair.reverse.tm}°C
                  </span>
                </div>
                <div>
                  <span className="text-gray-600 dark:text-gray-400">GC%:</span>{" "}
                  <span className="font-medium dark:text-gray-300">
                    {Math.round(pair.reverse.gcContent * 100)}%
                  </span>
                </div>
                <div>
                  <span className="text-gray-600 dark:text-gray-400">
                    Length:
                  </span>{" "}
                  <span className="font-medium dark:text-gray-300">
                    {pair.reverse.length} bp
                  </span>
                </div>
              </div>
              <div className="mt-1">
                <span className="text-gray-600 dark:text-gray-400 text-sm">
                  Binding Region:
                </span>{" "}
                <div className="font-mono text-xs mt-1 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-sm overflow-x-auto">
                  {pair.reverse.bindingRegion}
                </div>
              </div>
            </div>

            {/* Mutation details - show if available */}
            {pair.mutation && (
              <div className="mt-3 pt-2 border-t border-gray-200 dark:border-gray-600">
                <details className="text-sm">
                  <summary className="cursor-pointer font-medium text-gray-600 dark:text-gray-300 hover:text-blue-500 dark:hover:text-blue-400">
                    View Mutation Details
                  </summary>
                  <div className="mt-2 pl-2 border-l-2 border-gray-300 dark:border-gray-600">
                    <div className="mb-1">
                      <span className="text-gray-600 dark:text-gray-400">
                        Enzyme:
                      </span>{" "}
                      <span className="font-medium dark:text-gray-300">
                        {pair.mutation.enzyme}
                      </span>
                    </div>
                    <div className="mb-1">
                      <span className="text-gray-600 dark:text-gray-400">
                        Mutation Range:
                      </span>{" "}
                      <span className="font-medium dark:text-gray-300">
                        {pair.mutation.firstMutIdx} - {pair.mutation.lastMutIdx}
                      </span>
                    </div>
                    {pair.mutation.mutCodons &&
                      pair.mutation.mutCodons.length > 0 && (
                        <div className="mb-1">
                          <span className="text-gray-600 dark:text-gray-400">
                            Codon Changes:
                          </span>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                            {pair.mutation.mutCodons.map((mutCodon, idx) => (
                              <div
                                key={idx}
                                className="bg-gray-100 dark:bg-gray-800 p-2 rounded-sm"
                              >
                                <div className="flex justify-between">
                                  <span className="text-gray-700 dark:text-gray-300">
                                    Codon {mutCodon.nthCodonInRs}:{" "}
                                    {mutCodon.codon.codonSequence}
                                  </span>
                                  <span className="font-medium text-blue-600 dark:text-blue-400">
                                    {mutCodon.codon.aminoAcid}
                                  </span>
                                </div>
                                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                  Position: {mutCodon.codon.contextPosition} •
                                  Usage: {mutCodon.codon.usage}%
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    {pair.mutation.overhangOptions &&
                      pair.mutation.overhangOptions.length > 0 && (
                        <div>
                          <span className="text-gray-600 dark:text-gray-400">
                            Overhang Options:
                          </span>
                          <div className="font-mono text-xs mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {pair.mutation.overhangOptions.map(
                              (option, idx) => (
                                <div
                                  key={idx}
                                  className="bg-gray-100 dark:bg-gray-800 p-2 rounded-sm"
                                >
                                  <div>
                                    Top:{" "}
                                    <span className="text-blue-600 dark:text-blue-400">
                                      {option.topOverhang}
                                    </span>
                                  </div>
                                  <div>
                                    Bottom:{" "}
                                    <span className="text-green-600 dark:text-green-400">
                                      {option.bottomOverhang}
                                    </span>
                                  </div>
                                  <div className="text-gray-500 dark:text-gray-400">
                                    Start: {option.overhangStartIndex}
                                  </div>
                                </div>
                              )
                            )}
                          </div>
                        </div>
                      )}
                  </div>
                </details>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="mt-1">
      <div className="sticky top-14 z-20 bg-white dark:bg-gray-900 p-2 border-b border-gray-300 dark:border-gray-700 shadow-sm">
        <h2 className="text-xl font-bold dark:text-gray-100">
          Primer Explorer
        </h2>
      </div>

      {primerSets.length > 0 ? (
        <>
          {/* Primer set selector */}
          <PrimerSetSelector
            sets={primerSets}
            selectedIndex={selectedSetIndex}
            onSelect={setSelectedSetIndex}
          />

          {/* Display the currently selected primer set */}
          <div className="mt-4 space-y-6">
            {renderPrimerSet(primerSets[selectedSetIndex])}
          </div>
        </>
      ) : (
        <div className="p-4 bg-yellow-100 dark:bg-yellow-900 border border-yellow-400 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200 rounded-sm">
          No primer data available to explore
        </div>
      )}
    </div>
  );
};

export default PrimerExplorer;
