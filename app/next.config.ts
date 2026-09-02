import type { NextConfig } from "next";

// Deployment readiness (decisions.md, 2026-09-02, revised same day). The
// catalog and advice data these API routes read at runtime
// (app/lib/retrieval.ts, catalog-db.ts, advice-retrieval.ts) live inside
// this project now (app/data/, populated by scripts/copy-runtime-data.ts
// before every dev/build), not in a sibling directory outside it.
//
// A prior version of this file set `outputFileTracingRoot` one level up
// (the monorepo root) so tracing could reach ../data directly. That
// broke the deployment outright: Vercel's build reported success, but
// every route 404'd at runtime. Root cause, confirmed against a known,
// currently-unresolved issue rather than guessed: `outputFileTracingRoot`
// pointing OUTSIDE this project's configured Vercel Root Directory (app/)
// corrupts Turbopack's production routing manifest in a monorepo, even
// though `next build` itself exits 0 -- https://github.com/vercel/next.js/issues/88579.
// Copying the handful of runtime-needed files inside app/ instead removes
// the need for outputFileTracingRoot entirely, which avoids the bug
// rather than working around it.
//
// outputFileTracingIncludes is kept: the files are read via
// `fs.readFileSync(path.resolve(process.cwd(), "data", ...))`, a
// dynamically-built path Next's automatic tracing can't fully resolve on
// its own, so each route still names its exact dependencies explicitly.
// Verified against `next build`'s own .next/server/app/**/*.nft.json
// trace output, not assumed to work from reading the docs alone.
const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/conversation": [
      "data/catalog/out/catalog.db",
      "data/catalog/out/catalog.json",
      "data/catalog/out/blurbs.json",
      "data/catalog/out/embeddings.json",
      "data/advice/out/chunks.json",
      "data/advice/out/embeddings.json",
    ],
    "/api/query": [
      "data/catalog/out/catalog.json",
      "data/catalog/out/blurbs.json",
      "data/catalog/out/embeddings.json",
    ],
  },
};

export default nextConfig;
