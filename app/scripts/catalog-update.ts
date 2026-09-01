// Phase 7c (decisions.md, 2026-09-01). A real catalog change used to be
// four steps someone had to remember, in the right order, by hand:
// rebuild the SQLite DB, regenerate the golden set's nearest_miss ground
// truth, re-run the Python composition validator, and check that the
// ordered-relaxation domains (rim_type/material/face_width_fit) still
// cover every value actually in the data. `npm run catalog:update` is
// all four, in order, stopping at the first real failure rather than
// plowing ahead with stale downstream state.
//
// Deliberately does NOT re-run `blurbs`/`embed` (the naive baseline's
// vector index) -- nothing in the real pipeline (hybrid/orchestrated/
// conversation) depends on that index staying fresh, and re-embedding it
// on every catalog change would misrepresent the actual freshness
// asymmetry this phase's own measurement (decisions.md, "7a") is about:
// the SQL half needs no re-embedding at all, that's the point, not an
// oversight here.
import { execSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..");
const APP_DIR = path.join(ROOT, "app");
const CATALOG_DIR = path.join(ROOT, "data", "catalog");

function run(label: string, cmd: string, cwd: string) {
  console.log(`\n--- ${label} ---`);
  try {
    execSync(cmd, { cwd, stdio: "inherit" });
  } catch {
    console.error(`\n✗ FAILED at: ${label}`);
    process.exit(1);
  }
}

function main() {
  run("1/4 rebuild catalog.db", "npx tsx scripts/build-catalog-db.ts", APP_DIR);
  run("2/4 regenerate nearest_miss ground truth", "npx tsx scripts/generate-nearest-miss.ts", APP_DIR);
  // validate.py never calls sys.exit(1) on a FAIL row, deliberately left that way here:
  // its "100 frames" / "type mix 45/25/15/15" checks are Phase-0's one-time generation
  // contract, not an ongoing invariant a normal catalog change (a new frame, a
  // discontinuation) should be blocked by -- gating this step would make catalog:update
  // fail on every legitimate future catalog change. Its output is still printed in full
  // (stdio: "inherit") so a human reviewing a real update sees exactly what changed and
  // judges it, rather than the tool silently deciding for them. See decisions.md 2026-09-01.
  run("3/4 validate catalog composition (Python, informational)", "python validate.py", CATALOG_DIR);
  run("4/4 check ordered-domain coverage", "npx tsx scripts/check-ordered-domains.ts", APP_DIR);
  console.log("\n=== catalog:update complete -- all four steps ran ===");
}

main();
