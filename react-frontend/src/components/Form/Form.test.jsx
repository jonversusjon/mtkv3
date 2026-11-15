import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import Form from "./Form";

const baseForm = (overrides = {}) => ({
  templateSequence: "",
  sequencesToDomesticate: [
    { sequence: "ATGAAA", primerName: "p1", mtkPartLeft: "", mtkPartRight: "" },
  ],
  availableSpecies: ["homo_sapiens", "mus_musculus"],
  species: "",
  ...overrides,
});

const renderForm = (formData, props = {}) => {
  const onSubmit = vi.fn();
  render(
    <Form
      onSubmit={onSubmit}
      formData={formData}
      updateFields={vi.fn()}
      errors={{}}
      isValid={true}
      initialized={true}
      activeTabIndex={0}
      setActiveTabIndex={vi.fn()}
      {...props}
    />
  );
  return onSubmit;
};

describe("Form species handling on submit", () => {
  it("falls back to the first available species when none is selected", () => {
    const onSubmit = renderForm(baseForm());
    fireEvent.click(screen.getByRole("button", { name: /generate protocol/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][1].species).toBe("homo_sapiens");
  });

  it("keeps an explicitly selected species", () => {
    const onSubmit = renderForm(baseForm({ species: "mus_musculus" }));
    fireEvent.click(screen.getByRole("button", { name: /generate protocol/i }));
    expect(onSubmit.mock.calls[0][1].species).toBe("mus_musculus");
  });

  it("does not submit while the form is invalid", () => {
    const onSubmit = renderForm(baseForm(), { isValid: false });
    expect(screen.getByRole("button", { name: /generate protocol/i })).toBeDisabled();
    fireEvent.submit(document.getElementById("primer-form"));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
