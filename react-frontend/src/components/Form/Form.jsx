import React, { useCallback } from "react";
import TemplateSequence from "./TemplateSequence";
import SequenceTabs from "./SequenceTabs";

const Form = ({
  onSubmit,
  formData,
  updateFields,
  errors,
  isValid,
  initialized,
  activeTabIndex,
  setActiveTabIndex,
}) => {
  // Form submission handler
  const handleSubmit = (e) => {
    e.preventDefault();
    // Ensure species is set before submitting, defaulting if necessary
    const finalFormData =
      (!formData.species || formData.species.trim() === "") &&
      formData.availableSpecies?.length > 0
        ? { ...formData, species: formData.availableSpecies[0] }
        : formData;

    if (isValid && initialized) {
      onSubmit(finalFormData);
    } else {
      console.warn(
        "Form submission prevented. Is valid:",
        isValid,
        "Is initialized:",
        initialized
      );
      // Optionally, provide user feedback about why submission failed
    }
  };

  // Callback to update a specific sequence's field [cite: uploaded:src/components/Form/Form.jsx]
  const updateSequence = useCallback(
    (index) => (field, value) => {
      updateFields((prev) => {
        // Create a deep copy to avoid direct state mutation issues
        const updatedSequences = prev.sequencesToDomesticate.map((seq, i) =>
          i === index ? { ...seq, [field]: value } : seq
        );
        // Only update state if the sequences actually changed
        if (
          JSON.stringify(prev.sequencesToDomesticate) ===
          JSON.stringify(updatedSequences)
        ) {
          return prev;
        }
        return { ...prev, sequencesToDomesticate: updatedSequences };
      });
    },
    [updateFields]
  );

  // Callback to add a new default sequence
  const addSequence = useCallback(() => {
    updateFields((prev) => {
      if (prev.sequencesToDomesticate.length >= 10) return prev; // Max 10 sequences
      return {
        ...prev,
        sequencesToDomesticate: [
          ...prev.sequencesToDomesticate,
          { sequence: "", primerName: "", mtkPartLeft: "", mtkPartRight: "" }, // Default new sequence
        ],
      };
    });
  }, [updateFields]);

  // Callback to remove the last sequence
  const removeSequence = useCallback(() => {
    updateFields((prev) => {
      if (prev.sequencesToDomesticate.length <= 1) return prev; // Keep at least one
      const newSequences = prev.sequencesToDomesticate.slice(0, -1);
      // Adjust active tab if the removed tab was the active one
      if (activeTabIndex >= newSequences.length) {
        setActiveTabIndex(newSequences.length - 1);
      }
      return {
        ...prev,
        sequencesToDomesticate: newSequences,
      };
    });
  }, [updateFields, activeTabIndex, setActiveTabIndex]); // Added setActiveTabIndex dependency

  // Callback to reset parts of the form
  const resetForm = useCallback(() => {
    // Reset template sequence and sequences to domesticate to initial defaults
    updateFields((prev) => ({
      ...prev,
      templateSequence: "",
      sequencesToDomesticate: [
        { sequence: "", primerName: "", mtkPartLeft: "", mtkPartRight: "" },
      ],
      // Optionally reset other fields like species, kozak etc. if desired
      // species: prev.availableSpecies?.[0] || "",
      // kozak: "MTK",
    }));
    setActiveTabIndex(0); // Reset active tab to the first one
  }, [updateFields, setActiveTabIndex]); // Added setActiveTabIndex dependency

  return (
    <form
      id="primer-form"
      onSubmit={handleSubmit}
      className="p-5 bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-700/50"
    >
      {/* Loading Overlay - conditionally rendered */}
      {!initialized && (
        <div className="absolute inset-0 bg-gray-400/50 flex items-center justify-center z-50 rounded-lg">
          <p className="text-white text-lg font-semibold p-4 bg-black/70 rounded-sm">
            Loading required data...
          </p>
        </div>
      )}

      {/* Template Sequence Component */}
      <TemplateSequence
        value={formData.templateSequence || ""}
        onChange={(value) =>
          updateFields((prev) => ({ ...prev, templateSequence: value }))
        }
        // Pass down relevant errors if TemplateSequence needs to display them
        error={errors?.templateSequence}
      />

      {/* Sequence Tabs Component */}
      <SequenceTabs
        sequencesToDomesticate={formData.sequencesToDomesticate}
        updateSequence={updateSequence} // Pass the memoized updater
        addSequence={addSequence}
        removeSequence={removeSequence}
        activeTabIndex={activeTabIndex}
        onTabChange={setActiveTabIndex} // Pass setter for tab changes
        // Pass down relevant errors if SequenceTabs/SequenceTab need to display them
        errorsBySequence={errors?.sequencesToDomesticate || {}}
      />

      {/* Button Container */}
      <div className="mt-6 flex flex-col md:flex-row justify-between gap-4 px-5 pb-5">
        {/* Submit Button */}
        <button
          type="submit"
          className="px-4 py-2 rounded border font-medium text-white transition-colors w-full md:w-auto
                     bg-pink-600 border-pink-600 hover:bg-pink-700 hover:border-pink-700  /* Light Mode Primary */
                     dark:bg-pink-600 dark:border-pink-600 dark:hover:bg-pink-500 dark:hover:border-pink-500 /* Dark Mode Primary */
                     disabled:opacity-50 disabled:cursor-not-allowed" /* Disabled State */
          disabled={!isValid || !initialized || !formData || formData.sequencesToDomesticate.length === 0}
        >
          Generate Protocol
        </button>

        {/* Clear Button */}
        <button
          type="button"
          // Base button styles + warning colors
          className="px-4 py-2 rounded border font-medium text-gray-800 transition-colors w-full md:w-auto
                     bg-yellow-400 border-yellow-400 hover:bg-yellow-500 hover:border-yellow-500 /* Light Mode Warning */
                     dark:bg-yellow-400 dark:border-yellow-400 dark:hover:bg-yellow-300 dark:text-black" /* Dark Mode Warning */
          onClick={resetForm}
        >
          Clear Form
        </button>
      </div>
    </form>
  );
};

export default Form;
