// Plain .js: no JSX, so it does not depend on a JSX transform for .js files.
import { createElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import App from "./App";

describe("App shell", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn((url) => {
        const body = String(url).endsWith("/api/species") ? { species: [] } : {};
        return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
      })
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("mounts the router and renders the form route without crashing", async () => {
    const { container } = render(createElement(App));
    await waitFor(() => expect(container.querySelector("form, input, select, button")).not.toBeNull());
    expect(screen.queryByText(/learn react/i)).not.toBeInTheDocument();
  });

  it("requests the species list from the backend API on the form route", async () => {
    render(createElement(App));
    await waitFor(() =>
      expect(fetch.mock.calls.some(([u]) => String(u).endsWith("/api/species"))).toBe(true)
    );
  });
});
