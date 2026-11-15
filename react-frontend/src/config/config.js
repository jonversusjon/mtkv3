// Base URLs for API requests.
// Default is same-origin (relative) in every mode:
//   * built bundle: served by Flask itself, so /api and /sse hit the same origin;
//   * dev (vite): vite.config.js proxies /api and /sse to VITE_PROXY_TARGET
//     (default http://localhost:5000), so the Flask port is not baked in here.
// VITE_API_URL / VITE_SSE_URL still override with an explicit origin.
const DEFAULT_ORIGIN = "";

export const SSE_BASE_URL = (import.meta.env.VITE_SSE_URL ?? DEFAULT_ORIGIN) + "/sse";

// Origin the API lives on ("" = same origin / vite proxy).
export const API_ORIGIN = import.meta.env.VITE_API_URL ?? DEFAULT_ORIGIN;

export const API_BASE_URL = API_ORIGIN + "/api";

// How often the browser asks the server for a job's status, and how long it waits
// for every sequence to reach a terminal state before reporting a timeout.
export const JOB_POLL_INTERVAL_MS = 2000;
export const JOB_TIMEOUT_MS = 15 * 60 * 1000;
