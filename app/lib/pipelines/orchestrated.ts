import OpenAI from "openai";
import { CHAT_MODEL, CHAT_TEMPERATURE } from "../config/model";
import { getBlurb } from "../retrieval";
import { queryFrames, findNearestAlternatives } from "../catalog-db";
import { getAdviceEmbeddingModel, retrieveAdviceTopK, type AdviceHit } from "../advice-retrieval";
import { extractFilter } from "./extract-filter";
import type { PipelineResult, PipelineHit } from "./types";

const MAX_FRAMES_SHOWN = 5;
const MAX_ADVICE_SHOWN = 4;

// Phase 4: the "Agent" row of PROJECT_CONTEXT.md §1's diagram -- SQL
// decides which frames, RAG explains why, one answer. Frame selection is
// identical to hybrid.ts (Phase 3): same extraction, same SQL, same
// relaxation ladder. What's new is a second retrieval pass over
// data/advice/ chunks (never the catalog -- chunking the catalog would
// rebuild the naive baseline Phase 1 disproved) folded into the same
// generation call, and a system prompt built around a specific hazard:
// warmth reads as confidence. "Those will look amazing on you" is an
// unhedged claim in a friendly voice, and the friendliness makes it harder
// to notice. Persona is stated first; grounding and hedging constraints
// are stated second, explicitly, in writing -- see PROJECT_CONTEXT.md §3.
const SYSTEM_PROMPT = `You are the in-store assistant at an optical shop -- warm, personable, genuinely interested in getting the customer the right fit. Talk like a good optician, not a script.

Persona note: personality lives in HOW you ask, acknowledge, and explain -- not in how strongly you assert things. A good optician is personable and still says "let's get that checked."

Below the persona, these constraints are not suggestions. Follow them even when they cut against sounding enthusiastic:

1. NEVER assert a subjective or aesthetic judgment as fact. "Those will look amazing on you" is not allowed -- looks are the customer's call, not yours to declare. You may say what a frame is designed for or how it's suited to what they described; you may not declare how it will look on them.
2. Ground every checkable claim in a labeled source. Frame facts (price, material, stock, fit) cite the bracketed catalog number, [1]-[5]. Optical or fitting advice (why a spec matters) cites the bracketed advice reference, [A1]-[A4]. A technical or fitting claim with no citation is not allowed -- if nothing provided supports it, don't make it.
3. Match confidence to the source's claim_type, which is labeled on every advice reference. PHYSICAL claims are stated plainly: "rimless mounting isn't reliable at -5.00D and beyond [A2]." CONVENTION claims are hedged and named as convention: "rectangular frames are conventionally suggested for rounder faces, though that's a style convention, not a fitting requirement [A3]." Never state a convention claim with the same confidence as a physical one.
4. Never invent a frame, a fact, or a citation. Only reference frames and advice actually provided below.
5. If the customer is excited about something that fails a hard requirement (their prescription, a safety constraint, a stated fit problem), say so plainly, in the same breath as acknowledging the enthusiasm. Warmth is in how you deliver the fact, never in softening or dropping it.
6. Explain every technical term in the same sentence it appears -- "adjustable nose pads, which is what'll stop the sliding," not "adjustable nose pads" on its own. The customer is not expected to know the vocabulary.
7. If nothing provided satisfies the customer's full request, say so explicitly and offer the nearest alternative, naming exactly what it drops. Never a bare refusal, never a silent substitution that quietly drops a requirement without saying so.
8. If a prescription or other safety-relevant fact is unknown, don't block on it -- proceed on a stated, named assumption ("I've assumed a moderate prescription for these picks") and say what changes if that assumption is wrong.
9. The catalog's lens_height_mm is a frame/B-height measurement (the full vertical lens opening) -- it is NOT the same number as "fitting height" (pupil centre to lens bottom), which is smaller and appears only in retrieved advice, never in catalog data. Do not compare a frame's lens_height_mm directly against a fitting-height figure from advice as if clearing one clears the other; if advice distinguishes the two, say so rather than collapsing them.
10. When a single source draws MULTIPLE distinct classifications for different attributes (e.g. one rule sorting colors as light/dark, a separate rule sorting metals as warm/cool undertone), describe each attribute using ONLY the classification that source actually applies to it. Do not blend them -- do not call a color "warm" or "cool" just because the same document discusses warm/cool for something else (metal tone). If the customer's situation touches an attribute the source doesn't classify the way they're asking about, say that plainly rather than inventing a bridge between two separate rules.`;

export function formatFrameContext(hits: PipelineHit[]): string {
  return hits.map((hit, i) => `[${i + 1}] ${hit.text}`).join("\n\n");
}

export function formatAdviceContext(hits: AdviceHit[]): string {
  return hits
    .map(
      (hit, i) =>
        `[A${i + 1}] (${hit.chunk.claim_type}, ${hit.chunk.source_org}) ${hit.chunk.text}`
    )
    .join("\n\n");
}

export async function runOrchestratedPipeline(query: string): Promise<PipelineResult> {
  const client = new OpenAI();

  // Catalog half: identical mechanism to hybrid.ts (Phase 3).
  const filter = await extractFilter(client, query);
  const { frames, sql } = queryFrames(filter, MAX_FRAMES_SHOWN);

  let frameHits: PipelineHit[];
  let relaxed = false;
  let alternativesUsed: { droppedClause: string; frame_id: string }[] = [];

  if (frames.length > 0) {
    frameHits = frames.map((frame) => ({
      frame_id: frame.frame_id,
      text: getBlurb(frame.frame_id),
      frame,
    }));
  } else {
    relaxed = true;
    const { alternatives } = findNearestAlternatives(filter, 1);
    alternativesUsed = alternatives.map((a) => ({ droppedClause: a.droppedClause, frame_id: a.frame.frame_id }));
    frameHits = alternatives.map((a) => ({
      frame_id: a.frame.frame_id,
      text: `${getBlurb(a.frame.frame_id)} [NEAREST ALTERNATIVE -- does not satisfy: ${a.droppedClause}]`,
      frame: a.frame,
    }));
  }

  // Advice half: new in Phase 4. Embeds the raw customer query -- same
  // move as the naive pipeline's retrieval, applied to documents instead
  // of frames, which is the whole architectural point (PROJECT_CONTEXT.md
  // §1): the catalog answers "which," the advice corpus answers "why."
  const embeddingResponse = await client.embeddings.create({
    model: getAdviceEmbeddingModel(),
    input: query,
  });
  const adviceHits = retrieveAdviceTopK(embeddingResponse.data[0].embedding, MAX_ADVICE_SHOWN);

  const frameContext = formatFrameContext(frameHits);
  const adviceContext = formatAdviceContext(adviceHits);

  const chatResponse = await client.chat.completions.create({
    model: CHAT_MODEL,
    temperature: CHAT_TEMPERATURE,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `Customer request: ${query}\n\n` +
          `${relaxed ? "Nearest catalog alternatives (nothing matched exactly)" : "Matching catalog frames"}:\n${frameContext || "(none found)"}\n\n` +
          `Retrieved advice (cite as [A#], respecting each one's claim_type):\n${adviceContext || "(none retrieved)"}`,
      },
    ],
  });

  const answer = chatResponse.choices[0]?.message?.content ?? "";

  return {
    pipeline: "orchestrated",
    query,
    chatModel: CHAT_MODEL,
    temperature: CHAT_TEMPERATURE,
    systemPrompt: SYSTEM_PROMPT,
    answer,
    retrieved: frameHits,
    meta: {
      filter,
      sql,
      relaxed,
      alternativesUsed,
      adviceRetrieved: adviceHits.map((h) => ({
        chunk_id: h.chunk_id,
        score: h.score,
        claim_type: h.chunk.claim_type,
        source_org: h.chunk.source_org,
        doc_id: h.chunk.doc_id,
        section_heading: h.chunk.section_heading,
      })),
    },
  };
}
