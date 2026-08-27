import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getEmbeddingModel, retrieveTopK } from "@/lib/retrieval";

const CHAT_MODEL = "gpt-4o-mini";
const TOP_K = 5;

// Phase 1 naive baseline: embed the query, take the top-k most similar
// catalog blurbs by cosine similarity, and hand them to the model as
// context. No SQL filtering, no metadata pre-filtering, no reranking --
// this route is deliberately the thing PROJECT_CONTEXT.md predicts will
// fail on constraint queries.
export async function POST(req: Request) {
  const { query } = (await req.json()) as { query?: string };
  if (!query || typeof query !== "string") {
    return NextResponse.json({ error: "Missing 'query' string" }, { status: 400 });
  }

  const client = new OpenAI();

  const embeddingResponse = await client.embeddings.create({
    model: getEmbeddingModel(),
    input: query,
  });
  const queryEmbedding = embeddingResponse.data[0].embedding;

  const retrieved = retrieveTopK(queryEmbedding, TOP_K);

  const context = retrieved
    .map((hit, i) => `[${i + 1}] ${hit.text}`)
    .join("\n\n");

  const chatResponse = await client.chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are an eyewear store assistant. Recommend 2-3 frames from the " +
          "retrieved product descriptions below that best match the customer's " +
          "request. Only use frames from the retrieved list; do not invent frames. " +
          "Reference each pick by its bracketed number.",
      },
      {
        role: "user",
        content: `Customer request: ${query}\n\nRetrieved frames:\n${context}`,
      },
    ],
  });

  const answer = chatResponse.choices[0]?.message?.content ?? "";

  return NextResponse.json({
    query,
    answer,
    retrieved: retrieved.map((hit) => ({
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
