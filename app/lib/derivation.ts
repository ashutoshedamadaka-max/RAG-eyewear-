// Minimal derivation-rule functions extracted ahead of the full STATED ->
// DERIVED -> QUERY conversation layer (Phase 3+, PROJECT_CONTEXT.md §3).
// These exist now so the contested thresholds in lib/config/thresholds.ts
// are testable today, not just documented.
import {
  HIGH_INDEX_MAX_LENS_WIDTH_MM,
  HIGH_INDEX_RX_NARROW_THRESHOLD_D,
  HIGH_INDEX_RX_THRESHOLD_D,
} from "./config/thresholds";

export interface RimTypeDerivation {
  requiresNonRimless: boolean;
  maxLensWidthMm: number | null;
  reason: string;
}

/**
 * PROJECT_CONTEXT.md §3 derivation rules, rows 1-2:
 *   rx_power <= threshold        -> rim_type in {full, semi}
 *   rx_power <= narrowThreshold  -> + lens_width <= 54mm
 *
 * `threshold` is passed in (rather than imported directly) so the harness
 * can compare old vs. new values side by side.
 */
export function deriveRimTypeConstraint(
  rxPowerD: number,
  threshold = HIGH_INDEX_RX_THRESHOLD_D
): RimTypeDerivation {
  const requiresNonRimless = rxPowerD <= threshold;
  const narrow = rxPowerD <= HIGH_INDEX_RX_NARROW_THRESHOLD_D;

  return {
    requiresNonRimless,
    maxLensWidthMm: narrow ? HIGH_INDEX_MAX_LENS_WIDTH_MM : null,
    reason: requiresNonRimless
      ? `rx ${rxPowerD}D <= ${threshold}D threshold: rimless construction unreliable at this edge thickness`
      : `rx ${rxPowerD}D above ${threshold}D threshold: rimless still permitted`,
  };
}
