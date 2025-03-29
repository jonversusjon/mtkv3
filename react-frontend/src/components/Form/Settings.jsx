import React, { useRef, useEffect, useCallback } from "react";
// Removed CSS import

// Constants for slider interpretation [cite: uploaded:src/components/Form/Settings.jsx]
const sliderValues = ["one", "a few", "many", "most", "all"];

function Settings({
  show,
  onClose,
  formData = {}, // Default formData to prevent errors
  updateField,
  availableSpecies = [], // Default availableSpecies
}) {
  const modalContentRef = useRef(null); // [cite: uploaded:src/components/Form/Settings.jsx]

  // Handle clicks outside the modal content to close it [cite: uploaded:src/components/Form/Settings.jsx]
  const handleOutsideClick = useCallback(
    (e) => {
      if (
        modalContentRef.current &&
        !modalContentRef.current.contains(e.target)
      ) {
        onClose(); // Call the passed onClose function
      }
    },
    [onClose] // Dependency array includes onClose
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

  // --- Slider Logic ---
  // Find the index corresponding to the current maxResults value
  const currentIndex = sliderValues.indexOf(formData.maxResults);
  // Default to 0 if the value isn't found (e.g., initial state)
  const safeIndex = currentIndex !== -1 ? currentIndex : 0;

  // If not shown, return null (render nothing)
  if (!show) return null;

  // --- Main Render ---
  return (
    // Modal container: Positioned absolutely relative to nearest positioned ancestor (likely Sidebar)
    // Use Tailwind for positioning, sizing, styling, and responsiveness based on Settings.css
    <div
      // Use fixed positioning relative to viewport, or absolute if nested in a relative parent like Sidebar
      // Adjust top/right/left as needed. Using absolute positioning here assuming it's inside the relative/sticky Sidebar.
      // Added responsive positioning and width
      className="absolute top-16 right-4 left-4 md:left-auto z-50
                 w-auto max-w-md p-4 border rounded-lg shadow-xl
                 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600
                 overflow-y-auto max-h-[calc(100vh-10rem)] transition-opacity duration-200 ease-in-out"
      // Removed the onClick={handleOutsideClick} here, the listener handles it now.
      ref={modalContentRef} // Assign ref to the content wrapper
      aria-modal="true" // Accessibility attribute
      role="dialog" // Accessibility attribute
      aria-labelledby="settings-title" // Accessibility attribute
    >
      <h2 id="settings-title" className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-100">
        Settings
      </h2>

      {/* Form Groups styled with Tailwind Flexbox based on .form-group*/}
      <div className="space-y-4"> {/* Add spacing between form groups */}

        {/* Species Selection */}
        <div className="flex items-center justify-between gap-4">
          <label htmlFor="species-select" className="shrink-0 w-2/5 text-sm font-medium text-gray-700 dark:text-gray-300">
            Species:
          </label>
          <select
            id="species-select"
            // Input styling based on .form-control
            className="flex-1 p-1.5 border rounded-sm text-sm bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 focus:ring-blue-500 focus:border-blue-500"
            value={formData.species || ""} // Ensure value is controlled
            onChange={(e) => updateField("species", e.target.value)} // [cite: uploaded:src/components/Form/Settings.jsx]
          >
            {/* Default option if needed */}
            {/* <option value="">Select Species</option> */}
            {(availableSpecies || []).map((species) => ( // Safely map over species
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
            value={formData.kozak || "MTK"} // Ensure value is controlled, default if needed
            onChange={(e) => updateField("kozak", e.target.value)} // [cite: uploaded:src/components/Form/Settings.jsx]
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
            value={formData.maxMutationsPerSite || 1} // Ensure value is controlled, default if needed [cite: uploaded:src/pages/FormPage.jsx] has default 1
            onChange={(e) =>
              updateField("maxMutationsPerSite", parseInt(e.target.value, 10)) // Use radix 10 [cite: uploaded:src/components/Form/Settings.jsx] contains max_mut_per_site but FormPage uses maxMutationsPerSite
            }
          >
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
          </select>
        </div>

        {/* Results Limit Slider */}
        <div className="flex items-center justify-between gap-4">
          <label htmlFor="results-slider" className="shrink-0 w-2/5 text-sm font-medium text-gray-700 dark:text-gray-300">
            Number of Results:
          </label>
          <div className="flex-1 flex items-center gap-2">
             <input
                type="range"
                id="results-slider"
                className="grow h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-600" // Basic slider styling
                min="0"
                max={sliderValues.length - 1} // Max index
                step="1"
                value={safeIndex} // Use calculated safe index [cite: uploaded:src/components/Form/Settings.jsx]
                onChange={(e) => {
                    const newIndex = parseInt(e.target.value, 10); // Use radix 10
                    updateField("maxResults", sliderValues[newIndex]); // Update with string value [cite: uploaded:src/components/Form/Settings.jsx]
                }}
             />
            {/* Display current value */}
             <span className="text-sm text-gray-600 dark:text-gray-400 w-10 text-right">
                {formData.maxResults || "one"} {/* Display current string value */}
            </span>
           </div>
        </div>

        {/* Verbose Mode Toggle */}
        {/* Styled based on .form-check */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="verbose-mode"
            // Basic checkbox styling - Tailwind forms plugin recommended for better styling
            className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded-sm focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
            checked={formData.verboseMode || false} // Ensure value is controlled [cite: uploaded:src/pages/FormPage.jsx] uses verboseMode
            onChange={(e) => updateField("verboseMode", e.target.checked)} // [cite: uploaded:src/components/Form/Settings.jsx] uses verbose_mode but FormPage uses verboseMode
          />
          <label htmlFor="verbose-mode" className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Verbose Mode
          </label>
        </div>

      </div>
      {/* Removed footer and close button as per original comment [cite: uploaded:src/components/Form/Settings.jsx] */}
       {/* Optional: Add a close button if needed for accessibility or usability */}
       {/* <div className="mt-5 text-right">
           <button
               type="button"
               onClick={onClose}
               className="px-3 py-1 text-sm rounded-sm bg-gray-200 hover:bg-gray-300 dark:bg-gray-600 dark:hover:bg-gray-500"
           >
               Close
           </button>
       </div> */}
    </div>
  );
}

export default Settings;