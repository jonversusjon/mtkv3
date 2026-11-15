// Results/SequenceStatus.jsx
// Shows whether ONE sequence is pending, finished, failed, or timed out.
// `status` is that sequence's server record ({state, error}) or undefined while unknown;
// `jobState` is the whole-job poll state ("timeout" is only known client-side).
const SequenceStatus = ({ status, jobState, pollError, onRetry }) => {
  const state = status?.state;

  if (state === "failure") {
    return (
      <div role="alert" data-testid="sequence-status-failure"
        className="mb-4 p-4 border-l-4 border-red-500 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 rounded-sm">
        {status.error || "This sequence could not be processed."}
      </div>
    );
  }
  if (state === "success") {
    return (
      <div role="status" data-testid="sequence-status-success"
        className="mb-4 p-3 border-l-4 border-green-500 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 rounded-sm">
        Finished. Results are shown below.
      </div>
    );
  }
  if (jobState === "timeout") {
    return (
      <div role="alert" data-testid="sequence-status-timeout"
        className="mb-4 p-4 border-l-4 border-yellow-500 bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200 rounded-sm">
        This is taking longer than expected and we stopped waiting. The work may still finish.{" "}
        <button type="button" className="underline font-medium" onClick={onRetry}>
          Check again
        </button>
      </div>
    );
  }
  return (
    <div role="status" data-testid="sequence-status-pending"
      className="mb-4 p-3 border-l-4 border-blue-500 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 rounded-sm">
      Processing…
      {pollError ? ` (having trouble reaching the server: ${pollError})` : ""}
    </div>
  );
};

export default SequenceStatus;
