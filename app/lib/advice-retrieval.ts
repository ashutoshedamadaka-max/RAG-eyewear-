// Phase 4: retrieval over the advice corpus only. This is the RAG half of
// PROJECT_CONTEXT.md §1's hybrid architecture -- deliberately the mirror
// image of app/lib/retrieval.ts (catalog blurbs, Phase 1) applied to
// documents instead of frames. The catalog is never embedded (app/lib/catalog-db.ts,
// Phase 3, handles it with SQL); this module is never asked to answer a
// numeric or categorical filter question, only "what does the advice say."
import fs from "node:fs";
import path from "node:path";
import { cosineSimilarity } from "./cosine";

export interface AdviceChunk {
  chunk_id: string;
  doc_id: string;
  doc_title: string;
  section_heading: string;
  text: string;
  claim_type: "physical" | "convention";
  source_org: string;
  source_document: string;
  source_url: string;
  source_url_secondary?: string;
  source_url_note?: string;
  verified: string;
  verification_method: string;
}

interface StoredEmbedding {
  chunk_id: string;
  embedding: number[];
}

let cache:
  | {
      chunks: Map<string, AdviceChunk>;
      embeddings: StoredEmbedding[];
      model: string;
    }
  | undefined;

function loadStore() {
  if (cache) return cache;

  const root = path.resolve(process.cwd(), "..");
  const outDir = path.join(root, "data", "advice", "out");

  const chunkRows: AdviceChunk[] = JSON.parse(
    fs.readFileSync(path.join(outDir, "chunks.json"), "utf-8")
  );
  const { model, embeddings }: { model: string; embeddings: StoredEmbedding[] } = JSON.parse(
    fs.readFileSync(path.join(outDir, "embeddings.json"), "utf-8")
  );

  cache = {
    chunks: new Map(chunkRows.map((c) => [c.chunk_id, c])),
    embeddings,
    model,
  };
  return cache;
}

export function getAdviceEmbeddingModel(): string {
  return loadStore().model;
}

export function getAllAdviceChunks(): AdviceChunk[] {
  return Array.from(loadStore().chunks.values());
}

export function getAdviceChunkById(chunkId: string): AdviceChunk | undefined {
  return loadStore().chunks.get(chunkId);
}

export interface AdviceHit {
  chunk_id: string;
  score: number;
  chunk: AdviceChunk;
}

/**
 * Brute-force cosine similarity over every chunk. No metadata
 * pre-filtering by claim_type here -- `opinion` never made it into the
 * index at all (app/scripts/build-advice-chunks.ts), so there's nothing
 * left to filter at retrieval time; `physical` vs `convention` differ in
 * how the generation step is instructed to use them (register, authority
 * -- PROJECT_CONTEXT.md §3), not in whether they're retrievable.
 */
export function retrieveAdviceTopK(queryEmbedding: number[], k = 4): AdviceHit[] {
  const store = loadStore();

  const scored = store.embeddings.map(({ chunk_id, embedding }) => ({
    chunk_id,
    score: cosineSimilarity(queryEmbedding, embedding),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, k).map(({ chunk_id, score }) => ({
    chunk_id,
    score,
    chunk: store.chunks.get(chunk_id)!,
  }));
}
