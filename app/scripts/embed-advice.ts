// Phase 4: embed advice chunks (app/scripts/build-advice-chunks.ts's output)
// with the same embedding model as the catalog blurbs, for the same
// "dozens of rows doesn't need a vector database" reason. Advice chunks are
// the ONLY thing embedded in this project -- the catalog stays SQL-only
// (Phase 3). Same model as data/catalog/out/embeddings.json so a future
// cross-corpus comparison isn't confounded by a model difference.
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";

const EMBEDDING_MODEL = "text-embedding-3-small";

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is not set. Add it to app/.env.local first.");
    process.exit(1);
  }

  const root = path.resolve(__dirname, "..", "..");
  const chunksPath = path.join(root, "data", "advice", "out", "chunks.json");
  const outPath = path.join(root, "data", "advice", "out", "embeddings.json");

  const chunks: { chunk_id: string; text: string }[] = JSON.parse(
    fs.readFileSync(chunksPath, "utf-8")
  );

  const client = new OpenAI();
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: chunks.map((c) => c.text),
  });

  const embeddings = response.data.map((d, i) => ({
    chunk_id: chunks[i].chunk_id,
    embedding: d.embedding,
  }));

  fs.writeFileSync(outPath, JSON.stringify({ model: EMBEDDING_MODEL, embeddings }, null, 2));
  console.log(`Wrote ${embeddings.length} embeddings (model=${EMBEDDING_MODEL}) to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
