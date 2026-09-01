// Phase 3 hybrid pipeline: real SQL over the catalog, built by
// app/scripts/build-catalog-db.ts into data/catalog/out/catalog.db. This is
// the "SQL / structured filters" half of PROJECT_CONTEXT.md §1's hybrid
// architecture -- the direct answer to what the naive baseline (Phase 1)
// couldn't do: enforce a numeric or categorical constraint rather than just
// rank by similarity to it.
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getFrameById, type CatalogFrame } from "./retrieval";
import { ORDERED_DOMAINS } from "./config/domains";

const DB_PATH = path.resolve(process.cwd(), "..", "data", "catalog", "out", "catalog.db");

let db: DatabaseSync | undefined;
function getDb(): DatabaseSync {
  if (!db) db = new DatabaseSync(DB_PATH, { readOnly: true });
  return db;
}

export interface StructuredFilter {
  product_type?: string;
  material?: string;
  max_price?: number;
  min_price?: number;
  purpose_tags?: string[];
  requires_in_stock?: boolean;
  requires_polarized?: boolean;
  requires_uv400?: boolean;
  requires_progressive_ready?: boolean;
  rim_type?: string;
  // Added Phase 5 (PROJECT_CONTEXT.md §3 derivation table) -- every column
  // below already existed in catalog.db (app/scripts/build-catalog-db.ts);
  // this just exposes them as filterable, which the single-shot extraction
  // pipelines (hybrid.ts, orchestrated.ts) never needed but the
  // conversation layer's DERIVED->QUERY compile step does.
  /** `lens_type = progressive` -> PROGRESSIVE_MIN_B_HEIGHT_MM. Hard, never relax. */
  min_lens_height_mm?: number;
  /** rimless request / rx-compatibility check -> `max_power_supported >= |rx_power|`. */
  min_max_power_supported?: number;
  /** `fit_issues ∋ marks | heavy` -> weight_g <= 25. */
  max_weight_g?: number;
  /** `fit_issues ∋ slipping` (adjustable/silicone) or flat nose profile (adjustable). */
  nose_pad_type?: string[];
  /** Shifted by splaying (wider)/pressing/cheekbone_contact (narrower) -- exact tier, already shifted by the derivation layer, not a range here. */
  face_width_fit?: string;
  /** `purpose ∋ sports` -> wrap_angle > 0. */
  requires_wrap?: boolean;
  /** `purpose ∋ driving_night` excludes polarized (glare/dashboard-glass conflict) and requires no tint. */
  excludes_polarized?: boolean;
  tint_color?: string;
}

type FilterKey = keyof StructuredFilter;

interface CompiledClause {
  key: FilterKey;
  sql: string;
  params: (string | number)[];
  describe: string;
}

function compileClauses(filter: StructuredFilter): CompiledClause[] {
  const clauses: CompiledClause[] = [];

  if (filter.product_type)
    clauses.push({ key: "product_type", sql: "product_type = ?", params: [filter.product_type], describe: `product_type == ${filter.product_type}` });
  if (filter.material)
    clauses.push({ key: "material", sql: "material = ?", params: [filter.material], describe: `material == ${filter.material}` });
  if (filter.max_price !== undefined)
    clauses.push({ key: "max_price", sql: "price_frame_only <= ?", params: [filter.max_price], describe: `price <= ${filter.max_price}` });
  if (filter.min_price !== undefined)
    clauses.push({ key: "min_price", sql: "price_frame_only >= ?", params: [filter.min_price], describe: `price >= ${filter.min_price}` });
  if (filter.requires_in_stock)
    clauses.push({ key: "requires_in_stock", sql: "in_stock = 1", params: [], describe: "in_stock == true" });
  if (filter.requires_polarized)
    clauses.push({ key: "requires_polarized", sql: "polarized = 1", params: [], describe: "polarized == true" });
  if (filter.requires_uv400)
    clauses.push({ key: "requires_uv400", sql: "uv400 = 1", params: [], describe: "uv400 == true" });
  if (filter.requires_progressive_ready)
    clauses.push({ key: "requires_progressive_ready", sql: "progressive_ready = 1", params: [], describe: "progressive_ready == true" });
  if (filter.rim_type)
    clauses.push({ key: "rim_type", sql: "rim_type = ?", params: [filter.rim_type], describe: `rim_type == ${filter.rim_type}` });
  if (filter.min_lens_height_mm !== undefined)
    clauses.push({ key: "min_lens_height_mm", sql: "lens_height_mm >= ?", params: [filter.min_lens_height_mm], describe: `lens_height_mm >= ${filter.min_lens_height_mm}` });
  if (filter.min_max_power_supported !== undefined)
    clauses.push({ key: "min_max_power_supported", sql: "max_power_supported >= ?", params: [filter.min_max_power_supported], describe: `max_power_supported >= ${filter.min_max_power_supported}` });
  if (filter.max_weight_g !== undefined)
    clauses.push({ key: "max_weight_g", sql: "weight_g <= ?", params: [filter.max_weight_g], describe: `weight_g <= ${filter.max_weight_g}` });
  if (filter.nose_pad_type && filter.nose_pad_type.length > 0)
    clauses.push({ key: "nose_pad_type", sql: `nose_pad_type IN (${filter.nose_pad_type.map(() => "?").join(", ")})`, params: filter.nose_pad_type, describe: `nose_pad_type in {${filter.nose_pad_type.join(", ")}}` });
  if (filter.face_width_fit)
    clauses.push({ key: "face_width_fit", sql: "face_width_fit = ?", params: [filter.face_width_fit], describe: `face_width_fit == ${filter.face_width_fit}` });
  if (filter.requires_wrap)
    clauses.push({ key: "requires_wrap", sql: "wrap_angle > 0", params: [], describe: "wrap_angle > 0" });
  if (filter.excludes_polarized)
    clauses.push({ key: "excludes_polarized", sql: "polarized = 0", params: [], describe: "polarized == false" });
  if (filter.tint_color)
    clauses.push({ key: "tint_color", sql: "tint_color = ?", params: [filter.tint_color], describe: `tint_color == ${filter.tint_color}` });

  for (const tag of filter.purpose_tags ?? []) {
    clauses.push({
      key: "purpose_tags",
      sql: "frame_id IN (SELECT frame_id FROM frame_purpose_tags WHERE tag = ?)",
      params: [tag],
      describe: `purpose_tags includes ${tag}`,
    });
  }

  return clauses;
}

function buildSql(clauses: CompiledClause[], limit: number): string {
  const where = clauses.length ? "WHERE " + clauses.map((c) => c.sql).join(" AND ") : "";
  return `SELECT frame_id FROM frames ${where} ORDER BY price_frame_only ASC LIMIT ${limit}`;
}

function runClauses(clauses: CompiledClause[], limit: number): CatalogFrame[] {
  const sql = buildSql(clauses, limit);
  const params = clauses.flatMap((c) => c.params);
  const rows = getDb().prepare(sql).all(...params) as { frame_id: string }[];
  return rows.map((r) => getFrameById(r.frame_id)!);
}

export interface QueryResult {
  frames: CatalogFrame[];
  sql: string;
}

export function queryFrames(filter: StructuredFilter, limit = 10): QueryResult {
  const clauses = compileClauses(filter);
  return { frames: runClauses(clauses, limit), sql: buildSql(clauses, limit) };
}

/**
 * Phase 6 machinery toggle: `queryFrames`'s own `frames.length` is capped
 * by `limit`, so it can't answer "how many frames actually matched" once
 * more than `limit` do. A real `COUNT(*)` against the same compiled
 * clauses, not a second full row fetch.
 */
export function countMatches(filter: StructuredFilter): number {
  const clauses = compileClauses(filter);
  const where = clauses.length ? "WHERE " + clauses.map((c) => c.sql).join(" AND ") : "";
  const params = clauses.flatMap((c) => c.params);
  const row = getDb().prepare(`SELECT COUNT(*) as n FROM frames ${where}`).get(...params) as { n: number };
  return row.n;
}

export interface NearestAlternative {
  droppedClause: string;
  frame: CatalogFrame;
  /** Set only when an ordered domain was walked -- which tier produced the result. */
  domainTierUsed?: string[];
}

/** rim_type/material/face_width_fit FilterKeys happen to match their catalog column names directly. */
function domainColumnFor(key: FilterKey): string | null {
  return key === "rim_type" || key === "material" || key === "face_width_fit" ? key : null;
}

/**
 * PROJECT_CONTEXT.md §3's relaxation ladder names three constraints that
 * must NEVER be relaxed: progressive lens height, UV400 for sun, and Rx
 * power compatibility (reading power is a fourth, but has no compiled
 * `StructuredFilter` clause yet -- nothing to protect until it exists).
 * That was true only in the documentation until 2026-09-01 (decisions.md)
 * -- this function had no code-level concept of "never relax" at all, and
 * would have tried dropping any of these exactly like `price` or
 * `purpose_tags` if one of them ever ended up being the only clause
 * standing between zero and one result. It happened not to fire only
 * because price was always the clause that got dropped in every case
 * tested -- ordering luck, not a safeguard. This is the third instance of
 * the *documented ≠ implemented* pattern named in decisions.md
 * 2026-08-31 (alongside the B-height/fitting-height conflation and the
 * un-wired derivation table): correct in §3's prose, absent from the
 * code that actually walks the relaxation ladder, invisible until a case
 * happened to force it.
 */
export const NEVER_RELAX_KEYS: ReadonlySet<FilterKey> = new Set<FilterKey>([
  "min_lens_height_mm",
  "requires_uv400",
  "min_max_power_supported",
]);

export interface NeverRelaxBlock {
  key: FilterKey;
  describe: string;
}

export interface RelaxationResult {
  alternatives: NearestAlternative[];
  /**
   * "Fail loudly, not silently skip": every never-relax clause present in
   * the filter that is checked to confirm dropping it WOULD have produced
   * a match (i.e. it's the actual thing standing between zero and a real
   * alternative) is recorded here and warned to the console, rather than
   * the information just vanishing into an empty `alternatives` list with
   * no trace of why. Declining outright with this populated is the
   * CORRECT behavior (§3), not a bug -- this field exists so that
   * correctness is visible and testable, not just assumed.
   */
  neverRelaxBlocked: NeverRelaxBlock[];
}

/**
 * Relaxation ladder (PROJECT_CONTEXT.md §3): if the full filter returns
 * nothing, relax exactly one clause at a time -- all purpose_tags clauses
 * relax together, as one requirement, not tag-by-tag -- and report the
 * cheapest frame that qualifies once that one requirement is dropped.
 * Mirrors app/lib/nearest-miss.ts's approach for the golden set, applied
 * here to a live query instead of a fixed constraint list.
 *
 * For rim_type/material (ordered categorical domains -- decisions.md
 * 2026-08-28), relaxing doesn't drop straight to "any value": it tries the
 * nearest domain tier first (rimless -> semi -> full) and only widens
 * further if that tier has no candidates.
 *
 * Never-relax clauses (see NEVER_RELAX_KEYS above) are skipped entirely --
 * not attempted, not offered as an alternative, under any circumstance.
 */
export function findNearestAlternatives(filter: StructuredFilter, limit = 1): RelaxationResult {
  const clauses = compileClauses(filter);
  const alternatives: NearestAlternative[] = [];
  const neverRelaxBlocked: NeverRelaxBlock[] = [];
  const relaxedKeys = new Set<FilterKey>();

  for (const clause of clauses) {
    if (relaxedKeys.has(clause.key)) continue;
    relaxedKeys.add(clause.key);

    if (NEVER_RELAX_KEYS.has(clause.key)) {
      // Never attempted as a real relaxation -- but check (read-only, never
      // returned as an alternative) whether dropping it WOULD have found a
      // match, purely so the caller can see and log that this is why the
      // system is declining, rather than the reason disappearing silently.
      const others = clauses.filter((c) => c.key !== clause.key);
      const wouldMatch = runClauses(others, 1);
      if (wouldMatch.length > 0) {
        neverRelaxBlocked.push({ key: clause.key, describe: clause.describe });
        console.warn(
          `[catalog-db] never-relax constraint blocked a recommendation: "${clause.describe}" -- ` +
            `dropping it would have produced a match, but it is protected (NEVER_RELAX_KEYS) and was not offered. Declining is correct.`
        );
      }
      continue;
    }

    const others = clauses.filter((c) => c.key !== clause.key);
    const domainColumn = domainColumnFor(clause.key);
    const requestedValue = domainColumn ? (filter[clause.key] as string | undefined) : undefined;

    if (domainColumn && requestedValue) {
      const domain = ORDERED_DOMAINS[domainColumn];
      const startTier = domain.findIndex((tier) => tier.includes(requestedValue));
      const tiersToTry = startTier >= 0 ? domain.slice(startTier + 1) : domain;

      for (const tier of tiersToTry) {
        const tierClause: CompiledClause = {
          key: clause.key,
          sql: `${domainColumn} IN (${tier.map(() => "?").join(", ")})`,
          params: tier,
          describe: clause.describe,
        };
        const results = runClauses([...others, tierClause], limit);
        if (results.length > 0) {
          alternatives.push({ droppedClause: clause.describe, frame: results[0], domainTierUsed: tier });
          break;
        }
      }
    } else {
      const results = runClauses(others, limit);
      if (results.length > 0) {
        alternatives.push({ droppedClause: clause.describe, frame: results[0] });
      }
    }
  }

  return { alternatives, neverRelaxBlocked };
}
