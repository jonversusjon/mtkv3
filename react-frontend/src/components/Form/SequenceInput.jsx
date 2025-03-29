import React from 'react';

function SequenceInput({ id, value, onChange, placeholder }) {
  return (
    <div className="w-full"> 
      <textarea
        id={id}
        className="
          w-full min-h-[120px] p-2
          border border-gray-300 rounded-md
          font-mono text-xs
          resize-y
          text-gray-700 bg-white
          placeholder:text-gray-400
          transition-colors duration-200 ease-in-out
          focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30
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
        rows={4}
        spellCheck="false"
      />
    </div>
  );
}

export default SequenceInput;
