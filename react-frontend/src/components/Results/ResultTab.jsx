// Results/ResultTab.jsx
import React, { useState, useEffect, useCallback, useRef } from "react";
import useSSE from "../../hooks/useSSE";
import ProtocolTracker from "../../components/Results/ProtocolTracker";

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
      "Mutation Analysis", // Now sends mutation_options
      "Primer Design", // Now sends recommended primers
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

    // Update the event processing logic to handle progress correctly
    rawSseEvents.forEach((event) => {
      let stepName = event.step || null;

      if (event.mutation_options) {
        stepName = "Mutation Analysis";
        sseData[stepName].mutation_options = event.mutation_options;
      }

      if (stepName) {
        const stepIndex = steps.findIndex((s) => s.name === stepName);
        if (stepIndex >= 0) {
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
          }

          if (event.message) {
            steps[stepIndex].message = event.message;
            messages.push({
              step: stepName,
              message: event.message,
              timestamp: event.timestamp || event.clientTimestamp,
            });
          }
        }
      }
    });

    // Update protocol data state
    setProtocolSteps(steps);
    setProtocolMessages(messages);
    setProtocolCallouts(callouts);
    setProtocolSseData(sseData);

    console.log(`[ResultTab:${sequenceIdx}] Protocol data processed:`, {
      steps: steps.length,
      messages: messages.length,
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
    </div>
  );
};

export default ResultTab;
