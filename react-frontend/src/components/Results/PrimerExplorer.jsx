import React, { useState, useEffect } from "react";

/**
 * PrimerExplorer Component
 * 
 * This component displays primer set options from SSE data.
 * It mimics the styling and interaction patterns of the MutationExplorer.
 */
const PrimerExplorer = ({ stepSseData }) => {
  // State to store primer sets from SSE payload (expected under 'primers')
  const [primerSets, setPrimerSets] = useState([]);
  
  // State to track copy button confirmation for each primer (using a simple object keyed by a unique id)
  const [copiedStates, setCopiedStates] = useState({});

  // On component mount or when stepSseData updates, extract primer data.
  useEffect(() => {
    if (stepSseData && stepSseData.primers) {
      setPrimerSets(stepSseData.primers);
    }
  }, [stepSseData]);

  // Helper function: Copy text to clipboard and set a temporary copied state.
  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedStates((prev) => ({ ...prev, [id]: true }));
      setTimeout(() => {
        setCopiedStates((prev) => ({ ...prev, [id]: false }));
      }, 2000);
    });
  };

  return (
    <div className="mt-1">
      <div className="sticky top-14 z-20 bg-white dark:bg-gray-900 p-2 border-b border-gray-300 dark:border-gray-700 shadow-sm">
        <h2 className="text-xl font-bold dark:text-gray-100">Primer Explorer</h2>
      </div>
      <div className="mt-4 space-y-6">
        {primerSets.length === 0 ? (
          <div className="p-4 bg-yellow-100 dark:bg-yellow-900 border border-yellow-400 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200 rounded-sm">
            No primer data available to explore
          </div>
        ) : (
          primerSets.map((primerSet, setIndex) => (
            <div
              key={`primer-set-${setIndex}`}
              className="p-4 border border-gray-300 dark:border-gray-700 rounded-sm shadow-xs dark:bg-gray-800"
            >
              <h3 className="text-lg font-semibold mb-2 dark:text-gray-200">
                Primer Set {setIndex + 1}
              </h3>
              {primerSet.mutPrimerPairs.map((pair, pairIndex) => (
                <div
                  key={`primer-pair-${setIndex}-${pairIndex}`}
                  className="p-3 mb-3 border rounded-sm bg-gray-50 dark:bg-gray-700"
                >
                  <div className="mb-1">
                    <span className="font-medium dark:text-gray-200">
                      Site: {pair.site}
                    </span>
                  </div>
                  <div className="mb-1">
                    <strong>Forward Primer:</strong>
                    <div className="font-mono bg-blue-100 dark:bg-blue-800 px-2 py-1 inline-block">
                      {pair.forward.sequence}
                    </div>
                    <button
                      className="ml-2 text-xs text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 px-2 py-1 rounded-sm border border-gray-300 dark:border-gray-600"
                      onClick={() =>
                        copyToClipboard(pair.forward.sequence, `forward-${setIndex}-${pairIndex}`)
                      }
                    >
                      {copiedStates[`forward-${setIndex}-${pairIndex}`]
                        ? "Copied!"
                        : "Copy"}
                    </button>
                  </div>
                  <div>
                    <strong>Reverse Primer:</strong>
                    <div className="font-mono bg-green-100 dark:bg-green-800 px-2 py-1 inline-block">
                      {pair.reverse.sequence}
                    </div>
                    <button
                      className="ml-2 text-xs text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 px-2 py-1 rounded-sm border border-gray-300 dark:border-gray-600"
                      onClick={() =>
                        copyToClipboard(pair.reverse.sequence, `reverse-${setIndex}-${pairIndex}`)
                      }
                    >
                      {copiedStates[`reverse-${setIndex}-${pairIndex}`]
                        ? "Copied!"
                        : "Copy"}
                    </button>
                  </div>
                  {/* 
                    Optionally, add more primer details here:
                    - bindingRegion, tm, gcContent, length, etc.
                    - Additional styling or interactive elements can be added as needed.
                  */}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default PrimerExplorer;
