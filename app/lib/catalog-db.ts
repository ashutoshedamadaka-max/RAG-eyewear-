// Phase 3 hybrid pipeline: real SQL over the catalog, built by
// app/scripts/build-catalog-db.ts into data/catalog/out/catalog.db. This is
// the "SQL / structured filters" half of PROJECT_CONTEXT.md §1's hybrid
// architecture -- the direct answer to what the naive baseline (Phase 1)
// couldn't do: enforce a numeric or categorical constraint rather than just
// rank by similarity to it.
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getFrameById, type CatalogFrame } from "./retrieval";

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

export interface NearestAlternative {
  droppedClause: string;
  frame: CatalogFrame;
}

/**
 * Relaxation ladder (PROJECT_CONTEXT.md §3): if the full filter returns
 * nothing, relax exactly one clause at a time -- all purpose_tags clauses
 * relax together, as one requirement, not tag-by-tag -- and report the
 * cheapest frame that qualifies once that one requirement is dropped.
 * Mirrors app/lib/nearest-miss.ts's approach for the golden set, applied
 * here to a live query instead of a fixed constraint list.
 */
export function findNearestAlternatives(filter: StructuredFilter, limit = 1): NearestAlternative[] {
  const clauses = compileClauses(filter);
  const alternatives: NearestAlternative[] = [];
  const relaxedKeys = new Set<FilterKey>();

  for (const clause of clauses) {
    if (relaxedKeys.has(clause.key)) continue;
    relaxedKeys.add(clause.key);

    const others = clauses.filter((c) => c.key !== clause.key);
    const results = runClauses(others, limit);
    if (results.length > 0) {
      alternatives.push({ droppedClause: clause.describe, frame: results[0] });
    }
  }

  return alternatives;
}
