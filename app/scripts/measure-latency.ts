// Phase 8 (decisions.md, 2026-09-01). A measured latency experiment, not
// an optimization pass -- the prediction was written and saved BEFORE
// this script existed (see the "Phase 8 prediction" entry). Every sample
// here is a real call against the live pipeline; nothing is estimated.
//
// Usage: npm run measure-latency
import { emptyState, type ConversationState } from "../lib/conversation/types";
import { runTurn } from "../lib/conversation/converse";
import { PIPELINES } from "../lib/pipelines";

// "Volunteer everything upfront" queries -- each reaches the recommend
// turn in exactly one user reply (2 total runTurn calls, the second
// being the only one that compiles a query and generates), so sample
// cost is minimized without changing what's being measured: the
// recommend turn's own stage breakdown is identical regardless of how
// many questions preceded it.
const QUERIES: string[] = [
  "Not sure on face shape. Everyday eyeglasses, budget up to ₹3000.",
  "Skip face shape. Sunglasses for outdoor use, budget up to ₹4000, polarized would be nice.",
  "Not sure. Computer glasses, budget around ₹2500, I stare at screens 8 hours a day.",
  "Skip. Reading glasses, budget up to ₹1500.",
  "Not sure on shape. Eyeglasses for everyday wear, budget between ₹2000 and ₹3500, I don't wear glasses currently.",
  "Skip face shape. Progressive lenses for everyday wear, budget up to ₹5000, I wear glasses, about -3.00.",
  "Not sure. Sports sunglasses, budget up to ₹3000.",
  "Skip. Titanium eyeglasses, budget up to ₹6000, everyday wear.",
  "Not sure on face shape. Rimless eyeglasses, budget up to ₹5000, my prescription is about -2.50.",
  "Skip face shape. Driving sunglasses, budget up to ₹4500, mostly night driving.",
  "Not sure. Formal work eyeglasses, budget up to ₹4000.",
  "Skip. Everyday eyeglasses under ₹2000, my current pair keeps sliding down my nose.",
];

// Deliberately unsatisfiable combinations -- exercises the relaxation-search
// stage, which otherwise never fires in the sample above.
const RELAXATION_QUERIES: string[] = [
  "Not sure on face shape. Polarized sports sunglasses, budget up to ₹2500.",
  "Skip. Progressive-ready rimless eyeglasses, budget up to ₹6000.",
  "Not sure. Titanium eyeglasses, budget up to ₹4000.",
];

interface Sample {
  extraction?: number;
  sqlQuery?: number;
  adviceEmbedding?: number;
  adviceSearch?: number;
  relaxationSearch?: number;
  generation?: number;
  generationTTFT?: number;
  total: number;
}

async function runOnce(query: string, opts: { measureTTFT?: boolean; parallelizeRetrieval?: boolean } = {}): Promise<Sample> {
  let state: ConversationState = emptyState();
  state = (await runTurn(state, undefined)).state;
  const result = await runTurn(state, query, opts.measureTTFT, opts.parallelizeRetrieval);
  const last = result.state.history[result.state.history.length - 1];
  return { ...last.timingsMs };
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function report(label: string, values: number[]) {
  if (values.length === 0) {
    console.log(`  ${label}: (no samples)`);
    return;
  }
  const p50 = percentile(values, 50);
  const p95 = percentile(values, 95);
  const mean = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  console.log(`  ${label}: p50=${p50}ms  p95=${p95}ms  mean=${mean}ms  n=${values.length}`);
}

async function main() {
  console.log("=== 8b: per-stage p50/p95, main sample (sequential, non-streaming -- default production path) ===\n");
  const samples: Sample[] = [];
  for (const q of QUERIES) {
    console.log(`  running: ${q.slice(0, 60)}...`);
    samples.push(await runOnce(q));
  }
  report("extraction", samples.map((s) => s.extraction).filter((x): x is number => x !== undefined));
  report("sqlQuery", samples.map((s) => s.sqlQuery).filter((x): x is number => x !== undefined));
  report("adviceEmbedding", samples.map((s) => s.adviceEmbedding).filter((x): x is number => x !== undefined));
  report("adviceSearch", samples.map((s) => s.adviceSearch).filter((x): x is number => x !== undefined));
  report("generation (total)", samples.map((s) => s.generation).filter((x): x is number => x !== undefined));
  report("TOTAL (whole recommend turn)", samples.map((s) => s.total));

  console.log("\n=== 8b continued: relaxation-search stage (deliberately unsatisfiable queries) ===\n");
  const relaxSamples: Sample[] = [];
  for (const q of RELAXATION_QUERIES) {
    console.log(`  running: ${q.slice(0, 60)}...`);
    relaxSamples.push(await runOnce(q));
  }
  report("sqlQuery (non-relaxed portion)", relaxSamples.map((s) => s.sqlQuery).filter((x): x is number => x !== undefined));
  report("relaxationSearch", relaxSamples.map((s) => s.relaxationSearch).filter((x): x is number => x !== undefined));
  const firedCount = relaxSamples.filter((s) => s.relaxationSearch !== undefined).length;
  console.log(`  (relaxation fired on ${firedCount}/${relaxSamples.length} of these deliberately-tight queries)`);

  console.log("\n=== 8b continued: generation time-to-first-token vs total (streaming variant) ===\n");
  const ttftSamples: Sample[] = [];
  for (const q of QUERIES.slice(0, 8)) {
    console.log(`  running (streaming): ${q.slice(0, 60)}...`);
    ttftSamples.push(await runOnce(q, { measureTTFT: true }));
  }
  report("generation TTFT", ttftSamples.map((s) => s.generationTTFT).filter((x): x is number => x !== undefined));
  report("generation total (streaming call)", ttftSamples.map((s) => s.generation).filter((x): x is number => x !== undefined));

  console.log("\n=== 8c: parallelize SQL + advice retrieval, before/after, same queries ===\n");
  const seqSamples: Sample[] = [];
  const parSamples: Sample[] = [];
  for (const q of QUERIES.slice(0, 8)) {
    seqSamples.push(await runOnce(q, { parallelizeRetrieval: false }));
    parSamples.push(await runOnce(q, { parallelizeRetrieval: true }));
  }
  report("TOTAL, sequential (before)", seqSamples.map((s) => s.total));
  report("TOTAL, parallel (after)", parSamples.map((s) => s.total));
  const seqCriticalPath = seqSamples.map((s) => (s.sqlQuery ?? 0) + (s.adviceEmbedding ?? 0) + (s.adviceSearch ?? 0));
  const parCriticalPath = parSamples.map((s) => Math.max((s.sqlQuery ?? 0), (s.adviceEmbedding ?? 0) + (s.adviceSearch ?? 0)));
  report("retrieval critical path, sequential (sql+embed+search summed)", seqCriticalPath);
  report("retrieval critical path, parallel (max of the two halves)", parCriticalPath);

  console.log("\n=== 8d: hybrid (this pipeline) vs naive baseline, wall-clock ===\n");
  const hybridTotals: number[] = [];
  const naiveTotals: number[] = [];
  for (const q of QUERIES.slice(0, 6)) {
    const hStart = Date.now();
    await PIPELINES["hybrid"](q);
    hybridTotals.push(Date.now() - hStart);

    const nStart = Date.now();
    await PIPELINES["naive"](q);
    naiveTotals.push(Date.now() - nStart);
  }
  report("hybrid pipeline, total wall time", hybridTotals);
  report("naive pipeline, total wall time", naiveTotals);

  console.log("\n=== Query-embedding cacheability check ===\n");
  const { getAdviceEmbeddingModel } = await import("../lib/advice-retrieval");
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI();
  const text = "Does my skin tone matter for choosing metal color?";
  const r1 = await client.embeddings.create({ model: getAdviceEmbeddingModel(), input: text });
  const r2 = await client.embeddings.create({ model: getAdviceEmbeddingModel(), input: text });
  const v1 = r1.data[0].embedding;
  const v2 = r2.data[0].embedding;
  const identical = v1.length === v2.length && v1.every((x, i) => x === v2[i]);
  console.log(`  same input text, two separate API calls -- vectors bit-identical: ${identical}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
