// Phase 5: the conversation orchestrator. One call per turn: takes the
// current state and the user's new message, runs extraction -> merge ->
// derive -> policy, and either returns the next question or compiles the
// QUERY and generates a final recommendation. Both retrieval halves
// (catalog-db.ts's SQL, advice-retrieval.ts's RAG) and the relaxation
// ladder (findNearestAlternatives) are reused unchanged from Phase 3/4 --
// this file is the conversational shell around them, not a rewrite
// (explicit instruction, decisions.md 2026-08-31).
//
// Phase 6/interface: every stage below also records a TurnMachinery entry
// (state.history) -- timings, real token usage and cost per model call,
// which derivation rules fired (out of how many), the compiled SQL and
// its true match count, retrieved advice chunks (and near-misses below
// the floor), and a citation map -- for the "show the machinery" UI. This
// is instrumentation around data the pipeline already computes to do its
// job; nothing here changes what the pipeline decides, only what's
// exposed about how.
import OpenAI from "openai";
import { CHAT_MODEL, CHAT_TEMPERATURE } from "../config/model";
import { costInr } from "../config/pricing";
import { queryFrames, countMatches, findNearestAlternatives } from "../catalog-db";
import { getBlurb } from "../retrieval";
import { getAdviceEmbeddingModel, retrieveAdviceTopKWithNearMisses, type AdviceHit } from "../advice-retrieval";
import { extractTurn } from "./extract-turn";
import { deriveQuery, rankCandidates, filterUnsafeRimless, FITTING_RULES, type DerivedFact } from "./derive";
import { decideNextStep, ASK_ORDER, QUESTION_CAP, topicIsAnswered, FACE_SHAPE_OPENER_TEXT } from "./policy";
import type {
  ConversationState,
  PartialSlots,
  Slots,
  SlotName,
  QuestionTopic,
  TurnMachinery,
  CitationMapping,
  ModelCallUsage,
} from "./types";

const MAX_FRAMES_SHOWN = 5;
const MAX_ADVICE_SHOWN = 4;

// Defaults applied only when the 5-question cap is hit (or no topic is left
// to ask) and a required slot is still empty -- always tagged
// source="assumed" and pushed to assumedAtCap, per PROJECT_CONTEXT.md §3:
// "assume a default, state the assumption, and offer to refine." Not
// derived from the catalog dynamically (e.g. a live median price) on
// purpose -- a fixed, documented default is easier for the golden-set
// eval to assert against than a value that could drift if the catalog
// changes.
const DEFAULT_PRODUCT_TYPE = "eyeglasses" as const;
const DEFAULT_BUDGET_MAX = 5000; // INR, documented mid-range default -- see decisions.md Phase 5 entry
const DEFAULT_PURPOSE = ["everyday"];

function mergeSlots(current: Slots, partial: PartialSlots): Slots {
  // Object spread at the top level is exactly the partial-update contract:
  // only keys present in `partial` are touched, everything else in
  // `current` is carried through untouched. This is also what makes
  // mid-conversation mind-change correct -- restating a slot (e.g. a new
  // budget) overwrites only that one field, never the rest.
  return { ...current, ...partial };
}

function applyCapAssumptions(slots: Slots): { slots: Slots; assumed: SlotName[] } {
  const assumed: SlotName[] = [];
  const next: Slots = { ...slots };

  if (!next.product_type) {
    next.product_type = { value: DEFAULT_PRODUCT_TYPE, source: "assumed", confidence: 0.4, reason: "no product type given by the question cap; defaulted to eyeglasses, the most common request." };
    assumed.push("product_type");
  }
  if (!next.budget_min && !next.budget_max) {
    next.budget_max = { value: DEFAULT_BUDGET_MAX, source: "assumed", confidence: 0.3, reason: `no budget given by the question cap; assumed a mid-range ceiling of ${DEFAULT_BUDGET_MAX}.` };
    assumed.push("budget_max");
  }
  if ((next.purpose?.value.length ?? 0) === 0 && next.rx_power === undefined) {
    next.purpose = { value: DEFAULT_PURPOSE, source: "assumed", confidence: 0.3, reason: "no purpose or prescription power given by the question cap; assumed everyday use." };
    assumed.push("purpose");
  }

  return { slots: next, assumed };
}

const PERSONA_AND_RULES = `You are the in-store assistant at an optical shop, continuing a multi-turn conversation with a customer. Warm, personable, genuinely interested in getting the customer the right fit -- but the constraints below are not suggestions, follow them even when they cut against sounding enthusiastic.

1. NEVER assert a subjective or aesthetic judgment as fact -- "those will look amazing on you" is not allowed. You may say what a frame is designed for or suited to; you may not declare how it will look on them.
2. Ground every checkable claim in a labeled source: frame facts cite [1]-[5], optical/fitting advice cites [A1]-[A4]. A technical claim with no citation is not allowed.
3. Match confidence to each advice reference's claim_type: physical claims stated plainly, convention claims hedged and named as convention, never with the confidence of a physical fact.
4. Never invent a frame, a fact, or a citation.
5. If any assumption was made because the customer didn't answer a question (listed below as "Assumptions made"), state it plainly in the answer, in your own words, and say what would change if it's wrong -- never bury it.
6. Explain every technical term in the same sentence it appears -- the customer is not expected to know eyewear vocabulary (this is the vocabulary policy, PROJECT_CONTEXT.md §3: derive, don't quiz).
7. If nothing satisfies the full request, say so explicitly and offer the nearest alternative, naming exactly what it drops.
8. The catalog's lens_height_mm is a frame/B-height measurement, not "fitting height" (pupil centre to lens bottom) -- never conflate the two.
9. When a single source draws MULTIPLE distinct classifications for different attributes (e.g. one rule sorting colors as light/dark, a separate rule sorting metals as warm/cool undertone), describe each attribute using ONLY the classification that source actually applies to it. Do not blend them -- do not call a color "warm" or "cool" just because the same document discusses warm/cool for something else (metal tone). If the customer's situation touches an attribute the source doesn't classify the way they're asking about, say that plainly ("the guidance covers light-vs-dark for that color, not warm-vs-cool") rather than inventing a bridge between two separate rules.`;

function formatFrameContext(frames: { frame_id: string; text: string }[]): string {
  return frames.map((f, i) => `[${i + 1}] ${f.text}`).join("\n\n");
}

function formatAdviceContext(hits: AdviceHit[]): string {
  return hits.map((hit, i) => `[A${i + 1}] (${hit.chunk.claim_type}, ${hit.chunk.source_org}) ${hit.chunk.text}`).join("\n\n");
}

function formatDerivedFacts(facts: DerivedFact[], assumptions: DerivedFact[]): string {
  const lines: string[] = [];
  if (facts.length > 0) {
    lines.push("Derived constraints in effect this turn (explain these in plain language if relevant, they are not the customer's own words):");
    lines.push(...facts.map((f) => `- ${f.explanation}${f.source ? ` [source: ${f.source}]` : ""}`));
  }
  if (assumptions.length > 0) {
    lines.push("Assumptions made (MUST be stated plainly in the answer, per rule 5):");
    lines.push(...assumptions.map((a) => `- ${a.explanation}`));
  }
  return lines.join("\n");
}

function synthesizeQueryText(slots: Slots, latestUserMessage: string): string {
  // Advice retrieval embeds a single string -- unlike the catalog half
  // (structured filter, exact), the advice half stays a similarity search,
  // same architecture as orchestrated.ts (Phase 4). Folding in accumulated
  // purpose/fit-issue context (not just the latest message) means a
  // recommendation turn retrieves advice relevant to the WHOLE
  // conversation, not just its last sentence.
  const bits = [
    latestUserMessage,
    ...(slots.purpose?.value ?? []),
    ...(slots.fit_issues?.value ?? []),
    slots.face_shape?.value,
    slots.lens_type?.value,
  ].filter(Boolean);
  return bits.join(". ");
}

/**
 * Phase 6: "citations mapped to the claims they support." Splits the
 * generated answer into sentences and, for each, records which bracketed
 * markers ([1]-[5], [A1]-[A4]) appear in it -- a deterministic map from
 * prose back to the specific catalog/advice entries it cited, built by
 * parsing the model's own output rather than a second LLM call asked to
 * self-report its citations.
 */
function mapCitations(answer: string): CitationMapping[] {
  const sentences = answer.split(/(?<=[.!?])\s+(?=[A-Z#*])/).map((s) => s.trim()).filter(Boolean);
  const markerRe = /\[(A?\d+)\]/g;
  return sentences
    .map((sentence) => ({
      sentence,
      citedMarkers: [...sentence.matchAll(markerRe)].map((m) => `[${m[1]}]`),
    }))
    .filter((c) => c.citedMarkers.length > 0);
}

/** Dedupes facts+reasons back down to distinct FITTING_RULES ids that actually fired this turn -- rankCandidates pushes one fact per matching FRAME, so without this a rule that matched 4 frames would look like 4 different rules. */
function countDistinctRulesFired(facts: DerivedFact[]): number {
  return new Set(facts.map((f) => f.ruleId).filter((id): id is string => Boolean(id))).size;
}

export interface TurnResult {
  state: ConversationState;
  assistantMessage: string;
  /** Set only on the turn that produced a recommendation. */
  recommendation?: {
    frames: {
      frame_id: string;
      text: string;
      boost: number;
      /** Real, structured "why this frame" data straight from rankCandidates -- not parsed out of the free-text answer, which would be fragile. Empty when nothing about this specific frame was derived (e.g. it's here on price/purpose alone). */
      reasons: DerivedFact[];
      /** Present only when this frame is a relaxation-ladder alternative, not an exact match -- what it specifically drops. */
      droppedClause?: string;
    }[];
    sql: string;
    relaxed: boolean;
  };
}

/**
 * Runs one turn. `userMessage` is undefined only for the very first call,
 * to get the opening question without a customer message yet.
 */
export async function runTurn(state: ConversationState, userMessage: string | undefined): Promise<TurnResult> {
  const turnStart = Date.now();
  const client = new OpenAI();
  let slots = state.slots;
  let askedTopics = state.askedTopics;
  const turns = [...state.turns];
  const history = [...state.history];
  const timingsMs: TurnMachinery["timingsMs"] = { total: 0 };
  const modelCalls: ModelCallUsage[] = [];

  let extractedPartial: PartialSlots = {};
  let safetyFlag: TurnMachinery["safetyFlag"] = "none";

  // Turn 0, unconditional: the face-shape opener (PROJECT_CONTEXT.md §3/§7),
  // ahead of `purpose` -- not run through decideNextStep and not tracked in
  // askedTopics/QUESTION_CAP, so it can never be skipped by sufficiency and
  // never costs one of the five real questions. See policy.ts's
  // FACE_SHAPE_OPENER_TEXT comment for why this moved here 2026-09-01.
  if (userMessage === undefined) {
    turns.push({ role: "assistant", content: FACE_SHAPE_OPENER_TEXT });
    timingsMs.total = Date.now() - turnStart;
    history.push({
      turnIndex: history.length,
      extractedPartial: {},
      safetyFlag: "none",
      derivedFacts: [],
      assumptions: [],
      fittingRulesTotalCount: FITTING_RULES.length,
      modelCalls,
      timingsMs,
    });
    return {
      state: { slots, turns, askedTopics, assumedAtCap: state.assumedAtCap, status: "in_progress", history },
      assistantMessage: FACE_SHAPE_OPENER_TEXT,
    };
  }

  // userMessage is guaranteed defined here -- the undefined case returned above.
  turns.push({ role: "user", content: userMessage });

  const extractStart = Date.now();
  const extracted = await extractTurn(client, state.turns, userMessage, slots);
  timingsMs.extraction = Date.now() - extractStart;
  modelCalls.push({
    label: "Reading your answers into fields",
    kind: "chat",
    promptTokens: extracted.usage.promptTokens,
    completionTokens: extracted.usage.completionTokens,
    costInr: costInr(extracted.usage.promptTokens, extracted.usage.completionTokens, "chat"),
    ms: timingsMs.extraction,
  });
  extractedPartial = extracted.partial;
  safetyFlag = extracted.safetyFlag;
  slots = mergeSlots(slots, extractedPartial);

  // Safety interrupt fires at ANY turn, not just the first (PROJECT_CONTEXT.md §3) --
  // checked every turn regardless of what question was pending, before sufficiency/policy runs.
  if (safetyFlag !== "none") {
    const message =
      safetyFlag === "vision_symptom"
        ? "That's not something glasses can safely address, and it's not something I should guess about — please see an optometrist or ophthalmologist, especially if it's sudden or getting worse. I'm glad to keep helping you find frames once that's been checked out, or now if you'd rather set it aside."
        : "Whether glasses can correct that is a question for an optometrist, not a frame recommendation — I don't want to imply a purchase here would resolve it. Happy to keep going on frame selection once you've had that checked, or we can pause here.";
    turns.push({ role: "assistant", content: message });
    // `assumptions` deliberately omitted here (and in the "ask" branch below): deriveQuery's
    // assumption logic (e.g. rx_power) fires on an ABSENT value, so calling it mid-conversation
    // -- before the customer has even been asked, let alone declined to answer -- would show a
    // "we've assumed X" note that isn't real yet; nothing has been compiled into a query. Only
    // meaningful once a recommendation is actually being produced, below.
    const { facts } = deriveQuery(slots);
    timingsMs.total = Date.now() - turnStart;
    history.push({
      turnIndex: history.length,
      userMessage,
      extractedPartial,
      safetyFlag,
      derivedFacts: facts,
      assumptions: [],
      fittingRulesTotalCount: FITTING_RULES.length,
      modelCalls,
      timingsMs,
    });
    return {
      state: { slots, turns, askedTopics, assumedAtCap: state.assumedAtCap, status: "safety_interrupt", history },
      assistantMessage: message,
    };
  }

  const next = decideNextStep({ slots, turns, askedTopics, assumedAtCap: state.assumedAtCap, status: "in_progress", history });

  if (next.kind === "ask" && next.topic) {
    askedTopics = [...askedTopics, next.topic];
    const message = next.questionText!;
    turns.push({ role: "assistant", content: message });
    const { facts } = deriveQuery(slots); // assumptions omitted -- see comment above, same reasoning
    timingsMs.total = Date.now() - turnStart;
    history.push({
      turnIndex: history.length,
      userMessage,
      extractedPartial,
      safetyFlag,
      derivedFacts: facts,
      assumptions: [],
      fittingRulesTotalCount: FITTING_RULES.length,
      askedTopic: next.topic,
      modelCalls,
      timingsMs,
    });
    return {
      state: { slots, turns, askedTopics, assumedAtCap: state.assumedAtCap, status: "in_progress", history },
      assistantMessage: message,
    };
  }

  // Recommending: apply cap assumptions for anything still missing, then compile and generate.
  const capResult = applyCapAssumptions(slots);
  slots = capResult.slots;
  const assumedAtCap = [...new Set([...state.assumedAtCap, ...capResult.assumed])];

  const { filter, facts, assumptions } = deriveQuery(slots, true);

  const sqlStart = Date.now();
  const { frames: sqlFrames, sql } = queryFrames(filter, MAX_FRAMES_SHOWN * 2);
  const sqlMatchCount = countMatches(filter);
  const catalogTotalCount = countMatches({});
  timingsMs.sqlQuery = Date.now() - sqlStart;

  const safeFrames = filterUnsafeRimless(sqlFrames, slots.rx_power?.value);

  let relaxed = false;
  let relaxedDetails: { droppedClause: string; frame_id: string }[] | undefined;
  let neverRelaxBlockedDetails: { key: string; describe: string }[] | undefined;
  let candidateFrames = safeFrames;
  if (candidateFrames.length === 0) {
    relaxed = true;
    const { alternatives, neverRelaxBlocked } = findNearestAlternatives(filter, MAX_FRAMES_SHOWN);
    relaxedDetails = alternatives.map((a) => ({ droppedClause: a.droppedClause, frame_id: a.frame.frame_id }));
    if (neverRelaxBlocked.length > 0) {
      // "Fail loudly": surfaced in the machinery panel too, not just the server console warning
      // catalog-db.ts already emitted -- so declining outright is visibly CORRECT, not silent.
      neverRelaxBlockedDetails = neverRelaxBlocked.map((b) => ({ key: b.key, describe: b.describe }));
    }
    candidateFrames = filterUnsafeRimless(alternatives.map((a) => a.frame), slots.rx_power?.value);
  }

  const ranked = rankCandidates(candidateFrames, slots).slice(0, MAX_FRAMES_SHOWN);
  const rankedFacts = ranked.flatMap((r) => r.reasons);

  const frameContextRows = ranked.map((r) => ({ frame_id: r.frame.frame_id, text: getBlurb(r.frame.frame_id) }));
  const frameContext = formatFrameContext(frameContextRows);

  const embeddingStart = Date.now();
  const queryText = synthesizeQueryText(slots, userMessage ?? "");
  const embeddingResponse = await client.embeddings.create({ model: getAdviceEmbeddingModel(), input: queryText });
  timingsMs.adviceEmbedding = Date.now() - embeddingStart;
  const embeddingUsage = { promptTokens: embeddingResponse.usage?.prompt_tokens ?? 0, completionTokens: 0 };
  modelCalls.push({
    label: "Turning the question into a vector",
    kind: "embedding",
    promptTokens: embeddingUsage.promptTokens,
    completionTokens: 0,
    costInr: costInr(embeddingUsage.promptTokens, 0, "embedding"),
    ms: timingsMs.adviceEmbedding,
  });

  const searchStart = Date.now();
  const { hits: adviceHits, nearMisses: adviceNearMisses } = retrieveAdviceTopKWithNearMisses(
    embeddingResponse.data[0].embedding,
    MAX_ADVICE_SHOWN
  );
  timingsMs.adviceSearch = Date.now() - searchStart;
  const adviceContext = formatAdviceContext(adviceHits);

  const derivedContext = formatDerivedFacts([...facts, ...rankedFacts], assumptions);

  const generationStart = Date.now();
  const chatResponse = await client.chat.completions.create({
    model: CHAT_MODEL,
    temperature: CHAT_TEMPERATURE,
    messages: [
      { role: "system", content: PERSONA_AND_RULES },
      {
        role: "user",
        content:
          `Conversation so far:\n${turns.map((t) => `${t.role}: ${t.content}`).join("\n")}\n\n` +
          `${relaxed ? "Nothing matched every requirement -- nearest alternatives shown" : "Matching catalog frames"}:\n${frameContext || "(none found)"}\n\n` +
          `Retrieved advice (cite as [A#], respecting each one's claim_type):\n${adviceContext || "(none retrieved)"}\n\n` +
          `${derivedContext}`,
      },
    ],
  });
  timingsMs.generation = Date.now() - generationStart;
  const generationUsage = {
    promptTokens: chatResponse.usage?.prompt_tokens ?? 0,
    completionTokens: chatResponse.usage?.completion_tokens ?? 0,
  };
  modelCalls.push({
    label: "Writing the answer",
    kind: "chat",
    promptTokens: generationUsage.promptTokens,
    completionTokens: generationUsage.completionTokens,
    costInr: costInr(generationUsage.promptTokens, generationUsage.completionTokens, "chat"),
    ms: timingsMs.generation,
  });

  const answer = chatResponse.choices[0]?.message?.content ?? "";
  turns.push({ role: "assistant", content: answer });
  timingsMs.total = Date.now() - turnStart;

  const allFacts = [...facts, ...rankedFacts];

  history.push({
    turnIndex: history.length,
    userMessage,
    extractedPartial,
    safetyFlag,
    derivedFacts: allFacts,
    assumptions,
    fittingRulesTotalCount: FITTING_RULES.length,
    modelCalls,
    recommendation: {
      sql,
      sqlMatchCount,
      catalogTotalCount,
      relaxed,
      relaxedDetails,
      neverRelaxBlocked: neverRelaxBlockedDetails,
      adviceHits: adviceHits.map((h) => ({
        chunk_id: h.chunk_id,
        score: h.score,
        claim_type: h.chunk.claim_type,
        source_org: h.chunk.source_org,
        doc_id: h.chunk.doc_id,
        section_heading: h.chunk.section_heading,
      })),
      adviceNearMisses: adviceNearMisses.map((h) => ({
        chunk_id: h.chunk_id,
        score: h.score,
        claim_type: h.chunk.claim_type,
        source_org: h.chunk.source_org,
        doc_id: h.chunk.doc_id,
        section_heading: h.chunk.section_heading,
      })),
      citations: mapCitations(answer),
    },
    timingsMs,
  });

  const droppedClauseByFrameId = new Map((relaxedDetails ?? []).map((d) => [d.frame_id, d.droppedClause]));

  return {
    state: { slots, turns, askedTopics, assumedAtCap, status: "done", history },
    assistantMessage: answer,
    recommendation: {
      frames: ranked.map((r) => ({
        frame_id: r.frame.frame_id,
        text: getBlurb(r.frame.frame_id),
        boost: r.boost,
        reasons: r.reasons,
        droppedClause: droppedClauseByFrameId.get(r.frame.frame_id),
      })),
      sql,
      relaxed,
    },
  };
}

export { ASK_ORDER, QUESTION_CAP, topicIsAnswered, countDistinctRulesFired };
export type { QuestionTopic };
