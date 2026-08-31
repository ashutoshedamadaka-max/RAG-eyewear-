// Minimal derivation-rule functions extracted ahead of the full STATED ->
// DERIVED -> QUERY conversation layer (Phase 3+, PROJECT_CONTEXT.md §3).
// These exist now so the contested thresholds in lib/config/thresholds.ts
// are testable today, not just documented.
import {
  EDGE_EXPOSURE_SHIFT_D,
  HIGH_INDEX_MAX_LENS_WIDTH_MM,
  HIGH_INDEX_RX_NARROW_THRESHOLD_D,
  LARGE_LENS_WIDTH_MM,
  LENS_INDEX_TIER_BOUNDARIES_D,
  PLUS_LENS_SHIFT_D,
  RIMLESS_MAX_INDEX,
  SIZE_SHIFT_D,
} from "./config/thresholds";

export type LensIndexTier = "standard" | "consider" | "recommended" | "high";
export type RimType = "full" | "semi" | "rimless";

export interface LensIndexAssessment {
  tier: LensIndexTier;
  suggestedIndex: number;
  requiresNonRimless: boolean;
  maxLensWidthMm: number | null;
  reason: string;
}

/**
 * Replaces the old single-threshold `deriveRimTypeConstraint` (decisions.md
 * 2026-08-28, "high-index should be a function, not a threshold"). Two
 * real effects a scalar threshold can't represent:
 *
 * - Sag depth scales with roughly diameter^2, so a large lens should get
 *   the high-index recommendation earlier (at a lower |Rx|) than a small
 *   one -- and rimless/semi-rim mounts expose more of that edge on a
 *   minus lens than a full rim does.
 * - Minus lenses are edge-thick; plus lenses are centre-thick. The same
 *   |Rx| threshold doesn't mean the same thing for +3.00 and -3.00 --
 *   this function never requires non-rimless construction for a plus
 *   lens, because plus-lens edges are thin regardless of power.
 *
 * See app/lib/config/thresholds.ts for the tunable constants and their
 * provenance, and data/advice/ttuhsc-rimless-lens-materials.md for why
 * rimless mounts are capped at 1.67 rather than always recommending the
 * highest available index (1.74 has lower tensile strength for
 * drill-mounting, not just less of a thinness benefit).
 */
export function assessLensIndex(
  rxPowerD: number,
  lensWidthMm: number,
  rimType: RimType
): LensIndexAssessment {
  const isPlus = rxPowerD > 0;
  const absPower = Math.abs(rxPowerD);
  const isLarge = lensWidthMm >= LARGE_LENS_WIDTH_MM;
  const edgeExposed = rimType !== "full";

  const notes: string[] = [];
  let adjusted = absPower;

  if (isLarge) {
    adjusted += SIZE_SHIFT_D;
    notes.push(`large lens (${lensWidthMm}mm >= ${LARGE_LENS_WIDTH_MM}mm) -- sag depth scales ~diameter^2, recommend earlier`);
  }
  if (edgeExposed && !isPlus) {
    adjusted += EDGE_EXPOSURE_SHIFT_D;
    notes.push(`${rimType} mount exposes edge thickness on a minus lens, recommend earlier`);
  }
  if (isPlus) {
    adjusted -= PLUS_LENS_SHIFT_D;
    notes.push("plus lens is centre-thick, not edge-thick -- cosmetic/weight concern is less urgent per diopter than a minus lens's edge thickness");
  }

  const { consider, recommended, high } = LENS_INDEX_TIER_BOUNDARIES_D;
  let tier: LensIndexTier;
  if (adjusted < consider) tier = "standard";
  else if (adjusted < recommended) tier = "consider";
  else if (adjusted < high) tier = "recommended";
  else tier = "high";

  let suggestedIndex: number;
  switch (tier) {
    case "standard":
      suggestedIndex = 1.5;
      break;
    case "consider":
      suggestedIndex = 1.6;
      break;
    case "recommended":
      suggestedIndex = 1.67;
      break;
    case "high":
      suggestedIndex = rimType === "rimless" ? RIMLESS_MAX_INDEX : 1.74;
      if (rimType === "rimless") {
        notes.push(
          `capped at ${RIMLESS_MAX_INDEX} for rimless mounting -- 1.74 has lower tensile strength (drill-mount risk), not just a thinness trade-off`
        );
      }
      break;
  }

  // Rimless/edge-drilling hard constraint: a minus-lens concern only --
  // plus-lens edges are thin regardless of power, so rimless mounting
  // isn't structurally compromised the way it is for a minus lens.
  const requiresNonRimless = !isPlus && (tier === "recommended" || tier === "high");

  // Preserved from the original scalar rule, evaluated on RAW power (not
  // size/geometry-adjusted) to avoid a feedback loop with the lens-width
  // input itself.
  const maxLensWidthMm = !isPlus && absPower >= Math.abs(HIGH_INDEX_RX_NARROW_THRESHOLD_D)
    ? HIGH_INDEX_MAX_LENS_WIDTH_MM
    : null;

  return {
    tier,
    suggestedIndex,
    requiresNonRimless,
    maxLensWidthMm,
    reason: `rx ${rxPowerD}D, ${lensWidthMm}mm lens, ${rimType} rim -> adjusted severity ${adjusted.toFixed(2)}D (${notes.join("; ") || "no adjustments"}), tier=${tier}`,
  };
}
