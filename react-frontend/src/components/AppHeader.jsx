import React from "react";

function AppHeader({ darkMode, toggleDarkMode }) {
  return (
    // Modified gradient percentages here: from-25% and to-75%
    <header className="fixed top-0 left-0 z-100 box-border flex justify-between items-center w-full h-24 px-6 shadow-sm text-white bg-linear-to-r from-indigo-900 from-1% via-gray-950 via-25% to-blue-900 to-99%">
      <div className="flex items-center gap-3">
        <button
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg border transition-all duration-300 ease-in-out focus:outline-2 focus:outline-blue-600 focus:outline-offset-2 bg-black hover:bg-opacity-90 dark:bg-opacity-10 dark:bg-white dark:border-gray-600 dark:hover:bg-opacity-20 border-gray-300"
          onClick={toggleDarkMode}
          aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
        >
          <span className="text-lg">
            {darkMode ? "☀️" : "🌙"}
          </span>
          <span className="font-medium text-xs hidden sm:inline">
            {darkMode ? "Light Mode" : "Dark Mode"}
          </span>
        </button>
      </div>
      <div className="absolute left-1/2 transform -translate-x-1/2 flex justify-center items-center grow">
        <h1 className="flex items-center m-0 text-xl sm:text-2xl font-semibold whitespace-nowrap">
          MTK Advanced Primer Designer
        </h1>
      </div>
      <div className="flex items-center gap-3">
        {/* Settings toggle moved to Form component */}
      </div>
    </header>
  );
}

export default AppHeader;