import { render, screen, waitFor } from "@testing-library/react";
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
});
