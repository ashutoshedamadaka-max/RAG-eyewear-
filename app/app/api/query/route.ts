import { NextResponse } from "next/server";
import { PIPELINES } from "@/lib/pipelines";

// Thin dispatcher. `pipeline` selects which retrieval/generation pipeline
// answers the request -- "naive" (Phase 1, vector-only) or "hybrid"
// (Phase 3, SQL structured filters). Both are registered in
// app/lib/pipelines/index.ts so this route and the eval harness
// (app/scripts/run-eval.ts) share one source of truth for what pipelines
// exist.
export async function POST(req: Request) {
  const { query, pipeline = "naive" } = (await req.json()) as {
    query?: string;
    pipeline?: string;
  };
  if (!query || typeof query !== "string") {
    return NextResponse.json({ error: "Missing 'query' string" }, { status: 400 });
  }

  const run = PIPELINES[pipeline];
  if (!run) {
    return NextResponse.json({ error: `Unknown pipeline: '${pipeline}'` }, { status: 400 });
  }

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
}
