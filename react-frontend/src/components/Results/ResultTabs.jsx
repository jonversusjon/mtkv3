// Results/ResultTabs.jsx
import React, { useState, useEffect } from "react";
import ResultTab from "./ResultTab"; // Ensure this path is correct

const ResultTabs = ({ jobId }) => {
  // Load sequences from sessionStorage (each sequence gets an id that serves as sequenceIdx)
  const [sequences, setSequences] = useState([]);
  const [activeTab, setActiveTab] = useState(0); // Keep track of the active tab index

  useEffect(() => {
    // Attempt to load sequence information from sessionStorage
    const savedFormData = sessionStorage.getItem("formData");
    if (savedFormData) {
      try {
        const parsed = JSON.parse(savedFormData);
        // Assuming sequencesToDomesticate holds the array of sequence objects
        if (parsed.sequencesToDomesticate?.length > 0) {
          // Map sequences to include an 'id' (which corresponds to sequenceIdx) and a display name
          const seqs = parsed.sequencesToDomesticate.map((seq, i) => ({
            id: i, // Use the index as the unique ID and sequenceIdx
            // Use primerName if available, otherwise fallback to a generic name
            displayName: seq.primerName?.trim() || `Sequence ${i + 1}`,
          }));
          setSequences(seqs);
        } else {
          console.warn("No sequences found in sessionStorage formData.");
          setSequences([]); // Ensure sequences is an empty array if none are found
        }
      } catch (error) {
        console.error("Error parsing formData from sessionStorage:", error);
        setSequences([]); // Reset sequences on error
      }
    } else {
      console.warn("No formData found in sessionStorage.");
      setSequences([]); // Ensure sequences is an empty array if no data found
    }
  }, []); // Run this effect only once on component mount

  // Adjust activeTab if it becomes out of bounds (e.g., if sequences load async or change)
  useEffect(() => {
    if (sequences.length > 0) {
      // If activeTab is invalid, reset to 0 or the last valid index
      if (activeTab >= sequences.length || activeTab < 0) {
        setActiveTab(0); // Default to the first tab if current is invalid
      }
    } else {
      // If there are no sequences, reset activeTab to 0
      setActiveTab(0);
    }
  }, [sequences, activeTab]);

  // Add debug logging for state changes
  useEffect(() => {
    console.log("Active tab changed to:", activeTab);
  }, [activeTab]);

  // Display a loading message or placeholder if sequences haven't loaded yet
  if (sequences.length === 0) {
    // Added check for jobId as well, perhaps loading is dependent on it too
    return (
      <p className="p-4 text-gray-500 dark:text-gray-400">
        Loading sequence data{jobId ? ` for Job ${jobId}` : ""}...
      </p>
    );
  }

  return (
    <div className="flex flex-col w-full max-w-4xl mx-auto">
      {/* Result Tabs - Fixed at top with highest z-index */}
      <div className="sticky top-18 z-50 bg-white dark:bg-gray-900 shadow-sm border-b border-gray-300 dark:border-gray-700">
        <div className="flex justify-between overflow-x-auto">
          {sequences.map((seq, index) => {
            const isActive = activeTab === index;
            const isComplete = false; // Replace with your completion logic
            const notificationCount = 0; // Replace with actual notification count

            return (
              <button
                key={seq.id}
                type="button"
                role="tab"
                className={`py-2 px-4 text-lg font-medium text-center whitespace-nowrap flex-1
                  border-b-2 bg-transparent flex items-center justify-center relative
                  ${
                    isActive
                      ? "border-blue-500 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300 dark:hover:border-gray-600"
                  }`}
                onClick={() => {
                  console.log("Setting activeTab to:", index);
                  setActiveTab(index);
                }}
                aria-selected={isActive}
                aria-controls={`tab-content-${seq.id}`}
                id={`tab-button-${seq.id}`}
              >
                <span>{seq.displayName}</span>

                {/* Green checkmark */}
                {isComplete && (
                  <span className="ml-2 text-green-500">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </span>
                )}

                {/* Red notification circle */}
                {notificationCount > 0 && (
                  <span className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-xs text-white">
                    {notificationCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content Area - Takes remaining space and can scroll */}
      <div className="flex-1 relative">
        {sequences.map((seq, index) => (
          <div
            key={seq.id}
            role="tabpanel"
            aria-labelledby={`tab-button-${seq.id}`}
            id={`tab-content-${seq.id}`}
            className={`tab-pane w-full ${
              activeTab === index ? "block" : "hidden"
            }`}
          >
            <ResultTab jobId={jobId} sequenceIdx={seq.id} />
          </div>
        ))}
      </div>
    </div>
  );
};

export default ResultTabs;
