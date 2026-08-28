import { NextResponse } from "next/server";
import { runNaivePipeline } from "@/lib/pipelines/naive";

// Thin dispatcher. `pipeline` selects which retrieval/generation pipeline
// answers the request -- currently only "naive" (Phase 1) exists. Phase 3
// adds "hybrid" here so the eval harness (app/scripts/run-eval.ts) can run
// both through the same request shape for the A/B.
export async function POST(req: Request) {
  const { query, pipeline = "naive" } = (await req.json()) as {
    query?: string;
    pipeline?: string;
  };
  if (!query || typeof query !== "string") {
    return NextResponse.json({ error: "Missing 'query' string" }, { status: 400 });
  }

  if (pipeline !== "naive") {
    return NextResponse.json(
      { error: `Unknown or not-yet-implemented pipeline: '${pipeline}'` },
      { status: 400 }
    );
  }

  const result = await runNaivePipeline(query);

  return NextResponse.json({
    query: result.query,
    pipeline: result.pipeline,
    chatModel: result.chatModel,
    answer: result.answer,
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
