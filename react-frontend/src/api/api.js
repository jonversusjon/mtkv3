import { API_BASE_URL } from "../config/config.js";
import axios from "axios";

/**
 * Submit protocol generation; returns jobId for SSE subscription.
 */
export const submitProtocol = async (formData) => {
  const jobId = formData.jobId || Date.now().toString();
  const payload = { ...formData, jobId };

  console.group("Submit Protocol");
  console.time("Protocol request");

  const response = await fetch(`${API_BASE_URL}/generate_protocol`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  console.timeEnd("Protocol request");
  const initialData = await response.json();

  if (!response.ok) {
    console.error("Protocol generation error:", initialData);
    throw new Error(initialData.error);
  }

  console.log("Protocol generation started, jobId:", jobId);
  console.groupEnd();
  return { jobId };
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

/**
 * Get status of a running job
 *
 * @param {string} jobId - The job ID to check
 * @returns {Promise} - API response with job status
 */
export const getJobStatus = async (jobId) => {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/api/task-status/${jobId}`
    );
    return response.data;
  } catch (error) {
    console.error("Failed to get job status:", error);
    throw error;
  }
};
