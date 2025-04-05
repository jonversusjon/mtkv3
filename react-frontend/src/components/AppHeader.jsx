function AppHeader({ darkMode }) {
  return (
    <header className="fixed top-0 left-0 z-600 box-border flex justify-between items-center w-full h-24 px-6 shadow-sm text-white bg-gradient-to-r from-indigo-900 from-10% via-gray-950 via-50% to-blue-900 to-90%">
      <div className="flex items-center gap-3">
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 
          border-2 border-transparent dark:border-gray-700
          text-gray-900 dark:text-white
          bg-white hover:bg-gray-100
          dark:bg-gray-800 dark:hover:bg-gray-700
          shadow-md hover:shadow-lg"
          aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          type="button"
        >
          <span className="text-lg">{darkMode ? "☀️" : "🌙"}</span>
          <span className="font-medium text-sm hidden sm:inline">
            {darkMode ? "Light Mode" : "Dark Mode"}
          </span>
        </button>
      </div>
      <div className="absolute left-1/2 transform -translate-x-1/2 flex justify-center items-center">
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
