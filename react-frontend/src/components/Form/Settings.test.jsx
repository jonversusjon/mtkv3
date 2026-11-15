import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import Settings from "./Settings";

describe("Settings species selector", () => {
  const species = ["homo_sapiens", "mus_musculus"];

  it("lists exactly the species provided by the backend", () => {
    render(
      <Settings show onClose={vi.fn()} updateField={vi.fn()}
        formData={{ species: "homo_sapiens" }} availableSpecies={species} />
    );
    const select = screen.getByLabelText(/species/i);
    expect(Array.from(select.options).map((o) => o.value)).toEqual(species);
    expect(select.value).toBe("homo_sapiens");
  });

  it("reports a species change through updateField", () => {
    const updateField = vi.fn();
    render(
      <Settings show onClose={vi.fn()} updateField={updateField}
        formData={{ species: "homo_sapiens" }} availableSpecies={species} />
    );
    fireEvent.change(screen.getByLabelText(/species/i), { target: { value: "mus_musculus" } });
    expect(updateField).toHaveBeenCalledWith("species", "mus_musculus");
  });

  it("renders nothing when hidden", () => {
    const { container } = render(
      <Settings show={false} onClose={vi.fn()} updateField={vi.fn()} availableSpecies={species} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
