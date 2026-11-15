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

import { designPrimers, getTaskStatus, exportPrimers } from "./api";

describe("client URLs hit the intended handlers (no duplicated prefix)", () => {
  const urls = async (fn) => {
    const fetchMock = vi.fn(() => reply({ task_id: "t", state: "PENDING", job_id: "j", events: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await fn();
    return fetchMock.mock.calls.map((c) => String(c[0]));
  };

  it.each([
    ["submitProtocol", () => submitProtocol({}), "/api/generate_protocol"],
    ["getJob", () => getJob("j 1"), "/api/jobs/j%201"],
    ["getJobEvents", () => getJobEvents("j", 0), "/api/jobs/j/events?sequenceIdx=0"],
    ["designPrimers", () => designPrimers({ job_id: "j" }), "/api/design_primers"],
    ["getTaskStatus", () => getTaskStatus("t/1"), "/api/task-status/t%2F1"],
  ])("%s requests exactly its route", async (_n, call, expected) => {
    const [url] = await urls(() => call().catch(() => {}));
    expect(url).toBe(expected);
    expect(url).not.toMatch(/\/api\/api/);
  });
});

describe("designPrimers", () => {
  it("posts JSON with the numeric first-sequence index preserved", async () => {
    const fetchMock = vi.fn(() => reply({ task_id: "t-9", status: "success" }, 202));
    vi.stubGlobal("fetch", fetchMock);
    const out = await designPrimers({ job_id: "J", sequence_idx: 0, selected_mutations: { mutation480: "ACT" } });
    expect(out.task_id).toBe("t-9");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ job_id: "J", sequence_idx: 0, selected_mutations: { mutation480: "ACT" } });
  });

  it("surfaces the server's rejection message", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply({ error: "sequence_idx must be a non-negative integer" }, 400)));
    await expect(designPrimers({})).rejects.toThrow("sequence_idx must be a non-negative integer");
  });

  it("rejects an accepted response that has no task id", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply({ status: "success" }, 202)));
    await expect(designPrimers({})).rejects.toThrow(/task id/);
  });
});

describe("exportPrimers", () => {
  const file = (text, type = "text/tab-separated-values; charset=utf-8", status = 200) => ({
    ok: status < 400, status, headers: { get: () => type }, text: () => Promise.resolve(text),
    json: () => Promise.reject(new Error("not json")),
  });
  const HEAD = "Primer Name\tSequence\tAmplicon\n";

  it("posts rows, retrieves the file and returns its filename and TSV content", async () => {
    const fetchMock = vi.fn()
      .mockReturnValueOnce(reply({ download_url: "/api/export/primers_1_abcdef12.tsv" }))
      .mockReturnValueOnce(Promise.resolve(file(HEAD + "p1\tACGT\t\n")));
    vi.stubGlobal("fetch", fetchMock);
    const out = await exportPrimers([["p1", "ACGT", ""]]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ primers: [["p1", "ACGT", ""]] });
    expect(String(fetchMock.mock.calls[1][0])).toBe("/api/export/primers_1_abcdef12.tsv");
    expect(out.filename).toBe("primers_1_abcdef12.tsv");
    expect(out.text).toBe(HEAD + "p1\tACGT\t\n");
  });

  it("surfaces export rejection, non-TSV bodies and failed downloads", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply({ error: "No primers to export" }, 400)));
    await expect(exportPrimers([])).rejects.toThrow("No primers to export");
    vi.stubGlobal("fetch", vi.fn()
      .mockReturnValueOnce(reply({ download_url: "/api/export/x" }))
      .mockReturnValueOnce(Promise.resolve(file("<html>", "text/html"))));
    await expect(exportPrimers([["a", "A", ""]])).rejects.toThrow(/not return a TSV/);
    vi.stubGlobal("fetch", vi.fn()
      .mockReturnValueOnce(reply({ download_url: "/api/export/x" }))
      .mockReturnValueOnce(Promise.resolve(file("garbage"))));
    await expect(exportPrimers([["a", "A", ""]])).rejects.toThrow(/not a valid primer TSV/);
    vi.stubGlobal("fetch", vi.fn()
      .mockReturnValueOnce(reply({ download_url: "/api/export/x" }))
      .mockReturnValueOnce(Promise.resolve({ ok: false, status: 404, headers: { get: () => "application/json" }, json: () => Promise.resolve({ error: "Unknown export" }) })));
    await expect(exportPrimers([["a", "A", ""]])).rejects.toThrow("Unknown export");
  });
});
