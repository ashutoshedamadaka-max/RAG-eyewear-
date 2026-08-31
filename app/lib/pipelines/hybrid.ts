import OpenAI from "openai";
import { CHAT_MODEL, CHAT_TEMPERATURE } from "../config/model";
import { getBlurb } from "../retrieval";
import { queryFrames, findNearestAlternatives } from "../catalog-db";
import { extractFilter } from "./extract-filter";
import type { PipelineResult, PipelineHit } from "./types";

const MAX_SHOWN = 5;

const GENERATION_SYSTEM_PROMPT =
  "You are an eyewear store assistant. Below are catalog results from a structured " +
  "database query. If they exactly match the customer's request, recommend 2-3 of " +
  "them. If instead they are NEAREST ALTERNATIVES (marked as such, because nothing " +
  "matched exactly), say plainly that nothing matches exactly, name the specific " +
  "requirement each alternative drops using the note attached to it, and offer it " +
  "as an option anyway. Never claim an alternative satisfies a requirement its note " +
  "says it drops. Only use frames from the list below; do not invent frames. " +
  "Reference each pick by its bracketed number.";

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
