// Phase 1 naive baseline: flatten each catalog row into one unoptimized prose
// blurb. No chunking strategy, no field weighting -- this is deliberately the
// "dump the JSON into a sentence" approach being tested against.
import fs from "node:fs";
import path from "node:path";

interface CatalogFrame {
  frame_id: string;
  sku: string;
  brand: string;
  model: string;
  product_type: string;
  shape: string;
  material: string;
  rim_type: string;
  color: string;
  temple_style: string;
  lens_width_mm: number;
  bridge_mm: number;
  temple_mm: number;
  lens_height_mm: number;
  frame_width_mm: number;
  face_width_fit: string;
  weight_g: number;
  price_frame_only: number;
  currency: string;
  purpose_tags: string[];
  style_tags: string[];
  face_shape_suits: string[];
  rx_compatible: boolean;
  max_power_supported: number | null;
  progressive_ready: boolean;
  nose_pad_type: string;
  reading_power: number | null;
  uv400: boolean;
  polarized: boolean;
  photochromic: boolean;
  tint_color: string | null;
  wrap_angle: number;
  blue_light_ready: boolean;
  in_stock: boolean;
  stock_qty: number;
}

function blurb(f: CatalogFrame): string {
  const parts: string[] = [];

  parts.push(
    `${f.brand} ${f.model} (SKU ${f.sku}) is a ${f.product_type} frame with a ${f.shape} shape, made of ${f.material} with a ${f.rim_type} rim, in ${f.color.replace(/_/g, " ")}. It has ${f.temple_style.replace(/_/g, " ")} temples.`
  );

  parts.push(
    `Lens width ${f.lens_width_mm}mm, bridge ${f.bridge_mm}mm, temple length ${f.temple_mm}mm, lens height ${f.lens_height_mm}mm, frame width ${f.frame_width_mm}mm, fits ${f.face_width_fit} face widths, weighs ${f.weight_g}g.`
  );

  parts.push(`Priced at ${f.currency} ${f.price_frame_only} (frame only).`);

  if (f.purpose_tags?.length) {
    parts.push(`Good for ${f.purpose_tags.join(", ").replace(/_/g, " ")}.`);
  }
  if (f.style_tags?.length) {
    parts.push(`Style: ${f.style_tags.join(", ")}.`);
  }
  if (f.face_shape_suits?.length) {
    parts.push(`Suits ${f.face_shape_suits.join(", ")} face shapes.`);
  }

  const rxBits: string[] = [];
  rxBits.push(
    f.rx_compatible
      ? `Rx compatible${f.max_power_supported ? ` up to ${f.max_power_supported}D` : ""}`
      : "not Rx compatible"
  );
  rxBits.push(f.progressive_ready ? "progressive-ready" : "not progressive-ready");
  rxBits.push(`${f.nose_pad_type.replace(/_/g, " ")} nose pads`);
  if (f.reading_power) rxBits.push(`fixed reading power ${f.reading_power}D`);
  parts.push(rxBits.join(", ") + ".");

  const lensBits: string[] = [];
  lensBits.push(f.uv400 ? "UV400 protection" : "no UV400 rating");
  lensBits.push(f.polarized ? "polarized" : "not polarized");
  if (f.photochromic) lensBits.push("photochromic");
  if (f.tint_color) lensBits.push(`${f.tint_color.replace(/_/g, " ")} tint`);
  lensBits.push(f.wrap_angle > 0 ? `${f.wrap_angle} degree wrap` : "no wrap");
  lensBits.push(f.blue_light_ready ? "blue-light ready" : "not blue-light ready");
  parts.push(lensBits.join(", ") + ".");

  parts.push(
    f.in_stock ? `In stock (${f.stock_qty} units).` : "Currently out of stock."
  );

  return parts.join(" ");
}

function main() {
  const root = path.resolve(__dirname, "..", "..");
  const catalogPath = path.join(root, "data", "catalog", "out", "catalog.json");
  const outPath = path.join(root, "data", "catalog", "out", "blurbs.json");

  const catalog: CatalogFrame[] = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
  const blurbs = catalog.map((f) => ({ frame_id: f.frame_id, text: blurb(f) }));

  fs.writeFileSync(outPath, JSON.stringify(blurbs, null, 2));
  console.log(`Wrote ${blurbs.length} blurbs to ${outPath}`);
  console.log("\nSample:\n" + blurbs[0].text);
}

main();
