import { render, screen, waitFor } from "@testing-library/react";
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
