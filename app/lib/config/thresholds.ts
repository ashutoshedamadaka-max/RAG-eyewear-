// Contested numeric thresholds, isolated here so a source disagreement is a
// one-line diff, not an inline literal buried in a derivation rule.
//
// See decisions.md (2026-08-28, "Contested thresholds" and "Threshold
// research resolved the progressive disagreement") for the full reasoning.

/**
 * Minimum FRAME height (mm, the "B" measurement -- the full vertical lens
 * opening) for a frame to be considered progressive-ready. Checked against
 * the catalog's `lens_height_mm` column, which is a B-height, not a
 * fitting height -- see below for why that distinction is the whole story.
 *
 * RESOLVED, not provisional: the original 30mm-vs-44mm disagreement (an
 * optician source citing >44mm) turned out to be two different
 * measurements being compared as if they were one. **Fitting height**
 * (pupil centre to lens bottom) runs 14-20mm across every vendor checked;
 * **frame/B-height** (the full vertical opening this constant actually
 * constrains) runs 24-34mm. The optician's 44mm could not be substantiated
 * in Rodenstock, Zeiss, or HOYA documentation (OptiCampus doesn't publish
 * per-product figures) and should be treated as unsupported, not just as
 * a stricter alternative — see decisions.md for what was actually checked.
 *
 * Sources (data/advice/, claim_type: physical):
 * - Rodenstock *Tips & Technology 2022*, Table 2-3: minimum frame height
 *   24mm (short corridor) / 26mm (medium) / 28mm (long) / up to 34mm
 *   (individual design); near-comfort and other product lines documented
 *   up to 36mm.
 * - OptiCampus *Progressive Lens Dispensing* (Meister, 2008): "For most
 *   general purpose progressive lenses, a minimum depth of 25-30mm is
 *   recommended" — explicitly labelled "Depth 'B'" in the source diagram.
 *
 * 32mm sits inside Rodenstock's documented range (just above the
 * short/medium design-type values, below their long-corridor and
 * near-comfort maximums) and just above OptiCampus's general-purpose
 * range — a reasonable choice for a catalog meant to include some
 * longer-corridor designs, not a resolved single clinical number (the
 * sources themselves give a range depending on corridor length, not one
 * figure). At 44mm, only 26 of 100 catalog frames would qualify (16
 * non-sunglasses), down from 72 at the old unconstrained value — nearly
 * collapsing the progressive-ready query class and making the "no
 * progressive-ready rimless frames" intentional catalog gap meaningless.
 * That consequence is why parameterising this rather than adopting the
 * unverified 44mm figure outright mattered in practice, not just in
 * principle — see decisions.md.
 */
export const PROGRESSIVE_MIN_B_HEIGHT_MM = 32;

/**
 * Lens-index recommendation is a FUNCTION now, not a scalar threshold --
 * see `app/lib/derivation.ts#assessLensIndex`. A single "-3.00D" cutoff
 * (the previous version of this file) can't represent two real effects:
 * sag depth scales with roughly frame-size squared, so a large lens
 * should get the recommendation earlier than a small one at the same Rx;
 * and minus lenses are edge-thick while plus lenses are centre-thick, so
 * the same diopter threshold doesn't mean the same thing for +3.00 and
 * -3.00. These constants are the tunable knobs that function reads --
 * still not expert-validated numbers, but now the axes being adjusted are
 * named instead of collapsed into one threshold.
 *
 * Tier boundaries (|Rx power|, diopters) -- same provenance dispute as
 * before (project default -4.00D vs. optician source -2.00D for the point
 * where non-rimless construction is required), now expressed as the
 * "recommended" tier boundary rather than a single on/off threshold:
 * standard <2.00D, consider 2.00-4.00D, recommended 4.00-6.00D, high
 * (1.67/1.74 territory) >6.00D.
 */
export const LENS_INDEX_TIER_BOUNDARIES_D = { consider: 2.0, recommended: 4.0, high: 6.0 };

/**
 * "Large" lens_width_mm, relative to this catalog: 75th percentile
 * (46-60mm range, median 52mm, verified 2026-08-28). Sag depth scales
 * with roughly diameter^2, so a frame at or above this width pulls every
 * tier boundary earlier by `SIZE_SHIFT_D`.
 */
export const LARGE_LENS_WIDTH_MM = 55;
export const SIZE_SHIFT_D = 1.0;

/** Semi/rimless mounts expose more edge thickness on a minus lens than a full rim does; pulls the tier boundary earlier by this much. Not applied to plus lenses -- see PLUS_LENS_SHIFT_D. */
export const EDGE_EXPOSURE_SHIFT_D = 0.5;

/** Plus lenses are centre-thick, not edge-thick -- the cosmetic/weight concern is real but less urgent per diopter than a minus lens's edge thickness. Delays every tier boundary by this much and this project models plus power as never triggering the rimless-construction hard constraint (see assessLensIndex). */
export const PLUS_LENS_SHIFT_D = 1.5;

/** Preserved from the original scalar rule: at or beyond this (minus) power, cap lens_width_mm too -- edge thickness at this magnitude isn't just a rim-type problem. */
export const HIGH_INDEX_RX_NARROW_THRESHOLD_D = -6.0;
export const HIGH_INDEX_MAX_LENS_WIDTH_MM = 54;

/**
 * 1.74 is capped out of rimless recommendations regardless of how high the
 * tier goes -- material strength for drill-mounting, not thinness, is the
 * limiting factor. Source: TTUHSC "The Art and Science of Rimless
 * Eyewear" (data/advice/ttuhsc-rimless-lens-materials.md) tensile
 * strength table -- 1.74 measures 31.6 kgf vs. 1.67's 67.3 kgf and 1.60's
 * 80.5 kgf. This is a real, specific, sourced number, not a hedge.
 */
export const RIMLESS_MAX_INDEX = 1.67;
