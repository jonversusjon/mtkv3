import React, { useState } from "react";
import SequenceTab from "./SequenceTab";

// Constants should be outside the component to avoid recreating on each render
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
}) {
  const [activeTab, setActiveTab] = useState(0);

  // Ensure active tab is valid after removing sequences
  React.useEffect(() => {
    if (
      activeTab >= sequencesToDomesticate.length &&
      sequencesToDomesticate.length > 0
    ) {
      setActiveTab(sequencesToDomesticate.length - 1);
    }
  }, [sequencesToDomesticate.length, activeTab]);

  return (
    <div className="w-full">
      {/* Section Header */}
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-lg font-semibold">Sequences to Domesticate</h3>
        </div>

        <div className="flex space-x-2">
          <button
            type="button"
            className="w-8 h-8 flex items-center justify-center rounded border border-red-500 text-red-500 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            onClick={removeSequence}
            disabled={sequencesToDomesticate.length <= 1}
            aria-label="Remove sequence"
          >
            –
          </button>
          <button
            type="button"
            className="w-8 h-8 flex items-center justify-center rounded border border-green-500 text-green-500 hover:bg-green-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            onClick={addSequence}
            disabled={sequencesToDomesticate.length >= 10}
            aria-label="Add sequence"
          >
            +
          </button>
        </div>
      </div>

      {/* Tabs Container */}
      <div className="mt-6">
        {/* Tab Navigation */}
        <div className="relative">
          <div className="flex gap-8 pb-2 mb-2 overflow-x-auto scrollbar-hide max-w-lg scroll-smooth">
            {sequencesToDomesticate.map((_, index) => (
              <button
                key={index}
                type="button"
                className={`flex-auto relative py-3 px-4 text-sm font-medium whitespace-nowrap transition-colors ${
                  activeTab === index
                    ? "text-gray-900 font-bold after:absolute after:bottom-0 after:left-0 after:w-full after:h-0.5 after:bg-indigo-600 after:scale-x-100"
                    : "text-gray-500 hover:text-gray-900 after:absolute after:bottom-0 after:left-0 after:w-full after:h-0.5 after:bg-indigo-600 after:scale-x-0"
                } after:transition-transform after:duration-300`}
                onClick={() => setActiveTab(index)}
                role="tab"
                aria-selected={activeTab === index}
                aria-controls={`sequence-tab-${index}`}
                id={`sequence-tab-button-${index}`}
              >
                {index + 1}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content Panels */}
        <div className="w-full bg-gray-200 border border-gray-300 rounded-xl p-0 overflow-x-hidden mb-8 max-w-lg">
          {sequencesToDomesticate.map((sequence, index) => (
            <div
              key={index}
              className={`transition-opacity duration-300 ${
                activeTab === index ? "block opacity-100" : "hidden opacity-0"
              }`}
              id={`sequence-tab-${index}`}
              role="tabpanel"
              aria-labelledby={`sequence-tab-button-${index}`}
              hidden={activeTab !== index}
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
    </div>
  );
}

export default SequenceTabs;
