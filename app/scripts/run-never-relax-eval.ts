// 2026-09-01: deterministic (no LLM) probe for the never-relax fix in
// catalog-db.ts. Constructs filters where an impossible THRESHOLD value on
// a never-relax field (min_lens_height_mm, min_max_power_supported) is
// combined with an ordinary, satisfiable clause (product_type), such that:
//   - the full filter matches nothing (the impossible threshold blocks it)
//   - dropping the ordinary clause STILL matches nothing (the impossible
//     threshold alone blocks everything, regardless of product type)
//   - dropping the never-relax clause DOES match (removing the impossible
//     threshold leaves an ordinary, satisfiable product_type filter)
// This is catalog-content-independent by construction -- no real frame can
// support a 999D prescription or a 999mm lens height, so the "impossible"
// side of the test doesn't depend on knowing the catalog's actual values,
// only that SOME frame of the given product_type exists (verified below,
// not assumed).
//
// Before the fix, `findNearestAlternatives` would have tried relaxing
// the never-relax clause like any other and returned it as "the nearest
// alternative" -- exactly the real-harm case PROJECT_CONTEXT.md §3
// prohibits (recommending a frame that can't carry the prescription, or
// implicitly, could have been sunglasses without UV400). After the fix,
// it must decline outright: zero alternatives, and the blocker recorded
// in `neverRelaxBlocked` rather than silently disappearing.
import { queryFrames, findNearestAlternatives, NEVER_RELAX_KEYS, type StructuredFilter } from "../lib/catalog-db";

interface Check {
  label: string;
  pass: boolean;
  detail: string;
}
function check(label: string, pass: boolean, detail: string): Check {
  return { label, pass, detail };
}

function probe(label: string, filter: StructuredFilter, neverRelaxKey: keyof StructuredFilter): Check[] {
  const checks: Check[] = [];

  const { frames: fullMatch } = queryFrames(filter, 1);
  checks.push(check(`[${label}] full filter matches nothing`, fullMatch.length === 0, `matched ${fullMatch.length}`));

  const withoutOrdinary: StructuredFilter = { [neverRelaxKey]: filter[neverRelaxKey] } as StructuredFilter;
  const { frames: stillBlocked } = queryFrames(withoutOrdinary, 1);
  checks.push(
    check(
      `[${label}] the never-relax clause alone (no other constraint) still matches nothing`,
      stillBlocked.length === 0,
      `matched ${stillBlocked.length}`
    )
  );

  const { alternatives, neverRelaxBlocked } = findNearestAlternatives(filter, 5);
  checks.push(
    check(
      `[${label}] findNearestAlternatives returns ZERO alternatives (declines outright)`,
      alternatives.length === 0,
      JSON.stringify(alternatives.map((a) => ({ dropped: a.droppedClause, frame_id: a.frame.frame_id })))
    )
  );
  checks.push(
    check(
      `[${label}] the never-relax clause is recorded as the blocker, not silently absent`,
      neverRelaxBlocked.some((b) => b.key === neverRelaxKey),
      JSON.stringify(neverRelaxBlocked)
    )
  );
  checks.push(
    check(
      `[${label}] no alternative frame violates the never-relax constraint`,
      alternatives.every((a) => {
        if (neverRelaxKey === "min_lens_height_mm") return (a.frame.lens_height_mm as number) >= (filter.min_lens_height_mm as number);
        if (neverRelaxKey === "min_max_power_supported") return (a.frame.max_power_supported as number) >= (filter.min_max_power_supported as number);
        return true;
      }),
      "checked each returned alternative against the constraint"
    )
  );

  return checks;
}

function main() {
  console.log(`NEVER_RELAX_KEYS = ${JSON.stringify([...NEVER_RELAX_KEYS])}`);

  // Sanity: confirm eyeglasses exist at all before treating "zero matches" as meaningful.
  const { frames: sanityCheck } = queryFrames({ product_type: "eyeglasses" }, 5);
  console.log(`sanity: ${sanityCheck.length} eyeglasses frames exist in the catalog (unfiltered otherwise)\n`);
  if (sanityCheck.length === 0) {
    console.error("FATAL: no eyeglasses frames in the catalog at all -- this test's premise doesn't hold, fix the catalog or the test.");
    process.exit(1);
  }

  const allChecks: Check[] = [
    ...probe(
      "impossible Rx compatibility (999D)",
      { product_type: "eyeglasses", min_max_power_supported: 999 },
      "min_max_power_supported"
    ),
    ...probe(
      "impossible progressive lens height (999mm)",
      { product_type: "eyeglasses", min_lens_height_mm: 999 },
      "min_lens_height_mm"
    ),
  ];

  let pass = 0;
  for (const c of allChecks) {
    if (c.pass) pass++;
    console.log(`  ${c.pass ? "✓" : "✗ FAIL"} ${c.label}${c.pass ? "" : `\n      got: ${c.detail}`}`);
  }

  console.log(`\n=== ${pass}/${allChecks.length} checks passed ===`);
  if (pass < allChecks.length) process.exitCode = 1;
}

main();
