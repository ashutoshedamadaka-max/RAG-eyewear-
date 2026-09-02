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
  /** Most sources are fetchable vendor/CE PDFs and have this. Privately-shared, non-URL sources (e.g. a Google Doc) have source_provenance instead. */
  source_url?: string;
  source_url_secondary?: string;
  source_url_note?: string;
  /** e.g. "Authored guide, not an interview transcript" -- how the source was produced, when that's not obvious from a URL. */
  source_type?: string;
  /** How a non-URL source reached this repo (who shared it, when, how) -- present in place of source_url when there isn't one. */
  source_provenance?: string;
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

  // Deployment fix (decisions.md, 2026-09-02): see the matching comment in
  // app/lib/retrieval.ts -- reads app/data (a build-time copy), never the
  // repo-root data directly, to avoid the Turbopack/outputFileTracingRoot
  // monorepo bug (vercel/next.js#88579).
  const outDir = path.resolve(process.cwd(), "data", "advice", "out");

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
 *
 * MIN_ADVICE_SCORE (2026-09-01, decisions.md): a real similarity floor,
 * calibrated against live conversation transcripts, not picked in the
 * abstract. A single-vision, no-progressive customer's query retrieved
 * progressive-fitting-height content at 0.187-0.199; a genuinely relevant
 * face-shape/complexion query retrieved its top hits at 0.256-0.465. This
 * is Phase 4's own "watch for a flattering result" caveat arriving as
 * predicted: the corpus is lens-technical-heavy (progressive fitting
 * height alone spans 5 of the ~8 source documents), so lens-technical
 * content weakly matches almost any query regardless of topic, and always
 * being in the top-k regardless of relevance was never itself evidence
 * retrieval was working. 0.25 sits in the real gap observed between the
 * two clusters above -- correctly dropped every irrelevant hit from the
 * transcripts that motivated this, correctly kept every relevant one.
 */
export const MIN_ADVICE_SCORE = 0.25;

export function retrieveAdviceTopK(queryEmbedding: number[], k = 4): AdviceHit[] {
  return retrieveAdviceTopKWithNearMisses(queryEmbedding, k).hits;
}

export interface AdviceRetrievalResult {
  hits: AdviceHit[];
  /**
   * Interface work (2026-09-01, decisions.md): the machinery panel's
   * "retrieved optician guidance" stage needs to show what the 0.25 floor
   * actually excluded, not just what passed it, or the floor is asserted
   * rather than demonstrated. Takes the top `k + nearMissBuffer` chunks by
   * RAW score (floor not yet applied), then whichever of those fall below
   * the floor are reported here -- a bounded, meaningful "almost made it"
   * set, not every chunk in the corpus that scored low (nearly all of
   * them, for any query, which would be noise not signal).
   */
  nearMisses: AdviceHit[];
}

const NEAR_MISS_BUFFER = 4;

export function retrieveAdviceTopKWithNearMisses(queryEmbedding: number[], k = 4): AdviceRetrievalResult {
  const store = loadStore();

  const scored = store.embeddings.map(({ chunk_id, embedding }) => ({
    chunk_id,
    score: cosineSimilarity(queryEmbedding, embedding),
  }));

  scored.sort((a, b) => b.score - a.score);

  const candidatePool = scored.slice(0, k + NEAR_MISS_BUFFER);
  const toHit = ({ chunk_id, score }: { chunk_id: string; score: number }): AdviceHit => ({
    chunk_id,
    score,
    chunk: store.chunks.get(chunk_id)!,
  });

  const hits = candidatePool.filter(({ score }) => score >= MIN_ADVICE_SCORE).slice(0, k).map(toHit);
  const nearMisses = candidatePool.filter(({ score }) => score < MIN_ADVICE_SCORE).map(toHit);

  return { hits, nearMisses };
}
