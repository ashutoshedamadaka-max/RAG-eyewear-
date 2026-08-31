// Golden-set ground truth was found to be circular (decisions.md 2026-08-28,
// "golden set ground truth was circular"): hand-written "nearest miss" claims
// had been eyeballed from what the naive baseline happened to retrieve,
// rather than computed from the catalog -- so a Phase 3 system that searches
// the whole catalog correctly would be marked wrong by a rubric built from a
// broken pipeline's output. This module replaces hand-written nearest-miss
// claims with a computed one: relax exactly one constraint at a time, keep
// the rest fixed, and take the cheapest catalog frame that now qualifies.
//
// For categorical constraints with an ordered domain (rim_type, material --
// decisions.md 2026-08-28 "ordered categorical relaxation"), relaxing walks
// outward tier by tier (rimless -> semi -> full) instead of dropping the
// constraint straight to "any value," so a rimless request doesn't resolve
// to a full-rim frame when a semi-rim one would have worked.
import { getAllFrames, type CatalogFrame } from "./retrieval";
import { checkFrame, describeConstraint, type Constraint } from "./constraints";
import { ORDERED_DOMAINS } from "./config/domains";

export interface NearestMiss {
  relaxed: string;
  frame_id: string;
  sku: string;
  brand: string;
  model: string;
  price_frame_only: number;
  violation: string;
  /** Set only when an ordered domain was walked -- which tier produced the result, e.g. ["semi"] or ["tr90","acetate"]. */
  domainTierUsed?: string[];
}

function domainInfoFor(c: Constraint): { column: string; value: string } | null {
  if (c.type === "requires_rim_type") return { column: "rim_type", value: c.value };
  if (c.type === "material_equals") return { column: "material", value: c.value };
  return null;
}

function cheapest(frames: CatalogFrame[]): CatalogFrame | undefined {
  return [...frames].sort(
    (a, b) => a.price_frame_only - b.price_frame_only || a.frame_id.localeCompare(b.frame_id)
  )[0];
}

/**
 * For each constraint in `constraints`, drops just that one, finds every
 * catalog frame satisfying all the others, and returns the cheapest such
 * frame along with why it still fails the dropped constraint. If the
 * dropped constraint has an ordered domain, tries the nearest tier(s)
 * first rather than jumping straight to "any value." Skips a constraint if
 * dropping it doesn't narrow anything (e.g. the case has only one
 * constraint) -- in that case "nearest miss" degenerates to "cheapest
 * frame in the whole catalog," which isn't a meaningful answer to the
 * original query and shouldn't be presented as one.
 */
export function computeNearestMisses(constraints: Constraint[]): NearestMiss[] {
  if (constraints.length < 2) return [];

  const frames = getAllFrames();
  const misses: NearestMiss[] = [];

  for (let i = 0; i < constraints.length; i++) {
    const relaxed = constraints[i];
    const others = constraints.filter((_, j) => j !== i);
    const passingOthers = frames.filter((f) => checkFrame(f, others).length === 0);

    let best: CatalogFrame | undefined;
    let domainTierUsed: string[] | undefined;

    const domainInfo = domainInfoFor(relaxed);
    if (domainInfo) {
      const domain = ORDERED_DOMAINS[domainInfo.column];
      const startTier = domain.findIndex((tier) => tier.includes(domainInfo.value));
      const tiersToTry = startTier >= 0 ? domain.slice(startTier + 1) : domain;

      for (const tier of tiersToTry) {
        const candidate = cheapest(passingOthers.filter((f) => tier.includes(f[domainInfo.column] as string)));
        if (candidate) {
          best = candidate;
          domainTierUsed = tier;
          break;
        }
      }
    } else {
      best = cheapest(passingOthers);
    }

    if (!best) continue; // still empty even after relaxing this one across the whole domain

    const violation = checkFrame(best, [relaxed])[0];

    misses.push({
      relaxed: describeConstraint(relaxed),
      frame_id: best.frame_id,
      sku: best.sku as string,
      brand: best.brand as string,
      model: best.model as string,
      price_frame_only: best.price_frame_only as number,
      violation: violation
        ? `${describeConstraint(violation.constraint)} fails (actual: ${JSON.stringify(violation.actual)})`
        : "satisfies all constraints (shouldn't happen if the case is genuinely empty)",
      ...(domainTierUsed ? { domainTierUsed } : {}),
    });
  }

  return misses;
}
