import { render, screen, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import ResultTabs from "./ResultTabs";

const reply = (body, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

// SSE that never delivers anything: simulates a browser that missed every transient event.
class SilentEventSource {
  constructor() { this.readyState = 1; }
  close() { this.readyState = 2; }
}
SilentEventSource.CLOSED = 2;


const seedForm = (names) =>
  sessionStorage.setItem("formData", JSON.stringify({
    sequencesToDomesticate: names.map((primerName) => ({ primerName, sequence: "ATG" })),
  }));

const backend = (jobs, events = {}) =>
  vi.stubGlobal("fetch", vi.fn((url) => {
    const u = String(url);
    const m = u.match(/\/jobs\/([^/?]+)(\/events\?sequenceIdx=(\d+))?/);
    if (!m || !jobs[m[1]]) return reply({ error: "Unknown job" }, 404);
    if (m[2]) return reply({ events: events[`${m[1]}:${m[3]}`] || [] });
    return reply(jobs[m[1]]);
  }));

beforeEach(() => {
  sessionStorage.clear();
  globalThis.EventSource = SilentEventSource; // plain assignment: survives RTL cleanup
});
afterEach(() => vi.unstubAllGlobals());

describe("results lifecycle in the browser", () => {
  it("shows pending while the sequence work is unfinished, even though SSE is silent", async () => {
    seedForm(["alpha"]);
    backend({ A: { jobId: "A", state: "pending", sequences: [{ sequenceIdx: 0, state: "pending" }] } });
    render(<ResultTabs jobId="A" />);
    expect(await screen.findByTestId("sequence-status-pending")).toBeInTheDocument();
    expect(screen.queryByTestId("sequence-status-success")).toBeNull();
  });

  it("shows a controlled worker failure message to the user", async () => {
    seedForm(["alpha"]);
    backend({ A: { jobId: "A", state: "failure", sequences: [{ sequenceIdx: 0, state: "failure", error: "Sequence 1 could not be processed: codon table is unusable" }] } });
    render(<ResultTabs jobId="A" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Sequence 1 could not be processed: codon table is unusable");
  });

  it("each tab shows its own sequence's outcome", async () => {
    seedForm(["alpha", "beta"]);
    backend({ A: { jobId: "A", state: "failure", sequences: [
      { sequenceIdx: 0, state: "success", result: {} },
      { sequenceIdx: 1, state: "failure", error: "Sequence 2 could not be processed: bad" }] } });
    render(<ResultTabs jobId="A" />);
    expect(await screen.findByTestId("sequence-status-success")).toBeInTheDocument();
    expect(screen.getByTestId("sequence-status-failure")).toHaveTextContent("Sequence 2 could not be processed: bad");
  });

  it("recovers the stored events when SSE was missed, once the job is terminal", async () => {
    seedForm(["alpha"]);
    const events = { "A:0": [
      { jobId: "A", sequenceIdx: 0, step: "Restriction Sites", message: "Found 1 restriction sites", stepProgress: 100 },
      { jobId: "A", sequenceIdx: 0, step: "Sequence Status", message: "Sequence 1 complete", status: "success", terminal: true },
    ] };
    backend({ A: { jobId: "A", state: "success", sequences: [{ sequenceIdx: 0, state: "success", result: {} }] } }, events);
    render(<ResultTabs jobId="A" />);
    // events arrive only through recovery (SSE is silent): they are shown and kept
    expect(await screen.findByText("Show Raw SSE Events")).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem("sseEvents_A_0")).map((e) => e.step)).toEqual([
      "Restriction Sites",
      "Sequence Status",
    ]);
  });

  it("two submissions: submission B is not completed by submission A's result", async () => {
    seedForm(["alpha"]);
    // The server answers /jobs/B with B's own (pending) record and has A as success.
    backend({
      A: { jobId: "A", state: "success", sequences: [{ sequenceIdx: 0, state: "success", result: {} }] },
      B: { jobId: "B", state: "pending", sequences: [{ sequenceIdx: 0, state: "pending" }] },
    }, { "A:0": [{ jobId: "A", sequenceIdx: 0, step: "Restriction Sites", message: "A-only event" }] });
    const { unmount } = render(<ResultTabs jobId="A" />);
    expect(await screen.findByTestId("sequence-status-success")).toBeInTheDocument();
    unmount();
    render(<ResultTabs jobId="B" />);
    expect(await screen.findByTestId("sequence-status-pending")).toBeInTheDocument();
    expect(screen.queryByTestId("sequence-status-success")).toBeNull();
    expect(sessionStorage.getItem("sseEvents_B_0")).toBeNull();
  });

  it("ignores a recovered event that belongs to another job", async () => {
    seedForm(["alpha"]);
    backend({ B: { jobId: "B", state: "success", sequences: [{ sequenceIdx: 0, state: "success", result: {} }] } },
      { "B:0": [{ jobId: "OTHER", sequenceIdx: 0, step: "Restriction Sites", message: "wrong-job event" },
                { jobId: "B", sequenceIdx: 0, step: "Restriction Sites", message: "right-job event" }] });
    render(<ResultTabs jobId="B" />);
    await screen.findByText("Show Raw SSE Events");
    const stored = JSON.parse(sessionStorage.getItem("sseEvents_B_0"));
    expect(stored.map((e) => e.message)).toEqual(["right-job event"]);
  });

  // ---- F2: job-level failure is terminal and understandable in the consumer ----
  it("unknown job shows a terminal alert, not Processing forever", async () => {
    seedForm(["alpha"]);
    backend({});
    render(<ResultTabs jobId="GONE" />);
    expect(await screen.findByTestId("sequence-status-job-failure")).toHaveTextContent(/no longer exists/i);
    expect(screen.queryByTestId("sequence-status-pending")).toBeNull();
  });

  it("job identity mismatch shows a terminal alert", async () => {
    seedForm(["alpha"]);
    backend({ A: { jobId: "OTHER", state: "success", sequences: [{ sequenceIdx: 0, state: "success", result: {} }] } });
    render(<ResultTabs jobId="A" />);
    expect(await screen.findByTestId("sequence-status-job-failure")).toHaveTextContent(/different job/i);
    expect(screen.queryByTestId("sequence-status-pending")).toBeNull();
    expect(screen.queryByTestId("sequence-status-success")).toBeNull();
  });

  // ---- F3: event recovery ----
  const okJob = { A: { jobId: "A", state: "success", sequences: [{ sequenceIdx: 0, state: "success", result: { answer: 42 } }] } };
  const evs = [{ jobId: "A", sequenceIdx: 0, step: "Restriction Sites", message: "Found 1 restriction sites" }];

  it("a first failed event-recovery request is retried and then succeeds (silent SSE)", async () => {
    seedForm(["alpha"]);
    let eventCalls = 0;
    vi.stubGlobal("fetch", vi.fn((url) => {
      const u = String(url);
      if (u.includes("/events")) {
        eventCalls += 1;
        return eventCalls === 1 ? reply({ error: "boom" }, 500) : reply({ events: evs });
      }
      return reply(okJob.A);
    }));
    render(<ResultTabs jobId="A" recoveryBackoffMs={[5, 5]} />);
    expect(await screen.findByText("Show Raw SSE Events")).toBeInTheDocument();
    expect(eventCalls).toBe(2);
  });

  it("falls back to the durable result and offers a retry when events stay unavailable", async () => {
    seedForm(["alpha"]);
    let fail = true;
    vi.stubGlobal("fetch", vi.fn((url) => {
      if (String(url).includes("/events")) return fail ? reply({ error: "down" }, 503) : reply({ events: evs });
      return reply(okJob.A);
    }));
    render(<ResultTabs jobId="A" recoveryBackoffMs={[1, 1]} />);
    expect(await screen.findByTestId("recovery-failed")).toBeInTheDocument();
    expect(screen.getByTestId("durable-result")).toHaveTextContent('"answer": 42');
    fail = false;
    screen.getByRole("button", { name: "Retry" }).click();
    expect(await screen.findByText("Show Raw SSE Events")).toBeInTheDocument();
    expect(screen.queryByTestId("recovery-failed")).toBeNull();
  });

  it("stops retrying and does not store events after unmount", async () => {
    seedForm(["alpha"]);
    let eventCalls = 0;
    vi.stubGlobal("fetch", vi.fn((url) => {
      if (String(url).includes("/events")) { eventCalls += 1; return reply({ error: "down" }, 503); }
      return reply(okJob.A);
    }));
    const { unmount } = render(<ResultTabs jobId="A" recoveryBackoffMs={[400, 400, 400]} />);
    await waitFor(() => expect(eventCalls).toBe(1));
    unmount();
    await act(async () => { await new Promise((r) => setTimeout(r, 900)); });
    expect(eventCalls).toBe(1);
    expect(sessionStorage.getItem("sseEvents_A_0")).toBeNull();
  });

  it("job change cancels the previous job's recovery and never merges its events", async () => {
    seedForm(["alpha"]);
    let release;
    const gate = new Promise((r) => { release = r; });
    vi.stubGlobal("fetch", vi.fn((url) => {
      const u = String(url);
      if (u.includes("/jobs/A/events")) return gate.then(() => reply({ events: evs }));
      if (u.includes("/jobs/A")) return reply(okJob.A);
      if (u.includes("/jobs/B/events")) return reply({ events: [] });
      return reply({ jobId: "B", state: "pending", sequences: [{ sequenceIdx: 0, state: "pending" }] });
    }));
    const { rerender } = render(<ResultTabs jobId="A" />);
    await screen.findByTestId("sequence-status-success");
    rerender(<ResultTabs jobId="B" />);
    await screen.findByTestId("sequence-status-pending");
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 20)); });
    expect(sessionStorage.getItem("sseEvents_A_0")).toBeNull();
    expect(sessionStorage.getItem("sseEvents_B_0")).toBeNull();
  });

  // ---- round 2 F3: stored result is visible independent of events ----
  const fullJob = { A: { jobId: "A", state: "success", sequences: [{ sequenceIdx: 0, state: "success", result: {
    processedSequence: "ATGGCCAAATAA", mtkPartLeft: "3", mtkPartRight: "4",
    restrictionSites: [{ enzyme: "BsaI", recognitionSeq: "GGTCTC", position: 7, frame: 1, strand: "+" }],
    mutationOptions: [{}, {}],
  } }] } };

  const withEvents = (events) => vi.stubGlobal("fetch", vi.fn((url) =>
    String(url).includes("/events") ? reply({ events }) : reply(fullJob.A)));

  it.each([
    ["status-only", [{ jobId: "A", sequenceIdx: 0, step: "Sequence Status", message: "Sequence 1 complete", status: "success", terminal: true }]],
    ["progress-only", [{ jobId: "A", sequenceIdx: 0, step: "Restriction Sites", message: "Found 1 restriction sites" }]],
  ])("keeps the readable stored result visible with %s recovered events", async (_n, events) => {
    seedForm(["alpha"]);
    withEvents(events);
    render(<ResultTabs jobId="A" recoveryBackoffMs={[1, 1]} />);
    await screen.findByText("Show Raw SSE Events"); // events were recovered and counted
    const dr = screen.getByTestId("durable-result");
    expect(dr).toHaveTextContent("ATGGCCAAATAA");
    expect(screen.getByTestId("durable-restriction-sites")).toHaveTextContent(/BsaI.*GGTCTC.*position 7/);
  });

  it("shows readable summary when no events exist, and says so when the stored result is empty", async () => {
    seedForm(["alpha"]);
    withEvents([]);
    const { unmount } = render(<ResultTabs jobId="A" recoveryBackoffMs={[1, 1]} />);
    expect(await screen.findByTestId("durable-processed-dna")).toHaveTextContent("ATGGCCAAATAA");
    unmount();
    vi.stubGlobal("fetch", vi.fn((url) => String(url).includes("/events") ? reply({ events: [] })
      : reply({ jobId: "A", state: "success", sequences: [{ sequenceIdx: 0, state: "success", result: {} }] })));
    render(<ResultTabs jobId="A" recoveryBackoffMs={[1, 1]} />);
    expect(await screen.findByTestId("durable-result-empty")).toHaveTextContent(/no result data/i);
  });
});
