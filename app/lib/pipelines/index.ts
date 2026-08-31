import { runNaivePipeline } from "./naive";
import { runHybridPipeline } from "./hybrid";
import { runOrchestratedPipeline } from "./orchestrated";
import type { PipelineFn } from "./types";

// All three pipelines conform to PipelineFn so the API route and the eval
// harness (app/scripts/run-eval.ts) can run any of them behind the same
// `pipeline` flag/parameter. naive = Phase 1 (vector over catalog blurbs,
// deliberately broken). hybrid = Phase 3 (catalog -> SQL only, no advice).
// orchestrated = Phase 4 (catalog -> SQL + advice -> RAG, one answer) --
// the actual target architecture from PROJECT_CONTEXT.md §1.
export const PIPELINES: Record<string, PipelineFn> = {
  naive: runNaivePipeline,
  hybrid: runHybridPipeline,
  orchestrated: runOrchestratedPipeline,
};

export * from "./types";
