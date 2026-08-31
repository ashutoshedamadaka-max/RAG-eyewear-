// Phase 4: validates the three LLM judges (app/lib/judges.ts) against
// evals/golden/judge_validation.json before trusting them for anything.
// Runs each judge against each hand-labelled case, compares to the hand
// label, and reports per-dimension agreement -- not just an aggregate,
// because a judge that's great at groundedness and bad at hedging looks
// fine on average and is actually half-broken.
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { JUDGES, type JudgeInput, type Verdict } from "../lib/judges";

const ROOT = path.resolve(__dirname, "..", "..");
const VALIDATION_PATH = path.join(ROOT, "evals", "golden", "judge_validation.json");
const REPORTS_DIR = path.join(ROOT, "evals", "harness", "reports");

interface ValidationCase extends JudgeInput {
  id: string;
  source: string;
  hand_labels: Record<string, Verdict | "n/a">;
  label_reasoning: string;
}

async function main() {
  const { cases }: { cases: ValidationCase[] } = JSON.parse(fs.readFileSync(VALIDATION_PATH, "utf-8"));
  const client = new OpenAI();

  const results: Record<
    string,
    { total: number; agree: number; disagreements: { id: string; hand: Verdict; judge: Verdict; reasoning: string }[] }
  > = {};
  for (const dim of Object.keys(JUDGES)) results[dim] = { total: 0, agree: 0, disagreements: [] };

  const fullLog: Record<string, unknown>[] = [];

  for (const c of cases) {
    console.log(`\n[${c.id}] (${c.source})`);
    const caseLog: Record<string, unknown> = { id: c.id, source: c.source };

    for (const [dim, judgeFn] of Object.entries(JUDGES)) {
      const hand = c.hand_labels[dim];
      if (hand === "n/a") {
        console.log(`  ${dim}: n/a (skipped)`);
        continue;
      }
      const result = await judgeFn(client, c);
      results[dim].total++;
      const agrees = result.verdict === hand;
      if (agrees) results[dim].agree++;
      else results[dim].disagreements.push({ id: c.id, hand, judge: result.verdict, reasoning: result.reasoning });

      console.log(`  ${dim}: hand=${hand} judge=${result.verdict} ${agrees ? "✓" : "✗ DISAGREE"}`);
      caseLog[dim] = { hand, judge: result.verdict, agrees, reasoning: result.reasoning };
    }
    fullLog.push(caseLog);
  }

  console.log("\n=== Agreement summary ===\n");
  for (const [dim, r] of Object.entries(results)) {
    const rate = r.total > 0 ? ((r.agree / r.total) * 100).toFixed(0) : "n/a";
    console.log(`${dim}: ${r.agree}/${r.total} (${rate}%)`);
    for (const d of r.disagreements) {
      console.log(`  DISAGREE [${d.id}]: hand=${d.hand} judge=${d.judge}`);
      console.log(`    judge reasoning: ${d.reasoning.slice(0, 200)}${d.reasoning.length > 200 ? "..." : ""}`);
    }
  }

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(REPORTS_DIR, `judge-validation-${timestamp}.json`);
  fs.writeFileSync(
    reportPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), summary: results, cases: fullLog }, null, 2)
  );
  console.log(`\nFull report written to ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
