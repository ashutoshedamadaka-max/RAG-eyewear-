import OpenAI from "openai";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { CHAT_MODEL, CHAT_TEMPERATURE } from "../config/model";
import { getBlurb } from "../retrieval";
import { queryFrames, findNearestAlternatives, type StructuredFilter } from "../catalog-db";
import type { PipelineResult, PipelineHit } from "./types";

const MAX_SHOWN = 5;

const EXTRACTION_SYSTEM_PROMPT =
  "Extract a structured catalog filter from the customer's eyewear request. " +
  "Only set fields the customer actually implied; leave everything else unset. " +
  "purpose_tags are lowercase snake_case values like 'sports', 'outdoor', 'everyday', 'computer', 'driving_day', 'driving_night', 'formal_work', 'reading', 'dust_travel' -- " +
  "do not invent a tag the customer's words don't support, and do not substitute a semantically adjacent tag (e.g. 'outdoor' is not the same as 'sports').";

const EXTRACTION_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "extract_filter",
    description: "Structured catalog filter matching the customer's request.",
    parameters: {
      type: "object",
      properties: {
        product_type: { type: "string", enum: ["eyeglasses", "sunglasses", "reading", "computer"] },
        material: { type: "string", enum: ["acetate", "metal", "titanium", "tr90"] },
        max_price: { type: "number" },
        min_price: { type: "number" },
        purpose_tags: { type: "array", items: { type: "string" } },
        requires_in_stock: { type: "boolean" },
        requires_polarized: { type: "boolean" },
        requires_uv400: { type: "boolean" },
        requires_progressive_ready: { type: "boolean" },
        rim_type: { type: "string", enum: ["full", "semi", "rimless"] },
      },
      additionalProperties: false,
    },
  },
};

const GENERATION_SYSTEM_PROMPT =
  "You are an eyewear store assistant. Below are catalog results from a structured " +
  "database query. If they exactly match the customer's request, recommend 2-3 of " +
  "them. If instead they are NEAREST ALTERNATIVES (marked as such, because nothing " +
  "matched exactly), say plainly that nothing matches exactly, name the specific " +
  "requirement each alternative drops using the note attached to it, and offer it " +
  "as an option anyway. Never claim an alternative satisfies a requirement its note " +
  "says it drops. Only use frames from the list below; do not invent frames. " +
  "Reference each pick by its bracketed number.";

async function extractFilter(client: OpenAI, query: string): Promise<StructuredFilter> {
  const response = await client.chat.completions.create({
    model: CHAT_MODEL,
    temperature: CHAT_TEMPERATURE,
    // gpt-5.6-luna rejects function tools on /v1/chat/completions unless
    // reasoning_effort is explicitly disabled (confirmed against the live
    // API 2026-08-28) -- only set here, where tools are actually used, not
    // on the generation call, so the naive pipeline's already-established
    // behavior isn't retroactively changed by an unrelated fix.
    reasoning_effort: "none",
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content: query },
    ],
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: "function", function: { name: "extract_filter" } },
  });

  const call = response.choices[0]?.message?.tool_calls?.[0];
  if (!call || call.type !== "function") return {};
  try {
    return JSON.parse(call.function.arguments) as StructuredFilter;
  } catch {
    return {};
  }
}

// Phase 3 hybrid pipeline: extract a structured filter (function calling),
// run it as real SQL against data/catalog/out/catalog.db, and -- if nothing
// matches -- relax one clause at a time (PROJECT_CONTEXT.md §3 relaxation
// ladder) instead of returning empty. Shares the exact chat model,
// temperature, and generation-prompt conventions (bracketed-number
// references, blurb text) as the naive pipeline so the A/B isolates the
// retrieval mechanism as the only variable. Advice-corpus citations are not
// included -- data/advice/ is still empty (decisions.md 2026-08-28); this
// pipeline is catalog-only until that's sourced.
export async function runHybridPipeline(query: string): Promise<PipelineResult> {
  const client = new OpenAI();

  const filter = await extractFilter(client, query);
  const { frames, sql } = queryFrames(filter, MAX_SHOWN);

  let hits: PipelineHit[];
  let relaxed = false;
  let alternativesUsed: { droppedClause: string; frame_id: string }[] = [];

  if (frames.length > 0) {
    hits = frames.map((frame) => ({
      frame_id: frame.frame_id,
      text: getBlurb(frame.frame_id),
      frame,
    }));
  } else {
    relaxed = true;
    const alternatives = findNearestAlternatives(filter, 1);
    alternativesUsed = alternatives.map((a) => ({ droppedClause: a.droppedClause, frame_id: a.frame.frame_id }));
    hits = alternatives.map((a) => ({
      frame_id: a.frame.frame_id,
      text: `${getBlurb(a.frame.frame_id)} [NEAREST ALTERNATIVE -- does not satisfy: ${a.droppedClause}]`,
      frame: a.frame,
    }));
  }

  const context = hits.map((hit, i) => `[${i + 1}] ${hit.text}`).join("\n\n");

  const chatResponse = await client.chat.completions.create({
    model: CHAT_MODEL,
    temperature: CHAT_TEMPERATURE,
    messages: [
      { role: "system", content: GENERATION_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Customer request: ${query}\n\n${relaxed ? "Nearest alternatives (nothing matched exactly)" : "Matching frames"}:\n${context || "(none found)"}`,
      },
    ],
  });

  const answer = chatResponse.choices[0]?.message?.content ?? "";

  return {
    pipeline: "hybrid",
    query,
    chatModel: CHAT_MODEL,
    temperature: CHAT_TEMPERATURE,
    systemPrompt: GENERATION_SYSTEM_PROMPT,
    answer,
    retrieved: hits,
    meta: { filter, sql, relaxed, alternativesUsed },
  };
}
