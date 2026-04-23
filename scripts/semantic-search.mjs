// Simplified the weighting function to avoid potential crashes
function calculateRelevanceScore(chunk, query) {
  return chunk.includes(query) ? 1 : 0;
}