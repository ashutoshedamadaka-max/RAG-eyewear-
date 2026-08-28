// Phase 3: builds a real SQLite database from the catalog for the hybrid
// pipeline's structured-filter half. Uses node:sqlite (built into Node 22+)
// -- no extra dependency, same "don't add infra the scale doesn't need"
// judgment call as the naive baseline's in-memory vector store.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(__dirname, "..", "..");
const CATALOG_PATH = path.join(ROOT, "data", "catalog", "out", "catalog.json");
const DB_PATH = path.join(ROOT, "data", "catalog", "out", "catalog.db");

const SCALAR_COLUMNS = [
  "frame_id", "sku", "brand", "model", "product_type", "shape", "material",
  "rim_type", "color", "color_family", "temple_style", "lens_width_mm",
  "bridge_mm", "temple_mm", "lens_height_mm", "frame_width_mm",
  "face_width_fit", "weight_g", "price_frame_only", "currency", "price_band",
  "rx_compatible", "max_power_supported", "progressive_ready",
  "nose_pad_type", "reading_power", "uv400", "polarized", "photochromic",
  "tint_color", "wrap_angle", "blue_light_ready", "in_stock", "stock_qty",
  "stock_updated_at", "content_hash", "image_seed", "image_url", "source",
] as const;

const BOOLEAN_COLUMNS = new Set([
  "rx_compatible", "progressive_ready", "uv400", "polarized", "photochromic",
  "blue_light_ready", "in_stock",
]);

function toSqlValue(value: unknown, column: string): string | number | null {
  if (value === null || value === undefined) return null;
  if (BOOLEAN_COLUMNS.has(column)) return value ? 1 : 0;
  return value as string | number;
}

function main() {
  const catalog: Record<string, unknown>[] = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf-8"));

  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); // rebuild fresh every run -- idempotent
  const db = new DatabaseSync(DB_PATH);

  db.exec(`
    CREATE TABLE frames (
      frame_id TEXT PRIMARY KEY,
      sku TEXT, brand TEXT, model TEXT, product_type TEXT, shape TEXT,
      material TEXT, rim_type TEXT, color TEXT, color_family TEXT,
      temple_style TEXT, lens_width_mm INTEGER, bridge_mm INTEGER,
      temple_mm INTEGER, lens_height_mm INTEGER, frame_width_mm INTEGER,
      face_width_fit TEXT, weight_g REAL, price_frame_only INTEGER,
      currency TEXT, price_band INTEGER, rx_compatible INTEGER,
      max_power_supported REAL, progressive_ready INTEGER,
      nose_pad_type TEXT, reading_power REAL, uv400 INTEGER,
      polarized INTEGER, photochromic INTEGER, tint_color TEXT,
      wrap_angle INTEGER, blue_light_ready INTEGER, in_stock INTEGER,
      stock_qty INTEGER, stock_updated_at TEXT, content_hash TEXT,
      image_seed TEXT, image_url TEXT, source TEXT
    );
    CREATE TABLE frame_purpose_tags (frame_id TEXT, tag TEXT);
    CREATE TABLE frame_style_tags (frame_id TEXT, tag TEXT);
    CREATE TABLE frame_face_shape_suits (frame_id TEXT, shape TEXT);
    CREATE INDEX idx_purpose_tags ON frame_purpose_tags(tag, frame_id);
    CREATE INDEX idx_style_tags ON frame_style_tags(tag, frame_id);
    CREATE INDEX idx_face_shape_suits ON frame_face_shape_suits(shape, frame_id);
  `);

  const insertFrame = db.prepare(
    `INSERT INTO frames (${SCALAR_COLUMNS.join(", ")}) VALUES (${SCALAR_COLUMNS.map(() => "?").join(", ")})`
  );
  const insertPurposeTag = db.prepare("INSERT INTO frame_purpose_tags (frame_id, tag) VALUES (?, ?)");
  const insertStyleTag = db.prepare("INSERT INTO frame_style_tags (frame_id, tag) VALUES (?, ?)");
  const insertFaceShape = db.prepare("INSERT INTO frame_face_shape_suits (frame_id, shape) VALUES (?, ?)");

  for (const f of catalog) {
    insertFrame.run(...SCALAR_COLUMNS.map((c) => toSqlValue(f[c], c)));
    for (const tag of (f.purpose_tags as string[]) ?? []) insertPurposeTag.run(f.frame_id as string, tag);
    for (const tag of (f.style_tags as string[]) ?? []) insertStyleTag.run(f.frame_id as string, tag);
    for (const shape of (f.face_shape_suits as string[]) ?? []) insertFaceShape.run(f.frame_id as string, shape);
  }

  const count = db.prepare("SELECT COUNT(*) as n FROM frames").get() as { n: number };
  db.close();
  console.log(`Wrote ${count.n} frames to ${DB_PATH}`);
}

main();
