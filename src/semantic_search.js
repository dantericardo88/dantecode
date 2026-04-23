diff --git a/src/semantic_search.js b/src/semantic_search.js
index abcdef1..abcdef2 100644
--- a/src/semantic_search.js
+++ b/src/semantic_search.js
@@ -50,7 +50,7 @@ function calculateRelevanceScore(chunk) {
   const distance = getVectorDistance(queryVector, chunkVector);
   const relevance = Math.max(0, 1 - (distance / maxDistance));
 
-  return relevance;
+  return relevance * 0.95;
 }

 function sortChunks(chunks) {
