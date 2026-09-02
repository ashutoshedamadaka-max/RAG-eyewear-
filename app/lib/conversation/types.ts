// Phase 5: the multi-turn conversation layer (PROJECT_CONTEXT.md §3). This
// file defines the STATED layer's shape only -- DERIVED and QUERY are
// compiled from it in derive.ts, not stored here, so there is never a
// second copy of a value to let drift out of sync with its source.

export type SlotSource = "stated" | "derived" | "assumed";

/** Every slot value carries where it came from and how sure the system is -- surfaced to the user for `assumed`, explainable on demand for `derived`. */
export interface SlotValue<T> {
  value: T;
  source: SlotSource;
  confidence: number; // 0-1. 1.0 for stated/derived-from-a-hard-rule; lower for a heuristic derivation or an assumed default.
  /** Present for source=derived: which rule produced it, for "why do you ask" / citation purposes. Present for source=assumed: what would change if the assumption is wrong. */
  reason?: string;
}

export type ProductType = "eyeglasses" | "sunglasses" | "reading" | "computer" | "sports";
export type RxStatus = "none" | "has_rx" | "unknown";
export type LensType = "single" | "progressive" | "bifocal" | "reading";
export type FitIssue =
  | "slipping"
  | "splaying"
  | "pressing"
  | "cheekbone_contact"
  | "pinching"
  | "marks"
  | "heavy"
  | "slides_sport";
export type FaceShape = "oval" | "round" | "square" | "heart" | "rectangle" | "unsure";
export type StylePref = "minimal" | "bold" | "retro" | "professional" | "sporty" | "playful";
export type SafetyFlag = "vision_symptom" | "medical_question" | "none";

/**
 * The STATED slot table (PROJECT_CONTEXT.md §3). Deliberately does NOT
 * include rim_type, material, lens index, or nose_pad_type -- those are
 * DERIVED-only per the vocabulary policy (rule 2: "technical attributes
 * are derived, never solicited"). If a future change adds a slot here
 * that names a technical attribute, that's the policy violation the rule
 * exists to catch.
 */
export interface Slots {
  product_type?: SlotValue<ProductType>;
  purpose?: SlotValue<string[]>;
  screen_hours?: SlotValue<number>;
  rx_status?: SlotValue<RxStatus>;
  rx_power?: SlotValue<number>;
  lens_type?: SlotValue<LensType>;
  reading_power?: SlotValue<number>;
  fit_issues?: SlotValue<FitIssue[]>;
  budget_min?: SlotValue<number>;
  budget_max?: SlotValue<number>;
  face_shape?: SlotValue<FaceShape>;
  style_prefs?: SlotValue<StylePref[]>;
  safety_flag?: SlotValue<SafetyFlag>;
  /** Free-text signals not yet mapped to a slot above but useful context for derivation/generation (e.g. "close-set eyes", "flat nose bridge"). Not part of the Slots table in §3, but needed to carry the bridge_mm/nose_pad_type soft-derivation inputs that have no dedicated STATED slot of their own. */
  nose_profile?: SlotValue<"flat" | "prominent">;
  eye_spacing?: SlotValue<"close_set" | "wide_set">;
  face_length_ratio?: SlotValue<"long" | "typical">;
}

export type SlotName = keyof Slots;

/** Only the fields the user actually addressed this turn -- never a whole-state replacement (PROJECT_CONTEXT.md §3: "a partial update each turn ... never the whole state, so nothing is silently clobbered"). */
export type PartialSlots = Partial<Slots>;

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

export type QuestionTopic = "purpose" | "prescription" | "fit_issues" | "budget" | "style";

/**
 * Phase 6: one snapshot per processed turn, capturing what the machinery
 * actually did -- not a second source of truth (the real state is
 * `slots`/`turns`/etc. above), just an audit trail of *how* each turn's
 * contribution to that state was produced, for the "show the machinery"
 * toggle. Every field here is data the pipeline already computes to do
 * its job; nothing here changes what the pipeline decides.
 */
export interface DerivedFactRecord {
  explanation: string;
  source?: string;
  /** Which app/lib/conversation/derive.ts#FITTING_RULES entry this came from -- lets the UI dedupe rankCandidates' one-fact-per-matching-frame output into "N distinct rules fired," computed, never hardcoded. */
  ruleId?: string;
}
export interface AdviceHitRecord {
  chunk_id: string;
  score: number;
  claim_type: string;
  source_org: string;
  doc_id: string;
  section_heading: string;
}
export interface CitationMapping {
  sentence: string;
  citedMarkers: string[]; // e.g. ["[2]", "[A1]"]
}

/**
 * Interface work (2026-09-01, decisions.md): one entry per OpenAI call made
 * this turn, in call order, with REAL token counts read off the response's
 * `usage` field -- never estimated. `label` is the plain-language gloss
 * for the machinery panel's stage 5 ("Reading your answers into fields,"
 * not "extraction call"); `kind` distinguishes chat calls (billed on both
 * prompt and completion tokens) from the embedding call (prompt tokens
 * only) since app/lib/config/pricing.ts prices them differently.
 */
export interface ModelCallUsage {
  label: string;
  kind: "chat" | "embedding";
  promptTokens: number;
  completionTokens: number;
  costInr: number;
  ms: number;
}

export interface TurnMachinery {
  turnIndex: number;
  userMessage?: string;
  /** Exactly what this turn's extraction added -- the partial update, before merge, so a mind-change is visible as a diff against the slots recorded on the PRIOR entry. */
  extractedPartial: PartialSlots;
  safetyFlag: SafetyFlag;
  /** Derivation rules that fire against the CUMULATIVE slots as of this turn -- recomputed every turn (cheap, pure) so the constraint set is visible building up even before a recommendation exists. */
  derivedFacts: DerivedFactRecord[];
  assumptions: DerivedFactRecord[];
  /** FITTING_RULES.length -- the total number of distinct rule categories that COULD have fired, so the panel can show "N of M" honestly. Same value every turn (it's a property of the code, not the conversation), included per-turn so the UI never has to import derive.ts's registry directly. */
  fittingRulesTotalCount: number;
  askedTopic?: QuestionTopic;
  /** New-opening flow (decisions.md, 2026-09-02): true only on the one turn that acknowledges the customer's first open reply and asks for face shape -- the client uses this, not turn position, to know when to show the face-shape chips. */
  askingFaceShape?: boolean;
  recommendation?: {
    sql: string;
    sqlMatchCount: number;
    /** Real `countMatches({})` against the live catalog -- so the UI's "N of M frames matched" never hardcodes the catalog size (2026-09-01, decisions.md: every count in the machinery panel must be computed from data). */
    catalogTotalCount: number;
    relaxed: boolean;
    relaxedDetails?: { droppedClause: string; frame_id: string }[];
    /** "Fail loudly" (2026-09-01, decisions.md): never-relax constraints (progressive lens height, UV400, Rx compatibility) that were confirmed to be the actual blocker -- present only when declining outright is the correct, verified behavior, not a silent gap. */
    neverRelaxBlocked?: { key: string; describe: string }[];
    adviceHits: AdviceHitRecord[];
    /** Chunks that scored below MIN_ADVICE_SCORE (advice-retrieval.ts) but were close enough to be worth showing what the floor actually excluded -- see retrieveAdviceTopKWithNearMisses. */
    adviceNearMisses: AdviceHitRecord[];
    citations: CitationMapping[];
  };
  /** Every OpenAI call made this turn, in order -- powers both stage 5 (timing) and stage 6 (cost) from the same real data, so the two panels can never disagree about how many calls happened. */
  modelCalls: ModelCallUsage[];
  timingsMs: {
    extraction?: number;
    sqlQuery?: number;
    /** The embeddings.create call itself -- a model call, billed, timed separately from the pure-compute similarity search below. */
    adviceEmbedding?: number;
    /** Cosine similarity + floor filter over already-fetched embeddings -- pure compute, no model call, no cost. */
    adviceSearch?: number;
    /** findNearestAlternatives -- only present when the relaxation ladder actually fires (Phase 8, decisions.md 2026-09-01: previously uncounted, folded silently into nothing). */
    relaxationSearch?: number;
    generation?: number;
    /** Only present when runTurn was called with measureTTFT=true (the Phase 8 benchmark) -- the default, non-streaming production path has no first-token event to measure. */
    generationTTFT?: number;
    total: number;
  };
}

export interface ConversationState {
  slots: Slots;
  turns: Turn[];
  /** Which topics have already been asked -- tracked separately from slot values, since "asked and the customer said no issues" must not look identical to "never asked" (both leave fit_issues undefined). Length is what the 5-question cap counts against, not turns.length or questionsAsked. */
  askedTopics: QuestionTopic[];
  /** Slots explicitly assumed (never answered) once the question cap was hit, or because the answer was "unknown", so the UI/eval can check the assumption was actually surfaced. */
  assumedAtCap: SlotName[];
  status: "in_progress" | "safety_interrupt" | "recommending" | "done";
  /** Phase 6: one entry per processed turn (including the opening turn), for the machinery toggle. */
  history: TurnMachinery[];
  /** New-opening flow (decisions.md, 2026-09-02): the face-shape ask has moved off turn 0 -- it's now asked (with acknowledgment) right after the customer's first open reply to the greeting, exactly once. This tracks whether that's happened yet, independent of askedTopics (face_shape stays outside ASK_ORDER and the question cap, same as before). */
  faceShapeAsked: boolean;
}

export function emptyState(): ConversationState {
  return { slots: {}, turns: [], askedTopics: [], assumedAtCap: [], status: "in_progress", history: [], faceShapeAsked: false };
}
