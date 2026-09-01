// Client-side mirror of app/lib/conversation/types.ts's wire shapes -- kept
// separate from the server module (which imports node:sqlite transitively
// via catalog-db.ts) so client components can import types without pulling
// in server-only code. Field names and shapes must match the real API
// response exactly; nothing here is invented.

export type SlotSource = "stated" | "derived" | "assumed";

export interface SlotValue<T> {
  value: T;
  source: SlotSource;
  confidence: number;
  reason?: string;
}

export interface Slots {
  [key: string]: SlotValue<unknown> | undefined;
}

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

export interface DerivedFactRecord {
  explanation: string;
  source?: string;
  ruleId?: string;
}

export interface AdviceHitRecord {
  chunk_id: string;
  score: number;
  claim_type: string;
  source_org: string;
  doc_id: string;
  section_heading: string;
}

export interface CitationMapping {
  sentence: string;
  citedMarkers: string[];
}

export interface ModelCallUsage {
  label: string;
  kind: "chat" | "embedding";
  promptTokens: number;
  completionTokens: number;
  costInr: number;
  ms: number;
}

export interface TurnMachinery {
  turnIndex: number;
  userMessage?: string;
  extractedPartial: Slots;
  safetyFlag: string;
  derivedFacts: DerivedFactRecord[];
  assumptions: DerivedFactRecord[];
  fittingRulesTotalCount: number;
  askedTopic?: string;
  recommendation?: {
    sql: string;
    sqlMatchCount: number;
    catalogTotalCount: number;
    relaxed: boolean;
    relaxedDetails?: { droppedClause: string; frame_id: string }[];
    neverRelaxBlocked?: { key: string; describe: string }[];
    adviceHits: AdviceHitRecord[];
    adviceNearMisses: AdviceHitRecord[];
    citations: CitationMapping[];
  };
  modelCalls: ModelCallUsage[];
  timingsMs: {
    extraction?: number;
    sqlQuery?: number;
    adviceEmbedding?: number;
    adviceSearch?: number;
    relaxationSearch?: number;
    generation?: number;
    total: number;
  };
}

export interface ConversationState {
  slots: Slots;
  turns: Turn[];
  askedTopics: string[];
  assumedAtCap: string[];
  status: "in_progress" | "safety_interrupt" | "recommending" | "done";
  history: TurnMachinery[];
}

export interface RecommendedFrame {
  frame_id: string;
  text: string;
  boost: number;
  reasons: DerivedFactRecord[];
  droppedClause?: string;
}

export interface Recommendation {
  frames: RecommendedFrame[];
  sql: string;
  relaxed: boolean;
}

export interface TurnResult {
  state: ConversationState;
  assistantMessage: string;
  recommendation?: Recommendation;
}

/** Parses a catalog blurb (app/lib/retrieval.ts's flattened prose format) back into structured fields -- the API returns frames as pre-flattened text for the LLM prompt, not as structured JSON, so the card UI has to read the same fields back out. Regex-based, not a second source of truth: every field it extracts is literally printed in the blurb by build-blurbs.ts's fixed template. */
export interface ParsedFrame {
  frame_id: string;
  brand: string;
  model: string;
  product_type: string;
  shape: string;
  material: string;
  rim_type: string;
  color: string;
  lens_width_mm: number;
  bridge_mm: number;
  temple_mm: number;
  lens_height_mm: number;
  frame_width_mm: number;
  face_width_fit: string;
  weight_g: number;
  price_frame_only: number;
  currency: string;
  in_stock: boolean;
  stock_qty: number;
  raw: string;
}

export function parseFrameBlurb(frameId: string, text: string): ParsedFrame | null {
  // "Brand Model (SKU XXX) is a {product_type} frame with a {shape} shape, made of {material}
  // with a {rim_type} rim, in {color}. ... Lens width Nmm, bridge Nmm, temple length Nmm,
  // lens height Nmm, frame width Nmm, fits {fit} face widths, weighs Ng. Priced at {CUR} N
  // (frame only). ... In stock (N units)." / "Currently out of stock."
  const nameMatch = text.match(/^([^(]+) \(SKU/);
  const productMatch = text.match(/is a (\S+) frame with a (\S+) shape, made of (\S+) with a (\S+) rim, in ([\w_]+)/);
  const dims = text.match(
    /Lens width (\d+)mm, bridge (\d+)mm, temple length (\d+)mm, lens height (\d+)mm, frame width (\d+)mm, fits (\w+) face widths, weighs ([\d.]+)g/
  );
  const price = text.match(/Priced at (\w+) (\d+) \(frame only\)/);
  const stock = text.match(/In stock \((\d+) units\)/);

  if (!nameMatch || !productMatch || !dims || !price) return null;
  const [brand, ...modelParts] = nameMatch[1].trim().split(" ");

  return {
    frame_id: frameId,
    brand,
    model: modelParts.join(" "),
    product_type: productMatch[1],
    shape: productMatch[2],
    material: productMatch[3],
    rim_type: productMatch[4],
    color: productMatch[5],
    lens_width_mm: Number(dims[1]),
    bridge_mm: Number(dims[2]),
    temple_mm: Number(dims[3]),
    lens_height_mm: Number(dims[4]),
    frame_width_mm: Number(dims[5]),
    face_width_fit: dims[6],
    weight_g: Number(dims[7]),
    currency: price[1],
    price_frame_only: Number(price[2]),
    in_stock: Boolean(stock),
    stock_qty: stock ? Number(stock[1]) : 0,
    raw: text,
  };
}
