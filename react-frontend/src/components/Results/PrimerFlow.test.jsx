// The user-visible follow-up flow, from the real MutationExplorer UI to the real
// consuming UI, with the server's real payload shapes (test/fixtures/followups.json is
// produced by the backend and checked against it by tests/readiness/test_followups.py).
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import ResultTabs from "./ResultTabs";
import fx from "../../test/fixtures/followups.json";

vi.mock("react-toastify", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
import { toast } from "react-toastify";

const JOB = fx.jobId;
const reply = (body, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

class SilentEventSource {
  constructor() { this.readyState = 1; }
  close() { this.readyState = 2; }
}
SilentEventSource.CLOSED = 2;

const eventFor = (idx) => ({ ...fx.mutationEvent, sequenceIdx: idx });

// Fake server: job/events from fixtures; design_primers + task-status scripted per test.
const server = ({ events, design, tasks }) => {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn((url, init) => {
    const u = String(url);
    calls.push({ url: u, init });
    let m;
    if (u === "/api/design_primers") return design(JSON.parse(init.body));
    if ((m = u.match(/^\/api\/task-status\/(.+)$/))) return tasks(decodeURIComponent(m[1]));
    if ((m = u.match(/^\/api\/jobs\/([^/?]+)\/events\?sequenceIdx=(\d+)$/)))
      return reply({ events: events[Number(m[2])] || [] });
    if ((m = u.match(/^\/api\/jobs\/([^/?]+)$/)))
      return reply({ jobId: JOB, state: "success", sequences: [0, 1].map((i) => ({ sequenceIdx: i, state: "success", result: {} })) });
    return reply({ error: `unexpected ${u}` }, 404);
  }));
  return calls;
};

let clipboard;
beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  sessionStorage.setItem("formData", JSON.stringify({
    sequencesToDomesticate: [{ primerName: "alpha", sequence: "ATG" }, { primerName: "beta", sequence: "ATG" }],
  }));
  globalThis.EventSource = SilentEventSource;
  clipboard = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", { value: { writeText: clipboard }, configurable: true });
});
afterEach(() => vi.unstubAllGlobals());

const panel = (name) => screen.getByRole("tabpanel", { name });

// Opens sequence `idx`'s tab and its Mutation Analysis step; returns the panel.
const openMutationAnalysis = async (idx) => {
  render(<ResultTabs jobId={JOB} />);
  const name = ["alpha", "beta"][idx];
  fireEvent.click(await screen.findByRole("tab", { name }));
  const p = panel(name);
  await within(p).findByText("Show Raw SSE Events"); // recovered events have been applied
  fireEvent.click(await within(p).findByRole("button", { name: /Mutation Analysis/ }));
  return p;
};

const pairsOf = (result) => result.primerSet.mutPrimerPairs;
const parseSnapGeneTsv = (text) => text.split("\n").filter(Boolean).map((l) => l.split("\t"));

describe.each([0, 1])("designing primers for sequence %i from the UI", (idx) => {
  const events = (i) => ({ [i]: [eventFor(i)] });
  // Alphabetical picker: Position 33 offers ACA, ACG, ACT; fixture selection is ACT,
  // whose picker index (2) differs from its position in the server's insertion order (1).
  const selected = fx.selection;
  const [siteKey, codon] = Object.entries(selected)[0];

  it("sends the displayed selection with this tab's job and sequence, then shows and exports the result", async () => {
    let task = 0;
    const calls = server({
      events: events(idx),
      design: () => reply({ status: "success", task_id: `task-${++task}`, job_id: JOB, sequence_idx: idx }, 202),
      tasks: (id) => reply({ task_id: id, state: "SUCCESS", result: { ...fx.designResult, taskId: id }, jobId: JOB, sequenceIdx: idx }),
    });
    const p = await openMutationAnalysis(idx);

    // user picks the codon in the picker, then asks for primers
    fireEvent.click(within(p).getByText(codon));
    fireEvent.click(within(p).getByRole("button", { name: "Design Primers" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Custom primers designed"));
    const post = calls.find((c) => c.url === "/api/design_primers");
    expect(post.init.method).toBe("POST");
    expect(JSON.parse(post.init.body)).toEqual({
      job_id: JOB,
      sequence_idx: idx,                 // a number; 0 is a real index
      selected_mutations: { [siteKey]: codon },
    });
    expect(calls.map((c) => c.url).filter((u) => u.includes("/api/api"))).toEqual([]);

    // consuming UI: Primer Design step shows exactly that selection's primers
    fireEvent.click(within(p).getByRole("button", { name: /Primer Design/ }));
    const shown = await within(p).findByTestId("selected-mutations");
    expect(shown).toHaveTextContent(`${siteKey}=${codon}`);
    const first = pairsOf(fx.designResult)[0];
    expect(within(p).getAllByText(first.forward.sequence).length).toBeGreaterThan(0);

    // browser export entry point: the SnapGene copy button writes a parseable TSV
    fireEvent.click(within(p).getByRole("button", { name: /Copy All for SnapGene/ }));
    await waitFor(() => expect(clipboard).toHaveBeenCalledTimes(1));
    const rows = parseSnapGeneTsv(clipboard.mock.calls[0][0]);
    const expected = pairsOf(fx.designResult).flatMap((pr) => [pr.forward, pr.reverse]).map((pm) => [pm.name, pm.sequence, ""]);
    expect(rows).toEqual(expected);
    expect(rows.length).toBe(2 * pairsOf(fx.designResult).length);
    rows.forEach((r) => expect(r).toHaveLength(3));
    // representative values from the selected result, not placeholders
    expect(rows[0][1]).toBe(first.forward.sequence);
    expect(rows[1][1]).toBe(first.reverse.sequence);
  });
});

describe("Download TSV (server file export; separate from the clipboard copy)", () => {
  const tsvOf = (rows) =>
    "Primer Name\tSequence\tAmplicon\n" + rows.map((r) => r.join("\t") + "\n").join("");
  const setup = async (exportReply) => {
    let exportBody;
    const calls = server({
      events: { 0: [eventFor(0)] },
      design: () => reply({ status: "success", task_id: "t1", job_id: JOB, sequence_idx: 0 }, 202),
      tasks: (id) => reply({ task_id: id, state: "SUCCESS", result: { ...fx.designResult, taskId: id } }),
    });
    const base = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn((url, init) => {
      if (String(url) === "/api/export") {
        exportBody = JSON.parse(init.body);
        calls.push({ url: String(url), init });
        return exportReply.post(exportBody);
      }
      if (String(url).startsWith("/api/export/")) {
        calls.push({ url: String(url), init });
        return exportReply.get(exportBody);
      }
      return base(url, init);
    }));
    const created = [];
    const click = vi.fn();
    globalThis.URL.createObjectURL = vi.fn((b) => { created.push(b); return "blob:x"; });
    globalThis.URL.revokeObjectURL = vi.fn();
    const anchors = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { anchors.push({ download: this.download, href: this.getAttribute("href") }); click(); };
    const p = await openMutationAnalysis(0);
    fireEvent.click(within(p).getByText(Object.values(fx.selection)[0]));
    fireEvent.click(within(p).getByRole("button", { name: "Design Primers" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Custom primers designed"));
    fireEvent.click(within(p).getByRole("button", { name: /Primer Design/ }));
    await within(p).findByTestId("selected-mutations");
    return { p, calls, created, anchors, click, restore: () => { HTMLAnchorElement.prototype.click = orig; } };
  };
  const fileReply = (text, type = "text/tab-separated-values; charset=utf-8", status = 200) =>
    Promise.resolve({ ok: status < 400, status, headers: { get: () => type }, text: () => Promise.resolve(text), json: () => Promise.reject(new Error("not json")) });

  it("posts the selected primer rows, fetches the returned file and downloads its parsed bytes", async () => {
    const url = "/api/export/primers_1_abcdef12.tsv";
    const { p, calls, created, anchors, restore } = await setup({
      post: (body) => reply({ download_url: url }),
      get: (body) => fileReply(tsvOf(body.primers)),
    });
    try {
      fireEvent.click(within(p).getByRole("button", { name: "Download TSV" }));
      await waitFor(() => expect(anchors).toHaveLength(1));
      const expected = pairsOf(fx.designResult).flatMap((pr) => [pr.forward, pr.reverse]).map((pm) => [pm.name, pm.sequence, ""]);
      const post = calls.find((c) => c.url === "/api/export");
      expect(post.init.method).toBe("POST");
      expect(JSON.parse(post.init.body)).toEqual({ primers: expected });
      expect(calls.map((c) => c.url)).toContain(url);
      expect(anchors[0].download).toBe("primers_1_abcdef12.tsv");
      const text = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsText(created[0]); });
      const table = parseSnapGeneTsv(text);
      expect(table[0]).toEqual(["Primer Name", "Sequence", "Amplicon"]);
      const first = pairsOf(fx.designResult)[0];
      expect(table[1].slice(0, 2)).toEqual([first.forward.name, first.forward.sequence]);
      expect(table[2].slice(0, 2)).toEqual([first.reverse.name, first.reverse.sequence]);
      expect(table.length - 1).toBe(expected.length);
      expect(clipboard).not.toHaveBeenCalled(); // separate implementation from the clipboard copy
    } finally { restore(); }
  });

  it("shows the server's error and downloads nothing when export is rejected", async () => {
    const { p, anchors, restore } = await setup({ post: () => reply({ error: "primers[0]: bad" }, 400), get: () => fileReply("") });
    try {
      fireEvent.click(within(p).getByRole("button", { name: "Download TSV" }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("TSV export failed: primers[0]: bad"));
      expect(anchors).toHaveLength(0);
    } finally { restore(); }
  });

  it("refuses to download an HTML page served in place of the file", async () => {
    const { p, anchors, restore } = await setup({
      post: () => reply({ download_url: "/api/export/primers_1_abcdef12.tsv" }),
      get: () => fileReply("<html>oops</html>", "text/html"),
    });
    try {
      fireEvent.click(within(p).getByRole("button", { name: "Download TSV" }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("did not return a TSV file")));
      expect(anchors).toHaveLength(0);
    } finally { restore(); }
  });
});

describe("asynchronous result consumption", () => {
  it("waits through PENDING and consumes the result once it succeeds", async () => {
    let polls = 0;
    server({
      events: { 0: [eventFor(0)] },
      design: () => reply({ status: "success", task_id: "slow", job_id: JOB, sequence_idx: 0 }, 202),
      tasks: (id) => (++polls < 2
        ? reply({ task_id: id, state: "PENDING" })
        : reply({ task_id: id, state: "SUCCESS", result: { ...fx.designResult, taskId: id } })),
    });
    const p = await openMutationAnalysis(0);
    fireEvent.click(within(p).getByRole("button", { name: "Design Primers" }));
    expect(await within(p).findByRole("button", { name: "Designing..." })).toBeDisabled();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Custom primers designed"), { timeout: 6000 });
    expect(polls).toBe(2);
    fireEvent.click(within(p).getByRole("button", { name: /Primer Design/ }));
    expect(await within(p).findByTestId("selected-mutations")).toBeInTheDocument();
  });

  it("shows the worker's failure instead of pretending success", async () => {
    server({
      events: { 0: [eventFor(0)] },
      design: () => reply({ status: "success", task_id: "bad", job_id: JOB, sequence_idx: 0 }, 202),
      tasks: (id) => reply({ task_id: id, state: "FAILURE", error: "Primer design failed: no compatible primer set exists" }),
    });
    const p = await openMutationAnalysis(0);
    fireEvent.click(within(p).getByRole("button", { name: "Design Primers" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Primer design failed: Primer design failed: no compatible primer set exists"));
    expect(toast.success).not.toHaveBeenCalled();
    expect(within(p).queryByTestId("selected-mutations")).toBeNull();
    expect(within(p).getByRole("button", { name: "Design Primers" })).toBeEnabled();
  });

  it("shows the server's rejection of the request", async () => {
    server({
      events: { 0: [eventFor(0)] },
      design: () => reply({ error: "Unknown job" }, 404),
      tasks: () => reply({}, 500),
    });
    const p = await openMutationAnalysis(0);
    fireEvent.click(within(p).getByRole("button", { name: "Design Primers" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Primer design failed: Unknown job"));
  });

  it("consumes a result delivered only by the event stream/recovery (no poll needed), once", async () => {
    const live = {
      jobId: JOB, sequenceIdx: 0, step: "Primer Design", message: "Custom primers designed for the selected mutations",
      stepProgress: 100, customPrimers: { ...fx.designResult, taskId: "sse-1" },
    };
    server({
      events: { 0: [eventFor(0), live, { ...live, timestamp: 12345 }] }, // delivered twice
      design: () => reply({}, 500),
      tasks: () => reply({}, 500),
    });
    render(<ResultTabs jobId={JOB} />);
    const p = panel("alpha");
    await within(p).findByText("Show Raw SSE Events");
    fireEvent.click(await within(p).findByRole("button", { name: /Primer Design/ }));
    expect(await within(p).findByTestId("selected-mutations")).toBeInTheDocument();
    expect(within(p).getAllByRole("button", { name: /Custom Primer Set/ })).toHaveLength(1);
  });

  it("shows a failure event for a design that failed in the worker", async () => {
    const fail = {
      jobId: JOB, sequenceIdx: 0, step: "Primer Design", message: "Primer design failed: boom",
      customPrimers: { status: "failure", error: "Primer design failed: boom", taskId: "f-1", selectedMutations: [] },
    };
    server({ events: { 0: [eventFor(0), fail] }, design: () => reply({}, 500), tasks: () => reply({}, 500) });
    render(<ResultTabs jobId={JOB} />);
    const p = panel("alpha");
    await within(p).findByText("Show Raw SSE Events");
    fireEvent.click(await within(p).findByRole("button", { name: /Primer Design/ }));
    expect(await within(p).findByTestId("custom-primer-failure")).toHaveTextContent("Primer design failed: boom");
  });
});
