import type { CatalogFrame } from "../retrieval";

// Shared shape across pipelines so the API route and the eval harness
// (app/scripts/run-eval.ts) can treat "naive" and "hybrid" identically --
// the only thing that should differ between them is how `retrieved` was
// produced (cosine similarity vs. SQL), not the interface.
export interface PipelineHit {
  frame_id: string;
  /** Cosine similarity score. Only set by the naive pipeline -- SQL results aren't ranked by a score. */
  score?: number;
  text: string;
  frame: CatalogFrame;
}

export interface PipelineResult {
  pipeline: string;
  query: string;
  chatModel: string;
  temperature: number;
  systemPrompt: string;
  answer: string;
  retrieved: PipelineHit[];
  /** Pipeline-specific detail worth surfacing (e.g. the compiled SQL, whether the relaxation ladder fired). */
  meta?: Record<string, unknown>;
}

export type PipelineFn = (query: string) => Promise<PipelineResult>;
