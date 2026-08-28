// Regenerates the `nearest_miss` field on every constraint_violation_case in
// evals/golden/refusal.json from the current catalog. Run this after any
// catalog change -- ground truth comes from the data, not from what a
// pipeline happened to retrieve. See decisions.md 2026-08-28.
//
// Usage: npm run nearest-miss
import fs from "node:fs";
import path from "node:path";
import { computeNearestMisses } from "../lib/nearest-miss";
import type { Constraint } from "../lib/constraints";

const ROOT = path.resolve(__dirname, "..", "..");
const REFUSAL_PATH = path.join(ROOT, "evals", "golden", "refusal.json");

interface ConstraintViolationCase {
  id: string;
  violated_constraints: Constraint[];
  nearest_miss?: unknown;
  [key: string]: unknown;
}

function main() {
  const golden = JSON.parse(fs.readFileSync(REFUSAL_PATH, "utf-8"));
  const cases: ConstraintViolationCase[] = golden.constraint_violation_cases;

  for (const c of cases) {
    if (!c.violated_constraints || c.violated_constraints.length < 2) {
      console.log(`[${c.id}] skipped -- fewer than 2 constraints, no meaningful relaxation axis`);
      continue;
    }
    const misses = computeNearestMisses(c.violated_constraints);
    c.nearest_miss = misses;
    console.log(`[${c.id}] ${misses.length} nearest-miss candidate(s):`);
    for (const m of misses) {
      console.log(`  relax "${m.relaxed}" -> ${m.brand} ${m.model} (${m.sku}, ₹${m.price_frame_only}) -- ${m.violation}`);
    }
  }

  fs.writeFileSync(REFUSAL_PATH, JSON.stringify(golden, null, 2) + "\n");
  console.log(`\nWrote generated nearest_miss fields to ${REFUSAL_PATH}`);
}

main();
