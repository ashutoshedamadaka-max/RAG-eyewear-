// Deployment readiness (decisions.md, 2026-09-02). Fallback "recorded
// conversation" fixtures for the /conversation page: real TurnResult
// sequences captured by actually running app/lib/conversation/converse.ts
// against the live pipeline -- never hand-written. When the live model is
// unavailable (missing key, rate limited, erroring), the client replays one
// of these instead of showing an error, through the exact same rendering
// code a real conversation uses (app/app/conversation/page.tsx just does
// setState(result.state) per turn either way), so the machinery panel still
// renders correctly.
//
// Usage: npm run generate-replay-fixtures (needs OPENAI_API_KEY -- this
// hits the real pipeline once per scenario, same as any other eval script)
import fs from "node:fs";
import path from "node:path";
import { emptyState, type ConversationState } from "../lib/conversation/types";
import { runTurn, type TurnResult } from "../lib/conversation/converse";

interface Scenario {
  id: string;
  label: string;
  description: string;
  turns: string[];
}

// Four categories chosen to match the live-transcript review this project
// already did once (decisions.md, 2026-09-01): straightforward, an
// intentional catalog gap (relaxation ladder fires), a safety interrupt
// arriving mid-conversation rather than on turn one, and a convention-heavy
// case that pulls hedged style/face-shape advice rather than only physical
// constraints.
const SCENARIOS: Scenario[] = [
  {
    id: "straightforward",
    label: "Straightforward: everyday eyeglasses",
    description: "A clean, ordinary conversation from opener to recommendation, no surprises.",
    turns: [
      "Not sure about my face shape, let's skip that.",
      "Everyday eyeglasses for the office.",
      "Yes I wear glasses, about -1.75, single vision.",
      "No fit issues really, my current pair is fine.",
      "Budget up to ₹4000.",
      "Something classic, nothing too bold.",
    ],
  },
  {
    id: "intentional-gap",
    label: "Intentional gap: the relaxation ladder fires",
    description:
      "A budget tight enough that nothing satisfying it also clears the never-relax UV400 requirement -- the system drops price (relaxable), keeps UV400 (never relaxed), and names exactly what it dropped instead of pretending or refusing outright. Cheapest real outdoor/UV400 sunglasses in the catalog is ₹1,200 (verified directly against catalog.db, not assumed), so a ₹800 ceiling guarantees a real gap.",
    turns: [
      "Skip face shape.",
      "Sunglasses for outdoor use.",
      "No, I don't wear glasses currently.",
      "No fit issues.",
      "Keep it under ₹800.",
      "Minimal look.",
    ],
  },
  {
    id: "safety-interrupt",
    label: "Safety interrupt mid-conversation",
    description:
      "Three ordinary turns, then a reported vision symptom on turn four -- the interrupt fires immediately, mid-flow, not just as a first-turn special case.",
    turns: [
      "Not sure, skip.",
      "Eyeglasses for everyday wear, mainly office work.",
      "Yes I wear glasses, about -2.50, just single vision.",
      "Actually, I've been seeing flashes of light in my peripheral vision the last couple days -- is that something these glasses would help with?",
    ],
  },
  {
    id: "convention-heavy",
    label: "Convention-heavy: face shape and style",
    description:
      "A customer who picks a real face shape and leans on style preference -- pulls hedged, convention-tagged advice (a soft nudge, never a filter) alongside the physical constraints.",
    turns: [
      "My face shape is round.",
      "Everyday eyeglasses, and I'd like something that suits my face shape.",
      "No, I don't wear glasses currently.",
      "No fit issues.",
      "Budget up to ₹5000.",
      "I like a bold, statement look -- maybe tortoiseshell.",
    ],
  },
];

async function runScenario(scenario: Scenario): Promise<TurnResult[]> {
  const results: TurnResult[] = [];
  let state: ConversationState = emptyState();

  const opening = await runTurn(state, undefined);
  results.push(opening);
  state = opening.state;

  for (const message of scenario.turns) {
    const result = await runTurn(state, message);
    results.push(result);
    state = result.state;
  }

  return results;
}

async function main() {
  const outDir = path.resolve(process.cwd(), "lib", "conversation", "fixtures");
  fs.mkdirSync(outDir, { recursive: true });

  for (const scenario of SCENARIOS) {
    console.log(`Running scenario: ${scenario.id}`);
    const results = await runScenario(scenario);
    const finalState = results[results.length - 1].state;
    const finalHistory = finalState.history[finalState.history.length - 1];
    console.log(`  final status: ${finalState.status}`);
    if (finalHistory?.recommendation) {
      console.log(
        `  relaxed=${finalHistory.recommendation.relaxed}  adviceHits=${finalHistory.recommendation.adviceHits.length}  sqlMatchCount=${finalHistory.recommendation.sqlMatchCount}`
      );
    }

    const filePath = path.join(outDir, `${scenario.id}.json`);
    fs.writeFileSync(
      filePath,
      JSON.stringify(
        { id: scenario.id, label: scenario.label, description: scenario.description, turns: results },
        null,
        2
      )
    );
    console.log(`  wrote ${filePath}`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
