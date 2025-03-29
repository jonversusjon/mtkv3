import React from 'react';

// Remove the CSS import:
// import '../../styles/SequenceInput.css';

function SequenceInput({ id, value, onChange, placeholder }) {
  // Combine styles from .sequence-input-wrapper and apply directly if needed,
  // or simplify if the wrapper only provides width. Here, assuming wrapper's w-full is sufficient.
  return (
    <div className="w-full"> {/* Equivalent to sequence-input-wrapper */}
      <textarea
        id={id}
        // Translate styles from .sequence-textarea, .form-control.sequence-textarea,
        // :focus, .dark-mode variants from SequenceInput.css [cite: uploaded:src/styles/SequenceInput.css]
        className="
          w-full min-h-[100px] p-2
          border border-gray-300 rounded
          font-mono text-xs
          resize-y
          text-gray-700 bg-white
          placeholder:text-gray-400
          transition-colors duration-200 ease-in-out
          focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30
          dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300
          dark:placeholder:text-gray-500
          dark:focus:border-blue-400 dark:focus:ring-blue-400/40
          scrollbar-thin
          scrollbar-thumb-gray-400
          scrollbar-track-gray-100
          dark:scrollbar-thumb-gray-500
          dark:scrollbar-track-gray-800
          hover:scrollbar-thumb-gray-500
          dark:hover:scrollbar-thumb-gray-400
          scrollbar-thumb-rounded 
        "
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        rows={4} // You can keep rows or rely solely on min-height
        spellCheck="false"
      />
    </div>
  );
}

export default SequenceInput;