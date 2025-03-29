// src/App.jsx
import React, { useState } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import AppHeader from "./components/AppHeader";
import Banner from "./components/Banner";
import FormPage from "./pages/FormPage";
import ResultsPage from "./pages/ResultsPage";
import { useDarkMode } from "./hooks/useDarkMode";

function App() {
  const [darkMode, toggleDarkMode] = useDarkMode();
  const [showSettings, setShowSettings] = useState(false);
  const [results, setResults] = useState(null);

  return (
    <div>
      <Router>
        <div className="flex flex-col min-h-screen bg-white text-gray-900 dark:bg-gray-900 dark:text-white transition-colors duration-200">
          <AppHeader darkMode={darkMode} toggleDarkMode={toggleDarkMode} />
          <Banner />
          <div className="flex-1 w-full max-w-screen-lg mx-auto px-4 sm:px-6 lg:px-8">
            <Routes>
              <Route
                path="/"
                element={
                  <FormPage
                    showSettings={showSettings}
                    setShowSettings={setShowSettings}
                    setResults={(newResults) => {
                      console.log("Setting new results:", newResults);
                      setResults(newResults);
                    }}
                  />
                }
              />
              <Route
                path="/results"
                element={<ResultsPage results={results} />}
              />
            </Routes>
          </div>
          {/* Optional: Footer */}
        </div>
      </Router>
    </div>
  );
}

export default App;