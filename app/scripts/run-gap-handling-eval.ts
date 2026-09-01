// Interface work, 2026-09-01 (decisions.md). Deterministic (no LLM) probe
// for PROJECT_CONTEXT.md §4's three INTENTIONAL catalog gaps -- polarized
// sports <=INR 2,500, progressive-ready rimless, titanium <=INR 4,500 --
// each deliberately built to return zero exact matches (validate.py
// asserts this at catalog-generation time). Correct system behavior for a
// genuinely unsatisfiable request is the relaxation ladder: decline the
// exact combination, offer the nearest real alternative, and explicitly
// name what it drops -- not silence, not a bare refusal, not quietly
// substituting something that fails a requirement without saying so
// (PROJECT_CONTEXT.md §3's relaxation-ladder section).
//
// This exercises catalog-db.ts directly, the same layer docs/phase3-hybrid-ab.md's
// Result 3 table already verified this behavior against (2026-08-28) --
// re-run here to get a fresh, current number for the /conversation
// interface's evaluation section, not to re-litigate that finding.
import { queryFrames, findNearestAlternatives, type StructuredFilter } from "../lib/catalog-db";

interface GapCase {
  label: string;
  filter: StructuredFilter;
}

const GAPS: GapCase[] = [
  { label: "polarized sports <= INR 2,500", filter: { purpose_tags: ["sports"], requires_polarized: true, max_price: 2500 } },
  { label: "progressive-ready rimless", filter: { rim_type: "rimless", requires_progressive_ready: true } },
  { label: "titanium <= INR 4,500", filter: { material: "titanium", max_price: 4500 } },
];

function main() {
  let pass = 0;
  for (const gap of GAPS) {
    const { frames: exact } = queryFrames(gap.filter, 1);
    const isRealGap = exact.length === 0;

    const { alternatives, neverRelaxBlocked } = findNearestAlternatives(gap.filter, 1);
    const offersNamedAlternative = alternatives.length > 0 && alternatives[0].droppedClause.length > 0;

    const ok = isRealGap && offersNamedAlternative;
    if (ok) pass++;

    console.log(`${ok ? "✓" : "✗ FAIL"} ${gap.label}`);
    console.log(`    exact match count: ${exact.length} (gap real: ${isRealGap})`);
    if (alternatives.length > 0) {
      console.log(`    nearest alternative: ${alternatives[0].frame.brand} ${alternatives[0].frame.model} -- drops "${alternatives[0].droppedClause}"`);
    } else {
      console.log(`    no alternative offered${neverRelaxBlocked.length ? ` (blocked by never-relax: ${neverRelaxBlocked.map((b) => b.describe).join(", ")})` : ""}`);
    }
  }

  console.log(`\n=== ${pass}/${GAPS.length} intentional gaps correctly declined with a named alternative ===`);
  if (pass < GAPS.length) process.exitCode = 1;
}

main();
