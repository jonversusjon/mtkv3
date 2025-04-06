import React, { useState, useEffect } from "react";

/**
 * PcrReactionGrouping Component
 * 
 * Displays PCR reactions organized by primer sets in a tabular format.
 * Includes functionality to copy data in SnapGene-compatible format.
 */
const PcrReactionGrouping = ({ stepSseData }) => {
  // State to store primer sets and their related PCR reactions
  const [primerSets, setPrimerSets] = useState([]);
  
  // State to track copied states for different primer sets
  const [copiedStates, setCopiedStates] = useState({});

  // On component mount or when stepSseData updates, organize PCR reactions by primer sets
  useEffect(() => {
    if (stepSseData && stepSseData.pcrReactions) {
      // If the data is already organized by primer sets, use it directly
      if (stepSseData.primerSets && Array.isArray(stepSseData.primerSets)) {
        setPrimerSets(stepSseData.primerSets);
      } else {
        // Otherwise, attempt to organize PCR reactions by primer sets ourselves
        const reactions = stepSseData.pcrReactions;
        
        // Group reactions by template or other identifier
        // This is a basic grouping strategy - adjust based on your actual data structure
        const groupedReactions = {};
        
        reactions.forEach(reaction => {
          const setId = reaction.primerSetId || reaction.template || 'default';
          if (!groupedReactions[setId]) {
            groupedReactions[setId] = [];
          }
          groupedReactions[setId].push(reaction);
        });
        
        // Convert the grouped object to an array of primer sets
        const organizedSets = Object.entries(groupedReactions).map(([setId, reactions]) => ({
          id: setId,
          name: `Primer Set: ${setId}`,
          reactions
        }));
        
        setPrimerSets(organizedSets);
      }
    }
  }, [stepSseData]);

  // Helper function to format reaction data for SnapGene import
  const formatForSnapGene = (primerSet) => {
    // Create TSV data with primer name, sequence, notes (empty)
    let tsvContent = "";
    
    primerSet.reactions.forEach((reaction, index) => {
      // Process forward primer
      if (reaction.forwardPrimer) {
        const fwdName = reaction.forwardPrimerName || `${primerSet.id}_R${index+1}_FWD`;
        const fwdSeq = typeof reaction.forwardPrimer === 'object' ? 
          reaction.forwardPrimer.sequence : reaction.forwardPrimer;
        tsvContent += `${fwdName}\t${fwdSeq}\t\n`;
      }
      
      // Process reverse primer
      if (reaction.reversePrimer) {
        const revName = reaction.reversePrimerName || `${primerSet.id}_R${index+1}_REV`;
        const revSeq = typeof reaction.reversePrimer === 'object' ? 
          reaction.reversePrimer.sequence : reaction.reversePrimer;
        tsvContent += `${revName}\t${revSeq}\t\n`;
      }
    });
    
    return tsvContent;
  };

  // Helper function to copy text to clipboard and set temporary copied state
  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedStates(prev => ({ ...prev, [id]: true }));
      setTimeout(() => {
        setCopiedStates(prev => ({ ...prev, [id]: false }));
      }, 2000);
    }).catch(err => console.error("Failed to copy to clipboard:", err));
  };

  // Helper function to copy all primers in a set to clipboard in SnapGene format
  const copyPrimerSetForSnapGene = (primerSet, setIndex) => {
    const tsvContent = formatForSnapGene(primerSet);
    copyToClipboard(tsvContent, `primer-set-${setIndex}`);
  };

  // Format a primer value for display - handles different data structures
  const formatPrimerDisplay = (primer) => {
    if (!primer) return "None";
    if (typeof primer === "string") return primer;
    if (primer.sequence) return primer.sequence;
    if (Array.isArray(primer)) return primer.join(", ");
    return "None";
  };

  return (
    <div className="mt-1">
      <div className="sticky top-14 z-20 bg-white dark:bg-gray-900 p-2 border-b border-gray-300 dark:border-gray-700 shadow-sm">
        <h2 className="text-xl font-bold dark:text-gray-100">PCR Reaction Grouping</h2>
      </div>
      
      <div className="mt-4 space-y-6">
        {primerSets.length === 0 ? (
          <div className="p-4 bg-yellow-100 dark:bg-yellow-900 border border-yellow-400 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200 rounded-sm">
            No PCR reaction data available to display
          </div>
        ) : (
          primerSets.map((primerSet, setIndex) => (
            <div 
              key={`primer-set-${setIndex}`} 
              className="p-4 border border-gray-300 dark:border-gray-700 rounded-sm shadow-xs dark:bg-gray-800"
            >
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-semibold dark:text-gray-200">
                  {primerSet.name || `Primer Set ${setIndex+1}`}
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
                      d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                    />
                  </svg>
                  {copiedStates[`primer-set-${setIndex}`]
                    ? "Copied for SnapGene!"
                    : "Copy All for SnapGene"}
                </button>
              </div>
              
              {/* PCR Reactions Table */}
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        Reaction
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        Template
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        Forward Primer
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        Reverse Primer
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {primerSet.reactions.map((reaction, reactionIndex) => {
                      const reactionId = `set-${setIndex}-reaction-${reactionIndex}`;
                      const fwdPrimer = formatPrimerDisplay(reaction.forwardPrimer);
                      const revPrimer = formatPrimerDisplay(reaction.reversePrimer);
                      
                      return (
                        <tr key={reactionId}>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                            {reaction.name || `Reaction ${reactionIndex+1}`}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                            {reaction.template || "N/A"}
                          </td>
                          <td className="px-4 py-3 text-sm font-mono text-gray-500 dark:text-gray-300 max-w-xs truncate">
                            {fwdPrimer}
                          </td>
                          <td className="px-4 py-3 text-sm font-mono text-gray-500 dark:text-gray-300 max-w-xs truncate">
                            {revPrimer}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                            <button
                              className="text-xs text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 px-2 py-1 rounded-sm border border-gray-300 dark:border-gray-600"
                              onClick={() => {
                                const pairData = `${reaction.forwardPrimerName || `${primerSet.id}_R${reactionIndex+1}_FWD`}\t${fwdPrimer}\t\n${reaction.reversePrimerName || `${primerSet.id}_R${reactionIndex+1}_REV`}\t${revPrimer}\t\n`;
                                copyToClipboard(pairData, reactionId);
                              }}
                            >
                              {copiedStates[reactionId] ? "Copied!" : "Copy Pair"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              
              {/* Product Information (if available) */}
              {primerSet.reactions.some(r => r.product) && (
                <div className="mt-4">
                  <h4 className="text-md font-medium dark:text-gray-200 mb-2">PCR Products</h4>
                  <div className="space-y-2">
                    {primerSet.reactions.map((reaction, reactionIndex) => 
                      reaction.product ? (
                        <div key={`product-${setIndex}-${reactionIndex}`} className="p-2 bg-gray-50 dark:bg-gray-700 rounded-sm">
                          <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            {reaction.name || `Reaction ${reactionIndex+1}`} Product:
                          </div>
                          <div className="font-mono text-xs p-1 bg-gray-100 dark:bg-gray-800 rounded-sm dark:text-gray-300 overflow-x-auto">
                            {reaction.product}
                          </div>
                        </div>
                      ) : null
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default PcrReactionGrouping;