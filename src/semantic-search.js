diff --git a/src/semantic-search.js b/src/semantic-search.js
index abcdef1..2345678 100644
--- a/src/semantic-search.js
+++ b/src/semantic-search.js
@@ -123,7 +123,7 @@ function calculateRelevanceScore(chunk) {
   return score;
 }
 
-function setThreshold(value) {
+function setThreshold(value = 0.5) {
   threshold = value;
 }
