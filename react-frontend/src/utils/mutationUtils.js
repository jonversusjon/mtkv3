export const groupUniqueCodons = (site) => {
  const groups = {};
  site.mutations.forEach((mutation, mIndex) => {
    mutation.mutCodons?.forEach((mutCodon) => {
      const codon = mutCodon.codon;
      if (codon.contextPosition === undefined) return;
      const groupKey = `Position ${codon.contextPosition}`;
      groups[groupKey] = groups[groupKey] || {};
      const seq = codon.codonSequence;
      if (!groups[groupKey][seq]) {
        groups[groupKey][seq] = {
          codon,
          mutationIndices: [mIndex],
          isRecommended:
            site.recommendedMutations?.[site.siteKey]?.codon_sequence === seq,
        };
      } else {
        groups[groupKey][seq].mutationIndices.push(mIndex);
      }
    });
  });
  return groups;
};

export const getOriginalCodon = (site, position) => {
  if (
    !site.originalSequence ||
    position === undefined ||
    position < 0 ||
    position + 2 >= site.originalSequence.length
  ) {
    return null;
  }
  return site.originalSequence.substring(position, position + 3);
};

export const getRecognitionSiteSequence = (mutation) => {
  if (!mutation.contextRsIndices || !mutation.nativeContext) return null;
  const startIdx = Math.min(...mutation.contextRsIndices);
  const endIdx = Math.max(...mutation.contextRsIndices) + 1;
  return {
    original: mutation.nativeContext.substring(startIdx, endIdx),
    mutated: mutation.mutContext?.substring(startIdx, endIdx),
  };
};

export const processMutationOptions = (stepSseData, recommendedMutations) => {
  const mutationOptionsData =
    stepSseData.mutationOptions || stepSseData.mutation_options || {};
  return Object.entries(mutationOptionsData).map(([siteKey, mutations]) => {
    const firstMutation = mutations?.[0] || {};
    return {
      siteKey,
      mutations,
      contextSequence: firstMutation.mutContext || null,
      originalSequence: firstMutation.nativeContext || null,
      recommendedMutations,
    };
  });
};

export const initializeSelections = (sitesData) => {
  const codonOptions = {};
  sitesData.forEach((site) => {
    const groups = groupUniqueCodons(site);
    const sortedGroupKeys = Object.keys(groups).sort((a, b) => {
      const posA = parseInt(a.replace("Position ", ""), 10);
      const posB = parseInt(b.replace("Position ", ""), 10);
      return posA - posB;
    });
    const firstGroupKey = sortedGroupKeys[0];
    if (firstGroupKey && groups[firstGroupKey]) {
      codonOptions[site.siteKey] = `${firstGroupKey}:0`;
    }
  });
  return codonOptions;
};
