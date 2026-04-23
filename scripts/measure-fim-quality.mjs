diff --git a/scripts/measure-fim-quality.mjs b/scripts/measure-fim-quality.mjs
index abcdefg..hijklmn 100644
--- a/scripts/measure-fim-quality.mjs
+++ b/scripts/measure-fim-quality.mjs
@@ -23,7 +23,7 @@ function calculateRelevanceScore(chunk) {
   return Math.exp(-distance);
 }
 
-const relevanceThreshold = 0.5;
+const relevanceThreshold = 0.49;
 
 function isChunkRelevant(chunk) {
   return calculateRelevanceScore(chunk) < relevanceThreshold;
}