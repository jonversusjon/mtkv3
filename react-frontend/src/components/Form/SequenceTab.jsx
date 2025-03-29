import React, { useState, useEffect, useRef } from "react";
import SequenceInput from "../Form/SequenceInput";
import { validateDnaSequence } from "../../utils/dnaUtils";

function SequenceTab({ sequence, index, updateSequence, mtkPartOptions }) {
  const [validation, setValidation] = useState({
    message: "",
    isAdvisory: false,
  });
  // Instead of a state for charCount, compute it directly:
  const charCount = sequence.sequence ? sequence.sequence.length : 0;
  const [useSeparateParts, setUseSeparateParts] = useState(false);

  const hasInitialized = useRef(false);
  useEffect(() => {
    if (!hasInitialized.current && mtkPartOptions.length > 0) {
      // Only update if the current values are empty
      if (!sequence.mtkPartLeft || sequence.mtkPartLeft.trim() === "") {
        updateSequence("mtkPartLeft", mtkPartOptions[0]);
      }
      if (!sequence.mtkPartRight || sequence.mtkPartRight.trim() === "") {
        updateSequence("mtkPartRight", mtkPartOptions[0]);
      }
      hasInitialized.current = true;
    }
  }, [
    mtkPartOptions,
    updateSequence,
    sequence.mtkPartLeft,
    sequence.mtkPartRight,
  ]);

  useEffect(() => {
    const safeValue = sequence.sequence || "";

    if (safeValue) {
      const validationResult = validateDnaSequence(safeValue, true);
      if (validationResult.isValid) {
        setValidation({ message: "", isAdvisory: false });
      } else {
        setValidation({
          message: validationResult.message,
          isAdvisory: validationResult.isAdvisory,
        });
      }
    } else {
      setValidation({ message: "", isAdvisory: false });
    }
  }, [sequence.sequence, index]);

  const handleSequenceChange = (e) => {
    updateSequence("sequence", e.target.value);
  };

  const handlePrimerNameChange = (e) => {
    updateSequence("primerName", e.target.value);
  };

  const handleMtkPartChange = (partType) => (e) => {
    const newValue = e.target.value;
    if (useSeparateParts) {
      updateSequence(partType, newValue);
    } else {
      updateSequence("mtkPartLeft", newValue);
      updateSequence("mtkPartRight", newValue);
    }
  };

  const handleToggleChange = (e) => {
    setUseSeparateParts(e.target.checked);
  };

  return (
    <div className="p-6 space-y-4 bg-white dark:bg-gray-900 rounded-lg transition-colors duration-200">
      <div className="flex flex-col gap-2">
        <label 
          htmlFor={`primer-name-${index}`} 
          className="text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Primer Name:
        </label>
        <input
          type="text"
          id={`primer-name-${index}`}
          value={sequence.primerName}
          onChange={handlePrimerNameChange}
          className="w-full p-2 border border-gray-300 rounded-md bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:focus:ring-indigo-400 dark:focus:border-indigo-400"
          placeholder="Enter primer name"
        />
      </div>

      <div className="flex justify-between items-center">
        <label 
          htmlFor={`sequence-${index}`}
          className="text-sm font-medium text-gray-700"
        >
          Sequence {index + 1}:
        </label>
        {charCount > 0 && (
          <div           className="text-sm text-gray-500 dark:text-gray-400">Length: {charCount} bp</div>
        )}
      </div>
      
      <div className="space-y-2">
        <SequenceInput
          id={`sequence-${index}`}
          value={sequence.sequence}
          onChange={handleSequenceChange}
          placeholder="Paste your DNA sequence here"
          className="w-full p-2 border border-gray-300 rounded-md min-h-32 resize-y bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:focus:ring-indigo-400 dark:focus:border-indigo-400"
        />
        {validation.message && (
          <div
            className={`text-sm p-2 rounded ${
              validation.isAdvisory 
                ? "bg-yellow-100 text-yellow-700 border border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800" 
                : "bg-red-100 text-red-700 border border-red-300 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800"
            }`}
          >
            {validation.message}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="flex-1 min-w-[150px]">
          <label 
            htmlFor={`mtk-part-left-${index}`} 
            className="block mb-2 text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            {useSeparateParts ? "MTK Part Number Left:" : "MTK Part Number:"}
          </label>
          <select
            id={`mtk-part-left-${index}`}
            value={sequence.mtkPartLeft || ""}
            onChange={handleMtkPartChange("mtkPartLeft")}
            className="w-full p-2 bg-white border border-gray-300 rounded-md dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:focus:ring-indigo-400 dark:focus:border-indigo-400"
          >
            {mtkPartOptions.map((part) => (
              <option key={part} value={part}>
                {part}
              </option>
            ))}
          </select>
        </div>
        
        {useSeparateParts && (
          <div className="flex-1 min-w-[150px]">
            <label
              htmlFor={`mtk-part-right-${index}`}
              className="block mb-2 text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              MTK Part Number Right:
            </label>
            <select
              id={`mtk-part-right-${index}`}
              value={sequence.mtkPartRight || ""}
              onChange={handleMtkPartChange("mtkPartRight")}
              className="w-full p-2 bg-white border border-gray-300 rounded-md dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:focus:ring-indigo-400 dark:focus:border-indigo-400"
            >
              {mtkPartOptions.map((part) => (
                <option key={part} value={part}>
                  {part}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex items-center">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={useSeparateParts}
            onChange={handleToggleChange}
            className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:checked:bg-indigo-500 dark:focus:ring-indigo-400"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">Use separate left/right part numbers</span>
        </label>
      </div>
    </div>
  );
}

export default SequenceTab;