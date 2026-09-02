// Deployment fix (decisions.md, 2026-09-02). Runs automatically before
// `dev` and `build` (npm's predev/prebuild lifecycle hooks -- see
// package.json). Copies exactly the files the live API routes read at
// runtime (app/lib/retrieval.ts, advice-retrieval.ts, catalog-db.ts) from
// the canonical ../data (repo root, still the source of truth for every
// build/tooling script) into app/data (gitignored, a build-time mirror).
//
// Why this exists: a Next.js/Turbopack + Vercel monorepo bug means
// `outputFileTracingRoot` pointing OUTSIDE the project's Root Directory
// (the only way to reach ../data directly) silently breaks Vercel's
// routing manifest even though `next build` itself reports success --
// https://github.com/vercel/next.js/issues/88579. Copying the handful of
// files actually needed at runtime into app/ sidesteps the bug entirely:
// nothing the deployed routes read lives outside Root Directory anymore,
// so outputFileTracingRoot never needs to be set.
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(process.cwd(), "..");
const APP_ROOT = process.cwd();

const FILES = [
  ["data/catalog/out/catalog.db", "data/catalog/out/catalog.db"],
  ["data/catalog/out/catalog.json", "data/catalog/out/catalog.json"],
  ["data/catalog/out/blurbs.json", "data/catalog/out/blurbs.json"],
  ["data/catalog/out/embeddings.json", "data/catalog/out/embeddings.json"],
  ["data/advice/out/chunks.json", "data/advice/out/chunks.json"],
  ["data/advice/out/embeddings.json", "data/advice/out/embeddings.json"],
] as const;

for (const [src, dest] of FILES) {
  const srcPath = path.join(REPO_ROOT, src);
  const destPath = path.join(APP_ROOT, dest);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(srcPath, destPath);
  console.log(`copied ${src} -> app/${dest}`);
}
