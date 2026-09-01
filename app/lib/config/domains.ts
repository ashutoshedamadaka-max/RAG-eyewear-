// Ordered relaxation domains for categorical constraints (decisions.md
// 2026-08-28, "ordered categorical relaxation"). When a categorical
// constraint can't be satisfied, walk outward through these tiers instead
// of dropping the constraint outright and taking whatever's cheapest -- a
// rimless request should resolve to semi-rim before full-rim; a titanium
// request should resolve to metal before tr90/acetate. Values within the
// same tier are treated as equally distant (tiebroken by price, same as
// everywhere else).
//
// Domains are exhaustive over the catalog's actual values (verified
// 2026-08-28: rim_type ∈ {full, rimless, semi}, material ∈ {acetate,
// metal, titanium, tr90}), so walking every tier is equivalent to the old
// "drop the constraint entirely" behavior -- this is a strict refinement,
// not a different fallback.
export const RIM_TYPE_DOMAIN: string[][] = [["rimless"], ["semi"], ["full"]];
export const MATERIAL_DOMAIN: string[][] = [["titanium"], ["metal"], ["tr90", "acetate"]];

/**
 * `face_width_fit` is ordered narrow < medium < wide (verified 2026-08-28
 * alongside rim_type/material, catalog's only other ordered categorical
 * column). Used two ways: the conversation layer's derivation rules
 * (Phase 5, PROJECT_CONTEXT.md §3) shift a target tier by one step for
 * `fit_issues ∋ splaying` (one size wider) or `pressing`/`cheekbone_contact`
 * (one size narrower); the relaxation ladder below can also walk it
 * outward like any other ordered domain if a shifted tier returns nothing.
 */
export const FACE_WIDTH_FIT_DOMAIN: string[][] = [["narrow"], ["medium"], ["wide"]];

/** Keyed by catalog column name, not by Constraint type -- both nearest-miss.ts and catalog-db.ts map their own constraint shapes onto this. */
export const ORDERED_DOMAINS: Record<string, string[][]> = {
  rim_type: RIM_TYPE_DOMAIN,
  material: MATERIAL_DOMAIN,
  face_width_fit: FACE_WIDTH_FIT_DOMAIN,
};
