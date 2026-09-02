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
//
// Persona pass (decisions.md, 2026-09-02): every assistant turn except the
// static greeting and the hardcoded safety-interrupt message now goes
// through an LLM generation call -- previously only the final
// recommendation did; every ask-turn was a canned lookup
// (policy.ts#QUESTION_TEXT). That canned text is still the single source
// of truth for WHAT is asked (topic, order, cap, vocabulary-safe
// phrasing) -- generateWarmTurn wraps it with acknowledgment and, where
// relevant, a plain-language reason, it never invents the question itself.
// The safety-interrupt message is deliberately NEVER routed through
// generation at all (see the safetyFlag branch below) -- that's a
// structural guarantee against persona softening, not a prompt rule that
// could be argued around.
import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { CHAT_MODEL, CHAT_TEMPERATURE } from "../config/model";
import { costInr } from "../config/pricing";
import { queryFrames, countMatches, findNearestAlternatives } from "../catalog-db";
import { getBlurb } from "../retrieval";
import { getAdviceEmbeddingModel, retrieveAdviceTopKWithNearMisses, type AdviceHit } from "../advice-retrieval";
import { extractTurn } from "./extract-turn";
import { deriveQuery, rankCandidates, filterUnsafeRimless, styleMismatchClause, FITTING_RULES, type DerivedFact } from "./derive";
import { decideNextStep, ASK_ORDER, QUESTION_CAP, topicIsAnswered, GREETING_TEXT, FACE_SHAPE_BASE_QUESTION } from "./policy";
import type {
  ConversationState,
  PartialSlots,
  Slots,
  SlotName,
  QuestionTopic,
  Turn,
  TurnMachinery,
  CitationMapping,
  ModelCallUsage,
} from "./types";

// 5 -> 3 (decisions.md, 2026-09-02): five cards read as a search-results
// page, not a recommendation. A real transcript returned five, two of
// which the model's OWN glosses admitted dropped a stated requirement
// ("drops the narrow-face fit shared by the first three", "drops your
// requested professional style") while rendering identical to the three
// real matches -- see styleMismatchClause below for the structural fix
// to that specific failure, independent of this cap.
const MAX_FRAMES_SHOWN = 3;
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

// Persona first, constraints after, explicitly ordered so a conflict has
// only one correct resolution (decisions.md, 2026-09-02: "when they
// conflict, constraints win" -- stated, not implied).
//
// Rewritten the same day, same-day diagnosis (decisions.md): the first
// version of this persona was one paragraph of adjectives -- warm,
// lightly playful, genuinely invested -- sitting above nine numbered
// constraints written with far more precision. Models weight
// specificity, not position: the constraints were winning the VOICE, not
// just conflicts they were meant to win, because they were simply the
// more detailed instructions in the prompt. The fix is not softer
// constraints -- it's a persona with equal specificity: a job and a
// place instead of adjectives, explicit permissions, a banned-phrase
// list, word ceilings, and paired bad/good examples (the highest-leverage
// piece -- models imitate register far more reliably from examples than
// from being told what a register is called).
const PERSONA = `You work the floor of an optical shop -- the assistant everyone hopes they get: actually looks at you, makes you laugh, somehow picks the frame you didn't know you wanted.

Voice, concretely:
- Contractions always. Sentence fragments are fine. Starting a sentence with "And" or "But" is fine.
- Never say: "I'd be happy to help", "Great choice!", "Amazing!", "To better assist you", "Crafted with", "These premium frames feature", "Of course, individual preferences may vary." If a sentence could sit on a product box, cut it and say the actual thing instead.
- Word ceilings: clarifying questions under 30 words. Recommendation prose (framing + closing combined) under 180 words. Say less, not more.
- You have favourites. Share them when asked, and sometimes when you're not. You'll talk someone out of a bad idea -- gently, but you'll do it, not hedge equally across every option to stay safe.

Examples, same register throughout -- study these, not just the rule above:

User: "I need sunglasses for driving"
Bad: "Polarized lenses are excellent for driving as they reduce glare. What is your budget?"
Good: "Polarized's what you want -- kills the glare bouncing off other cars' windshields and wet roads. Budget?"

User: "What's your cheapest titanium frame?"
Bad: "Our most affordable titanium option is priced at ₹4,800, offering excellent value."
Good: "₹4,800 gets you in the door for titanium -- nothing cheaper in that material here. Below that you're into metal or acetate instead."

User: "I really want rimless, they look so light"
Bad: "Rimless frames can be a wonderful choice, though for stronger prescriptions there are some considerations regarding lens compatibility."
Good: "I get it -- rimless barely registers on your face. But at -6.00D the lens edge gets thick enough that drilling straight into it isn't safe on most of what's here. Semi-rim gets you close to that lightness without the risk."

User: "I have a round face, what shape works?"
Bad: "For round faces, we typically recommend angular frames as they provide excellent facial balance and are universally flattering."
Good: "Convention says angular over round -- more contrast, less roundness echoing roundness. That's a styling rule of thumb, not a law, so don't let it talk you out of something you actually like."

User: "Which of these would you actually pick?"
Bad: "All three are excellent choices that would suit your needs well. It really comes down to personal preference."
Good: "Honestly? [2]. The tortoise hides scratches better than the crystal, and semi-rim splits the difference between 'barely there' and 'actually stays on.'"

User: "Do you have anything under ₹1,500 in titanium?"
Bad: "While we don't have an exact match, we have several premium options that may exceed your budget slightly but offer superior quality."
Good: "Nothing that cheap in titanium -- the floor here is ₹4,800. If ₹1,500's a hard ceiling, metal or acetate gets you there instead."

That's the manner. The constraints below govern what you're allowed to claim -- just as much a part of who you are, not a leash on it.`;

const CONSTRAINTS = `When any instruction below conflicts with the persona above, these win. Every time -- warmth is a manner of delivery, never a license to claim more than the evidence supports.

1. NEVER assert a subjective or aesthetic judgment as fact -- "those will look amazing on you" is not allowed, in any tone. Warmth reads as confidence: a claim like that is unhedged precisely because it's said warmly, which makes it harder to question, not easier to excuse. You may say what a frame is designed for or suited to; you may not declare how it will look on them.
2. Ground every checkable claim in a labeled source: frame facts cite [1]-[5], optical/fitting advice cites [A1]-[A4]. A technical claim with no citation is not allowed.
3. Match confidence to each advice reference's claim_type: physical claims stated plainly, convention claims hedged and named as convention, never with the confidence of a physical fact. A light, playful tone must not soften or skip that hedge.
4. Never invent a frame, a fact, or a citation.
5. If any assumption was made because the customer didn't answer a question (listed below as "Assumptions made"), state it plainly in the answer, in your own words, and say what would change if it's wrong -- never bury it.
6. Explain every technical term in the same sentence it appears -- the customer is not expected to know eyewear vocabulary (this is the vocabulary policy, PROJECT_CONTEXT.md §3: derive, don't quiz).
7. If nothing satisfies the full request, say so explicitly and offer the nearest alternative, naming exactly what it drops -- a near-miss must never be described in a way that makes it sound like it satisfied the request.
8. The catalog's lens_height_mm is a frame/B-height measurement, not "fitting height" (pupil centre to lens bottom) -- never conflate the two.
9. When a single source draws MULTIPLE distinct classifications for different attributes (e.g. one rule sorting colors as light/dark, a separate rule sorting metals as warm/cool undertone), describe each attribute using ONLY the classification that source actually applies to it. Do not blend them -- do not call a color "warm" or "cool" just because the same document discusses warm/cool for something else (metal tone). If the customer's situation touches an attribute the source doesn't classify the way they're asking about, say that plainly ("the guidance covers light-vs-dark for that color, not warm-vs-cool") rather than inventing a bridge between two separate rules.`;

const PERSONA_AND_RULES = `${PERSONA}\n\n${CONSTRAINTS}`;

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
 * given text into sentences and, for each, records which bracketed
 * markers ([1]-[5], [A1]-[A4]) appear in it -- a deterministic map from
 * prose back to the specific catalog/advice entries it cited, built by
 * parsing the model's own output rather than a second LLM call asked to
 * self-report its citations. Callers pass whatever text was actually
 * shown to the customer this turn (framing+glosses+closing for a
 * recommendation, decisions.md 2026-09-02) so the citation map covers all
 * of it, not just one piece.
 */
function mapCitations(text: string): CitationMapping[] {
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z#*])/).map((s) => s.trim()).filter(Boolean);
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

interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

/**
 * Wraps a canned base question (or the face-shape ask) in acknowledgment
 * and, where the facts allow it, a plain-language reason -- persona pass,
 * decisions.md 2026-09-02. The base question is the ONLY source of truth
 * for what's actually being asked; this call may not introduce a new
 * question, answer on the customer's behalf, or reference anything beyond
 * `facts` (already-established derivations only -- nothing about the
 * topic currently being asked, since by definition it hasn't been
 * answered yet, so there is nothing safe to explain about it beyond the
 * generic sense already baked into the base question text itself).
 */
async function generateWarmTurn(
  client: OpenAI,
  turns: Turn[],
  baseQuestionText: string,
  facts: DerivedFact[]
): Promise<{ text: string; usage: TokenUsage }> {
  const factsBlock =
    facts.length > 0
      ? `Facts already established this conversation that you may reference BRIEFLY if it's natural -- do not invent a mechanism beyond these:\n${facts.map((f) => `- ${f.explanation}`).join("\n")}`
      : "Nothing technical has been established yet -- do not invent a reason.";

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: PERSONA_AND_RULES },
    {
      role: "user",
      content:
        `Conversation so far:\n${turns.map((t) => `${t.role}: ${t.content}`).join("\n")}\n\n` +
        `${factsBlock}\n\n` +
        `Your task this turn: acknowledge what the customer just said -- specifically, referencing what they actually said, not a generic "got it" -- in one short sentence. Then ask exactly this question, in your own natural words, preserving its full meaning and every option it lists:\n"${baseQuestionText}"\n\n` +
        `2-3 sentences total. Do not answer the question for them. Do not ask about or hint at anything beyond this one question. No frame names, prices, or specs -- no frame has been selected yet.`,
    },
  ];

  const response = await client.chat.completions.create({
    model: CHAT_MODEL,
    temperature: CHAT_TEMPERATURE,
    messages,
  });

  return {
    text: response.choices[0]?.message?.content ?? baseQuestionText,
    usage: {
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
    },
  };
}

/**
 * Exported (decisions.md, 2026-09-02) so the golden-set runner can assert
 * on the EXACT string, not a duplicated copy that could silently drift
 * from what the code actually sends -- one source of truth for the one
 * message in this whole system that must never be paraphrased by an LLM.
 */
export const SAFETY_INTERRUPT_MESSAGES = {
  vision_symptom:
    "That's not something glasses can safely address, and it's not something I should guess about — please see an optometrist or ophthalmologist, especially if it's sudden or getting worse. I'm glad to keep helping you find frames once that's been checked out, or now if you'd rather set it aside.",
  medical_question:
    "Whether glasses can correct that is a question for an optometrist, not a frame recommendation — I don't want to imply a purchase here would resolve it. Happy to keep going on frame selection once you've had that checked, or we can pause here.",
} as const;

const ASK_LABELS: Record<QuestionTopic, string> = {
  purpose: "Asking what it's for",
  prescription: "Asking about your prescription",
  fit_issues: "Asking how your current pair fits",
  budget: "Asking about budget",
  style: "Asking about style",
};

interface RecommendationGeneration {
  framing: string;
  frameGlosses: { frame_id: string; gloss: string }[];
  closing: string;
  usage: TokenUsage;
}

/**
 * Structured, not freeform (decisions.md, 2026-09-02): the old single
 * freeform completion produced a numbered per-frame list with specs
 * duplicated from the cards, because there was no way to keep prose and
 * card facts separate without one. Function-calling enforces the split at
 * the schema level -- framing may not name a frame, each gloss is scoped
 * to one specific frame_id (constrained to the real candidate list, so
 * the model can't invent one), closing is free to reference frames only
 * by their existing bracket number.
 */
async function generateRecommendation(
  client: OpenAI,
  turns: Turn[],
  frameContext: string,
  adviceContext: string,
  derivedContext: string,
  relaxed: boolean,
  frameIds: string[]
): Promise<RecommendationGeneration> {
  const frameIdSchema = frameIds.length > 0 ? { type: "string" as const, enum: frameIds } : { type: "string" as const };

  const tool: ChatCompletionTool = {
    type: "function",
    function: {
      name: "compose_recommendation",
      description: "Structured recommendation reply -- keeps frame facts on the cards and prose limited to judgement, per the product decision that cards carry facts and prose carries judgement.",
      parameters: {
        type: "object",
        properties: {
          framing: {
            type: "string",
            description:
              "1-2 sentences opening the recommendation. Must NOT name any frame, price, or measurement -- those are already on the cards shown right after this. Warm, brief, grounded in the conversation so far.",
          },
          frame_glosses: {
            type: "array",
            description:
              "Exactly one entry per frame shown, same frames as the candidate list below, in the same order. Vary sentence structure and opening words ACROSS this array -- do not start every gloss the same way (e.g. every one beginning \"This is the...\"). Each frame gets a genuinely different sentence shape, not a template filled in five ways.",
            items: {
              type: "object",
              properties: {
                frame_id: frameIdSchema,
                gloss: {
                  type: "string",
                  description:
                    "ONE sentence of judgement/reasoning for why THIS frame specifically. No specs, no price, no measurements, no numeric lens-index or power-support figures -- all already on the card or in the machinery panel. May cite [n]/[A#].",
                },
              },
              required: ["frame_id", "gloss"],
              additionalProperties: false,
            },
          },
          closing: {
            type: "string",
            description:
              'One to three short paragraphs: your practical starting point (may reference a frame only by its existing bracket number, e.g. "[1]"), and any assumption made this turn stated plainly per rule 5, if one was made. May cite [n]/[A#]. Restating the customer\'s OWN stated budget number back to them is fine. What is NOT allowed, no exceptions: any frame\'s name, price, or measurement (lens width/height, weight, frame width in mm or g), any numeric lens-index recommendation (e.g. "1.5 index", "1.6 index"), and any numeric power-support spec (e.g. "supports up to 8D"). All of that is already on the cards or in the machinery panel -- restating it here is exactly the duplication this format exists to remove.',
          },
        },
        required: ["framing", "frame_glosses", "closing"],
        additionalProperties: false,
      },
    },
  };

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: PERSONA_AND_RULES },
    {
      role: "user",
      content:
        `Conversation so far:\n${turns.map((t) => `${t.role}: ${t.content}`).join("\n")}\n\n` +
        `${relaxed ? "Nothing matched every requirement -- nearest alternatives shown" : "Matching catalog frames"}:\n${frameContext || "(none found)"}\n\n` +
        `Retrieved advice (cite as [A#], respecting each one's claim_type):\n${adviceContext || "(none retrieved)"}\n\n` +
        `${derivedContext}`,
    },
  ];

  const response = await client.chat.completions.create({
    model: CHAT_MODEL,
    temperature: CHAT_TEMPERATURE,
    reasoning_effort: "none", // gpt-5.6-luna requires this for tool calls -- same constraint as extract-turn.ts/extract-filter.ts
    messages,
    tools: [tool],
    tool_choice: { type: "function", function: { name: "compose_recommendation" } },
  });

  const usage: TokenUsage = {
    promptTokens: response.usage?.prompt_tokens ?? 0,
    completionTokens: response.usage?.completion_tokens ?? 0,
  };

  const call = response.choices[0]?.message?.tool_calls?.[0];
  const fallback: RecommendationGeneration = {
    framing: "Here's what I'd suggest, based on everything so far:",
    frameGlosses: [],
    closing: "",
    usage,
  };
  if (!call || call.type !== "function") return fallback;

  try {
    const parsed = JSON.parse(call.function.arguments) as {
      framing: string;
      frame_glosses: { frame_id: string; gloss: string }[];
      closing: string;
    };
    return {
      framing: parsed.framing ?? fallback.framing,
      frameGlosses: parsed.frame_glosses ?? [],
      closing: parsed.closing ?? "",
      usage,
    };
  } catch {
    return fallback;
  }
}

/**
 * The restored third path (decisions.md, 2026-09-02): an earlier version
 * of this project routed every turn to one of clarify / recommend /
 * follow-up; this codebase had shrunk to two, so any conversation ended
 * at the recommendation with no way to ask about what's on screen.
 * Deliberately freeform text, not structured output -- unlike the
 * recommendation turn, a follow-up isn't producing a new set of cards to
 * keep separate from prose, it's answering a question about cards that
 * already exist. Scoped tightly: may reference only the frames already
 * shown (by their existing bracket number), may not introduce a new one,
 * and is explicitly told it may hold and state an opinion rather than
 * hedge equally across every option -- "which would you pick" deserves a
 * real answer, not "all three are excellent choices."
 */
async function generateFollowUp(
  client: OpenAI,
  turns: Turn[],
  lastRecommendation: { frames: { frame_id: string; text: string }[] }
): Promise<{ text: string; usage: TokenUsage }> {
  const frameContext = formatFrameContext(lastRecommendation.frames);

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: PERSONA_AND_RULES },
    {
      role: "user",
      content:
        `Conversation so far:\n${turns.map((t) => `${t.role}: ${t.content}`).join("\n")}\n\n` +
        `The frames already on screen -- reference these by their existing bracket number, never introduce one not listed here:\n${frameContext}\n\n` +
        `Your task: answer the customer's latest message as a follow-up about what's already shown. If they ask for an opinion or a pick, give a real one -- name a frame directly rather than hedging equally across all of them. Don't restate specs already on the cards (size, price, material -- the customer can already see those). Don't run a new search or introduce a frame not in the list above; if the answer genuinely isn't in what's shown (e.g. a color variant that doesn't exist in the catalog), say that plainly rather than inventing one. Every grounding rule still applies: no invented facts, hedge convention claims, never assert how something will look on them.`,
    },
  ];

  const response = await client.chat.completions.create({
    model: CHAT_MODEL,
    temperature: CHAT_TEMPERATURE,
    messages,
  });

  return {
    text: response.choices[0]?.message?.content ?? "",
    usage: {
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
    },
  };
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
      /** One sentence of judgement, always present (decisions.md, 2026-09-02) -- generated per-frame by generateRecommendation, never parsed out of flowing prose. */
      gloss: string;
    }[];
    sql: string;
    relaxed: boolean;
    /** Opens the turn, before the cards -- names no frame, price, or measurement. */
    framing: string;
    /** After the cards -- practical starting point and any assumption, may cite. */
    closing: string;
  };
}

/**
 * Runs one turn. `userMessage` is undefined only for the very first call,
 * to get the opening greeting without a customer message yet.
 */
export async function runTurn(
  state: ConversationState,
  userMessage: string | undefined,
  /**
   * Phase 8 (decisions.md, 2026-09-01). NOTE (2026-09-02): the
   * recommendation turn's generation call is now structured (function
   * calling), not a single freeform streamed completion, so there is no
   * longer a token-by-token stream to measure a first-token time against
   * -- this flag is accepted for backward compatibility with
   * scripts/measure-latency.ts but no longer has an effect. See
   * decisions.md for the honest accounting of what that leaves stale.
   */
  measureTTFT = false,
  /**
   * Phase 8 (decisions.md, 2026-09-01): opt-in, defaults false (matches
   * production's existing sequential SQL-then-advice-retrieval order).
   * When true, the two retrieval halves run concurrently via
   * Promise.all instead -- the 8c benchmark variant, A/B'd against the
   * default to measure the actual delta rather than assuming one.
   * Unaffected by the 2026-09-02 persona pass -- still only about the
   * two retrieval halves, unrelated to generation shape.
   */
  parallelizeRetrieval = false
): Promise<TurnResult> {
  void measureTTFT; // see note above -- accepted, no longer used
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

  // Turn 0, unconditional: the greeting (decisions.md, 2026-09-02) --
  // static, since there's nothing yet to acknowledge. Replaces the old
  // face-shape opener as the literal first message; face shape is now
  // asked one exchange later, once the customer has said something to
  // acknowledge. Not run through decideNextStep and not tracked in
  // askedTopics/QUESTION_CAP -- same reasoning as before, just relocated.
  if (userMessage === undefined) {
    turns.push({ role: "assistant", content: GREETING_TEXT });
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
      state: { slots, turns, askedTopics, assumedAtCap: state.assumedAtCap, status: "in_progress", history, faceShapeAsked: state.faceShapeAsked, lastRecommendation: state.lastRecommendation },
      assistantMessage: GREETING_TEXT,
    };
  }

  // Restored third path (decisions.md, 2026-09-02): an earlier version of this project
  // routed every turn to one of clarify / recommend / follow-up; this codebase had shrunk
  // to two, so a conversation could never continue past its recommendation. Once
  // state.status is already "done", any further message is a follow-up about what's on
  // screen, not a new clarify/recommend cycle -- deliberately no extraction-driven slot
  // updates and no new SQL/retrieval (generateFollowUp is scoped to state.lastRecommendation's
  // already-shown frames). Still runs extraction for the SAFETY CHECK only, discarding
  // any partial slots it finds -- safety must never be weaker just because a recommendation
  // already happened. The three-way split is the ConversationState itself (in_progress +
  // unanswered topics = clarify, in_progress -> sufficient = recommend, done = follow-up),
  // not a separate intent-classification model call -- deterministic and testable, the same
  // reasoning policy.ts's own header gives for keeping ask-order a rule, not a judgment call.
  if (state.status === "done") {
    turns.push({ role: "user", content: userMessage });

    const safetyCheckStart = Date.now();
    const safetyCheck = await extractTurn(client, state.turns, userMessage, slots);
    timingsMs.extraction = Date.now() - safetyCheckStart;
    modelCalls.push({
      label: "Checking for anything urgent",
      kind: "chat",
      promptTokens: safetyCheck.usage.promptTokens,
      completionTokens: safetyCheck.usage.completionTokens,
      costInr: costInr(safetyCheck.usage.promptTokens, safetyCheck.usage.completionTokens, "chat"),
      ms: timingsMs.extraction,
    });

    if (safetyCheck.safetyFlag !== "none") {
      const message = SAFETY_INTERRUPT_MESSAGES[safetyCheck.safetyFlag === "vision_symptom" ? "vision_symptom" : "medical_question"];
      turns.push({ role: "assistant", content: message });
      timingsMs.total = Date.now() - turnStart;
      history.push({
        turnIndex: history.length,
        userMessage,
        extractedPartial: {},
        safetyFlag: safetyCheck.safetyFlag,
        derivedFacts: [],
        assumptions: [],
        fittingRulesTotalCount: FITTING_RULES.length,
        modelCalls,
        timingsMs,
      });
      return {
        state: { slots, turns, askedTopics, assumedAtCap: state.assumedAtCap, status: "safety_interrupt", history, faceShapeAsked: state.faceShapeAsked, lastRecommendation: state.lastRecommendation },
        assistantMessage: message,
      };
    }

    const followUpStart = Date.now();
    const followUp = await generateFollowUp(client, turns, state.lastRecommendation ?? { frames: [] });
    timingsMs.generation = Date.now() - followUpStart;
    modelCalls.push({
      label: "Answering a follow-up",
      kind: "chat",
      promptTokens: followUp.usage.promptTokens,
      completionTokens: followUp.usage.completionTokens,
      costInr: costInr(followUp.usage.promptTokens, followUp.usage.completionTokens, "chat"),
      ms: timingsMs.generation,
    });
    turns.push({ role: "assistant", content: followUp.text });
    timingsMs.total = Date.now() - turnStart;
    history.push({
      turnIndex: history.length,
      userMessage,
      extractedPartial: {},
      safetyFlag: "none",
      derivedFacts: [],
      assumptions: [],
      fittingRulesTotalCount: FITTING_RULES.length,
      isFollowUp: true,
      modelCalls,
      timingsMs,
    });
    return {
      state: { slots, turns, askedTopics, assumedAtCap: state.assumedAtCap, status: "done", history, faceShapeAsked: state.faceShapeAsked, lastRecommendation: state.lastRecommendation },
      assistantMessage: followUp.text,
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
  // This message is a fixed string, NEVER routed through generation -- a structural
  // guarantee (not just a prompt rule) that persona warmth can never soften it, even after
  // several friendly turns (decisions.md, 2026-09-02).
  if (safetyFlag !== "none") {
    const message = SAFETY_INTERRUPT_MESSAGES[safetyFlag === "vision_symptom" ? "vision_symptom" : "medical_question"];
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
      state: { slots, turns, askedTopics, assumedAtCap: state.assumedAtCap, status: "safety_interrupt", history, faceShapeAsked: state.faceShapeAsked, lastRecommendation: state.lastRecommendation },
      assistantMessage: message,
    };
  }

  // New-opening flow, ask-order revised again (decisions.md, 2026-09-02):
  // purpose determines far more than face shape does, so it leads.
  // Face-shape fires exactly once, but the trigger is now "purpose is
  // known" (however it became known -- volunteered in the open reply, or
  // just asked+answered), not "this is literally the first reply." If the
  // open reply doesn't state purpose, this condition is false here and
  // falls through to decideNextStep below, which asks purpose first
  // (ASK_ORDER[0]) same as any other unanswered topic; once purpose is
  // known, THIS branch fires on the very next turn. Still takes priority
  // over decideNextStep once its condition is met, still outside
  // askedTopics/cap, same as before.
  if (!state.faceShapeAsked && topicIsAnswered("purpose", slots)) {
    const { facts } = deriveQuery(slots);
    const askStart = Date.now();
    const generated = await generateWarmTurn(client, turns, FACE_SHAPE_BASE_QUESTION, facts);
    timingsMs.generation = Date.now() - askStart;
    modelCalls.push({
      label: "Asking about face shape",
      kind: "chat",
      promptTokens: generated.usage.promptTokens,
      completionTokens: generated.usage.completionTokens,
      costInr: costInr(generated.usage.promptTokens, generated.usage.completionTokens, "chat"),
      ms: timingsMs.generation,
    });
    turns.push({ role: "assistant", content: generated.text });
    timingsMs.total = Date.now() - turnStart;
    history.push({
      turnIndex: history.length,
      userMessage,
      extractedPartial,
      safetyFlag,
      derivedFacts: facts,
      assumptions: [],
      fittingRulesTotalCount: FITTING_RULES.length,
      askingFaceShape: true,
      modelCalls,
      timingsMs,
    });
    return {
      state: { slots, turns, askedTopics, assumedAtCap: state.assumedAtCap, status: "in_progress", history, faceShapeAsked: true, lastRecommendation: state.lastRecommendation },
      assistantMessage: generated.text,
    };
  }

  const next = decideNextStep({ slots, turns, askedTopics, assumedAtCap: state.assumedAtCap, status: "in_progress", history, faceShapeAsked: state.faceShapeAsked });

  if (next.kind === "ask" && next.topic) {
    askedTopics = [...askedTopics, next.topic];
    const { facts } = deriveQuery(slots); // assumptions omitted -- see comment above, same reasoning
    const askStart = Date.now();
    const generated = await generateWarmTurn(client, turns, next.questionText!, facts);
    timingsMs.generation = Date.now() - askStart;
    modelCalls.push({
      label: ASK_LABELS[next.topic],
      kind: "chat",
      promptTokens: generated.usage.promptTokens,
      completionTokens: generated.usage.completionTokens,
      costInr: costInr(generated.usage.promptTokens, generated.usage.completionTokens, "chat"),
      ms: timingsMs.generation,
    });
    turns.push({ role: "assistant", content: generated.text });
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
      usedAlternateQuestion: next.usedAlternateQuestion,
      modelCalls,
      timingsMs,
    });
    return {
      state: { slots, turns, askedTopics, assumedAtCap: state.assumedAtCap, status: "in_progress", history, faceShapeAsked: state.faceShapeAsked, lastRecommendation: state.lastRecommendation },
      assistantMessage: generated.text,
    };
  }

  // Recommending: apply cap assumptions for anything still missing, then compile and generate.
  const capResult = applyCapAssumptions(slots);
  slots = capResult.slots;
  const assumedAtCap = [...new Set([...state.assumedAtCap, ...capResult.assumed])];

  const { filter, facts, assumptions } = deriveQuery(slots, true);

  // Phase 8 (decisions.md, 2026-09-01): the catalog half (SQL, relaxation if it
  // fires, ranking) and the advice half (embed the query, similarity search) don't
  // depend on each other's output -- only on `slots`/`filter`, computed above. Wrapped
  // as two functions so `runCatalogHalf`/`runAdviceHalf` can be awaited sequentially
  // (matches production today) or via Promise.all (the `parallelizeRetrieval` opt-in
  // benchmark variant) from the exact same code, not two hand-maintained copies that
  // could drift. Both mutate the shared `timingsMs`/`modelCalls` by reference, which is
  // safe either way since they write to disjoint fields.
  let relaxed = false;
  let relaxedDetails: { droppedClause: string; frame_id: string }[] | undefined;
  let neverRelaxBlockedDetails: { key: string; describe: string }[] | undefined;
  let sql = "";
  let sqlMatchCount = 0;
  let catalogTotalCount = 0;
  let ranked: ReturnType<typeof rankCandidates> = [];

  async function runCatalogHalf() {
    const sqlStart = Date.now();
    const { frames: sqlFrames, sql: compiledSql } = queryFrames(filter, MAX_FRAMES_SHOWN * 2);
    sql = compiledSql;
    sqlMatchCount = countMatches(filter);
    catalogTotalCount = countMatches({});
    timingsMs.sqlQuery = Date.now() - sqlStart;

    const safeFrames = filterUnsafeRimless(sqlFrames, slots.rx_power?.value);
    let candidateFrames = safeFrames;
    if (candidateFrames.length === 0) {
      relaxed = true;
      const relaxStart = Date.now();
      const { alternatives, neverRelaxBlocked } = findNearestAlternatives(filter, MAX_FRAMES_SHOWN);
      timingsMs.relaxationSearch = Date.now() - relaxStart;
      relaxedDetails = alternatives.map((a) => ({ droppedClause: a.droppedClause, frame_id: a.frame.frame_id }));
      if (neverRelaxBlocked.length > 0) {
        // "Fail loudly": surfaced in the machinery panel too, not just the server console warning
        // catalog-db.ts already emitted -- so declining outright is visibly CORRECT, not silent.
        neverRelaxBlockedDetails = neverRelaxBlocked.map((b) => ({ key: b.key, describe: b.describe }));
      }
      candidateFrames = filterUnsafeRimless(alternatives.map((a) => a.frame), slots.rx_power?.value);
    }

    ranked = rankCandidates(candidateFrames, slots).slice(0, MAX_FRAMES_SHOWN);
  }

  let adviceHits: AdviceHit[] = [];
  let adviceNearMisses: AdviceHit[] = [];

  async function runAdviceHalf() {
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
    const result = retrieveAdviceTopKWithNearMisses(embeddingResponse.data[0].embedding, MAX_ADVICE_SHOWN);
    adviceHits = result.hits;
    adviceNearMisses = result.nearMisses;
    timingsMs.adviceSearch = Date.now() - searchStart;
  }

  if (parallelizeRetrieval) {
    await Promise.all([runCatalogHalf(), runAdviceHalf()]);
  } else {
    await runCatalogHalf();
    await runAdviceHalf();
  }

  const rankedFacts = ranked.flatMap((r) => r.reasons);
  const frameContextRows = ranked.map((r) => ({ frame_id: r.frame.frame_id, text: getBlurb(r.frame.frame_id) }));
  const frameContext = formatFrameContext(frameContextRows);
  const adviceContext = formatAdviceContext(adviceHits);

  const derivedContext = formatDerivedFacts([...facts, ...rankedFacts], assumptions);

  const generationStart = Date.now();
  const generated = await generateRecommendation(
    client,
    turns,
    frameContext,
    adviceContext,
    derivedContext,
    relaxed,
    frameContextRows.map((r) => r.frame_id)
  );
  timingsMs.generation = Date.now() - generationStart;
  modelCalls.push({
    label: "Writing the answer",
    kind: "chat",
    promptTokens: generated.usage.promptTokens,
    completionTokens: generated.usage.completionTokens,
    costInr: costInr(generated.usage.promptTokens, generated.usage.completionTokens, "chat"),
    ms: timingsMs.generation,
  });

  // Product decision, not a formatting preference (decisions.md, 2026-09-02):
  // cards carry facts, prose carries judgement. `answer` (the flat transcript
  // text stored in turns[]/assistantMessage) is framing+closing only -- the
  // per-frame reasoning lives structurally on each card's own gloss, never
  // duplicated into the flowing prose. The citation map, though, is built from
  // ALL of it (framing + every gloss + closing) so the machinery panel's
  // citation audit still covers what the glosses cited, not just the prose.
  const glossByFrameId = new Map(generated.frameGlosses.map((g) => [g.frame_id, g.gloss]));
  const answer = [generated.framing, generated.closing].filter(Boolean).join("\n\n");
  const citationSourceText = [generated.framing, ...generated.frameGlosses.map((g) => g.gloss), generated.closing].filter(Boolean).join("\n\n");

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
      citations: mapCitations(citationSourceText),
    },
    timingsMs,
  });

  const droppedClauseByFrameId = new Map((relaxedDetails ?? []).map((d) => [d.frame_id, d.droppedClause]));
  // Soft near-miss, merged in only where the relaxation ladder didn't already set a HARD
  // one (decisions.md, 2026-09-02): a frame that clears every hard constraint but shares
  // none of a stated style preference is still a dropped requirement in the customer's own
  // words, and must render with the same amber near-miss treatment, not sit undifferentiated
  // among real matches -- computed structurally (styleMismatchClause), not left to whether
  // the model's own prose happens to mention it.
  for (const r of ranked) {
    if (!droppedClauseByFrameId.has(r.frame.frame_id)) {
      const soft = styleMismatchClause(r.frame, slots);
      if (soft) droppedClauseByFrameId.set(r.frame.frame_id, soft);
    }
  }

  const recommendedFrames = ranked.map((r) => ({
    frame_id: r.frame.frame_id,
    text: getBlurb(r.frame.frame_id),
    boost: r.boost,
    reasons: r.reasons,
    droppedClause: droppedClauseByFrameId.get(r.frame.frame_id),
    gloss: glossByFrameId.get(r.frame.frame_id) ?? "",
  }));

  return {
    state: {
      slots,
      turns,
      askedTopics,
      assumedAtCap,
      status: "done",
      history,
      faceShapeAsked: state.faceShapeAsked,
      // Restored third path (decisions.md, 2026-09-02): persisted so a follow-up turn
      // ("does it come in tortoise?", "which would you pick?") can answer about what's
      // actually on screen without re-running extraction/SQL/retrieval to rediscover it.
      lastRecommendation: { frames: recommendedFrames.map((f) => ({ frame_id: f.frame_id, text: f.text })) },
    },
    assistantMessage: answer,
    recommendation: {
      frames: recommendedFrames,
      sql,
      relaxed,
      framing: generated.framing,
      closing: generated.closing,
    },
  };
}

export { ASK_ORDER, QUESTION_CAP, topicIsAnswered, countDistinctRulesFired };
export type { QuestionTopic };
