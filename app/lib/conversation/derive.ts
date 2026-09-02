// Phase 5: STATED -> DERIVED -> QUERY (PROJECT_CONTEXT.md §3's derivation
// table). Every function here takes STATED slots and returns either a
// DERIVED SlotValue (explainable, cites a rule) or a piece of the compiled
// QUERY (StructuredFilter for the hard WHERE half; a ranking function for
// the soft ORDER BY half). Nothing here talks to the LLM -- derivation is
// deterministic by design, the same reason app/lib/constraints.ts grades
// catalog facts without a judge (PROJECT_CONTEXT.md §6): the inputs are
// structured, so a rule is the right tool, not a model call.
import type { CatalogFrame } from "../retrieval";
import type { StructuredFilter } from "../catalog-db";
import { assessLensIndex, type RimType } from "../derivation";
import { PROGRESSIVE_MIN_B_HEIGHT_MM } from "../config/thresholds";
import { FACE_WIDTH_FIT_DOMAIN } from "../config/domains";
import type { Slots } from "./types";

export interface DerivedFact {
  /** Human-readable explanation, ready to surface on demand ("why do you ask" / citation-style). */
  explanation: string;
  /** data/advice/ doc_id this rule traces to, when the derivation is `physical` (PROJECT_CONTEXT.md §3: "every rule traces to a document"). Omitted for rules that are pure catalog-schema logic (e.g. purpose -> uv400) with no advice-corpus citation of their own. */
  source?: string;
  /** Which FITTING_RULES entry produced this fact -- lets a caller dedupe rankCandidates' one-fact-per-matching-frame output back down to "how many distinct rules fired," for the machinery panel's "N of M" count (interface work, 2026-09-01, decisions.md: that count has to be computed from real returned data, never a hardcoded label). */
  ruleId?: string;
}

/**
 * The full registry of distinct fitting-rule CATEGORIES this module can
 * check -- both deriveQuery's hard/soft QUERY-compile rules and
 * rankCandidates' per-frame ranking rules. Existing purely so
 * `FITTING_RULES.length` is an honest, code-derived denominator for "N of
 * M rules fired," not a number typed by hand and left to drift out of
 * sync with what's actually implemented. Every `ruleId` used in a
 * `facts.push`/`reasons.push` call below must appear here exactly once.
 */
export const FITTING_RULES: { id: string; description: string }[] = [
  { id: "uv400_outdoor", description: "outdoor/daytime-driving -> UV400 required" },
  { id: "driving_night_no_tint", description: "night driving -> no tint, exclude polarized" },
  { id: "sports_wrap_weight", description: "sports -> wrapped frame + 22g weight ceiling" },
  { id: "computer_screen_hours", description: "6+ screen hours -> blue-light/AR worth asking" },
  { id: "progressive_min_height", description: "progressive lenses -> minimum lens height (never relaxed)" },
  { id: "rimless_rx_cap", description: "rx power (known or assumed) -> rimless/edge-thickness safety cap" },
  { id: "fit_width_shift", description: "splaying/pressing/cheekbone_contact -> face-width-fit shift" },
  { id: "fit_slipping_nose_pad", description: "slipping -> adjustable/silicone nose pads" },
  { id: "fit_marks_heavy_weight", description: "marks/heavy -> weight ceiling" },
  { id: "nose_profile_flat", description: "flat nose profile -> adjustable nose pads" },
  { id: "face_shape_boost", description: "face_shape -> +0.15 ranking boost (soft, never a filter)" },
  { id: "style_prefs_overlap", description: "style_prefs -> ranking boost on tag overlap" },
  { id: "eye_spacing_close_set", description: "close-set eyes -> bridge-width ranking boost" },
  { id: "eye_spacing_wide_set", description: "wide-set eyes -> bridge-width ranking boost" },
  { id: "nose_profile_prominent", description: "prominent nose bridge -> fixed acetate bridge ranking boost" },
  { id: "long_face_lens_height", description: "long face ratio -> taller lens-height ranking boost" },
  { id: "lens_index_annotation", description: "rx power + candidate lens width/rim -> lens-index tier note" },
];

export interface DerivedResult {
  filter: StructuredFilter;
  facts: DerivedFact[];
  /** Assumptions the derivation had to make because a STATED value was missing -- e.g. no rx_power given, so rimless-safety defaulted to "assume moderate." Surfaced to the user per the vocabulary policy's "honest tension" section. */
  assumptions: DerivedFact[];
}

const WIDTH_TIERS = FACE_WIDTH_FIT_DOMAIN.map((t) => t[0]); // ["narrow", "medium", "wide"]

function shiftWidthTier(current: string | undefined, steps: number): string | undefined {
  const idx = current ? WIDTH_TIERS.indexOf(current) : 1; // default to "medium" if no stated/known width
  if (idx < 0) return current;
  const shifted = Math.min(WIDTH_TIERS.length - 1, Math.max(0, idx + steps));
  return WIDTH_TIERS[shifted];
}

/**
 * Compiles everything STATED so far into a StructuredFilter (hard WHERE)
 * plus a list of DerivedFacts (for citations/explanations) and assumptions
 * (for the "surfaced to the user" requirement). Pure function of the slots
 * -- callable every turn, not just once, since a partial update can change
 * what's derivable.
 * `allowRxAssumption` (interface work, 2026-09-01, decisions.md): a real
 * bug caught by a live smoke test of the machinery panel -- when
 * `rx_status` is simply not yet known (never undefined !== "none" holds
 * true), `effectiveRx` was defaulting to an assumed -4.00D on EVERY call,
 * including ask-turns before prescription has even been asked, so the
 * "rimless_rx_cap" fact and its assumption note fired prematurely, the
 * exact same category of bug already fixed once for `converse.ts`'s
 * `assumptions` display (this is the `facts` side of the same issue,
 * introduced when ruleId-tagging added an unconditional `facts.push` for
 * this rule that didn't exist before). Defaults false so ask/interrupt
 * turns never see a premature rimless-safety note; the recommend-turn
 * call site in `converse.ts` passes `true` explicitly, since only there
 * is "assume a moderate prescription" a real fallback being applied to a
 * real compiled query, not a preview of something that might happen.
 */
export function deriveQuery(slots: Slots, allowRxAssumption = false): DerivedResult {
  const filter: StructuredFilter = {};
  const facts: DerivedFact[] = [];
  const assumptions: DerivedFact[] = [];

  if (slots.product_type) filter.product_type = slots.product_type.value;
  if (slots.budget_min) filter.min_price = slots.budget_min.value;
  if (slots.budget_max) filter.max_price = slots.budget_max.value;

  const purposeTags = slots.purpose?.value ?? [];
  if (purposeTags.length > 0) filter.purpose_tags = purposeTags;

  // purpose -> uv400 (hard, never relax)
  if (purposeTags.some((p) => p === "outdoor" || p === "driving_day")) {
    filter.requires_uv400 = true;
    facts.push({ explanation: "outdoor/daytime-driving use requires UV400-rated lenses -- never relaxed, even if nothing else in budget has it.", ruleId: "uv400_outdoor" });
  }
  // purpose -> driving_night: no tint, exclude polarized
  if (purposeTags.includes("driving_night")) {
    filter.excludes_polarized = true;
    filter.tint_color = "none";
    facts.push({ explanation: "night driving excludes polarized and tinted lenses -- both reduce light transmission exactly when you need more of it, not less.", ruleId: "driving_night_no_tint" });
  }
  // purpose -> sports: wrap + weight ceiling
  if (purposeTags.includes("sports")) {
    filter.requires_wrap = true;
    filter.max_weight_g = Math.min(filter.max_weight_g ?? 22, 22);
    facts.push({ explanation: "sports use requires a wrapped frame (stays put during movement) and a weight ceiling of 22g.", ruleId: "sports_wrap_weight" });
  }
  // purpose + screen_hours -> blue light / AR (advice-only soft signal, not a hard filter -- surfaced in generation, not compiled into WHERE)
  if (purposeTags.includes("computer") && (slots.screen_hours?.value ?? 0) >= 6) {
    facts.push({ explanation: "6+ hours of daily screen time makes blue-light-ready lenses and anti-reflective coating worth asking about -- soft signal, not a hard filter.", ruleId: "computer_screen_hours" });
  }

  // lens_type = progressive -> min lens height, hard, never relax
  if (slots.lens_type?.value === "progressive") {
    filter.min_lens_height_mm = PROGRESSIVE_MIN_B_HEIGHT_MM;
    facts.push({
      explanation: `progressive lenses require a frame with at least ${PROGRESSIVE_MIN_B_HEIGHT_MM}mm of vertical lens height (the "B" measurement) to blend the near/far zones without distortion -- never relaxed.`,
      source: "opticampus-progressive-lens-dispensing",
      ruleId: "progressive_min_height",
    });
  }

  // rx_power -> rimless safety cap (max_power_supported >= |rx|) and lens-index tier, using assessLensIndex
  const rxPower = slots.rx_power?.value;
  const rxKnown = slots.rx_status?.value === "has_rx" && rxPower !== undefined;
  const assumedRx = allowRxAssumption && !rxKnown && slots.rx_status?.value !== "none"; // "none" (no glasses needed) legitimately has no power to assume
  const effectiveRx = rxKnown ? rxPower! : assumedRx ? -4.0 : undefined;

  if (effectiveRx !== undefined) {
    filter.min_max_power_supported = Math.abs(effectiveRx);
    facts.push({
      explanation: `rimless/edge-thickness safety check applied at ${effectiveRx}D (max_power_supported >= ${Math.abs(effectiveRx)}).`,
      ruleId: "rimless_rx_cap",
    });
    if (assumedRx) {
      assumptions.push({
        explanation: `no prescription power given -- assumed a moderate -4.00D so rimless/edge-thickness safety checks still run. If yours is stronger, some picks (especially rimless ones) may not hold up; know it roughly, or check a receipt or your optometrist's records.`,
        ruleId: "rimless_rx_cap",
      });
    }
    // Lens-index / rim-type interaction: assessLensIndex needs a lens width and rim type, neither
    // of which is known before a candidate frame exists -- so this runs per-candidate at ranking
    // time (see rankAndAnnotate below), not here. What IS compileable now is the coarse signal:
    // at high severity, note it as a fact so the generator can mention lens-index advice even
    // before a specific frame is chosen.
  }

  // fit_issues -> face_width_fit shift, nose_pad_type, weight ceiling
  const fitIssues = slots.fit_issues?.value ?? [];
  let widthShift = 0;
  if (fitIssues.includes("splaying")) widthShift += 1;
  if (fitIssues.includes("pressing") || fitIssues.includes("cheekbone_contact")) widthShift -= 1;
  if (widthShift !== 0) {
    const shifted = shiftWidthTier(undefined, widthShift);
    if (shifted) {
      filter.face_width_fit = shifted;
      facts.push({
        explanation: fitIssues.includes("splaying")
          ? "temple arms splaying outward means the frame is too small -- shifted to a wider face-width fit."
          : "temple arms pressing inward or cheekbone contact means the frame is too wide -- shifted to a narrower face-width fit.",
        source: "optician-guide-anatomical-fit",
        ruleId: "fit_width_shift",
      });
    }
  }
  if (fitIssues.includes("slipping")) {
    filter.nose_pad_type = ["adjustable", "silicone"];
    facts.push({ explanation: "sliding down the nose (vertical, not width) calls for adjustable or silicone nose pads that can be tuned to grip.", source: "optician-guide-anatomical-fit", ruleId: "fit_slipping_nose_pad" });
  }
  if (fitIssues.includes("marks") || fitIssues.includes("heavy")) {
    filter.max_weight_g = Math.min(filter.max_weight_g ?? 25, 25);
    facts.push({ explanation: "marks or a heavy-feeling frame -> capped at 25g.", ruleId: "fit_marks_heavy_weight" });
  }

  // Free-text nose-profile / eye-spacing signals (no dedicated STATED slot column in §3's table, carried on Slots as auxiliary fields)
  if (slots.nose_profile?.value === "flat") {
    filter.nose_pad_type = filter.nose_pad_type ?? ["adjustable"];
    facts.push({ explanation: "a flat nose profile needs adjustable nose pads to keep the frame from hitting the eyelashes.", source: "optician-guide-anatomical-fit", ruleId: "nose_profile_flat" });
  }

  return { filter, facts, assumptions };
}

/**
 * Derivation table row 1: `assessLensIndex(...).requiresNonRimless` ->
 * `rim_type ∈ {full, semi}`, hard. This can't be a single SQL column
 * filter because the assessment depends on each candidate's own
 * `lens_width_mm` (a large lens fails earlier than a small one at the
 * same Rx) -- so it runs as a post-SQL filter over whatever candidates
 * the hard WHERE already narrowed to, before ranking.
 */
export function filterUnsafeRimless(frames: CatalogFrame[], rxPower: number | undefined): CatalogFrame[] {
  if (rxPower === undefined) return frames;
  return frames.filter((frame) => {
    if (frame.rim_type !== "rimless") return true;
    if (typeof frame.lens_width_mm !== "number") return true;
    const assessment = assessLensIndex(rxPower, frame.lens_width_mm, "rimless");
    return !assessment.requiresNonRimless;
  });
}

export interface RankedFrame {
  frame: CatalogFrame;
  boost: number;
  reasons: DerivedFact[];
}

/**
 * A SOFT near-miss, distinct from the relaxation ladder's HARD one
 * (catalog-db.ts's `droppedClause`, produced only when a real WHERE
 * clause had to be dropped). This one fires when a frame clears every
 * hard constraint but shares NONE of the customer's stated style
 * preference -- a real gap, not a hard-constraint violation, but still a
 * dropped requirement in the customer's own words ("something classic"),
 * and it deserves the same near-miss treatment on the card, not silent
 * inclusion among frames that actually match (decisions.md, 2026-09-02:
 * "any frame that drops a stated requirement must render as a
 * near-miss"). Computed structurally from the same style_tags/style_prefs
 * overlap check rankCandidates already does for the boost, not parsed out
 * of generated prose -- returns undefined (no near-miss) whenever the
 * customer never stated a style preference at all, or this frame does
 * share one.
 */
export function styleMismatchClause(frame: CatalogFrame, slots: Slots): string | undefined {
  const stylePrefs = slots.style_prefs?.value ?? [];
  if (stylePrefs.length === 0) return undefined;
  const frameStyles = (frame.style_tags as string[] | undefined) ?? [];
  const overlap = stylePrefs.some((s) => frameStyles.includes(s));
  if (overlap) return undefined;
  return `your stated style preference (${stylePrefs.join(", ")})`;
}

/**
 * The soft-ORDER-BY half of the compile step. Runs after the hard SQL
 * filter narrows candidates (catalog-db.ts, unchanged) -- this project
 * deliberately keeps ranking in JS rather than folding it into the SQL
 * query, since every soft signal here is capped and additive, not a SQL
 * concern, and none of it may ever exclude a frame (face_shape most of
 * all -- PROJECT_CONTEXT.md §3: "no convention-tagged claim is ever
 * allowed to exclude a frame").
 */
export function rankCandidates(frames: CatalogFrame[], slots: Slots): RankedFrame[] {
  const faceShape = slots.face_shape?.value;
  const stylePrefs = slots.style_prefs?.value ?? [];
  const eyeSpacing = slots.eye_spacing?.value;
  const noseProfile = slots.nose_profile?.value;
  const longFace = slots.face_length_ratio?.value === "long";
  const rxPower = slots.rx_power?.value;

  const ranked: RankedFrame[] = frames.map((frame) => {
    let boost = 0;
    const reasons: DerivedFact[] = [];

    if (faceShape && faceShape !== "unsure") {
      const suits = (frame.face_shape_suits as string[] | undefined) ?? [];
      if (suits.includes(faceShape)) {
        boost += 0.15; // capped, matches PROJECT_CONTEXT.md §3 exactly
        reasons.push({
          explanation: `conventionally suggested for a ${faceShape} face shape -- a styling nudge, not a fitting requirement.`,
          source: "optician-guide-style-and-complexion",
          ruleId: "face_shape_boost",
        });
      }
    }

    if (stylePrefs.length > 0) {
      const frameStyles = (frame.style_tags as string[] | undefined) ?? [];
      const overlap = stylePrefs.filter((s) => frameStyles.includes(s)).length;
      if (overlap > 0) {
        boost += Math.min(0.1, overlap * 0.05);
        reasons.push({ explanation: `matches ${overlap} of your stated style preference${overlap === 1 ? "" : "s"} -- a soft ranking nudge.`, ruleId: "style_prefs_overlap" });
      }
    }

    const bridge = frame.bridge_mm as number | undefined;
    if (eyeSpacing === "close_set" && bridge !== undefined && bridge >= 14 && bridge <= 18) {
      boost += 0.05;
      reasons.push({ explanation: "bridge width in the 14-18mm range suits close-set eyes.", source: "optician-guide-anatomical-fit", ruleId: "eye_spacing_close_set" });
    }
    if (eyeSpacing === "wide_set" && bridge !== undefined && bridge >= 19 && bridge <= 22) {
      boost += 0.05;
      reasons.push({ explanation: "bridge width in the 19-22mm range suits wide-set eyes.", source: "optician-guide-anatomical-fit", ruleId: "eye_spacing_wide_set" });
    }

    if (noseProfile === "prominent" && frame.nose_pad_type === "fixed_integrated" && frame.material === "acetate") {
      boost += 0.05;
      reasons.push({ explanation: "a prominent nose bridge is often better served by a fixed acetate bridge than adjustable pads.", source: "optician-guide-anatomical-fit", ruleId: "nose_profile_prominent" });
    }

    if (longFace) {
      const lensHeight = frame.lens_height_mm as number | undefined;
      if (lensHeight !== undefined && lensHeight >= 40) {
        boost += 0.05;
        reasons.push({ explanation: "a long face (length >= 1.5x width) balances better with a taller lens opening.", source: "optician-guide-anatomical-fit", ruleId: "long_face_lens_height" });
      }
    }

    if (rxPower !== undefined && frame.lens_width_mm !== undefined && frame.rim_type) {
      const assessment = assessLensIndex(rxPower, frame.lens_width_mm as number, frame.rim_type as RimType);
      reasons.push({
        explanation: `at ${rxPower}D in this frame's ${frame.lens_width_mm}mm lens, ${assessment.reason} -- suggested index ${assessment.suggestedIndex}.`,
        source: "ttuhsc-rimless-lens-materials",
        ruleId: "lens_index_annotation",
      });
    }

    return { frame, boost, reasons };
  });

  ranked.sort((a, b) => b.boost - a.boost);
  return ranked;
}
