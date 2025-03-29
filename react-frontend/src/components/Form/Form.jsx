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
    const finalFormData =
      (!formData.species || formData.species.trim() === "") &&
      formData.availableSpecies?.length > 0
        ? { ...formData, species: formData.availableSpecies[0] }
        : formData;

    if (isValid && initialized) {
      onSubmit(e, finalFormData);
    } else {
      console.warn(
        "Form submission prevented. Is valid:",
        isValid,
        "Is initialized:",
        initialized
      );
    }
  };

  // Callback to update a specific sequence's field
  const updateSequence = useCallback(
    (index) => (field, value) => {
      updateFields((prev) => {
        const updatedSequences = prev.sequencesToDomesticate.map((seq, i) =>
          i === index ? { ...seq, [field]: value } : seq
        );
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
      if (prev.sequencesToDomesticate.length >= 10) return prev;
      return {
        ...prev,
        sequencesToDomesticate: [
          ...prev.sequencesToDomesticate,
          { sequence: "", primerName: "", mtkPartLeft: "", mtkPartRight: "" },
        ],
      };
    });
  }, [updateFields]);

  // Callback to remove the last sequence
  const removeSequence = useCallback(() => {
    updateFields((prev) => {
      if (prev.sequencesToDomesticate.length <= 1) return prev;
      const newSequences = prev.sequencesToDomesticate.slice(0, -1);
      if (activeTabIndex >= newSequences.length) {
        setActiveTabIndex(newSequences.length - 1);
      }
      return {
        ...prev,
        sequencesToDomesticate: newSequences,
      };
    });
  }, [updateFields, activeTabIndex, setActiveTabIndex]);

  // Callback to reset parts of the form
  const resetForm = useCallback(() => {
    updateFields((prev) => ({
      ...prev,
      templateSequence: "",
      sequencesToDomesticate: [
        { sequence: "", primerName: "", mtkPartLeft: "", mtkPartRight: "" },
      ],
    }));
    setActiveTabIndex(0);
  }, [updateFields, setActiveTabIndex]);

  return (
    <form
      id="primer-form"
      onSubmit={handleSubmit}
      className="p-5 bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-700/50"
    >
      {!initialized && (
        <div className="absolute inset-0 bg-gray-400/50 flex items-center justify-center z-50 rounded-lg">
          <p className="text-white text-lg font-semibold p-4 bg-black/70 rounded-sm">
            Loading required data...
          </p>
        </div>
      )}

      <TemplateSequence
        value={formData.templateSequence || ""}
        onChange={(value) =>
          updateFields((prev) => ({ ...prev, templateSequence: value }))
        }
        error={errors?.templateSequence}
      />

      <SequenceTabs
        sequencesToDomesticate={formData.sequencesToDomesticate}
        updateSequence={updateSequence}
        addSequence={addSequence}
        removeSequence={removeSequence}
        activeTabIndex={activeTabIndex}
        onTabChange={setActiveTabIndex}
        errorsBySequence={errors || {}}
      />

      <div className="mt-6 flex flex-col md:flex-row justify-between gap-4 px-5 pb-5">
        <button
          type="submit"
          className="px-4 py-2 rounded border font-medium text-white transition-colors w-full md:w-auto
                     bg-pink-600 border-pink-600 hover:bg-pink-700 hover:border-pink-700
                     dark:bg-pink-600 dark:border-pink-600 dark:hover:bg-pink-500 dark:hover:border-pink-500
                     disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={
            !isValid ||
            !initialized ||
            !formData ||
            formData.sequencesToDomesticate.length === 0
          }
        >
          Generate Protocol
        </button>

        <button
          type="button"
          className="px-4 py-2 rounded border font-medium text-gray-800 transition-colors w-full md:w-auto
                     bg-yellow-400 border-yellow-400 hover:bg-yellow-500 hover:border-yellow-500
                     dark:bg-yellow-400 dark:border-yellow-400 dark:hover:bg-yellow-300 dark:text-black"
          onClick={resetForm}
        >
          Clear Form
        </button>
      </div>
    </form>
  );
};

export default Form;
