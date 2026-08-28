import OpenAI from "openai";
import { getEmbeddingModel, retrieveTopK, type RetrievedHit } from "../retrieval";

// Rolling alias, not a dated snapshot: as of 2026-08-28 OpenAI has not
// published dated snapshots for the gpt-5.6 family (confirmed against both
// the live /v1/models list and the deprecations page -- only gpt-5.6-sol /
// -terra / -luna exist). Pin here to the smallest/cheapest tier -- Luna,
// not Terra, which is the mid tier, not the small one -- and revisit this
// pin once OpenAI exposes a dated snapshot. See decisions.md 2026-08-28.
export const CHAT_MODEL = "gpt-5.6-luna";
export const CHAT_TEMPERATURE = 1;
export const TOP_K = 5;

export const SYSTEM_PROMPT =
  "You are an eyewear store assistant. Recommend 2-3 frames from the " +
  "retrieved product descriptions below that best match the customer's " +
  "request. Only use frames from the retrieved list; do not invent frames. " +
  "Reference each pick by its bracketed number.";

export interface NaivePipelineResult {
  pipeline: "naive";
  query: string;
  embeddingModel: string;
  chatModel: string;
  temperature: number;
  systemPrompt: string;
  answer: string;
  retrieved: RetrievedHit[];
}

// Phase 1 naive baseline: embed the query, take the top-k most similar
// catalog blurbs by cosine similarity, and hand them to the model as
// context. No SQL filtering, no metadata pre-filtering, no reranking --
// this pipeline is deliberately the thing PROJECT_CONTEXT.md predicts will
// fail on constraint queries. Shared by the API route and the eval harness
// (app/scripts/run-eval.ts) so both exercise the exact same code path.
export async function runNaivePipeline(query: string): Promise<NaivePipelineResult> {
  const client = new OpenAI();
  const embeddingModel = getEmbeddingModel();

  const embeddingResponse = await client.embeddings.create({
    model: embeddingModel,
    input: query,
  });
  const queryEmbedding = embeddingResponse.data[0].embedding;

  const retrieved = retrieveTopK(queryEmbedding, TOP_K);

  const context = retrieved.map((hit, i) => `[${i + 1}] ${hit.text}`).join("\n\n");

  const chatResponse = await client.chat.completions.create({
    model: CHAT_MODEL,
    temperature: CHAT_TEMPERATURE,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Customer request: ${query}\n\nRetrieved frames:\n${context}`,
      },
    ],
  });

  const answer = chatResponse.choices[0]?.message?.content ?? "";

  return {
    pipeline: "naive",
    query,
    embeddingModel,
    chatModel: CHAT_MODEL,
    temperature: CHAT_TEMPERATURE,
    systemPrompt: SYSTEM_PROMPT,
    answer,
    retrieved,
  };
}
