// Phase 7c (decisions.md, 2026-09-01): part of `npm run catalog:update`.
// ORDERED_DOMAINS (app/lib/config/domains.ts) is documented as "exhaustive
// over the catalog's actual values" (domains.ts's own header comment,
// 2026-08-28) -- true when it was written, but nothing has ever checked
// that it STAYS true as the catalog changes. A catalog regeneration or a
// churn event that introduces a new rim_type/material/face_width_fit
// value the domain doesn't know about would silently fall outside the
// ordered-relaxation walk in catalog-db.ts#findNearestAlternatives --
// not a crash, just a value the relaxation ladder can't reason about as
// "one tier further out," the same silent-gap shape as the never-relax
// bug this session already found once.
import { getAllFrames } from "../lib/retrieval";
import { ORDERED_DOMAINS } from "../lib/config/domains";

const CHECKED_COLUMNS = ["rim_type", "material", "face_width_fit"] as const;

function main() {
  const frames = getAllFrames();
  let allCovered = true;

  for (const column of CHECKED_COLUMNS) {
    const domain = ORDERED_DOMAINS[column];
    const knownValues = new Set(domain.flat());
    const actualValues = new Set(frames.map((f) => String(f[column])));
    const uncovered = [...actualValues].filter((v) => !knownValues.has(v));

    if (uncovered.length > 0) {
      allCovered = false;
      console.log(`✗ FAIL ${column}: catalog has value(s) ORDERED_DOMAINS doesn't know about: ${uncovered.join(", ")}`);
      console.log(`    ORDERED_DOMAINS.${column} = ${JSON.stringify(domain)}`);
      console.log(`    catalog's actual distinct values = ${JSON.stringify([...actualValues].sort())}`);
    } else {
      console.log(`✓ ${column}: all ${actualValues.size} distinct catalog values covered by ORDERED_DOMAINS (${JSON.stringify(domain)})`);
    }
  }

  console.log(`\n=== ordered-domain coverage: ${allCovered ? "OK" : "GAP FOUND"} ===`);
  if (!allCovered) process.exitCode = 1;
}

main();
