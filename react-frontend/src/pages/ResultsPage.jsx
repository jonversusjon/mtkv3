// ResultsPage.jsx
import React, { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import ResultTabs from "../components/Results/ResultTabs";

function ResultsPage({ results }) {
  const navigate = useNavigate();
  // Get the jobId from sessionStorage
  const jobId = useMemo(() => sessionStorage.getItem("jobId"), []); // Memoize jobId retrieval [cite: uploaded:src/pages/ResultsPage.jsx]

  // Build placeholder sequences from stored form data if no results prop is provided.
  const placeholders = useMemo(() => {
    // Only run if results prop is null/undefined
    if (results) return null;

    const savedFormData = sessionStorage.getItem("formData");
    if (savedFormData) {
      try {
        const parsed = JSON.parse(savedFormData);
        // Ensure sequencesToDomesticate exists and is an array
        if (Array.isArray(parsed?.sequencesToDomesticate)) {
          return parsed.sequencesToDomesticate.map((seq, i) => ({
            id: i, // Use index as sequenceIdx
            placeholder: true, // Mark as placeholder
            sequence: seq.sequence || "", // Default to empty string if missing
            primerName: seq.primerName?.trim() || `Sequence ${i + 1}`, // Use primerName or default
          }));
        }
      } catch (error) {
        console.error("Error parsing placeholders from sessionStorage:", error);
      }
    }
    return []; // Return empty array if no data or error
  }, [results]); // Dependency on 'results' prop

  // Determine the data source: passed results or generated placeholders
  const dataToDisplay = results || placeholders;

  // Redirect to form if there's no jobId or no data to display
  useEffect(() => {
    // Redirect if no jobId OR if dataToDisplay is empty/null
    if (!jobId || !dataToDisplay || dataToDisplay.length === 0) {
      console.log("No Job ID or data found — redirecting to form");
      navigate("/");
    }
  }, [dataToDisplay, jobId, navigate]); // Dependencies include jobId now

  // --- Main Render ---
  return (
    // Use Tailwind for container styling (padding, etc.)
    // Match padding/max-width with App.jsx container if needed, or keep specific styles for results
    <div className="pt-4 pb-16">
      {jobId && dataToDisplay?.length ? ( // Check for jobId and data before rendering tabs
        // Pass jobId to ResultTabs, which will pass it down to ResultTab [cite: uploaded:src/components/Results/ResultTabs.jsx]
        // ResultTabs internally loads sequences from sessionStorage based on formData
        <ResultTabs jobId={jobId} /> // Only need to pass jobId now
      ) : (
        // Loading or Redirecting message
        // Use Tailwind for styling
        <p className="text-center text-xl py-10 text-gray-600 dark:text-gray-400">Loading results...</p> // [cite: uploaded:src/pages/ResultsPage.jsx]
      )}
    </div>
  );
}

export default ResultsPage;