import React from "react";
import SequenceTab from "./SequenceTab";

const MTK_PART_NUMS = [
  "",
  "1",
  "2",
  "3",
  "3a",
  "3b",
  "3c",
  "3d",
  "3e",
  "3f",
  "3g",
  "4",
  "4a",
  "4b",
  "4aII",
  "3bI",
  "3bII",
  "5",
  "6",
  "7",
  "8",
  "8a",
  "8b",
];

function SequenceTabs({
  sequencesToDomesticate,
  updateSequence,
  addSequence,
  removeSequence,
  activeTabIndex,
  onTabChange,
  // errorsBySequence,
}) {
  // Use the onTabChange function to update the active tab
  const handleTabClick = (index) => {
    if (onTabChange) {
      onTabChange(index);
    }
  };

  // Make sure activeTabIndex is valid
  React.useEffect(() => {
    if (
      activeTabIndex >= sequencesToDomesticate.length &&
      sequencesToDomesticate.length > 0
    ) {
      onTabChange(sequencesToDomesticate.length - 1);
    }
  }, [sequencesToDomesticate.length, activeTabIndex, onTabChange]);

  return (
    <div className="p-4 border-b border-gray-300 bg-white dark:bg-gray-800 rounded-xl">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl text-gray-800 dark:text-white">Sequences to Domesticate</h3>
        <div className="flex space-x-2">
          <button
            type="button"
            className="w-8 h-8 flex items-center justify-center rounded border border-red-500 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={removeSequence}
            disabled={sequencesToDomesticate.length <= 1}
          >
            –
          </button>
          <button
            type="button"
            className="w-8 h-8 flex items-center justify-center rounded border border-green-500 text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={addSequence}
            disabled={sequencesToDomesticate.length >= 10}
          >
            +
          </button>
        </div>
      </div>

      <div className="mb-6 w-full">
      {/* Container for the navigation tabs */}
      <div className="flex overflow-x-auto scrollbar-hide border-b border-gray-200 dark:border-gray-700">
        {sequencesToDomesticate.map((_, index) => (
          <button
            key={index}
            type="button"
            onClick={() => handleTabClick(index)}
            className={`
              flex-shrink-0
              px-6 py-2
              text-lg font-medium
              text-center      
              border-b-2       
              
              duration-150
              whitespace-nowrap

              ${
                activeTabIndex === index
                  ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400' // Active state: Colored border and text
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300 dark:hover:border-gray-600' // Inactive state: Transparent border, gray text, hover effects
              }
            `}
          >
            {index + 1}
          </button>
        ))}
      </div>
    </div>

      <div className="w-full bg-gray-50 rounded-xl p-0">
        {sequencesToDomesticate.map((sequence, index) => (
          <div
            key={index}
            className={activeTabIndex === index ? "block" : "hidden"}
          >
            <SequenceTab
              sequence={sequence}
              index={index}
              updateSequence={updateSequence(index)}
              mtkPartOptions={MTK_PART_NUMS}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default SequenceTabs;