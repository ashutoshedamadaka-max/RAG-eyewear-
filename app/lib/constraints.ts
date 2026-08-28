// Phase 2 harness, step 1: constraint-violation assertions against catalog
// columns. Deliberately no LLM judge -- every check here is a direct field
// comparison, so a "pass" means "provably true of the data," not "an LLM
// said it looked fine." PROJECT_CONTEXT.md §6.
import type { CatalogFrame } from "./retrieval";

export type Constraint =
  | { type: "max_price"; value: number }
  | { type: "material_equals"; value: string }
  | { type: "requires_in_stock" }
  | { type: "requires_purpose_tag"; value: string }
  | { type: "requires_polarized" }
  | { type: "requires_rim_type"; value: string }
  | { type: "requires_progressive_ready" }
  | { type: "requires_uv400" };

export interface Violation {
  constraint: Constraint;
  actual: unknown;
}

export function describeConstraint(c: Constraint): string {
  switch (c.type) {
    case "max_price":
      return `price <= ${c.value}`;
    case "material_equals":
      return `material == ${c.value}`;
    case "requires_in_stock":
      return "in_stock == true";
    case "requires_purpose_tag":
      return `purpose_tags includes ${c.value}`;
    case "requires_polarized":
      return "polarized == true";
    case "requires_rim_type":
      return `rim_type == ${c.value}`;
    case "requires_progressive_ready":
      return "progressive_ready == true";
    case "requires_uv400":
      return "uv400 == true";
  }
}

function checkOne(frame: CatalogFrame, c: Constraint): Violation | null {
  switch (c.type) {
    case "max_price":
      return frame.price_frame_only > c.value
        ? { constraint: c, actual: frame.price_frame_only }
        : null;
    case "material_equals":
      return frame.material !== c.value ? { constraint: c, actual: frame.material } : null;
    case "requires_in_stock":
      return frame.in_stock !== true ? { constraint: c, actual: frame.in_stock } : null;
    case "requires_purpose_tag": {
      const tags = Array.isArray(frame.purpose_tags) ? frame.purpose_tags : [];
      return !tags.includes(c.value) ? { constraint: c, actual: tags } : null;
    }
    case "requires_polarized":
      return frame.polarized !== true ? { constraint: c, actual: frame.polarized } : null;
    case "requires_rim_type":
      return frame.rim_type !== c.value ? { constraint: c, actual: frame.rim_type } : null;
    case "requires_progressive_ready":
      return frame.progressive_ready !== true
        ? { constraint: c, actual: frame.progressive_ready }
        : null;
    case "requires_uv400":
      return frame.uv400 !== true ? { constraint: c, actual: frame.uv400 } : null;
  }
}

export function checkFrame(frame: CatalogFrame, constraints: Constraint[]): Violation[] {
  return constraints.map((c) => checkOne(frame, c)).filter((v): v is Violation => v !== null);
}

/** Extracts "SKU XXX-999" mentions from free-text model output, in order of appearance. */
export function extractRecommendedSkus(answerText: string): string[] {
  const matches = answerText.matchAll(/SKU\s+([A-Z]+-\d+)/g);
  return Array.from(matches, (m) => m[1]);
}
