import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("API base URL resolution", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllEnvs());

  it("is same-origin (relative) in a production build", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_API_URL", undefined);
    const cfg = await import("./config.js");
    expect(cfg.API_BASE_URL).toBe("/api");
    expect(cfg.SSE_BASE_URL).toBe("/sse");
  });

  it("targets the Flask dev server in development", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_API_URL", undefined);
    const cfg = await import("./config.js");
    expect(cfg.API_BASE_URL).toBe("http://localhost:5000/api");
  });

  it("honours an explicit VITE_API_URL", async () => {
    vi.stubEnv("VITE_API_URL", "https://example.test");
    const cfg = await import("./config.js");
    expect(cfg.API_BASE_URL).toBe("https://example.test/api");
  });
});
