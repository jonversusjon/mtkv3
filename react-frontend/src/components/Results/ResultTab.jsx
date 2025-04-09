// Results/ResultTab.jsx
import React, { useState, useEffect, useCallback, useRef } from "react";
import useSSE from "../../hooks/useSSE";
import ProtocolTracker from "../../components/Results/ProtocolTracker";
import RawSseDisplay from "./RawSseDisplay"; // Import the Raw SSE Display component

const ResultTab = ({ jobId, sequenceIdx }) => {
  // --- State and Refs ---
  const [rawSseEvents, setRawSseEvents] = useState(() => {
    const savedEvents = sessionStorage.getItem(
      `sseEvents_${jobId}_${sequenceIdx}`
    );
    try {
      console.log(
        `[ResultTab:${sequenceIdx}] Initial load from sessionStorage: ${
          savedEvents ? savedEvents.length + " chars" : "null"
        }`
      );
      return savedEvents ? JSON.parse(savedEvents) : [];
    } catch (e) {
      console.error(
        `[ResultTab:${sequenceIdx}] Failed to parse saved SSE events:`,
        e
      );
      return [];
    }
  });

  // Protocol Tracker State
  const [protocolSteps, setProtocolSteps] = useState([]);
  const [protocolMessages, setProtocolMessages] = useState([]);
  const [protocolCallouts, setProtocolCallouts] = useState([]);
  const [protocolSseData, setProtocolSseData] = useState({});
  
  // State for raw SSE display toggle
  const [showRawSse, setShowRawSse] = useState(false);

  const processedEventIds = useRef(
    new Set(
      rawSseEvents.map(
        (event) =>
          `seq${sequenceIdx}-${JSON.stringify({
            ...event,
            _idTimestamp: event.clientTimestamp,
          })}`
      )
    )
  );
  const streamClosed = useRef(false);
  const hasReceivedData = useRef(rawSseEvents.length > 0);
  const isMounted = useRef(false);

  // --- Process SSE data into Protocol Tracker format ---
  useEffect(() => {
    console.log(
      `[ResultTab:${sequenceIdx}] Processing ${rawSseEvents.length} events for protocol data`
    );
    if (rawSseEvents.length > 0) {
      console.log("Sample event structure:", rawSseEvents[0]);
    }

    // Define expected protocol steps with their updated event types
    const expectedSteps = [
      "Preprocessing",
      "Restriction Sites",
      "Mutation Analysis", 
      "Primer Design", 
      "PCR Reaction Grouping",
    ];

    // Initialize steps with default values
    const steps = expectedSteps.map((name) => ({
      name,
      status: "waiting",
      stepProgress: 0,
      message: "",
      notificationCount: 0,
    }));

    const messages = [];
    const callouts = [];
    const sseData = {};

    // Initialize empty data structure for each step
    expectedSteps.forEach((step) => {
      sseData[step] = { timestamp: Date.now() };
    });

    // Debug helper to identify events by step
    const getStepFromEvent = (event) => {
      // First check explicit step property
      if (event.step) return event.step;
      
      // Check for step-specific data properties
      if (event.restrictionSites || (event.type === 'restriction_sites')) {
        return "Restriction Sites";
      }
      if (event.mutation_options || event.mutationOptions || (event.type === 'mutation_analysis')) {
        return "Mutation Analysis";
      }
      if (event.primers || event.edgePrimers || event.mutPrimers || (event.type === 'primer_design')) {
        return "Primer Design";
      }
      if (event.pcrReactions || event.reactionGroups || (event.type === 'pcr_grouping')) {
        return "PCR Reaction Grouping";
      }
      
      // Default to preprocessing if no other indicators
      return event.step || null;
    };

    // Process all events to extract data and update step status
    rawSseEvents.forEach((event) => {
      let stepName = getStepFromEvent(event);
      
      if (!stepName) return; // Skip events with no identifiable step
      
      // Update the step properties
      const stepIndex = steps.findIndex((s) => s.name === stepName);
      if (stepIndex >= 0) {
        // Mark as active by default if we're receiving data for it and it's not completed
        if (steps[stepIndex].status === "waiting") {
          steps[stepIndex].status = "active";
        }

        // Handle completion status
        if (event.message && event.message.includes("Complete")) {
          steps[stepIndex].status = "completed";
          steps[stepIndex].stepProgress = 100;
        } else {
          if (event.status) {
            steps[stepIndex].status = event.status;
          }
          if (event.stepProgress !== undefined) {
            steps[stepIndex].stepProgress = event.stepProgress;
          }
          // If we have data for this step but no progress info, set a minimum progress
          if (steps[stepIndex].stepProgress === 0) {
            steps[stepIndex].stepProgress = 10;
          }
        }

        // Add message if present
        if (event.message) {
          steps[stepIndex].message = event.message;
          messages.push({
            step: stepName,
            message: event.message,
            timestamp: event.timestamp || event.clientTimestamp,
          });
        }

        // Copy all relevant data from the event to the step's sseData
        Object.keys(event).forEach(key => {
          // Skip metadata properties
          if (!['step', 'message', 'status', 'stepProgress', 'timestamp', 'clientTimestamp', 'type'].includes(key)) {
            sseData[stepName][key] = event[key];
          }
        });
        
        // Set timestamp for step data
        sseData[stepName].timestamp = event.timestamp || event.clientTimestamp || Date.now();

        // Handle special case for mutation options
        if (event.mutation_options) {
          sseData[stepName].mutationOptions = event.mutation_options;
        }

        // Handle callouts
        if (event.callout) {
          callouts.push({
            step: stepName,
            message: event.callout,
            timestamp: event.timestamp || event.clientTimestamp || Date.now(),
          });
        }
      }
    });

    // Ensure at least one step is active or completed for display
    if (!steps.some(step => step.status === 'active' || step.status === 'completed')) {
      if (steps.length > 0) {
        steps[0].status = 'active';
        steps[0].stepProgress = 10;
      }
    }

    // Update protocol data state
    setProtocolSteps(steps);
    setProtocolMessages(messages);
    setProtocolCallouts(callouts);
    setProtocolSseData(sseData);

    console.log(`[ResultTab:${sequenceIdx}] Protocol data processed:`, {
      steps: steps.map(s => `${s.name}:${s.status}`),
      sseDataKeys: Object.keys(sseData),
    });
  }, [rawSseEvents, sequenceIdx]);

  // --- Callback for useSSE ---
  const processSseEvent = useCallback(
    (eventData) => {
      console.log(
        `[ResultTab:${sequenceIdx}] processSseEvent ENTERED. Data received:`,
        eventData
      );

      if (!eventData || typeof eventData !== "object") {
        console.warn(
          `[ResultTab:${sequenceIdx}] processSseEvent: EXITING - Invalid eventData type or null.`
        );
        return;
      }
      if (!hasReceivedData.current) {
        hasReceivedData.current = true;
        console.log(
          `[ResultTab:${sequenceIdx}] processSseEvent: Set hasReceivedData = true.`
        );
      }
      if (
        eventData.sequenceIdx !== undefined &&
        eventData.sequenceIdx !== sequenceIdx
      ) {
        console.warn(
          `[ResultTab:${sequenceIdx}] processSseEvent: Skipping event due to sequenceIdx mismatch. Event idx: ${eventData.sequenceIdx}`
        );
        return;
      }
      const eventIdSource = { ...eventData };
      const consistentTimestamp = eventData.timestamp || Date.now();
      eventIdSource._idTimestamp = consistentTimestamp;
      const eventId = `seq${sequenceIdx}-${JSON.stringify(eventIdSource)}`;
      if (processedEventIds.current.has(eventId)) {
        return;
      }
      processedEventIds.current.add(eventId);
      const eventToStore = {
        ...eventData,
        clientTimestamp: consistentTimestamp,
      };
      setRawSseEvents((prevEvents) => {
        if (!isMounted.current) {
          console.warn(
            `[ResultTab:${sequenceIdx}] processSseEvent: Attempted state update after unmount. Skipping.`
          );
          return prevEvents;
        }
        console.log(
          `[ResultTab:${sequenceIdx}] processSseEvent: Updating state with event timestamp: ${eventToStore.clientTimestamp}`
        );
        const updatedEvents = [...prevEvents, eventToStore];
        updatedEvents.sort(
          (a, b) => Number(a.clientTimestamp) - Number(b.clientTimestamp)
        );
        try {
          sessionStorage.setItem(
            `sseEvents_${jobId}_${sequenceIdx}`,
            JSON.stringify(updatedEvents)
          );
        } catch (e) {
          console.error(
            `[ResultTab:${sequenceIdx}] Failed to save SSE events to sessionStorage:`,
            e
          );
        }
        return updatedEvents;
      });
    },
    [sequenceIdx, jobId]
  );

  // --- Hook Usage ---
  useSSE(jobId, sequenceIdx, processSseEvent);

  // --- Mount/Unmount Effect ---
  useEffect(() => {
    isMounted.current = true;

    // Store the current sequence index in sessionStorage for components that need it
    sessionStorage.setItem("currentSequenceIdx", sequenceIdx);
    sessionStorage.setItem("jobId", jobId);

    console.log(
      `[ResultTab:${sequenceIdx}] Component Did Mount. Initial state length: ${rawSseEvents.length}`
    );
    return () => {
      isMounted.current = false;
      console.log(`[ResultTab:${sequenceIdx}] Component Will Unmount.`);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequenceIdx]);

  // --- Rendering ---
  return (
    <div className="sequence-results">
      {/* Status Messages */}
      {rawSseEvents.length === 0 &&
        !streamClosed.current &&
        !hasReceivedData.current && (
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            Connecting to event stream...
          </p>
        )}

      {/* Protocol Tracker Component */}
      {protocolSteps.length > 0 && (
        <div className="border rounded-lg border-gray-200 dark:border-gray-700">
          <ProtocolTracker
            steps={protocolSteps}
            messages={protocolMessages}
            callouts={protocolCallouts}
            sseData={protocolSseData}
          />
        </div>
      )}

      {/* Toggle for Raw SSE Display */}
      {rawSseEvents.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setShowRawSse(!showRawSse)}
            className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium flex items-center"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-5 w-5 mr-1 transition-transform ${
                showRawSse ? "rotate-90" : ""
              }`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                clipRule="evenodd"
              />
            </svg>
            {showRawSse ? "Hide Raw SSE Events" : "Show Raw SSE Events"}
          </button>
          
          {/* Raw SSE Display Component */}
          {showRawSse && (
            <div className="mt-4 p-4 border rounded-lg border-gray-200 dark:border-gray-700">
              <RawSseDisplay sseEvents={rawSseEvents} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ResultTab;