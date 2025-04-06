import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

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
