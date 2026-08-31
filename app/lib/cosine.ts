// Shared by app/lib/retrieval.ts (catalog blurbs, Phase 1) and
// app/lib/advice-retrieval.ts (advice chunks, Phase 4) -- same brute-force
// cosine similarity, same "100/dozens of rows doesn't need a vector
// database" judgment call in both places.
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
