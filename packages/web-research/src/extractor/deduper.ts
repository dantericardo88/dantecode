/**
 * Fuzzy/Semantic deduplicator for search results and extracted facts.
 */
export class SemanticDeduper {
  /**
   * Deduplicates a list of strings using simple Jaccard similarity.
   */
  dedupe(items: string[], threshold = 0.8): string[] {
    const unique: string[] = [];
    
    for (const item of items) {
      const isDuplicate = unique.some(existing => 
        this.similarity(item, existing) >= threshold
      );
      
      if (!isDuplicate) {
        unique.push(item);
      }
    }
    
    return unique;
  }

  private similarity(s1: string, s2: string): number {
    const set1 = new Set(s1.toLowerCase().split(/\W+/).filter(w => w.length > 2));
    const set2 = new Set(s2.toLowerCase().split(/\W+/).filter(w => w.length > 2));
    
    if (set1.size === 0 || set2.size === 0) return 0;
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  }
}
