// Contested numeric thresholds, isolated here so a source disagreement is a
// one-line diff, not an inline literal buried in a derivation rule.
//
// Both values below are PROVISIONAL MIDPOINTS, not expert-validated. See
// decisions.md (2026-08-28, "Contested thresholds") for the full reasoning.

/**
 * Minimum lens height (mm) for a frame to be considered progressive-ready.
 *
 * - Project default (pre-optician): 30mm.
 * - Optician source: >44mm, for 25mm-zone varifocal blending.
 * - Set here: 32mm.
 *
 * Provenance: the optician's 44mm figure is correct for a full progressive
 * corridor but empties the catalog too far to be usable as a demo/eval
 * threshold — at 44mm only 26 of 100 frames qualify (16 non-sunglasses),
 * down from 72 at the old 30mm value, which nearly collapses the
 * progressive-ready query class and makes the "no progressive-ready
 * rimless frames" intentional catalog gap meaningless (there'd be almost
 * nothing progressive-ready to be rimless in the first place). 32mm is
 * defensible as a floor for short-corridor progressives, which do fit in
 * the low 30s. Treat this as a placeholder pending confirmation from the
 * optician on whether 32mm is acceptable for a short-corridor product line,
 * not as a resolved clinical threshold.
 */
export const PROGRESSIVE_MIN_LENS_HEIGHT_MM = 32;

/**
 * Rx power (diopters, negative = myopic) at or beyond which a frame must be
 * full-rim or semi-rim (rimless construction becomes unreliable to drill/edge
 * at this thickness) and high-index lens material should be advised.
 *
 * - Project default (pre-optician): -4.00D.
 * - Optician source: -2.00D.
 * - Set here: -3.00D.
 *
 * Provenance: the optician's source material is ~40% advocacy for
 * independent-optician value over volume retail (see decisions.md,
 * "claim_type: opinion"), and a lower threshold sells more lens upgrades —
 * that commercial interest doesn't make -2.00D wrong, but it's reason
 * enough not to adopt it outright. -3.00D is a provisional midpoint
 * between the two, not a clinically re-derived value.
 */
export const HIGH_INDEX_RX_THRESHOLD_D = -3.0;

/** Second hard threshold on the same rim_type rule: caps lens width too. */
export const HIGH_INDEX_RX_NARROW_THRESHOLD_D = -6.0;
export const HIGH_INDEX_MAX_LENS_WIDTH_MM = 54;
