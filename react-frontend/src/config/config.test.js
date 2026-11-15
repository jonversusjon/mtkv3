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

  it("is same-origin in development so the vite proxy is used", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_API_URL", undefined);
    vi.stubEnv("VITE_SSE_URL", undefined);
    const cfg = await import("./config.js");
    expect(cfg.API_BASE_URL).toBe("/api");
    expect(cfg.SSE_BASE_URL).toBe("/sse");
  });

  it("honours an explicit VITE_SSE_URL", async () => {
    vi.stubEnv("VITE_SSE_URL", "https://sse.test");
    const cfg = await import("./config.js");
    expect(cfg.SSE_BASE_URL).toBe("https://sse.test/sse");
  });

  it("honours an explicit VITE_API_URL", async () => {
    vi.stubEnv("VITE_API_URL", "https://example.test");
    const cfg = await import("./config.js");
    expect(cfg.API_BASE_URL).toBe("https://example.test/api");
  });
});
