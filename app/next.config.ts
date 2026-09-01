import type { NextConfig } from "next";
import path from "node:path";

// Deployment readiness (decisions.md, 2026-09-02). The catalog and advice
// data this app reads at runtime (app/lib/retrieval.ts, catalog-db.ts,
// advice-retrieval.ts) live in ../data -- a sibling of this Next project,
// not inside it. That's true for local dev (npm run dev, cwd = app/), but
// NOT automatically true for a deployed serverless function: its bundle is
// built from Next's output file tracing, not a raw filesystem copy, and
// tracing only follows files it can find via static import/require
// analysis. These files are read via
// `fs.readFileSync(path.resolve(process.cwd(), "..", ...))` -- a
// dynamically-built path tracing can't resolve -- and without the config
// below, Next's automatic tracing root stops at app/ (the nearest
// lockfile), one level too shallow to consider ../data at all, regardless.
// Both settings are needed together: outputFileTracingRoot widens what's
// in-bounds, outputFileTracingIncludes force-includes the exact files each
// route needs. Verified against `next build`'s own .next/server/app/**/*.nft.json
// trace output, not assumed to work from reading the docs alone.
const monorepoRoot = path.join(__dirname, "..");

const nextConfig: NextConfig = {
  outputFileTracingRoot: monorepoRoot,
  outputFileTracingIncludes: {
    "/api/conversation": [
      "../data/catalog/out/catalog.db",
      "../data/catalog/out/catalog.json",
      "../data/catalog/out/blurbs.json",
      "../data/catalog/out/embeddings.json",
      "../data/advice/out/chunks.json",
      "../data/advice/out/embeddings.json",
    ],
    "/api/query": [
      "../data/catalog/out/catalog.json",
      "../data/catalog/out/blurbs.json",
      "../data/catalog/out/embeddings.json",
    ],
  },
};

export default nextConfig;
