// ProtocolTracker.jsx
import React, { useState, useEffect } from "react";
import RestrictionSiteSummary from "./RestrictionSiteSummary";
import MutationExplorer from "./MutationExplorer";
import PrimerExplorer from "./PrimerExplorer";
import PcrReactionGrouping from "./PcrReactionGrouping";

// UI Helper Components
const ProgressStep = ({ name, stepProgress, message }) => {
  // If progress is 100%, don't render anything
  if (stepProgress === 100) {
    return null;
  }

  return (
    <div className="border rounded-lg p-4 mb-4 shadow-xs bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
      <div className="flex justify-between items-center mb-2">
        <span className="font-semibold text-gray-800 dark:text-gray-100">
          {name}
        </span>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {stepProgress}%
        </span>
      </div>
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mb-2">
        <div
          className="bg-blue-500 dark:bg-blue-400 h-2 rounded-full transition-all duration-300"
          style={{ width: `${stepProgress}%` }}
        ></div>
      </div>
      {message && (
        <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
          {message}
        </p>
      )}
    </div>
  );
};

// Tab Button Component - This renders the actual tab buttons with spinner, notification bubble, and checkmark
const TabButton = ({
  name,
  isActive,
  onClick,
  notificationCount,
  notificationType = "error", // Default to error if not specified
  status,
  stepProgress,
}) => (
  <button
    className={`protocol-tab-button p-4 flex items-center gap-2 
      ${
        isActive
          ? "active border-b-2 border-blue-500 font-bold"
          : "border-b border-transparent"
      } 
      hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-150`}
    onClick={onClick}
  >
    {notificationCount > 0 ? (
      notificationType === "info" ? (
        // Info: Grey number with no background shape
        <span className="text-md font-semibold text-gray-500 dark:text-gray-100">
          {notificationCount}
        </span>
      ) : notificationType === "warning" || notificationType === "warn" ? (
        // Warning: Yellow triangle with number
        <div className="relative h-5 w-5 flex items-center justify-center">
          <svg
            className="absolute text-yellow-500"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            width="20"
            height="20"
          >
            <path
              fillRule="evenodd"
              d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z"
              clipRule="evenodd"
            />
          </svg>
          <span className="relative text-xs font-semibold text-gray-900 z-10">
            {notificationCount}
          </span>
        </div>
      ) : (
        // Error: Red circle (original style)
        <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-semibold rounded-full bg-red-500 text-white">
          {notificationCount}
        </span>
      )
    ) : stepProgress > 0 && stepProgress < 100 ? (
      <div className="animate-spin h-4 w-4">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          ></circle>
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
      </div>
    ) : status === "completed" || stepProgress === 100 ? (
      <div className="text-green-500 flex items-center justify-center w-5 h-5">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
      </div>
    ) : (
      <div className="checkmark-placeholder w-5 h-5"></div>
    )}
    <span className="tab-label">{name}</span>
  </button>
);

const DisplayMessage = ({ message, timestamp }) => (
  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-3 mb-4">
    <div className="flex items-start">
      <div className="shrink-0 pt-0.5">
        <svg
          className="h-5 w-5 text-blue-500 dark:text-blue-400"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2h-1V9z"
            clipRule="evenodd"
          />
        </svg>
      </div>
      <div className="ml-3">
        <div>
          <p className="text-sm text-blue-700 dark:text-blue-300">{message}</p>
          {timestamp && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {new Date(timestamp).toLocaleTimeString()}
            </p>
          )}
        </div>
      </div>
    </div>
  </div>
);

// Tab Content Component
const TabContent = ({ stepName, messages, activeStep, sseData, callouts }) => {
  // Filter messages relevant to this step
  const stepMessages = Array.isArray(messages)
    ? messages.filter((m) => m.step === stepName).map((m) => m.message)
    : [];

  const [isMessagesOpen, setIsMessagesOpen] = useState(false);
  const [isPayloadVisible, setIsPayloadVisible] = useState(false);
  const [selectedMutationSetIndex] = useState(0);
  const [copyText, setCopyText] = useState("Copy");

  // Get the SSE data for the current step
  const stepSseData = sseData?.[stepName];

  const handleCopy = () => {
    if (stepSseData) {
      navigator.clipboard.writeText(JSON.stringify(stepSseData, null, 2));
      setCopyText("Copied!");
      setTimeout(() => setCopyText("Copy"), 2000);
    }
  };

  const renderStepDetailContent = () => {
    if (!stepSseData) {
      console.debug(`No SSE data found for step: ${stepName}`);
      return (
        <div className="p-4 text-gray-600 dark:text-gray-400 text-center">
          Waiting for data...
        </div>
      );
    }

    // Render content based on the step
    switch (stepName) {
      case "Preprocessing":
        if (stepSseData.callout) {
          return <div></div>;
        }
        break;

      case "Restriction Sites":
        if (
          stepSseData.restrictionSites &&
          stepSseData.restrictionSites.length > 0
        ) {
          return (
            <RestrictionSiteSummary
              restrictionSites={stepSseData.restrictionSites}
            />
          );
        } else {
          // Show "No restriction sites found" message when SSE data exists but no restriction sites
          return (
            <div className="p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md">
              <p className="text-gray-600 dark:text-gray-300 text-center">
                No restriction sites found.
              </p>
            </div>
          );
        }

      case "Mutation Analysis":
        return (
          <MutationExplorer
            stepSseData={stepSseData}
            selectedMutationSetIndex={selectedMutationSetIndex || 0}
          />
        );
      case "Primer Design":
        if (stepSseData.primers) {
          return <PrimerExplorer stepSseData={stepSseData} />;
        } else if (
          (stepSseData.edgePrimers &&
            Object.keys(stepSseData.edgePrimers).length > 0) ||
          (stepSseData.mutPrimers &&
            Object.keys(stepSseData.mutPrimers).length > 0)
        ) {
          return (
            <div className="mt-2">
              <h3 className="font-semibold text-gray-700 dark:text-gray-200 mb-2">
                Designed Primers:
              </h3>
              {stepSseData.edgePrimers &&
                Object.keys(stepSseData.edgePrimers).length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">
                      Edge Primers:
                    </h4>
                    <div className="border dark:border-gray-700 rounded-sm overflow-hidden">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50 dark:bg-gray-700">
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                              Name
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                              Sequence
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                          {Object.entries(stepSseData.edgePrimers).map(
                            ([name, primer], idx) => (
                              <tr key={idx}>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                  {name}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-500 dark:text-gray-300">
                                  {primer.sequence || primer}
                                </td>
                              </tr>
                            )
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              {stepSseData.mutPrimers &&
                Object.keys(stepSseData.mutPrimers).length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">
                      Mutation Primers:
                    </h4>
                    <div className="border dark:border-gray-700 rounded-sm overflow-hidden">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50 dark:bg-gray-700">
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                              Name
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                              Sequence
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                          {Object.entries(stepSseData.mutPrimers).map(
                            ([name, primer], idx) => (
                              <tr key={idx}>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                  {name}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-500 dark:text-gray-300">
                                  {primer.sequence || primer}
                                </td>
                              </tr>
                            )
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
            </div>
          );
        }
        break;

      case "PCR Reaction Grouping":
        if (stepSseData.pcrReactions && stepSseData.pcrReactions.length > 0) {
          return <PcrReactionGrouping stepSseData={stepSseData} />;
        }
        break;

      default:
        return (
          <div className="p-4 text-gray-600 dark:text-gray-400 text-center">
            Waiting for data...
          </div>
        );
    }

    return (
      <div className="p-4 text-gray-600 dark:text-gray-400 text-center">
        Processing data...
      </div>
    );
  };

  return (
    <div className="protocol-tab-content">
      {/* Show progress for the active step */}
      {activeStep && activeStep.name === stepName && (
        <ProgressStep
          name={activeStep.name}
          stepProgress={activeStep.stepProgress}
          message={activeStep.message}
        />
      )}

      <div className="p-4">
        {/* Display callouts if any */}
        {callouts && callouts.length > 0 && (
          <div className="space-y-2">
            {callouts
              .slice()
              .reverse()
              .map((callout, idx) => (
                <DisplayMessage
                  key={idx}
                  message={callout.message}
                  timestamp={callout.timestamp}
                />
              ))}
          </div>
        )}

        {/* Main content for this step */}
        {renderStepDetailContent()}

        {/* Raw SSE payload toggle */}
        {stepSseData && Object.keys(stepSseData).length > 0 && (
          <div className="border-t border-gray-200 mt-4 pt-4">
            <button
              className="text-blue-500 hover:text-blue-700 text-xs cursor-pointer subtle-link mb-2 dark:text-gray-400 dark:hover:text-gray-300"
              onClick={() => setIsPayloadVisible(!isPayloadVisible)}
              style={{
                textDecoration: "none",
                fontStyle: "italic",
                border: "none",
                background: "none",
              }}
            >
              {isPayloadVisible
                ? "Hide Raw SSE Payload"
                : "Show Raw SSE Payload"}
            </button>
            {isPayloadVisible && (
              <>
                <pre className="bg-gray-100 dark:bg-gray-800 p-2 rounded-sm text-xs overflow-x-auto dark:text-gray-300">
                  {JSON.stringify(stepSseData, null, 2)}
                </pre>
                <button
                  className="text-blue-500 hover:text-blue-700 text-xs cursor-pointer subtle-link mt-2 dark:text-gray-400 dark:hover:text-gray-300"
                  onClick={handleCopy}
                  style={{
                    textDecoration: "none",
                    fontStyle: "italic",
                    border: "none",
                    background: "none",
                  }}
                >
                  {copyText}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Toggle display of all step-specific messages */}
      {stepMessages.length > 0 && (
        <div className="border-t border-gray-200 p-4">
          {!isMessagesOpen && (
            <button
              className="text-blue-500 hover:text-blue-700 text-xs cursor-pointer subtle-link"
              onClick={() => setIsMessagesOpen(true)}
              style={{
                textDecoration: "none",
                fontStyle: "italic",
                border: "none",
                background: "none",
              }}
            >
              see all messages
            </button>
          )}
          {isMessagesOpen && (
            <>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {stepMessages.map((msg, index) => (
                  <div
                    key={index}
                    className="text-gray-600 dark:text-gray-400 text-xs"
                  >
                    {msg.replace(`${stepName}: `, "")}
                  </div>
                ))}
              </div>
              <button
                className="text-blue-500 hover:text-blue-700 text-xs cursor-pointer mt-2 dark:text-gray-400 dark:hover:text-gray-300"
                onClick={() => setIsMessagesOpen(false)}
                style={{
                  textDecoration: "none",
                  fontStyle: "italic",
                  border: "none",
                  background: "none",
                }}
              >
                hide messages
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// Main ProtocolTracker Component
// eslint-disable-next-line no-unused-vars
const ProtocolTracker = ({ steps, messages, callouts, sseData }) => {
  // Filter steps by status
  const completedSteps = steps.filter((step) => step.status === "completed");
  const activeSteps = steps.filter((step) => step.status === "active");

  // Flag for manual tab selection
  const [userSelectedTab, setUserSelectedTab] = useState(false);

  // Accumulated callouts per step
  const [stepCallouts, setStepCallouts] = useState({});

  // Determine the initial active tab
  const [activeTab, setActiveTab] = useState(() => {
    if (activeSteps.length > 0) return activeSteps[0].name;
    if (completedSteps.length > 0)
      return completedSteps[completedSteps.length - 1].name;
    return steps.length > 0 ? steps[0].name : null;
  });

  // Accumulate callouts from SSE data
  useEffect(() => {
    if (!sseData) return;

    Object.entries(sseData)
      // eslint-disable-next-line no-unused-vars
      .filter(([_, data]) => data?.callout)
      .forEach(([stepName, stepData]) => {
        setStepCallouts((prev) => {
          const existingCallouts = prev[stepName] || [];
          if (existingCallouts.some((c) => c.message === stepData.callout))
            return prev;
          return {
            ...prev,
            [stepName]: [
              ...existingCallouts,
              {
                message: stepData.callout,
                timestamp: stepData.timestamp || Date.now(),
              },
            ],
          };
        });
      });
  }, [sseData]);

  const handleTabSelect = (tabName) => {
    setActiveTab(tabName);
    setUserSelectedTab(true);
  };

  // Auto-switch tab if a new active step is detected and the user hasn't manually selected a tab
  useEffect(() => {
    if (activeSteps.length > 0 && !userSelectedTab) {
      const mostRecentActiveStep = activeSteps[activeSteps.length - 1].name;
      setActiveTab(mostRecentActiveStep);
    }
  }, [activeSteps, userSelectedTab]);

  // Auto-switch based on callouts if the user hasn't manually selected a tab
  useEffect(() => {
    if (userSelectedTab || !sseData) return;

    const stepsWithCallouts = Object.entries(sseData)
      // eslint-disable-next-line no-unused-vars
      .filter(([_, data]) => data?.callout)
      .map(([stepName, data]) => ({
        stepName,
        timestamp: data.timestamp || Date.now(),
      }))
      .sort((a, b) => b.timestamp - a.timestamp);

    if (stepsWithCallouts.length > 0) {
      const mostRecentStep = stepsWithCallouts[0].stepName;
      const isStepRendered = [...completedSteps, ...activeSteps].some(
        (step) => step.name === mostRecentStep
      );

      if (isStepRendered) {
        setActiveTab(mostRecentStep);
      }
    }
  }, [sseData, completedSteps, activeSteps, userSelectedTab]);

  // Only show tabs that are either completed or active
  const tabsToShow = steps.filter(
    (step) => step.status === "completed" || step.status === "active"
  );

  // Show at least 1 step, even if it's waiting
  const displaySteps = tabsToShow.length > 0 ? tabsToShow : steps.slice(0, 1);

  // If no steps are available at all, show a loading indicator
  if (steps.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500">
        Loading protocol steps...
      </div>
    );
  }

  return (
    <div>
      {/* Tab Buttons Container with proper sticky positioning */}
      <div
        className="sticky top-35 z-30 flex bg-white dark:bg-gray-900 shadow-sm protocol-tab-container"
        style={{
          overflowX: "auto",
          whiteSpace: "nowrap",
          scrollbarWidth: "none" /* Firefox */,
          msOverflowStyle: "none" /* IE and Edge */,
        }}
        css={`
          &::-webkit-scrollbar {
            display: none; /* Safari and Chrome */
          }
        `}
      >
        {displaySteps.map((step) => (
          <TabButton
            key={step.name}
            name={step.name}
            isActive={activeTab === step.name}
            onClick={() => handleTabSelect(step.name)}
            notificationCount={step.notificationCount || 0}
            notificationType={step.notificationType || "error"}
            status={step.status}
            stepProgress={step.stepProgress || 0}
          />
        ))}
      </div>

      {/* Only render the active tab content */}
      {activeTab && (
        <div className="tab-content">
          <TabContent
            stepName={activeTab}
            messages={messages || []}
            activeStep={activeSteps.find((step) => step.name === activeTab)}
            sseData={sseData || {}}
            callouts={stepCallouts[activeTab] || []}
          />
        </div>
      )}
    </div>
  );
};

export default ProtocolTracker;
