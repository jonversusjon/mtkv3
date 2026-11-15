import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import useJobStatus from "./useJobStatus";

const reply = (body, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const job = (jobId, state, sequences = []) => ({ jobId, state, sequences });

describe("useJobStatus", () => {
  it("goes pending -> success only when the server reports success", async () => {
    vi.useFakeTimers();
    const states = ["pending", "pending", "success"];
    vi.stubGlobal("fetch", vi.fn(() => reply(job("A", states.shift() ?? "success", [{ sequenceIdx: 0, state: "x" }]))));
    const { result } = renderHook(() => useJobStatus("A", { intervalMs: 100, timeoutMs: 10000 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.state).toBe("pending");
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(result.current.state).toBe("pending");
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(result.current.state).toBe("success");
  });

  it("reports failure with the per-sequence error", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply(job("A", "failure", [{ sequenceIdx: 0, state: "failure", error: "Sequence 1 could not be processed: bad" }]))));
    const { result } = renderHook(() => useJobStatus("A", { intervalMs: 10 }));
    await waitFor(() => expect(result.current.state).toBe("failure"));
    expect(result.current.sequences[0].error).toMatch(/could not be processed/);
  });

  it("stops polling and reports timeout when the wait budget is exhausted", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => reply(job("A", "pending")));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useJobStatus("A", { intervalMs: 100, timeoutMs: 450 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.state).toBe("timeout");
    const calls = fetchMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(fetchMock.mock.calls.length).toBe(calls); // bounded: no more polling
  });

  it("reaches a bounded timeout even when a request stalls after headers", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => new Promise(() => {}) })));
    const { result, unmount } = renderHook(() => useJobStatus("A", { intervalMs: 100, timeoutMs: 450 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(result.current.state).toBe("timeout");
    unmount();
    // the abandoned request's own 30s limit still fires and is ignored; nothing lingers after it
    await act(async () => { await vi.advanceTimersByTimeAsync(31000); });
    expect(vi.getTimerCount()).toBe(0);
    expect(result.current.state).toBe("timeout");
  });

  it("a status that belongs to a different job never satisfies completion", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply(job("STALE-A", "success", [{ sequenceIdx: 0, state: "success" }]))));
    const { result } = renderHook(() => useJobStatus("B", { intervalMs: 10 }));
    await waitFor(() => expect(result.current.state).toBe("failure"));
    expect(result.current.error).toMatch(/different job/);
  });

  it("switching to a new submission resets to pending instead of reusing the old result", async () => {
    const db = { A: job("A", "success", [{ sequenceIdx: 0, state: "success" }]) };
    let release;
    vi.stubGlobal("fetch", vi.fn((url) => {
      const id = String(url).split("/jobs/")[1];
      if (id === "B") return new Promise((r) => { release = () => r({ ok: true, status: 200, json: () => Promise.resolve(job("B", "pending")) }); });
      return reply(db[id]);
    }));
    const { result, rerender } = renderHook(({ id }) => useJobStatus(id, { intervalMs: 10 }), { initialProps: { id: "A" } });
    await waitFor(() => expect(result.current.state).toBe("success"));
    rerender({ id: "B" });
    await waitFor(() => expect(result.current.state).toBe("pending"));
    expect(result.current.sequences).toEqual([]);
    release();
  });

  it("an unknown job is a failure, not an endless spinner", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply({ error: "Unknown job" }, 404)));
    const { result } = renderHook(() => useJobStatus("A", { intervalMs: 10 }));
    await waitFor(() => expect(result.current.state).toBe("failure"));
    expect(result.current.error).toMatch(/no longer exists/);
  });

  it("tolerates a transient network error and keeps polling", async () => {
    vi.useFakeTimers();
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(() => (++n === 1 ? Promise.reject(new TypeError("net")) : reply(job("A", "success")))));
    const { result } = renderHook(() => useJobStatus("A", { intervalMs: 100, timeoutMs: 10000 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.state).toBe("pending");
    expect(result.current.error).toMatch(/Could not reach the server/);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(result.current.state).toBe("success");
    expect(result.current.error).toBeNull();
  });
});
