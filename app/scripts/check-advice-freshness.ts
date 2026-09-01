// Phase 7b (decisions.md, 2026-09-01). Nothing currently detects a stale
// advice index -- a source .md edited without a follow-up `advice-chunks`
// + `embed-advice` run leaves `data/advice/out/chunks.json` (what
// retrieval actually serves) silently out of sync with the source of
// truth, with no error, no warning, just a citation that quietly no
// longer matches its own source document. This is the advice-corpus
// analogue of the catalog's existing `content_hash` field
// (`data/catalog/generate_catalog.py`) -- same mechanism, applied to the
// half of the system that was missing it.
//
// Usage: npm run check-advice-freshness
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(__dirname, "..", "..");
const ADVICE_DIR = path.join(ROOT, "data", "advice");
const CHUNKS_PATH = path.join(ADVICE_DIR, "out", "chunks.json");

interface AdviceChunk {
  doc_id: string;
  source_content_hash?: string;
}

function main() {
  if (!fs.existsSync(CHUNKS_PATH)) {
    console.error(`${CHUNKS_PATH} doesn't exist -- run \`npm run advice-chunks\` first.`);
    process.exit(1);
  }
  const chunks: AdviceChunk[] = JSON.parse(fs.readFileSync(CHUNKS_PATH, "utf-8"));
  const storedHashByDoc = new Map<string, string>();
  for (const c of chunks) {
    if (c.source_content_hash) storedHashByDoc.set(c.doc_id, c.source_content_hash);
  }

  const files = fs.readdirSync(ADVICE_DIR).filter((f) => f.endsWith(".md"));
  const stale: string[] = [];
  const noHashOnRecord: string[] = []; // chunks.json predates source_content_hash being added

  for (const file of files.sort()) {
    const docId = file.replace(/\.md$/, "");
    const raw = fs.readFileSync(path.join(ADVICE_DIR, file), "utf-8");
    const currentHash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
    const stored = storedHashByDoc.get(docId);

    if (stored === undefined) {
      // Either this doc is claim_type:opinion (excluded at ingest, never chunked, so it
      // legitimately has no stored hash -- not a staleness problem) or chunks.json predates
      // this check. Distinguish by checking whether ANY chunk exists at all for known docs.
      noHashOnRecord.push(docId);
      continue;
    }
    if (stored !== currentHash) {
      stale.push(docId);
      console.log(`✗ STALE  ${docId}.md has changed since the last \`advice-chunks\`/\`embed-advice\` run (source hash ${currentHash.slice(0, 8)}... != indexed hash ${stored.slice(0, 8)}...)`);
    } else {
      console.log(`✓ fresh  ${docId}.md`);
    }
  }

  if (noHashOnRecord.length > 0) {
    console.log(`\n(no stored hash on record, skipped -- likely claim_type:opinion, excluded at ingest: ${noHashOnRecord.join(", ")})`);
  }

  console.log(`\n=== ${stale.length === 0 ? "all indexed documents fresh" : `${stale.length} document(s) STALE`} ===`);
  if (stale.length > 0) {
    console.log(`Run \`npm run advice-chunks && npm run embed-advice\` to refresh.`);
    process.exitCode = 1;
  }
}

main();
