import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import FormPage from "./FormPage";

const json = (body, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) });

describe("FormPage species integration with the backend API", () => {
  let calls;
  beforeEach(() => {
    sessionStorage.clear();
    calls = [];
  });
  afterEach(() => vi.unstubAllGlobals());

  const stubBackend = ({ dummy, species }) =>
    vi.stubGlobal("fetch", vi.fn((url) => {
      calls.push(String(url));
      if (String(url).endsWith("/api/species")) return json({ species });
      if (String(url).endsWith("/api/dummy")) return json(dummy);
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    }));

  const renderPage = () =>
    render(
      <MemoryRouter>
        <FormPage showSettings={false} setShowSettings={vi.fn()} setResults={vi.fn()} />
      </MemoryRouter>
    );

  it("requests /api/species and loads the form once data arrives", async () => {
    stubBackend({ dummy: {}, species: ["homo_sapiens", "mus_musculus"] });
    renderPage();
    await waitFor(() => expect(screen.getByText(/primer design form/i)).toBeInTheDocument());
    expect(calls.some((u) => u.endsWith("/api/species"))).toBe(true);
    expect(calls.some((u) => u.endsWith("/api/dummy"))).toBe(true);
  });

  it("shows an error instead of a blank form when the species endpoint fails", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network down"))));
    renderPage();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/could not load initial form data/i));
  });
});

describe("FormPage submission", () => {
  const SEQ = "ATGACC".repeat(20); // 120 bp, in frame
  const dummy = {
    species: "homo_sapiens",
    sequencesToDomesticate: [{ sequence: SEQ, primerName: "p1", mtkPartLeft: "5", mtkPartRight: "5" }],
  };
  let submitReply;
  let posted;

  beforeEach(() => {
    sessionStorage.clear();
    posted = [];
    vi.stubGlobal("fetch", vi.fn((url, opts) => {
      const u = String(url);
      if (u.endsWith("/api/species")) return json({ species: ["homo_sapiens"] });
      if (u.endsWith("/api/dummy")) return json(dummy);
      if (u.endsWith("/api/generate_protocol")) {
        posted.push(JSON.parse(opts.body));
        return submitReply();
      }
      return Promise.reject(new Error(`unexpected fetch ${u}`));
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const submit = async (setResults = vi.fn()) => {
    render(
      <MemoryRouter>
        <FormPage showSettings={false} setShowSettings={vi.fn()} setResults={setResults} />
      </MemoryRouter>
    );
    const button = await screen.findByRole("button", { name: /submit|generate|design|run/i });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
  };

  it("shows the server's validation message instead of failing silently", async () => {
    submitReply = () => json({ error: "Invalid input: Unknown species 'x'" }, false);
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid input: Unknown species 'x'");
    expect(sessionStorage.getItem("jobId")).toBeNull();
  });

  it("keeps the server-issued job id and drops the previous submission's cached events", async () => {
    sessionStorage.setItem("sseEvents_OLD_0", "[{}]");
    submitReply = () => json({ job_id: "server-job-7", task_id: "t" }, true);
    const setResults = vi.fn();
    await submit(setResults);
    await waitFor(() => expect(sessionStorage.getItem("jobId")).toBe("server-job-7"));
    expect(sessionStorage.getItem("sseEvents_OLD_0")).toBeNull();
    expect(posted[0].jobId).toBeUndefined(); // the browser no longer invents the identity
    expect(setResults).toHaveBeenCalled();
  });

  it.each(["1", "2", "3"])("choosing %s in the settings selector posts that canonical limit", async (choice) => {
    submitReply = () => json({ job_id: "srv", task_id: "t" }, true);
    render(
      <MemoryRouter>
        <FormPage showSettings={true} setShowSettings={vi.fn()} setResults={vi.fn()} />
      </MemoryRouter>
    );
    const select = await screen.findByLabelText(/max mutations\/site/i);
    // go via another value first so the change is real for every choice, including the default 1
    fireEvent.change(select, { target: { value: choice === "3" ? "2" : "3" } });
    fireEvent.change(select, { target: { value: choice } });
    const button = await screen.findByRole("button", { name: /submit|generate|design|run/i });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].maxMutPerSite).toBe(Number(choice));
  });
});
