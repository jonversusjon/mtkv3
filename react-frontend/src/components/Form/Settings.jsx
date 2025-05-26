import React, { useRef, useEffect, useCallback } from "react";

function Settings({
  show,
  onClose,
  formData = {}, // Default formData to prevent errors
  updateField,
  availableSpecies = [], // Default availableSpecies
}) {
  const modalContentRef = useRef(null);

  // Handle clicks outside the modal content to close it
  const handleOutsideClick = useCallback(
    (e) => {
      if (
        modalContentRef.current &&
        !modalContentRef.current.contains(e.target)
      ) {
        onClose(); // Call the passed onClose function
      }
    },
    [onClose]
  );

  // Add/remove event listener for outside clicks
  useEffect(() => {
    if (show) {
      document.addEventListener("mousedown", handleOutsideClick);
    } else {
      document.removeEventListener("mousedown", handleOutsideClick);
    }
    // Cleanup function
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [show, handleOutsideClick]); // Re-run effect if show or the callback changes

  // If not shown, return null (render nothing)
  if (!show) return null;

  // --- Main Render ---
  return (
    // Modal container: Using fixed positioning anchored to the top-left of the viewport
    <div
      className="fixed top-0 left-0 z-50 w-full h-full pointer-events-none"
      aria-modal="true"
      role="dialog"
      aria-labelledby="settings-title"
    >
      <div 
        ref={modalContentRef}
        className="absolute top-32 left-16 md:left-20 w-64 md:w-72 p-4 border rounded-lg shadow-xl 
                 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600
                 pointer-events-auto transition-opacity duration-200 ease-in-out"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="settings-title" className="text-lg font-semibold text-gray-800 dark:text-gray-100">
            Settings
          </h2>
          <button 
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        {/* Form Groups styled with Tailwind Flexbox */}
        <div className="space-y-4">
          {/* Species Selection */}
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="species-select" className="shrink-0 w-2/5 text-sm font-medium text-gray-700 dark:text-gray-300">
              Species:
            </label>
            <select
              id="species-select"
              className="flex-1 p-1.5 border rounded-sm text-sm bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 focus:ring-blue-500 focus:border-blue-500"
              value={formData.species || ""} 
              onChange={(e) => updateField("species", e.target.value)}
            >
              {(availableSpecies || []).map((species) => (
                <option key={species} value={species}>
                  {species}
                </option>
              ))}
            </select>
          </div>

          {/* Kozak Selection */}
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="kozak-select" className="shrink-0 w-2/5 text-sm font-medium text-gray-700 dark:text-gray-300">
              Kozak:
            </label>
            <select
              id="kozak-select"
              className="flex-1 p-1.5 border rounded-sm text-sm bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 focus:ring-blue-500 focus:border-blue-500"
              value={formData.kozak || "MTK"}
              onChange={(e) => updateField("kozak", e.target.value)}
            >
              <option value="MTK">MTK</option>
              <option value="Canonical">Canonical</option>
            </select>
          </div>

          {/* Max Mutations Setting */}
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="mutations-select" className="shrink-0 w-2/5 text-sm font-medium text-gray-700 dark:text-gray-300">
              Max mutations/site:
            </label>
            <select
              id="mutations-select"
              className="flex-1 p-1.5 border rounded-sm text-sm bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 focus:ring-blue-500 focus:border-blue-500"
              value={formData.maxMutationsPerSite || 1}
              onChange={(e) =>
                updateField("maxMutationsPerSite", parseInt(e.target.value, 10))
              }
            >
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </div>

          {/* Verbose Mode Toggle */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="verbose-mode"
              className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded-sm focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
              checked={formData.verboseMode || false}
              onChange={(e) => updateField("verboseMode", e.target.checked)}
            />
            <label htmlFor="verbose-mode" className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Verbose Mode
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Settings;