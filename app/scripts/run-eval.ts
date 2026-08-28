// Phase 2 harness (step 1): runs the golden query cases through a pipeline,
// checks retrieved + recommended frames against hard constraints (no LLM
// judge), and separately checks the two contested thresholds in
// lib/config/thresholds.ts against the catalog directly.
//
// Usage: npm run eval -- --pipeline=naive
import fs from "node:fs";
import path from "node:path";
import { runNaivePipeline } from "../lib/pipelines/naive";
import { getAllFrames, type CatalogFrame } from "../lib/retrieval";
import { checkFrame, describeConstraint, type Constraint, type Violation } from "../lib/constraints";
import { deriveRimTypeConstraint } from "../lib/derivation";

const ROOT = path.resolve(__dirname, "..", "..");
const GOLDEN_PATH = path.join(ROOT, "evals", "golden", "physical.json");
const REPORTS_DIR = path.join(ROOT, "evals", "harness", "reports");

interface QueryCase {
  id: string;
  query: string;
  constraints: Constraint[];
  note?: string;
}

interface CatalogCompositionCase {
  id: string;
  description: string;
  field: string;
  filter: Record<string, unknown>;
  thresholds_mm: number[];
}

interface DerivationFunctionCase {
  id: string;
  description: string;
  function: string;
  rx_power_test_d: number;
  thresholds_d: number[];
}

interface GoldenFile {
  query_cases: QueryCase[];
  catalog_composition_cases: CatalogCompositionCase[];
  derivation_function_cases: DerivationFunctionCase[];
}

function parseArgs() {
  const pipelineArg = process.argv.find((a) => a.startsWith("--pipeline="));
  return { pipeline: pipelineArg ? pipelineArg.split("=")[1] : "naive" };
}

/** SKU mentions first; falls back to "[n]" bracket refs mapped to the nth retrieved hit. */
function extractRecommendedFrames(
  answerText: string,
  retrieved: { frame: CatalogFrame }[]
): CatalogFrame[] {
  const bySku = new Map(retrieved.map((r) => [r.frame.sku as string, r.frame]));
  const found: CatalogFrame[] = [];
  const seen = new Set<string>();

  for (const m of answerText.matchAll(/SKU\s+([A-Z]+-\d+)/g)) {
    const frame = bySku.get(m[1]);
    if (frame && !seen.has(frame.frame_id)) {
      found.push(frame);
      seen.add(frame.frame_id);
    }
  }

  if (found.length === 0) {
    for (const m of answerText.matchAll(/\[(\d+)\]/g)) {
      const idx = Number(m[1]) - 1;
      const frame = retrieved[idx]?.frame;
      if (frame && !seen.has(frame.frame_id)) {
        found.push(frame);
        seen.add(frame.frame_id);
      }
    }
  }

  return found;
}

function violationSummary(v: Violation): string {
  return `${describeConstraint(v.constraint)} (actual: ${JSON.stringify(v.actual)})`;
}

async function runQueryCases(cases: QueryCase[], pipeline: string) {
  const results = [];

  for (const c of cases) {
    if (pipeline !== "naive") {
      throw new Error(`Pipeline '${pipeline}' not implemented yet`);
    }

    const result = await runNaivePipeline(c.query);

    const retrievedChecked = result.retrieved.map((hit) => ({
      frame_id: hit.frame_id,
      sku: hit.frame.sku,
      score: hit.score,
      violations: checkFrame(hit.frame, c.constraints).map(violationSummary),
    }));
    const retrievedPassCount = retrievedChecked.filter((r) => r.violations.length === 0).length;

    const recommended = extractRecommendedFrames(result.answer, result.retrieved);
    const recommendedChecked = recommended.map((frame) => ({
      frame_id: frame.frame_id,
      sku: frame.sku,
      violations: checkFrame(frame, c.constraints).map(violationSummary),
    }));
    const recommendedPassCount = recommendedChecked.filter((r) => r.violations.length === 0).length;

    results.push({
      id: c.id,
      query: c.query,
      note: c.note,
      constraints: c.constraints.map(describeConstraint),
      chatModel: result.chatModel,
      temperature: result.temperature,
      systemPrompt: result.systemPrompt,
      answer: result.answer,
      retrieved: retrievedChecked,
      retrievedPassRate: `${retrievedPassCount}/${retrievedChecked.length}`,
      recommended: recommendedChecked,
      recommendedPassRate:
        recommendedChecked.length > 0
          ? `${recommendedPassCount}/${recommendedChecked.length}`
          : "no frames extracted from answer text",
    });
  }

  return results;
}

function runCatalogCompositionCases(cases: CatalogCompositionCase[]) {
  const frames = getAllFrames();

  return cases.map((c) => {
    const filtered = frames.filter((f) =>
      Object.entries(c.filter).every(([k, v]) => f[k] === v)
    );

    const rows = c.thresholds_mm.map((threshold) => {
      const clearing = filtered.filter((f) => (f[c.field] as number) >= threshold);
      const nonSunglasses = clearing.filter((f) => f.product_type !== "sunglasses");
      return {
        threshold_mm: threshold,
        total_clearing: clearing.length,
        non_sunglasses_clearing: nonSunglasses.length,
      };
    });

    return { id: c.id, description: c.description, base_count: filtered.length, rows };
  });
}

function runDerivationFunctionCases(cases: DerivationFunctionCase[]) {
  return cases.map((c) => {
    if (c.function !== "deriveRimTypeConstraint") {
      throw new Error(`Unknown derivation function: ${c.function}`);
    }
    const rows = c.thresholds_d.map((threshold) => {
      const d = deriveRimTypeConstraint(c.rx_power_test_d, threshold);
      return { threshold_d: threshold, requires_non_rimless: d.requiresNonRimless, reason: d.reason };
    });
    return { id: c.id, description: c.description, rx_power_test_d: c.rx_power_test_d, rows };
  });
}

async function main() {
  const { pipeline } = parseArgs();
  const golden: GoldenFile = JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf-8"));

  console.log(`\n=== Phase 2 harness -- pipeline: ${pipeline} ===\n`);

  const queryResults = await runQueryCases(golden.query_cases, pipeline);
  console.log("--- Query cases (constraint-violation check, no LLM judge) ---\n");
  for (const r of queryResults) {
    console.log(`[${r.id}] "${r.query}"`);
    console.log(`  constraints: ${r.constraints.join(", ")}`);
    console.log(`  retrieved top-${r.retrieved.length} constraint pass rate: ${r.retrievedPassRate}`);
    console.log(`  recommended-frame constraint pass rate: ${r.recommendedPassRate}`);
    for (const rec of r.recommended) {
      if (rec.violations.length > 0) {
        console.log(`    VIOLATION: ${rec.sku} -- ${rec.violations.join("; ")}`);
      }
    }
    console.log();
  }

  const compositionResults = runCatalogCompositionCases(golden.catalog_composition_cases);
  console.log("--- Catalog composition cases (threshold sensitivity) ---\n");
  for (const r of compositionResults) {
    console.log(`[${r.id}] ${r.description} (base count: ${r.base_count})`);
    for (const row of r.rows) {
      console.log(
        `  >= ${row.threshold_mm}mm: ${row.total_clearing} total, ${row.non_sunglasses_clearing} non-sunglasses`
      );
    }
    console.log();
  }

  const derivationResults = runDerivationFunctionCases(golden.derivation_function_cases);
  console.log("--- Derivation function cases (threshold sensitivity) ---\n");
  for (const r of derivationResults) {
    console.log(`[${r.id}] ${r.description}`);
    for (const row of r.rows) {
      console.log(`  threshold ${row.threshold_d}D: requires_non_rimless=${row.requires_non_rimless}`);
    }
    console.log();
  }

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(REPORTS_DIR, `${pipeline}-${timestamp}.json`);
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      { pipeline, generatedAt: new Date().toISOString(), queryResults, compositionResults, derivationResults },
      null,
      2
    )
  );
  console.log(`Full report written to ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
