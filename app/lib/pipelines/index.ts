import { runNaivePipeline } from "./naive";
import { runHybridPipeline } from "./hybrid";
import type { PipelineFn } from "./types";

// Both pipelines conform to PipelineFn so the API route and the eval
// harness (app/scripts/run-eval.ts) can run either behind the same
// `pipeline` flag/parameter -- the whole point of Phase 3's A/B.
export const PIPELINES: Record<string, PipelineFn> = {
  naive: runNaivePipeline,
  hybrid: runHybridPipeline,
};

export * from "./types";
