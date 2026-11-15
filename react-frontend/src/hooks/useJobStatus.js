// hooks/useJobStatus.js
// Polls GET /api/jobs/<jobId> until every sequence is terminal, with a bounded wait.
//
// state: "pending" | "success" | "failure" | "timeout"
//   pending  - at least one sequence has not finished (also while the server is briefly unreachable)
//   success  - every sequence finished successfully
//   failure  - every sequence is terminal and at least one failed (or the job is unknown)
//   timeout  - the wait budget was exhausted while still pending; the work may still finish
import { useEffect, useRef, useState } from "react";
import { getJob } from "../api/api";
import { JOB_POLL_INTERVAL_MS, JOB_TIMEOUT_MS } from "../config/config.js";

const TERMINAL = ["success", "failure"];

const useJobStatus = (
  jobId,
  { intervalMs = JOB_POLL_INTERVAL_MS, timeoutMs = JOB_TIMEOUT_MS } = {}
) => {
  const [status, setStatus] = useState({ state: "pending", sequences: [], error: null });
  const [attempt, setAttempt] = useState(0); // bump to restart after a timeout
  const startedAt = useRef(0);

  useEffect(() => {
    if (!jobId) return undefined;
    let cancelled = false;
    let timer = null;
    let finished = false; // a terminal state was reached: the deadline must not overwrite it
    startedAt.current = Date.now();
    setStatus({ state: "pending", sequences: [], error: null });

    // Overall deadline, independent of any single request: a stalled request
    // cannot push the terminal "timeout" state past the wait budget.
    const deadline = setTimeout(() => {
      if (cancelled || finished) return;
      cancelled = true; // ignore any late result from the stalled request
      if (timer) clearTimeout(timer);
      setStatus((prev) => ({ ...prev, state: "timeout" }));
    }, timeoutMs);

    const tick = async () => {
      try {
        const job = await getJob(jobId);
        if (cancelled) return;
        // Identity check: never accept a status that belongs to another submission.
        if (job.jobId !== jobId) {
          finished = true;
          setStatus({ state: "failure", sequences: [], error: "Received a status for a different job." });
          return;
        }
        setStatus({ state: job.state, sequences: job.sequences || [], error: null });
        if (TERMINAL.includes(job.state)) {
          finished = true;
          return;
        }
      } catch (err) {
        if (cancelled) return;
        if (/unknown job/i.test(err.message)) {
          finished = true;
          setStatus({ state: "failure", sequences: [], error: "This job no longer exists on the server. Please resubmit." });
          return;
        }
        // transient problem: stay pending, remember why
        setStatus((prev) => ({ ...prev, error: err.message }));
      }
      if (Date.now() - startedAt.current >= timeoutMs) {
        setStatus((prev) => ({ ...prev, state: "timeout" }));
        return;
      }
      timer = setTimeout(tick, intervalMs);
    };

    tick();
    return () => {
      cancelled = true;
      clearTimeout(deadline);
      if (timer) clearTimeout(timer);
    };
  }, [jobId, intervalMs, timeoutMs, attempt]);

  return { ...status, retry: () => setAttempt((n) => n + 1) };
};

export default useJobStatus;
