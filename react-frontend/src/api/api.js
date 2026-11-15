import { API_BASE_URL } from "../config/config.js";

// Bounded waits: no browser request may hang forever.
export const REQUEST_TIMEOUT_MS = 30000;

// The timer covers the whole exchange -- connection, headers AND the JSON body --
// so a server that sends headers and then stalls cannot hang the caller.
const fetchJson = async (url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const timeoutError = () =>
    new Error(
      `The server did not respond within ${Math.round(timeoutMs / 1000)} seconds. Please try again.`
    );
  try {
    let response;
    try {
      response = await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      if (err?.name === "AbortError") throw timeoutError();
      throw new Error("Could not reach the server. Check your connection and try again.");
    }
    let body = null;
    try {
      // A stalled body rejects with AbortError when the signal fires; some
      // implementations ignore the signal for body reads, so also race it.
      body = await Promise.race([
        response.json(),
        new Promise((_, reject) =>
          controller.signal.addEventListener(
            "abort",
            () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            { once: true }
          )
        ),
      ]);
    } catch (err) {
      // An aborted body is a timeout, never a successful empty response.
      if (err?.name === "AbortError") throw timeoutError();
      // otherwise a non-JSON body (e.g. a proxy error page) -- handled by callers
    }
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Submit protocol generation. The server validates the input and issues the
 * job id; that id (not a client-made one) identifies every later lookup.
 * Resolves { jobId, taskId } or throws an Error with a user-readable message.
 */
export const submitProtocol = async (formData) => {
  const { response, body } = await fetchJson(`${API_BASE_URL}/generate_protocol`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(formData),
  });

  if (!response.ok) {
    throw new Error(
      body?.error || `The server rejected the request (HTTP ${response.status}).`
    );
  }
  const jobId = body?.job_id || body?.jobId;
  if (!jobId) {
    throw new Error("The server accepted the request but did not return a job id.");
  }
  return { jobId, taskId: body.task_id };
};

/**
 * Authoritative per-sequence outcome of a submission:
 * { jobId, state: pending|success|failure, sequences: [{ sequenceIdx, state, result?, error? }] }
 */
export const getJob = async (jobId) => {
  const { response, body } = await fetchJson(
    `${API_BASE_URL}/jobs/${encodeURIComponent(jobId)}`
  );
  if (!response.ok) {
    throw new Error(body?.error || `Status request failed (HTTP ${response.status}).`);
  }
  return body;
};

/** Stored progress events of one sequence, for recovering a missed SSE stream. */
export const getJobEvents = async (jobId, sequenceIdx) => {
  const { response, body } = await fetchJson(
    `${API_BASE_URL}/jobs/${encodeURIComponent(jobId)}/events?sequenceIdx=${sequenceIdx}`
  );
  if (!response.ok) {
    throw new Error(body?.error || `Event recovery failed (HTTP ${response.status}).`);
  }
  return body.events || [];
};

/**
 * Request design of primers for user-selected mutations.
 * The work is asynchronous; resolves { task_id, job_id, sequence_idx } once accepted.
 *
 * @param {Object} data
 * @param {string} data.job_id - The server-issued job id
 * @param {number} data.sequence_idx - Zero-based sequence index (0 is the first sequence)
 * @param {Object} data.selected_mutations - Map of site keys to selected codon sequences
 */
export const designPrimers = async (data) => {
  const { response, body } = await fetchJson(`${API_BASE_URL}/design_primers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(
      body?.error || `Primer design was rejected (HTTP ${response.status}).`
    );
  }
  if (!body?.task_id) {
    throw new Error("The server accepted the request but did not return a task id.");
  }
  return body;
};

/** State (and, once finished, result or error) of one asynchronous task. */
export const getTaskStatus = async (taskId) => {
  const { response, body } = await fetchJson(
    `${API_BASE_URL}/task-status/${encodeURIComponent(taskId)}`
  );
  if (!response.ok) {
    throw new Error(body?.error || `Task status request failed (HTTP ${response.status}).`);
  }
  return body;
};

/**
 * Ask the server to write a TSV export of `rows` ([name, sequence, amplicon]) and
 * retrieve the actual file it produced. Resolves { filename, text, blob }.
 * Throws an Error with a user-readable message on any failure, including a
 * non-TSV (HTML/JSON error) response, so an error page is never handed on as a file.
 *
 * This is the server-file export; the SnapGene clipboard copy in PrimerExplorer is a
 * separate, client-side implementation.
 */
export const exportPrimers = async (rows) => {
  const { response, body } = await fetchJson(`${API_BASE_URL}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ primers: rows }),
  });
  if (!response.ok) {
    throw new Error(body?.error || `Export was rejected (HTTP ${response.status}).`);
  }
  const url = body?.download_url;
  if (typeof url !== "string" || !url.startsWith("/")) {
    throw new Error("The server created the export but did not return a download location.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let file;
    try {
      file = await fetch(url, { signal: controller.signal });
    } catch (err) {
      throw new Error(
        err?.name === "AbortError"
          ? "The export download timed out. Please try again."
          : "Could not download the export file. Check your connection and try again."
      );
    }
    if (!file.ok) {
      let detail = "";
      try {
        detail = (await file.json())?.error || "";
      } catch (_) { /* not JSON */ }
      throw new Error(detail || `Export download failed (HTTP ${file.status}).`);
    }
    const type = file.headers?.get?.("Content-Type") || "";
    if (!type.startsWith("text/tab-separated-values")) {
      throw new Error("The server did not return a TSV file; nothing was downloaded.");
    }
    const text = await file.text();
    if (!text.startsWith("Primer Name\tSequence\tAmplicon\n")) {
      throw new Error("The downloaded export is not a valid primer TSV; nothing was saved.");
    }
    return {
      filename: decodeURIComponent(url.split("?")[0].split("/").pop()) || "primers.tsv",
      text,
      blob: new Blob([text], { type: "text/tab-separated-values" }),
    };
  } finally {
    clearTimeout(timer);
  }
};
