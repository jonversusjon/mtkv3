// Base URLs for API requests.
// Default is same-origin (relative) in every mode:
//   * built bundle: served by Flask itself, so /api and /sse hit the same origin;
//   * dev (vite): vite.config.js proxies /api and /sse to VITE_PROXY_TARGET
//     (default http://localhost:5000), so the Flask port is not baked in here.
// VITE_API_URL / VITE_SSE_URL still override with an explicit origin.
const DEFAULT_ORIGIN = "";

export const SSE_BASE_URL = (import.meta.env.VITE_SSE_URL ?? DEFAULT_ORIGIN) + "/sse";

export const API_BASE_URL = (import.meta.env.VITE_API_URL ?? DEFAULT_ORIGIN) + "/api";
