// Answer pills (decisions.md, 2026-09-04): per-topic pill configuration.
// Every pill's `value` is typed against the canonical enums in
// lib/conversation/types.ts (a zero-import file, safe to pull into
// client code) via `Record<EnumMember, ...>` -- if that file's union
// types ever gain or lose a member, TypeScript fails to compile here
// until this file is updated, instead of the two silently drifting
// apart. `phrase` is deliberately NOT always identical to `label`:
// `label` is button text, `phrase` is the natural-language fragment
// folded into the composed message and sent through the exact same
// extraction pipeline typed text goes through -- several phrases below
// are copied verbatim from extract-turn.ts's own mapping examples
// ("sliding down my nose" -> slipping, "just one distance" -> single,
// etc.) specifically because those exact phrasings are already proven
// to extract correctly.
import type { ProductType, PurposeTag, FitIssue, StylePref } from "@/lib/conversation/types";

export interface PillOption {
  /** Unique within its group -- the React key and the toggle-selection tracking key. */
  id: string;
  label: string;
  phrase: string;
}

export interface PillGroup {
  /** "toggle": multi-select, accumulate then submit via a Continue action. "immediate": tapping submits this pill's phrase alone, right away. */
  mode: "toggle" | "immediate";
  options: PillOption[];
}

export interface TopicPillConfig {
  groups: PillGroup[];
}

/**
 * Not every enum member gets a pill -- e.g. `purpose` has 9 real tags but
 * only 6 read as natural one-tap answers to "what's it mainly for"
 * (`driving_night`, `dust_travel`, `reading` stay reachable through free
 * text, where `reading` is better served by the product_type pill below
 * anyway). `Partial<Record<...>>` keeps every key here checked against
 * the real union type -- a typo or a renamed enum member fails to
 * compile -- without forcing every member to have a pill.
 */
const PRODUCT_TYPE_LABELS: Partial<Record<ProductType, { label: string; phrase: string }>> = {
  eyeglasses: { label: "Eyeglasses", phrase: "eyeglasses" },
  sunglasses: { label: "Sunglasses", phrase: "sunglasses" },
  reading: { label: "Reading glasses", phrase: "reading glasses" },
  computer: { label: "Computer glasses", phrase: "computer glasses" },
};

const PURPOSE_LABELS: Partial<Record<PurposeTag, { label: string; phrase: string }>> = {
  everyday: { label: "Everyday wear", phrase: "everyday wear" },
  formal_work: { label: "Office / work", phrase: "office wear" },
  driving_day: { label: "Driving", phrase: "driving" },
  outdoor: { label: "Outdoors", phrase: "outdoor use" },
  sports: { label: "Sports", phrase: "sports" },
  computer: { label: "Screens / computer", phrase: "computer work" },
};

const FIT_ISSUE_LABELS: Partial<Record<FitIssue, { label: string; phrase: string }>> = {
  // Phrased verbatim from extract-turn.ts's own fit_issues mapping examples.
  slipping: { label: "Sliding down", phrase: "sliding down my nose" },
  pressing: { label: "Feels tight", phrase: "feels tight at the sides" },
  marks: { label: "Leaves marks", phrase: "leaves marks" },
};

const STYLE_PREF_LABELS: Record<StylePref, { label: string; phrase: string }> = {
  minimal: { label: "Minimal", phrase: "minimal" },
  bold: { label: "Bold", phrase: "bold" },
  retro: { label: "Retro", phrase: "retro" },
  professional: { label: "Professional", phrase: "professional" },
  sporty: { label: "Sporty", phrase: "sporty" },
  playful: { label: "Playful", phrase: "playful" },
};

function pillsFrom<K extends string>(prefix: string, labels: Partial<Record<K, { label: string; phrase: string }>>): PillOption[] {
  return (Object.entries(labels) as [K, { label: string; phrase: string }][]).map(([value, { label, phrase }]) => ({
    id: `${prefix}-${value}`,
    label,
    phrase,
  }));
}

export const TOPIC_PILLS: Record<string, TopicPillConfig> = {
  purpose: {
    groups: [
      {
        mode: "toggle",
        options: [...pillsFrom("purpose", PURPOSE_LABELS), ...pillsFrom("product", PRODUCT_TYPE_LABELS)],
      },
    ],
  },
  prescription: {
    groups: [
      {
        mode: "immediate",
        options: [
          { id: "lens-single", label: "Distance only", phrase: "Just one distance." },
          { id: "lens-reading", label: "Reading only", phrase: "Just for reading." },
          { id: "lens-progressive", label: "Both", phrase: "I need help seeing both far and up close." },
        ],
      },
      {
        mode: "immediate",
        options: [{ id: "rx-unknown", label: "I don't know my prescription", phrase: "I'm not sure what my prescription is." }],
      },
    ],
  },
  fit_issues: {
    groups: [
      { mode: "toggle", options: pillsFrom("fit", FIT_ISSUE_LABELS) },
      { mode: "immediate", options: [{ id: "fit-none", label: "No problems", phrase: "No fit issues." }] },
    ],
  },
  budget: {
    groups: [
      {
        mode: "immediate",
        options: [
          { id: "budget-under-1500", label: "Under ₹1,500", phrase: "Keep it under ₹1,500." },
          { id: "budget-1500-3000", label: "₹1,500–3,000", phrase: "My budget is between ₹1,500 and ₹3,000." },
          { id: "budget-3000-5000", label: "₹3,000–5,000", phrase: "My budget is between ₹3,000 and ₹5,000." },
          { id: "budget-5000-plus", label: "₹5,000+", phrase: "My budget is at least ₹5,000." },
        ],
      },
    ],
  },
  style: {
    groups: [
      { mode: "toggle", options: pillsFrom("style", STYLE_PREF_LABELS) },
      { mode: "immediate", options: [{ id: "style-none", label: "No preference", phrase: "Nothing specific, surprise me." }] },
    ],
  },
};

/** How a toggle group's selected phrases become one message -- `style` gets a light sentence wrapper; everything else is a plain comma-joined fragment. Either way it's still just ordinary text through the same extraction call. */
export function composeToggleMessage(topic: string, phrases: string[]): string {
  if (topic === "style") return `I lean toward a ${phrases.join(", ")} style.`;
  return `${phrases.join(", ")}.`;
}
