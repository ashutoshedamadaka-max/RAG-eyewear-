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

/** Keyed by catalog column name, not by Constraint type -- both nearest-miss.ts and catalog-db.ts map their own constraint shapes onto this. */
export const ORDERED_DOMAINS: Record<string, string[][]> = {
  rim_type: RIM_TYPE_DOMAIN,
  material: MATERIAL_DOMAIN,
};
