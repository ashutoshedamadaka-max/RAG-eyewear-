import fs from "node:fs";
import path from "node:path";

export interface CatalogFrame {
  frame_id: string;
  brand: string;
  model: string;
  product_type: string;
  material: string;
  price_frame_only: number;
  currency: string;
  in_stock: boolean;
  stock_qty: number;
  [key: string]: unknown;
}

interface StoredEmbedding {
  frame_id: string;
  embedding: number[];
}

let cache:
  | {
      catalog: Map<string, CatalogFrame>;
      blurbs: Map<string, string>;
      embeddings: StoredEmbedding[];
      model: string;
    }
  | undefined;

function loadStore() {
  if (cache) return cache;

  const root = path.resolve(process.cwd(), "..");
  const outDir = path.join(root, "data", "catalog", "out");

  const catalogRows: CatalogFrame[] = JSON.parse(
    fs.readFileSync(path.join(outDir, "catalog.json"), "utf-8")
  );
  const blurbRows: { frame_id: string; text: string }[] = JSON.parse(
    fs.readFileSync(path.join(outDir, "blurbs.json"), "utf-8")
  );
  const { model, embeddings }: { model: string; embeddings: StoredEmbedding[] } =
    JSON.parse(fs.readFileSync(path.join(outDir, "embeddings.json"), "utf-8"));

  cache = {
    catalog: new Map(catalogRows.map((f) => [f.frame_id, f])),
    blurbs: new Map(blurbRows.map((b) => [b.frame_id, b.text])),
    embeddings,
    model,
  };
  return cache;
}

export function getEmbeddingModel(): string {
  return loadStore().model;
}

function cosineSimilarity(a: number[], b: number[]): number {
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

export interface RetrievedHit {
  frame_id: string;
  score: number;
  text: string;
  frame: CatalogFrame;
}

// Naive: brute-force cosine similarity over every row, no metadata
// pre-filtering, no reranking. Top-k only.
export function retrieveTopK(queryEmbedding: number[], k = 5): RetrievedHit[] {
  const store = loadStore();

  const scored = store.embeddings.map(({ frame_id, embedding }) => ({
    frame_id,
    score: cosineSimilarity(queryEmbedding, embedding),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, k).map(({ frame_id, score }) => ({
    frame_id,
    score,
    text: store.blurbs.get(frame_id) ?? "",
    frame: store.catalog.get(frame_id)!,
  }));
}
