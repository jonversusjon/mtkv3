import { describe, it, expect, vi, afterEach } from "vitest";
import { submitProtocol, getJob, getJobEvents } from "./api";

const reply = (body, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("submitProtocol", () => {
  it("returns the server-issued job id, not a client-made one", async () => {
    const fetchMock = vi.fn(() => reply({ job_id: "srv-1", task_id: "t-1" }, 202));
    vi.stubGlobal("fetch", fetchMock);
    const out = await submitProtocol({ jobId: "client-made", species: "homo_sapiens" });
    expect(out).toEqual({ jobId: "srv-1", taskId: "t-1" });
  });

  it("two submissions resolve to their own distinct ids", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(() => reply({ job_id: `srv-${++n}`, task_id: `t-${n}` }, 202)));
    const a = await submitProtocol({});
    const b = await submitProtocol({});
    expect(a.jobId).not.toBe(b.jobId);
  });

  it("surfaces the server's validation message", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply({ error: "Invalid input: Species is required." }, 400)));
    await expect(submitProtocol({})).rejects.toThrow("Invalid input: Species is required.");
  });

  it("explains a non-JSON error response (e.g. proxy page)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 502, json: () => Promise.reject(new Error("x")) })));
    await expect(submitProtocol({})).rejects.toThrow(/HTTP 502/);
  });

  it("explains an unreachable server", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    await expect(submitProtocol({})).rejects.toThrow(/Could not reach the server/);
  });

  it("does not wait forever: aborts after the request timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_u, { signal }) =>
      new Promise((_res, rej) => signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))))));
    const p = submitProtocol({});
    const assertion = expect(p).rejects.toThrow(/did not respond within 30 seconds/);
    await vi.advanceTimersByTimeAsync(30001);
    await assertion;
  });

  it("times out when headers arrive but the body stalls until aborted", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_u, { signal }) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => new Promise((_res, rej) =>
          signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))),
      })));
    const assertion = expect(submitProtocol({})).rejects.toThrow(/did not respond within 30 seconds/);
    await vi.advanceTimersByTimeAsync(30001);
    await assertion;
  });

  it("still times out if the body read ignores the abort signal", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => new Promise(() => {}) })));
    const assertion = expect(getJob("j")).rejects.toThrow(/did not respond within 30 seconds/);
    await vi.advanceTimersByTimeAsync(30001);
    await assertion;
  });

  it("does not time out a normal JSON reply, and leaves no pending timer", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => reply({ job_id: "srv-1", task_id: "t" }, 202)));
    await expect(submitProtocol({})).resolves.toEqual({ jobId: "srv-1", taskId: "t" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports malformed JSON as an HTTP error, not a timeout", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
      ok: true, status: 200, json: () => Promise.reject(new SyntaxError("Unexpected token <")) })));
    await expect(submitProtocol({})).rejects.toThrow(/did not return a job id/);
  });

  it("rejects a 2xx response that carries no job id", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply({}, 202)));
    await expect(submitProtocol({})).rejects.toThrow(/did not return a job id/);
  });
});

describe("job lookups", () => {
  it("getJob / getJobEvents hit the job endpoints and report errors", async () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn((url) => {
      calls.push(String(url));
      if (String(url).includes("/events")) return reply({ events: [{ step: "x" }] });
      if (String(url).endsWith("/jobs/gone")) return reply({ error: "Unknown job" }, 404);
      return reply({ jobId: "j", state: "pending", sequences: [] });
    }));
    expect((await getJob("j")).state).toBe("pending");
    expect(await getJobEvents("j", 1)).toEqual([{ step: "x" }]);
    expect(calls).toEqual(["/api/jobs/j", "/api/jobs/j/events?sequenceIdx=1"]);
    await expect(getJob("gone")).rejects.toThrow("Unknown job");
  });
});
