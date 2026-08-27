// Phase 1 naive baseline: embed every catalog blurb with OpenAI
// text-embedding-3-small and store the raw vectors as JSON. 100 rows -- no
// vector database, just an array on disk read into memory at query time.
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
  const blurbsPath = path.join(root, "data", "catalog", "out", "blurbs.json");
  const outPath = path.join(root, "data", "catalog", "out", "embeddings.json");

  const blurbs: { frame_id: string; text: string }[] = JSON.parse(
    fs.readFileSync(blurbsPath, "utf-8")
  );

  const client = new OpenAI();
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: blurbs.map((b) => b.text),
  });

  const embeddings = response.data.map((d, i) => ({
    frame_id: blurbs[i].frame_id,
    embedding: d.embedding,
  }));

  fs.writeFileSync(
    outPath,
    JSON.stringify({ model: EMBEDDING_MODEL, embeddings }, null, 2)
  );
  console.log(`Wrote ${embeddings.length} embeddings (model=${EMBEDDING_MODEL}) to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
