import fs from "node:fs";
import path from "node:path";
import { cosineSimilarity } from "./cosine";

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

export function getAllFrames(): CatalogFrame[] {
  return Array.from(loadStore().catalog.values());
}

export function getFrameBySku(sku: string): CatalogFrame | undefined {
  return getAllFrames().find((f) => f.sku === sku);
}

export function getFrameById(frameId: string): CatalogFrame | undefined {
  return loadStore().catalog.get(frameId);
}

/** Same blurb text the naive pipeline embeds, reused by the hybrid pipeline so both describe frames to the LLM identically -- any difference in outcome is attributable to which frames were selected, not how they're described. */
export function getBlurb(frameId: string): string {
  return loadStore().blurbs.get(frameId) ?? "";
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
