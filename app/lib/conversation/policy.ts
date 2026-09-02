// Phase 5: sufficiency, question ordering, the five-question cap, and
// question phrasing (PROJECT_CONTEXT.md §3 "Question phrasing" and
// "Sufficiency and stopping"). Deterministic on purpose -- which question
// to ask next is a lookup over what's already known, not something that
// benefits from an LLM call, and a deterministic policy is what makes the
// golden-set cases (mind-change, volunteers-everything, question cap)
// checkable without a judge.
import type { ConversationState, QuestionTopic, Slots } from "./types";

export const ASK_ORDER: QuestionTopic[] = ["purpose", "prescription", "fit_issues", "budget", "style"];
export const QUESTION_CAP = 5;

/**
 * New-opening flow (decisions.md, 2026-09-02): the very first thing said,
 * before anything is asked. A warm, static greeting -- static because
 * there's nothing to react to yet, so an LLM call here would only add
 * latency for zero benefit. Introduces the assistant by name and opens
 * with a genuinely open question, so the customer states their situation
 * in their own words before being asked to tap anything.
 */
export const GREETING_TEXT =
  "Hi, I'm Specs — I help people find frames that actually work for them, not just look nice on a shelf. What's going on: shopping for something specific, or not sure where to start?";

/**
 * The face-shape ask (PROJECT_CONTEXT.md §3, §7: tappable illustrations,
 * "skip / not sure" always available). Originally turn 0 verbatim
 * (2026-09-01); moved again (2026-09-02) to right after the customer's
 * first open reply to GREETING_TEXT, so the assistant acknowledges what
 * they actually said before asking anything -- this text is now an INPUT
 * to a warm generation pass (converse.ts), not shown verbatim, but its
 * content (optional, styling nudge, never a requirement) is still exactly
 * what must be preserved. Still asked unconditionally, exactly once,
 * still NOT tracked in `askedTopics` and still doesn't count against
 * `QUESTION_CAP` -- see ConversationState.faceShapeAsked (types.ts) for
 * how "asked yet" is now tracked instead of turn position.
 */
export const FACE_SHAPE_BASE_QUESTION =
  "Before we go further — tap whichever face shape looks closest to yours, or skip if you're not sure. It's just a styling nudge, never a requirement.";

/**
 * Every topic's question, and -- audited across all five ASK_ORDER topics
 * plus the separate face-shape ask (decisions.md, 2026-09-02) -- an
 * explicit `precondition` wherever the default question can stop applying
 * given what's already known, with an `alternateQuestionText` that asks
 * something genuinely useful instead of either a contradiction or a
 * silent skip. Audit result: only `fit_issues` has a real one.
 *
 * - purpose: no precondition -- always applicable, nothing upstream of it.
 * - prescription: no precondition -- this is the question that ESTABLISHES
 *   rx_status; nothing can precede it.
 * - fit_issues: HAS one. Its default phrasing ("have your current glasses
 *   been sliding...") presupposes the customer currently owns eyewear.
 *   Found live (2026-09-02): a customer who'd just said "I don't wear
 *   glasses" was asked this anyway, one turn after the assistant itself
 *   acknowledged they don't wear glasses. Precondition: `rx_status !==
 *   "none"`. Alternate: ask about past experience instead of current fit,
 *   which is both askable and actually useful for a first-time or
 *   between-pairs customer.
 * - budget: no precondition -- always applicable regardless of anything
 *   else known.
 * - style: no precondition -- already phrased as optional ("Totally
 *   optional"), and asking it is harmless regardless of what else is known.
 */
interface TopicDefinition {
  questionText: string;
  /** Returns false when the default questionText doesn't apply given current slots. */
  precondition?: (slots: Slots) => boolean;
  /** Used instead of questionText when precondition() returns false. */
  alternateQuestionText?: string;
}

const TOPIC_DEFINITIONS: Record<QuestionTopic, TopicDefinition> = {
  purpose: {
    questionText: "What's this pair mainly for — everyday wear, sunglasses, computer or reading, or sports?",
  },
  prescription: {
    questionText:
      "Do you wear glasses now, and if so, do you know roughly how strong your prescription is? And do you need help seeing both far away and up close, or just one of those?",
  },
  fit_issues: {
    questionText: "Have your current glasses been sliding down, feeling tight, or leaving marks?",
    precondition: (slots) => slots.rx_status?.value !== "none",
    alternateQuestionText: "Have you worn glasses before, and if so, was there anything about the fit you didn't like?",
  },
  budget: {
    questionText: "What's your budget for the frame?",
  },
  style: {
    // face_shape moved out to FACE_SHAPE_BASE_QUESTION -- this covers style_prefs only.
    questionText: "Any particular style you lean toward — minimal, bold, retro, professional, sporty, playful? Totally optional.",
  },
};

/** The question text to actually ask for a topic right now -- the default, or the precondition-driven alternate. Single source of truth `decideNextStep` and `converse.ts` both read from, so the two can never disagree about which text applies. */
export function questionTextFor(topic: QuestionTopic, slots: Slots): { text: string; usedAlternate: boolean } {
  const def = TOPIC_DEFINITIONS[topic];
  if (def.precondition && !def.precondition(slots) && def.alternateQuestionText) {
    return { text: def.alternateQuestionText, usedAlternate: true };
  }
  return { text: def.questionText, usedAlternate: false };
}

/** Whether a topic's question is already answered by what's STATED/DERIVED so far -- independent of whether it was ever literally asked, so a volunteered answer skips the question (PROJECT_CONTEXT.md §3: "skip anything already inferable"). Deliberately does NOT special-case fit_issues on rx_status="none" -- that precondition is handled by asking a DIFFERENT, applicable question (above), not by skipping the topic outright; skipping was tried and reverted the same day once the "replace with something useful" requirement made skipping the wrong fix. */
export function topicIsAnswered(topic: QuestionTopic, slots: Slots): boolean {
  switch (topic) {
    case "purpose":
      return Boolean((slots.purpose?.value.length ?? 0) > 0 || slots.product_type);
    case "prescription":
      // rx_status="none" (doesn't wear glasses at all) makes lens_type moot -- don't
      // hold the topic open waiting for an answer to a question that no longer applies.
      // Otherwise (has_rx / unknown) lens_type still matters independent of whether the
      // exact power is known, so both must be answered.
      if (!slots.rx_status) return false;
      if (slots.rx_status.value === "none") return true;
      return Boolean(slots.lens_type);
    case "fit_issues":
      return Boolean(slots.fit_issues);
    case "budget":
      return Boolean(slots.budget_min || slots.budget_max);
    case "style":
      // face_shape no longer counts here -- it's asked separately, outside ASK_ORDER.
      return Boolean((slots.style_prefs?.value.length ?? 0) > 0);
  }
}

/** PROJECT_CONTEXT.md §3 sufficiency rule, verbatim: product_type AND budget AND at least one of {purpose, rx_power}. */
export function isSufficient(slots: Slots): boolean {
  const hasProduct = Boolean(slots.product_type);
  const hasBudget = Boolean(slots.budget_min || slots.budget_max);
  const hasPurposeOrRx = Boolean((slots.purpose?.value.length ?? 0) > 0 || slots.rx_power !== undefined);
  return hasProduct && hasBudget && hasPurposeOrRx;
}

export interface NextStep {
  kind: "ask" | "recommend";
  topic?: QuestionTopic;
  questionText?: string;
  /** True when the topic's precondition failed and the ALTERNATE question text was used instead of the default -- exposed so the machinery panel and golden-set checks can assert on it structurally, not by parsing prose. */
  usedAlternateQuestion?: boolean;
}

/**
 * The core policy decision, called after each turn's extraction+derivation
 * has been merged into state.slots.
 *
 * Sufficiency short-circuit is gated by `askedTopics.length <= 1`
 * (2026-09-01, see decisions.md) -- fixed after the live-transcript review
 * found that ANY topic positioned after the one that happens to complete
 * sufficiency is structurally unreachable, purely by where it sits in
 * ASK_ORDER, independent of whether it was "meant to be askable." Since
 * `purpose` is always asked first and virtually always satisfies its leg of
 * sufficiency immediately, and `budget` sits right before `style`,
 * `style` was permanently dead code in any normal multi-turn flow --
 * reachable only if a user volunteered everything in one shot (the
 * `askedTopics.length <= 1` case this gate preserves) or never happened to
 * state a purpose. The fix: sufficiency alone recommends immediately only
 * at the very first decision point (nothing or just the opening topic
 * asked so far) -- that's what "volunteers everything upfront" tests.
 * Once genuinely mid-flow (2+ topics already asked), sufficiency being met
 * is not on its own reason to stop; the remaining ask-order topics still
 * get asked until the list is exhausted or the cap is hit, exactly like
 * before. A topic can still become unreachable if the CAP is hit first --
 * that's the deliberate "assume and state it" path (§3), not a bug.
 */
export function decideNextStep(state: ConversationState): NextStep {
  const canShortCircuitOnSufficiency = state.askedTopics.length <= 1;
  if (canShortCircuitOnSufficiency && isSufficient(state.slots)) return { kind: "recommend" };

  const unasked = ASK_ORDER.filter(
    (topic) => !state.askedTopics.includes(topic) && !topicIsAnswered(topic, state.slots)
  );

  if (unasked.length === 0 || state.askedTopics.length >= QUESTION_CAP) {
    return { kind: "recommend" };
  }

  const topic = unasked[0];
  const { text, usedAlternate } = questionTextFor(topic, state.slots);
  return { kind: "ask", topic, questionText: text, usedAlternateQuestion: usedAlternate };
}
