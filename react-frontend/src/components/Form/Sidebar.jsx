import React from "react";
import { Tooltip } from "react-tooltip";
import Settings from "./Settings"; // [cite: uploaded:src/components/Form/Settings.jsx]

// --- Helper: Sidebar Item ---
const SidebarItem = ({ seq, index, errors = [], isActive, onSelectTab }) => (
  <li
    onClick={() => onSelectTab(index)}
    // Added explicit light mode text/border colors
    className={`flex items-center gap-3 p-2 border-b border-gray-200 text-gray-800 cursor-pointer transition-colors duration-150 ease-in-out
                dark:border-gray-700 dark:text-gray-200
                ${
                  isActive
                    ? "bg-pink-100 dark:bg-pink-800/30" // Active state
                    : "hover:bg-gray-100 dark:hover:bg-gray-700/50" // Hover state
                }`}
  >
    {/* Status Icon: Error Badge or Checkmark */}
    <div className="shrink-0 w-5 h-5 flex items-center justify-center">
      {errors.length > 0 ? (
        <>
          <div
            data-tooltip-id={`error-tooltip-${index}`}
            data-tooltip-content={errors.join("\n")}
            // Error badge - colors are self-contained (red/white)
            className="relative w-5 h-5 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center shadow-sm cursor-pointer"
          >
            {errors.length}
          </div>
          <Tooltip
            id={`error-tooltip-${index}`}
            place="right"
            style={{ whiteSpace: "pre-line", zIndex: 9999 }}
          />
        </>
      ) : (
        // Checkmark - explicit light/dark colors
        <div className="text-green-600 dark:text-green-500 text-xl font-bold">✔</div>
      )}
    </div>

    {/* Sequence Info: Name and Length */}
    <div className="grow flex flex-col overflow-hidden">
      {/* Added explicit light mode text color */}
      <div className="font-medium text-sm text-gray-800 dark:text-gray-200 truncate">
        {seq.primerName?.trim() || `Sequence ${index + 1}`}
      </div>
      {/* Added explicit light mode text color */}
      <div className="text-xs text-gray-500 dark:text-gray-400">
        {(seq.sequence || "").length} bp
      </div>
    </div>
  </li>
);

// --- Helper: Settings Toggle Button ---
const SettingsToggle = ({ settingsToggleRef, showSettings, setShowSettings }) => (
  <button
    ref={settingsToggleRef}
    type="button"
    className="flex items-center gap-1.5 px-2 py-1.5 m-4 border rounded-md text-xs font-medium transition-colors
               bg-black border-gray-300 text-white hover:bg-gray-700 /* Light Mode */
               dark:bg-gray-700 dark:border-gray-500 dark:text-gray-200 dark:hover:bg-gray-600" /* Dark Mode - Adjusted from previous */
    onClick={() => setShowSettings((prev) => !prev)} // This handles the toggle
    aria-label={showSettings ? "Close settings" : "Open settings"}
    aria-expanded={showSettings}
  >
    <span className="text-base" aria-hidden="true">⚙️</span>
    <span className="hidden sm:inline">Settings</span>
  </button>
);

// --- Main Sidebar Component ---
const Sidebar = ({
  sequences = [],
  errorsBySequence = {},
  settingsToggleRef,
  setShowSettings,
  showSettings,
  formData = {},
  updateSettings,
  activeTabIndex,
  onSelectTab,
}) => {

  const getSequenceErrors = (index) => {
    const sequenceErrors = [];

    // Look for errors that match the sequence index pattern
    // This handles how errors are actually structured in useValidateForm.js
    for (const key in errorsBySequence) {
      // Match pattern like "sequencesToDomesticate[0].sequence" or similar
      const regex = new RegExp(`sequencesToDomesticate\\[${index}\\]\\.`);
      if (regex.test(key)) {
        sequenceErrors.push(errorsBySequence[key]);
      }
    }

    return sequenceErrors;
  };

  return (
    <aside className="sticky top-[165px] w-full md:w-64 h-auto md:h-[calc(100vh-165px)] max-h-[50vh] md:max-h-[calc(100vh-165px)] p-4 border-b md:border-b-0 md:border-r border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 overflow-y-auto flex flex-col">

      <SettingsToggle
        settingsToggleRef={settingsToggleRef}
        showSettings={showSettings}
        setShowSettings={setShowSettings}
      />

      {/* Settings Component - Rendered conditionally */}
      <Settings
        show={showSettings}
        onClose={() => setShowSettings(false)}
        formData={formData}
        updateField={updateSettings}
        availableSpecies={formData?.availableSpecies || []}
      />

      {/* Sequence Overview Section */}
      <div className="mt-4 grow">
        {/* Added explicit light mode text color */}
        <h3 className="text-center mb-3 font-semibold text-gray-700 dark:text-gray-200">
          Sequences Overview
        </h3>
        <ul className="space-y-1">
          {sequences.map((seq, index) => (
            <SidebarItem
              key={index}
              seq={seq}
              index={index}
              errors={getSequenceErrors(index)}
              isActive={activeTabIndex === index}
              onSelectTab={onSelectTab}
            />
          ))}
        </ul>
      </div>
    </aside>
  );
};

export default Sidebar;