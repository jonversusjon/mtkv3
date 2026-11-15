// Base URLs for API requests.
// Dev (vite): talk to the Flask dev server directly unless overridden.
// Built bundle: served by Flask itself, so use same-origin relative URLs.
const DEFAULT_ORIGIN = import.meta.env.DEV ? "http://localhost:5000" : "";

export const SSE_BASE_URL = (import.meta.env.VITE_SSE_URL ?? DEFAULT_ORIGIN) + "/sse";

export const API_BASE_URL = (import.meta.env.VITE_API_URL ?? DEFAULT_ORIGIN) + "/api";
