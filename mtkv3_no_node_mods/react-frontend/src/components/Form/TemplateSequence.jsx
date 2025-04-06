import React, { useState, useEffect } from "react";
import { validateDnaSequence } from "../../utils/dnaUtils";
import SequenceInput from "../Form/SequenceInput";

function TemplateSequence({ value, onChange }) {
  const [validationMessage, setValidationMessage] = useState("");
  const [charCount, setCharCount] = useState(0);

  useEffect(() => {
    const safeValue = value || "";
    setCharCount(safeValue.length);

    // Validate template sequence (optional field)
    if (value) {
      const validationResult = validateDnaSequence(value, false, false);
      if (!validationResult.isValid) {
        setValidationMessage(validationResult.message);
      } else {
        setValidationMessage("");
      }
    } else {
      setValidationMessage("");
    }
  }, [value]);

  const handleChange = (e) => {
    const newValue = e.target.value;
    onChange(newValue);
  };
  return (
    <div className="p-4 border-b border-gray-300">
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center gap-2.5">
          <h3 className="text-xl text-gray-800 m-0 dark:text-white">Template Sequence</h3>
          <span className="text-base text-gray-500 italic dark:text-gray-400">(optional)</span>
        </div>
  
        <div className="text-sm text-gray-600 dark:text-gray-400">Length: {charCount} bp</div>
      </div>
  
      <div>
        <SequenceInput
          id="templateSequence"
          value={value}
          onChange={handleChange}
          placeholder="Paste your template DNA sequence here (optional)"
        />
      </div>
      {validationMessage && (
        <div className="text-red-500 mt-2">{validationMessage}</div>
      )}
    </div>
  );
}

export default TemplateSequence;
