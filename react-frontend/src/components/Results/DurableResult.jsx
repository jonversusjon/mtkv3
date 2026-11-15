// Results/DurableResult.jsx
// Readable summary of the authoritative stored result for one sequence.  It is
// rendered from the job record itself, so it never depends on which progress
// events happened to be received or recovered.
import React from "react";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const hasContent = (v) =>
  isObj(v) ? Object.keys(v).length > 0 : Array.isArray(v) ? v.length > 0 : v != null && v !== "";

const Field = ({ label, children, testId }) => (
  <div className="mb-2" data-testid={testId}>
    <div className="text-sm font-medium text-gray-600 dark:text-gray-300">{label}</div>
    <div className="text-sm">{children}</div>
  </div>
);

const DurableResult = ({ result }) => {
  const present = hasContent(result);
  const r = isObj(result) ? result : {};
  const sites = Array.isArray(r.restrictionSites) ? r.restrictionSites : [];
  const processed = typeof r.processedSequence === "string" ? r.processedSequence : "";
  const mutationCount = Array.isArray(r.mutationOptions) ? r.mutationOptions.length : null;
  const errors = isObj(r.errors) ? Object.values(r.errors) : r.errors ? [String(r.errors)] : [];

  return (
    <div data-testid="durable-result" className="mb-4 p-3 border rounded">
      <h3 className="font-medium mb-2">Result</h3>
      {!present && (
        <p data-testid="durable-result-empty">No result data was stored for this sequence.</p>
      )}
      {present && (
        <>
          {processed && (
            <Field label={`Processed DNA (${processed.length} bp)`} testId="durable-processed-dna">
              <code className="break-all">{processed}</code>
            </Field>
          )}
          {(r.mtkPartLeft || r.mtkPartRight) && (
            <Field label="MTK parts">
              Left {r.mtkPartLeft || "—"} / Right {r.mtkPartRight || "—"}
            </Field>
          )}
          {Array.isArray(r.restrictionSites) && (
            <Field label={`Restriction sites (${sites.length})`} testId="durable-restriction-sites">
              {sites.length === 0 ? (
                "None found"
              ) : (
                <ul className="list-disc ml-5">
                  {sites.map((s, i) => (
                    <li key={i}>
                      {s.enzyme} · recognition {s.recognitionSeq} · position {s.position} · frame{" "}
                      {s.frame} · strand {s.strand}
                    </li>
                  ))}
                </ul>
              )}
            </Field>
          )}
          {mutationCount !== null && (
            <Field label="Alternative codon options">{mutationCount}</Field>
          )}
          {errors.length > 0 && (
            <Field label="Notes">
              <ul className="list-disc ml-5">
                {errors.map((e, i) => (
                  <li key={i}>{String(e)}</li>
                ))}
              </ul>
            </Field>
          )}
          <details className="mt-2">
            <summary className="text-sm cursor-pointer">Technical details (raw stored result)</summary>
            <pre className="overflow-x-auto text-xs p-2 border rounded">
              {JSON.stringify(result, null, 2)}
            </pre>
          </details>
        </>
      )}
    </div>
  );
};

export default DurableResult;
