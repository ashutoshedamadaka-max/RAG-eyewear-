// Phase 4: chunks data/advice/*.md into retrieval units. Documents only --
// the catalog is deliberately NOT chunked or embedded here. Re-chunking the
// catalog would rebuild the exact naive-baseline architecture Phase 1 was
// built to disprove; the catalog stays in SQLite behind WHERE (Phase 3).
//
// One chunk per H2 section. This is not an arbitrary chunk-size choice --
// every source document in this corpus is a short vendor PDF transcription
// with tables and quoted figures that must not be split, and none of those
// tables span two H2 headings (verified by inspection of all 6 documents,
// checked again below at chunk time). Section boundaries in these documents
// ARE the safe split points.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(__dirname, "..", "..");
const ADVICE_DIR = path.join(ROOT, "data", "advice");
const OUT_PATH = path.join(ADVICE_DIR, "out", "chunks.json");

interface FrontmatterResult {
  data: Record<string, string>;
  body: string;
}

function parseFrontmatter(raw: string): FrontmatterResult {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error("Missing YAML frontmatter block (expected '---' ... '---' at top of file)");
  }
  const [, fmBlock, body] = match;
  const data: Record<string, string> = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = line.match(/^([A-Za-z0-9_]+):\s?(.*)$/);
    if (!m) throw new Error(`Unparseable frontmatter line: ${JSON.stringify(line)}`);
    const [, key, rawValue] = m;
    let value = rawValue.trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }
  return { data, body };
}

interface Section {
  heading: string;
  body: string;
}

function splitSections(body: string, docId: string): Section[] {
  const lines = body.split(/\r?\n/);
  const sections: Section[] = [];
  let current: Section | null = null;
  let sawH1 = false;
  let preamble = "";

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.*)$/);
    const h1 = line.match(/^#\s+(.*)$/);
    if (h2) {
      if (current) sections.push(current);
      current = { heading: h2[1].trim(), body: "" };
    } else if (h1 && !current) {
      sawH1 = true;
    } else if (current) {
      current.body += line + "\n";
    } else if (sawH1) {
      preamble += line + "\n";
    }
  }
  if (current) sections.push(current);

  // Loud failure, not a silent drop: every current document goes straight
  // from H1 to its first H2 with nothing in between. If a future document
  // doesn't, that content needs a home (either its own section or folded
  // into the first one) -- it shouldn't just vanish from the index.
  if (preamble.trim().length > 0) {
    throw new Error(
      `${docId}: non-empty content between H1 title and first H2 section -- this chunker drops it silently otherwise. Give it a heading or fold it into the first section.`
    );
  }

  return sections.map((s) => ({ heading: s.heading, body: s.body.trim() }));
}

/** A table inside a section must not have been truncated by a stray H2-looking line (e.g. inside a blockquote). Cheap sanity check, not a full markdown table parser. */
function checkTableIntegrity(docId: string, heading: string, body: string) {
  const lines = body.split("\n");
  const tableLines = lines.filter((l) => l.trim().startsWith("|"));
  if (tableLines.length === 0) return;
  // A well-formed GFM table has a header row immediately followed by a
  // separator row of the form |---|---|...
  const separatorIdx = lines.findIndex((l) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(l) && l.includes("-"));
  if (separatorIdx === -1) {
    throw new Error(`${docId} § "${heading}": found table row markers ("|") but no header separator row -- table may be malformed or split.`);
  }
}

export interface AdviceChunk {
  chunk_id: string;
  doc_id: string;
  doc_title: string;
  section_heading: string;
  text: string;
  claim_type: string;
  source_org: string;
  source_document: string;
  /** Most sources are fetchable vendor/CE PDFs and have this. Privately-shared, non-URL sources (e.g. a Google Doc) have source_provenance instead -- see below. */
  source_url?: string;
  source_url_secondary?: string;
  source_url_note?: string;
  /** e.g. "Authored guide, not an interview transcript" -- how the source was produced, when that's not obvious from a URL. */
  source_type?: string;
  /** Free text for how a non-URL source reached this repo (who shared it, when, how) -- required in place of source_url when there isn't one. */
  source_provenance?: string;
  verified: string;
  verification_method: string;
  /**
   * Phase 7b (decisions.md, 2026-09-01): a hash of the SOURCE .md file's
   * full raw content (frontmatter + body) as of this build -- same value
   * on every chunk from the same document, since staleness is a per-
   * document property. Lets `check-advice-freshness.ts` detect a source
   * file edited since the last `advice-chunks`/`embed-advice` run without
   * needing a separate manifest file to keep in sync -- the hash travels
   * with the chunks it describes, in the one artifact retrieval actually
   * reads.
   */
  source_content_hash: string;
}

function main() {
  const files = fs.readdirSync(ADVICE_DIR).filter((f) => f.endsWith(".md"));
  if (files.length === 0) {
    console.error(`No .md files found in ${ADVICE_DIR}`);
    process.exit(1);
  }

  const chunks: AdviceChunk[] = [];
  const excluded: { doc_id: string; claim_type: string }[] = [];

  for (const file of files.sort()) {
    const docId = file.replace(/\.md$/, "");
    const raw = fs.readFileSync(path.join(ADVICE_DIR, file), "utf-8");
    const contentHash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
    const { data, body } = parseFrontmatter(raw);

    for (const required of ["title", "claim_type", "source_org", "verified"]) {
      if (!data[required]) throw new Error(`${docId}: missing required frontmatter field "${required}"`);
    }
    // Every chunk needs SOME way to trace back to where it came from --
    // most sources are fetchable and use source_url; a privately-shared
    // document (no public URL to point at) must use source_provenance
    // instead. Neither present is the one thing this chunker refuses to
    // let through: an untraceable chunk defeats the entire point of the
    // claim_type/citation system.
    if (!data.source_url && !data.source_provenance) {
      throw new Error(`${docId}: needs either "source_url" (fetchable source) or "source_provenance" (how a non-URL source reached this repo) -- a chunk with neither can't be traced back to anything.`);
    }

    // Exclusion at ingest (PROJECT_CONTEXT.md §3, §5; decisions.md
    // 2026-08-28): opinion content never reaches the index. No opinion
    // documents exist in the corpus yet, but the filter has to actually
    // run, not just be documented as a policy, or it's not really there.
    if (data.claim_type === "opinion") {
      excluded.push({ doc_id: docId, claim_type: data.claim_type });
      continue;
    }
    if (!["physical", "convention"].includes(data.claim_type)) {
      throw new Error(`${docId}: unknown claim_type "${data.claim_type}" (expected physical | convention | opinion)`);
    }

    const sections = splitSections(body, docId);
    if (sections.length === 0) throw new Error(`${docId}: no H2 sections found`);

    sections.forEach((section, i) => {
      checkTableIntegrity(docId, section.heading, section.body);

      chunks.push({
        chunk_id: `${docId}#${i}`,
        doc_id: docId,
        doc_title: data.title,
        section_heading: section.heading,
        // Prepended title + section heading: "16mm minimum, 24mm frame
        // height" means nothing without knowing it's Rodenstock's design
        // table, not a competitor's or a different measurement entirely.
        text: `${data.title} — ${section.heading}\n\n${section.body}`,
        claim_type: data.claim_type,
        source_org: data.source_org,
        source_document: data.source_document ?? "",
        source_content_hash: contentHash,
        ...(data.source_url ? { source_url: data.source_url } : {}),
        ...(data.source_url_secondary ? { source_url_secondary: data.source_url_secondary } : {}),
        ...(data.source_url_note ? { source_url_note: data.source_url_note } : {}),
        ...(data.source_type ? { source_type: data.source_type } : {}),
        ...(data.source_provenance ? { source_provenance: data.source_provenance } : {}),
        verified: data.verified,
        verification_method: data.verification_method ?? "",
      });
    });
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(chunks, null, 2));

  console.log(`Wrote ${chunks.length} chunks from ${files.length - excluded.length} documents to ${OUT_PATH}`);
  if (excluded.length > 0) {
    console.log(`Excluded at ingest (claim_type: opinion): ${excluded.map((e) => e.doc_id).join(", ")}`);
  } else {
    console.log(`No opinion-tagged documents in this corpus (exclusion filter ran, matched 0 -- see decisions.md 2026-08-28 for why the filter exists anyway).`);
  }
  const byClaimType = chunks.reduce<Record<string, number>>((acc, c) => {
    acc[c.claim_type] = (acc[c.claim_type] ?? 0) + 1;
    return acc;
  }, {});
  console.log("Chunks by claim_type:", byClaimType);
}

main();
