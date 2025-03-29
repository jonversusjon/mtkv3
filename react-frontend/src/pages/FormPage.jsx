import { API_BASE_URL } from "../config/config.js";
import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import Form from "../components/Form/Form";
import Sidebar from "../components/Form/Sidebar";
import { submitProtocol } from "../api/api";
import useValidateForm from "../hooks/useValidateForm";
import { useFormUpdater } from "../hooks/useFormUpdater";

const defaultSequence = {
  sequence: "",
  primerName: "",
  mtkPartLeft: "",
  mtkPartRight: "",
};

function FormPage({ showSettings, setShowSettings, setResults }) {
  const [formData, setFormData] = useState({
    sequencesToDomesticate: [defaultSequence],
    availableSpecies: [],
    species: "",
    kozak: "MTK",
    maxMutationsPerSite: 1,
    verboseMode: false,
    maxResults: "one",
  });

  const [prefillLoaded, setPrefillLoaded] = useState(false);
  const [speciesLoaded, setSpeciesLoaded] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const settingsToggleRef = useRef(null);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const navigate = useNavigate();
  const { updateSettings, updateFormInput } = useFormUpdater(setFormData);

  // --- Data Loading Effects ---
  // Load persisted → dummy → default
  useEffect(() => {
    const initializeFormData = async () => {
      try {
        const saved = sessionStorage.getItem("formData");
        if (saved) {
          setFormData(JSON.parse(saved));
        } else {
          // Fetch dummy and species data
          const [dummyResp, speciesResp] = await Promise.all([
            fetch(`${API_BASE_URL}/dummy`),
            fetch(`${API_BASE_URL}/species`),
          ]);
          const dummy = dummyResp.ok ? await dummyResp.json() : {};
          const { species: speciesList = [] } = await speciesResp.json();

          setFormData((prev) => ({
            ...prev, // Keep existing defaults if any
            ...dummy, // Apply dummy data
            sequencesToDomesticate: dummy.sequencesToDomesticate || [
              defaultSequence,
            ], // Ensure sequences are present
            availableSpecies: speciesList,
            species: dummy.species || speciesList[0] || "", // Set default species
            kozak: dummy.kozak || "MTK", // Set default kozak
          }));
        }
      } catch (err) {
        console.error("Error loading initial form data", err);
        setError("Could not load initial form data."); // Set user-facing error
      } finally {
        setPrefillLoaded(true);
        setSpeciesLoaded(true);
      }
    };
    initializeFormData();
  }, []);

  // --- Validation ---
  // Validate form data using custom hook
  const { errors, isValid } = useValidateForm(
    formData,
    prefillLoaded && speciesLoaded
  );

  // --- Event Handlers ---
  const handleFormSubmit = async (e) => {
    e.preventDefault();

    if (!isValid) {
      setError("Please fix the errors in the form before submitting.");
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      sessionStorage.setItem("formData", JSON.stringify(formData));
      // Submit protocol using API helper function
      const { jobId } = await submitProtocol(formData);
      sessionStorage.setItem("jobId", jobId);

      // Create placeholder results for immediate navigation
      const placeholders = formData.sequencesToDomesticate.map((seq, idx) => ({
        id: idx,
        placeholder: true,
        sequence: seq.sequence,
        primerName: seq.primerName || `Sequence ${idx + 1}`,
      }));
      sessionStorage.setItem("results", JSON.stringify(placeholders));
      setResults(placeholders);
      navigate("/results");
    } catch (err) {
      console.error("Submit error:", err);
      setError(err.message || "Failed to start protocol generation");
    } finally {
      setProcessing(false);
    }
  };

  // --- Conditional Rendering ---
  // Show loading state until data is ready
  if (!prefillLoaded || !speciesLoaded) {
    // [cite: uploaded:src/pages/FormPage.jsx]
    return (
      <div className="text-center text-xl py-10 text-gray-600 dark:text-gray-400">
        Loading form…
      </div>
    );
  }

  // --- Main Render ---
  return (
    // Use Tailwind for overall page container and spacing
    <div className="pt-4 pb-16">
      {" "}
      {/* Added padding top/bottom */}
      {/* Use Tailwind for centering and text styling */}
      <header className="text-center mb-6">
        <h2 className="text-2xl font-semibold text-gray-800 dark:text-gray-100">
          Primer Design Form
        </h2>{" "}
        {/* [cite: uploaded:src/pages/FormPage.jsx] */}
      </header>
      {/* Use Tailwind Flexbox for layout (Sidebar + Form) */}
      {/* Adjusted responsive layout: Stack on small screens, side-by-side on larger */}
      <div className="flex flex-col md:flex-row gap-6">
        {/* Sidebar Component */}
        <Sidebar
          sequences={formData.sequencesToDomesticate}
          errorsBySequence={errors.sequencesToDomesticate || {}}
          onSelectTab={setActiveTabIndex}
          activeTabIndex={activeTabIndex}
          showSettings={showSettings}
          setShowSettings={setShowSettings}
          settingsToggleRef={settingsToggleRef}
          updateSettings={updateSettings}
          formData={formData}
        />
        {/* Main Form Area */}
        <main className="flex-1">
          {/* Error Alert Box */}
          {error && (
            <div
              className="mb-4 p-4 border-l-4 border-red-500 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 dark:border-red-600 rounded-sm"
              role="alert"
            >
              {error}
            </div>
          )}
          {/* Processing Indicator */}
          {processing && (
            <div className="mb-4 p-4 border-l-4 border-blue-500 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-600 rounded-sm">
              Processing your request... Please wait.
            </div>
          )}
          {/* Form Component */}
          <Form
            onSubmit={handleFormSubmit}
            formData={formData}
            updateFields={updateFormInput}
            errors={errors}
            isValid={isValid}
            initialized={prefillLoaded && speciesLoaded}
            activeTabIndex={activeTabIndex}
            setActiveTabIndex={setActiveTabIndex}
          />
        </main>
      </div>
    </div>
  );
}

export default FormPage;
