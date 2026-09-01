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
 * The face-shape opener (PROJECT_CONTEXT.md §3, §7: tappable illustrations,
 * "skip / not sure" always available). Moved to turn 0 -- 2026-09-01, see
 * decisions.md -- ahead of `purpose`, because it used to live inside the
 * `style` topic at the END of ASK_ORDER, where it was structurally
 * unreachable: `purpose` is always answered first, so by the time `budget`
 * (the only other sufficiency-gating slot) was answered, the conversation
 * was already sufficient and never reached `style` at all. Asked
 * unconditionally, exactly once, at the very start of every conversation --
 * NOT tracked in `askedTopics` and does not count against `QUESTION_CAP`,
 * since it's a single tap costing nothing in constraint terms (a soft
 * ranking nudge, never a filter) and the user can always skip it.
 */
export const FACE_SHAPE_OPENER_TEXT =
  "Before anything else — tap whichever face shape looks closest to yours, or skip if you're not sure. It's just a styling nudge, never a requirement.";

const QUESTION_TEXT: Record<QuestionTopic, string> = {
  purpose: "What's this pair mainly for — everyday wear, sunglasses, computer or reading, or sports?",
  prescription:
    "Do you wear glasses now, and if so, do you know roughly how strong your prescription is? And do you need help seeing both far away and up close, or just one of those?",
  fit_issues: "Have your current glasses been sliding down, feeling tight, or leaving marks?",
  budget: "What's your budget for the frame?",
  // face_shape moved out to FACE_SHAPE_OPENER_TEXT (turn 0) -- style now covers style_prefs only.
  style: "Any particular style you lean toward — minimal, bold, retro, professional, sporty, playful? Totally optional.",
};

/** Whether a topic's question is already answered by what's STATED/DERIVED so far -- independent of whether it was ever literally asked, so a volunteered answer skips the question (PROJECT_CONTEXT.md §3: "skip anything already inferable"). */
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
      // face_shape no longer counts here -- it's asked separately at turn 0, outside ASK_ORDER.
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
  return { kind: "ask", topic, questionText: QUESTION_TEXT[topic] };
}
