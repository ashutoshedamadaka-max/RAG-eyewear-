import OpenAI from "openai";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { CHAT_MODEL, CHAT_TEMPERATURE } from "../config/model";
import type { StructuredFilter } from "../catalog-db";

// Shared by hybrid.ts (Phase 3) and orchestrated.ts (Phase 4) -- both need
// the identical structured-filter extraction step, and duplicating it would
// risk the two pipelines silently drifting on what counts as a valid filter.
export const EXTRACTION_SYSTEM_PROMPT =
  "Extract a structured catalog filter from the customer's eyewear request. " +
  "Only set fields the customer actually implied; leave everything else unset. " +
  "purpose_tags are lowercase snake_case values like 'sports', 'outdoor', 'everyday', 'computer', 'driving_day', 'driving_night', 'formal_work', 'reading', 'dust_travel' -- " +
  "do not invent a tag the customer's words don't support, and do not substitute a semantically adjacent tag (e.g. 'outdoor' is not the same as 'sports').";

export const EXTRACTION_TOOL: ChatCompletionTool = {
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

/**
 * gpt-5.6-luna rejects function tools on /v1/chat/completions unless
 * reasoning_effort is explicitly disabled (confirmed against the live API
 * 2026-08-28) -- only set here, where tools are actually used, not on any
 * generation call, so this fix doesn't retroactively change generation
 * behavior established for the naive pipeline's A/B comparisons.
 */
export async function extractFilter(client: OpenAI, query: string): Promise<StructuredFilter> {
  const response = await client.chat.completions.create({
    model: CHAT_MODEL,
    temperature: CHAT_TEMPERATURE,
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
