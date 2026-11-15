import { API_BASE_URL } from "../config/config.js";
import axios from "axios";

// Bounded waits: no browser request may hang forever.
export const REQUEST_TIMEOUT_MS = 30000;

const fetchJson = async (url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(
        `The server did not respond within ${Math.round(timeoutMs / 1000)} seconds. Please try again.`
      );
    }
    throw new Error("Could not reach the server. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    // non-JSON body (e.g. a proxy error page) -- handled below
  }
  return { response, body };
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
 * Request design of primers for user-selected mutations
 *
 * @param {Object} data - The request data
 * @param {string} data.job_id - The job ID
 * @param {number} data.sequence_idx - The sequence index
 * @param {Object} data.selected_mutations - Map of site keys to selected codon sequences
 * @returns {Promise} - API response
 */
export const designPrimers = async (data) => {
  try {
    const response = await axios.post(
      `${API_BASE_URL}/api/design_primers`,
      data
    );
    return response.data;
  } catch (error) {
    console.error("Failed to request primer design:", error);
    throw error;
  }
};
