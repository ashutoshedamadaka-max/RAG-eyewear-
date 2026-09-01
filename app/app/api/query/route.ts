import { NextResponse } from "next/server";
import { PIPELINES } from "@/lib/pipelines";
import { checkRateLimit, clientIdFor } from "@/lib/rate-limit";

// Thin dispatcher. `pipeline` selects which retrieval/generation pipeline
// answers the request -- "naive" (Phase 1, vector-only) or "hybrid"
// (Phase 3, SQL structured filters). Both are registered in
// app/lib/pipelines/index.ts so this route and the eval harness
// (app/scripts/run-eval.ts) share one source of truth for what pipelines
// exist.
//
// Deployment readiness (decisions.md, 2026-09-02): same per-IP cap as
// /api/conversation (app/lib/rate-limit.ts), but no scripted-replay
// fallback here -- this route serves the Phase 1 naive-baseline page
// (app/page.tsx), a single-shot query/answer demo with no machinery-panel
// state to replay into. Its existing error UI (a plain red message) is an
// honest, sufficient degraded state for a page whose whole point is
// showing retrieval mechanics on one query, not a scripted narrative.
export async function POST(req: Request) {
  const { query, pipeline = "naive" } = (await req.json()) as {
    query?: string;
    pipeline?: string;
  };
  if (!query || typeof query !== "string") {
    return NextResponse.json({ error: "Missing 'query' string" }, { status: 400 });
  }

  const rateLimit = checkRateLimit(clientIdFor(req));
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "This demo is rate-limited per visitor to control API cost. Please try again in a bit." },
      { status: 429 }
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "The live demo isn't configured with a model API key right now." },
      { status: 503 }
    );
  }

  const run = PIPELINES[pipeline];
  if (!run) {
    return NextResponse.json({ error: `Unknown pipeline: '${pipeline}'` }, { status: 400 });
  }

  try {
    const result = await run(query);
    return NextResponse.json({
      query: result.query,
      pipeline: result.pipeline,
      chatModel: result.chatModel,
      answer: result.answer,
      meta: result.meta,
      retrieved: result.retrieved.map((hit) => ({
        frame_id: hit.frame_id,
        score: hit.score,
        brand: hit.frame.brand,
        model: hit.frame.model,
        material: hit.frame.material,
        price_frame_only: hit.frame.price_frame_only,
        currency: hit.frame.currency,
        in_stock: hit.frame.in_stock,
        stock_qty: hit.frame.stock_qty,
        text: hit.text,
      })),
    });
  } catch (err) {
    console.error("[api/query] pipeline failed:", err);
    return NextResponse.json(
      { error: "The live demo hit an error calling the model. Please try again shortly." },
      { status: 502 }
    );
  }
}
