import React from "react";

/**
 * EnhancedSequenceViewer component
 *
 * A reusable component that visualizes DNA sequences with mutations,
 * highlighting codon changes, restriction sites, and providing copy functionality.
 *
 * @param {Object} props Component props
 * @param {string} props.originalSequence - The original DNA sequence
 * @param {string} props.mutatedSequence - The mutated DNA sequence (optional)
 * @param {Array} props.highlightIndices - Array of indices to highlight (like restriction site positions)
 * @param {Object} props.codonChanges - Object describing codon changes {position, originalCodon, newCodon}
 * @param {Function} props.copyToClipboard - Function to copy text to clipboard
 * @param {Object} props.copiedStates - Object tracking copy button states
 * @param {string} props.sequenceId - Unique identifier for this sequence (for copy state tracking)
 * @param {Object} props.site - The restriction site object containing mutation data
 * @param {Object} props.selectedMutation - The currently selected mutation for this site
 * @param {Object} props.selectedCodonOption - Object mapping site keys to selected codon options
 */
const EnhancedSequenceViewer = ({
  originalSequence,
  mutatedSequence,
  // highlightIndices = [],
  codonChanges = null,
  copyToClipboard,
  copiedStates = {},
  sequenceId = "seq",
  site,
  selectedMutation,
  selectedCodonOption,
}) => {
  if (!originalSequence) return null;

  const substitutionRow = new Array(originalSequence.length).fill(" ");
  const underlineRow = new Array(originalSequence.length).fill(" ");
  const originalRow = originalSequence.split("");

  // Process mutation data to find codon options
  const groupsObj = {};
  if (site && site.mutations) {
    site.mutations.forEach((mutation, mIndex) => {
      if (mutation.mutCodons) {
        mutation.mutCodons.forEach((mutCodon) => {
          const codon = mutCodon.codon;
          if (codon.contextPosition === undefined) return;
          const groupKey = `Position ${codon.contextPosition}`;
          if (!groupsObj[groupKey]) {
            groupsObj[groupKey] = {};
          }
          const seq = codon.codonSequence;
          if (!groupsObj[groupKey][seq]) {
            groupsObj[groupKey][seq] = { codon, mutationIndices: [mIndex] };
          } else {
            groupsObj[groupKey][seq].mutationIndices.push(mIndex);
          }
        });
      }
    });
  }

  // Flatten the groups into an array with headers
  const flatOptions = [];
  Object.keys(groupsObj)
    .sort((a, b) => {
      const posA = parseInt(a.replace("Position ", ""));
      const posB = parseInt(b.replace("Position ", ""));
      return posA - posB;
    })
    .forEach((groupKey) => {
      const options = Object.values(groupsObj[groupKey]).sort((a, b) =>
        a.codon.codonSequence.localeCompare(b.codon.codonSequence)
      );
      // Extract the amino acid from the first option in the group.
      const aminoAcid = options[0]?.codon?.aminoAcid;
      flatOptions.push({ header: groupKey, aminoAcid });
      options.forEach((option, index) => {
        flatOptions.push({
          compositeKey: `${groupKey}:${index}`,
          ...option,
          group: groupKey,
          optionIndex: index,
        });
      });
    });

  // Find the codon to use for substitution visualization
  let codonForSubstitution;
  if (site && selectedCodonOption && selectedMutation) {
    const selectedOptionCompositeKey = selectedCodonOption[site.siteKey];
    if (selectedOptionCompositeKey) {
      const selectedOption = flatOptions.find(
        (opt) => opt.compositeKey === selectedOptionCompositeKey
      );
      if (selectedOption) {
        codonForSubstitution = selectedOption.codon;
      }
    }
    if (
      !codonForSubstitution &&
      selectedMutation.mutCodons &&
      selectedMutation.mutCodons.length > 0
    ) {
      codonForSubstitution = selectedMutation.mutCodons[0].codon;
    }
  } else if (codonChanges) {
    // Use the codonChanges prop if site data isn't provided
    codonForSubstitution = {
      contextPosition: codonChanges.position,
      codonSequence: codonChanges.newCodon,
    };
  }

  // Apply codon substitution to the visualization
  if (
    codonForSubstitution &&
    codonForSubstitution.contextPosition !== undefined
  ) {
    const start = codonForSubstitution.contextPosition;
    for (let i = 0; i < 3; i++) {
      if (start + i < substitutionRow.length) {
        substitutionRow[start + i] = codonForSubstitution.codonSequence[i];
        underlineRow[start + i] = "‾";
      }
    }
  }

  // Prepare IDs for copy buttons
  const originalId = site
    ? `original-${site.siteKey}`
    : `original-${sequenceId}`;
  const mutatedId = site ? `mutated-${site.siteKey}` : `mutated-${sequenceId}`;

  // If no mutatedSequence is provided, derive it from original + substitutions
  const derivedMutatedSequence = originalRow
    .map((char, i) => (substitutionRow[i] !== " " ? substitutionRow[i] : char))
    .join("");

  const effectiveMutatedSequence = mutatedSequence || derivedMutatedSequence;

  return (
    <div className="mb-3 border rounded-md">
      <div className="font-medium px-2 py-1 flex justify-between items-center dark:text-gray-200">
        <span className="m-2">Context Sequence:</span>
        <div className="flex space-x-2">
          <button
            className="text-xs text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 px-2 py-1 rounded-sm border border-gray-300 dark:border-gray-600"
            onClick={() => copyToClipboard(originalSequence, originalId)}
          >
            {copiedStates[originalId] ? "Copied!" : "Copy Original"}
          </button>
          <button
            className="text-xs text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 px-2 py-1 rounded-sm border border-gray-300 dark:border-gray-600"
            onClick={() => copyToClipboard(effectiveMutatedSequence, mutatedId)}
          >
            {copiedStates[mutatedId] ? "Copied!" : "Copy Mutated"}
          </button>
        </div>
      </div>
      <div className="relative">
        {/* Substitution row shifted by half a letter height upward */}
        <pre className="relative font-mono text-lg text-white text-center whitespace-pre">
          {substitutionRow.map((char, i) => (
            <span
              key={`sub-${i}`}
              className={char !== " " ? "text-green-400 font-semibold" : ""}
            >
              {char}
            </span>
          ))}
        </pre>
        <pre className="font-mono text-lg text-white text-center whitespace-pre">
          {originalRow.map((char, i) => (
            <span key={`orig-${i}`} className="text-gray-200">
              {char}
            </span>
          ))}
        </pre>
        <pre className="relative h-6px font-mono text-lg text-white text-center whitespace-pre -mt-2">
          {underlineRow.map((char, i) => (
            <span key={`under-${i}`} className="text-red-400 font-extrabold">
              {char === " " ? " " : char}
            </span>
          ))}
        </pre>
      </div>
    </div>
  );
};

export default EnhancedSequenceViewer;
