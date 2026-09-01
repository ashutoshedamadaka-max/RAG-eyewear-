// Phase 5: runs evals/golden/conversation.json's scripted turns through the
// real conversation engine (real extraction LLM calls, real catalog/advice
// retrieval -- nothing mocked) and asserts on the resulting
// ConversationState after each turn. Deterministic, code-based assertions,
// not an LLM judge -- see the golden file's _comment for why: slot state
// is structured, the same reason app/lib/constraints.ts doesn't use a
// judge for catalog facts (PROJECT_CONTEXT.md §6).
//
// Rewritten 2026-09-01 for the turn-0 face-shape opener and the
// sufficiency-timing fix (decisions.md) -- every case now starts with an
// opening face-shape reply before the real ASK_ORDER begins.
import fs from "node:fs";
import path from "node:path";
import { runTurn } from "../lib/conversation/converse";
import { emptyState, type ConversationState } from "../lib/conversation/types";

const ROOT = path.resolve(__dirname, "..", "..");
const GOLDEN_PATH = path.join(ROOT, "evals", "golden", "conversation.json");

interface Check {
  label: string;
  pass: boolean;
  detail: string;
}

function check(label: string, pass: boolean, detail: string): Check {
  return { label, pass, detail };
}

async function opening(): Promise<ConversationState> {
  return (await runTurn(emptyState(), undefined)).state;
}

async function runMindChange(): Promise<Check[]> {
  const checks: Check[] = [];
  let state = await opening();

  let r = await runTurn(state, "Not sure about my face shape, let's skip that.");
  state = r.state;

  r = await runTurn(state, "I'm looking for computer glasses.");
  state = r.state;
  checks.push(check("purpose includes computer", (state.slots.purpose?.value ?? []).includes("computer"), JSON.stringify(state.slots.purpose)));
  checks.push(check("product_type=computer", state.slots.product_type?.value === "computer", JSON.stringify(state.slots.product_type)));

  r = await runTurn(state, "No, I don't wear glasses currently.");
  state = r.state;

  r = await runTurn(state, "Actually, change of plans -- make it reading glasses instead of computer. Also, my current pair keeps sliding down my nose.");
  state = r.state;
  checks.push(check("purpose no longer includes computer", !(state.slots.purpose?.value ?? []).includes("computer"), JSON.stringify(state.slots.purpose)));
  checks.push(check("product_type=reading", state.slots.product_type?.value === "reading", JSON.stringify(state.slots.product_type)));
  checks.push(check("fit_issues includes slipping", (state.slots.fit_issues?.value ?? []).includes("slipping"), JSON.stringify(state.slots.fit_issues)));

  r = await runTurn(state, "My budget is up to ₹1200.");
  state = r.state;
  checks.push(check("budget_max=1200", state.slots.budget_max?.value === 1200, JSON.stringify(state.slots.budget_max)));
  checks.push(check("does NOT recommend yet -- style still unasked (post-fix sufficiency gate)", state.status === "in_progress", state.status));

  r = await runTurn(state, "I like a more minimal look, nothing flashy.");
  state = r.state;
  checks.push(check("status=done after style turn", state.status === "done", state.status));
  checks.push(check("recommendation SQL does not filter product_type=computer", !(r.recommendation?.sql ?? "").includes("'computer'"), r.recommendation?.sql ?? "(none)"));

  return checks;
}

async function runVolunteersUpfront(): Promise<Check[]> {
  const checks: Check[] = [];
  let state = await opening();

  const r = await runTurn(state, "Not sure about my face shape -- skip that. I need everyday eyeglasses, budget up to ₹6000, and I don't currently wear glasses.");
  state = r.state;

  checks.push(check("zero ASK_ORDER topics ever asked", state.askedTopics.length === 0, JSON.stringify(state.askedTopics)));
  checks.push(check("status=done after a single user turn", state.status === "done", state.status));
  checks.push(check("recommendation present", Boolean(r.recommendation), JSON.stringify(r.recommendation)));

  return checks;
}

async function runNeverGivesPrescription(): Promise<Check[]> {
  const checks: Check[] = [];
  let state = await opening();

  let r = await runTurn(state, "Not sure, let's skip that.");
  state = r.state;

  r = await runTurn(state, "Eyeglasses for everyday wear.");
  state = r.state;

  r = await runTurn(state, "I do wear glasses but honestly I have no idea what my prescription is.");
  state = r.state;
  checks.push(check("rx_status=unknown, not a guessed rx_power", state.slots.rx_status?.value === "unknown" && state.slots.rx_power === undefined, `rx_status=${JSON.stringify(state.slots.rx_status)} rx_power=${JSON.stringify(state.slots.rx_power)}`));

  r = await runTurn(state, "No real fit issues so far.");
  state = r.state;

  r = await runTurn(state, "My budget is up to ₹3000.");
  state = r.state;
  checks.push(check("does NOT recommend yet -- style still unasked (post-fix sufficiency gate)", state.status === "in_progress", state.status));

  r = await runTurn(state, "Something minimal would be nice.");
  state = r.state;
  checks.push(check("status=done after style turn", state.status === "done", state.status));
  const answerMentionsAssumption = /assum/i.test(r.assistantMessage);
  checks.push(check("final answer surfaces the assumption in prose", answerMentionsAssumption, r.assistantMessage.slice(0, 400)));

  return checks;
}

async function runSafetyInterruptTurnFour(): Promise<Check[]> {
  const checks: Check[] = [];
  let state = await opening();

  let r = await runTurn(state, "Not sure, skip.");
  state = r.state;
  checks.push(check("after face-shape skip: status still in_progress", state.status === "in_progress", state.status));

  r = await runTurn(state, "Eyeglasses for everyday wear, mainly office work.");
  state = r.state;
  checks.push(check("after purpose: status still in_progress", state.status === "in_progress", state.status));

  r = await runTurn(state, "Yes I wear glasses, about -2.50, just single vision.");
  state = r.state;
  checks.push(check("rx_power=-2.5", state.slots.rx_power?.value === -2.5, JSON.stringify(state.slots.rx_power)));
  checks.push(check("after prescription: status still in_progress", state.status === "in_progress", state.status));
  const askedBeforeInterrupt = state.askedTopics.length;

  r = await runTurn(state, "Actually, I've been seeing flashes of light in my peripheral vision the last couple days -- is that something these glasses would help with?");
  state = r.state;
  checks.push(check("turn 4: status=safety_interrupt", state.status === "safety_interrupt", state.status));
  checks.push(check("turn 4: no new topic asked instead of interrupting", state.askedTopics.length === askedBeforeInterrupt, `before=${askedBeforeInterrupt} after=${state.askedTopics.length}`));
  checks.push(check("turn 4: prior rx_power survives the interrupt", state.slots.rx_power?.value === -2.5, JSON.stringify(state.slots.rx_power)));
  checks.push(check("turn 4: prior purpose survives the interrupt", (state.slots.purpose?.value.length ?? 0) > 0, JSON.stringify(state.slots.purpose)));

  return checks;
}

async function runBudgetApproximate(): Promise<Check[]> {
  const checks: Check[] = [];
  const state = await opening();

  const r = await runTurn(state, "Not sure on my face shape. I need everyday eyeglasses, and my budget is somewhere around ₹3000.");
  const min = r.state.slots.budget_min?.value;
  const max = r.state.slots.budget_max?.value;

  checks.push(check("budget_min set", min !== undefined, JSON.stringify(r.state.slots.budget_min)));
  checks.push(check("budget_max set", max !== undefined, JSON.stringify(r.state.slots.budget_max)));
  checks.push(check("budget_min != budget_max (not a point constraint)", min !== undefined && max !== undefined && min !== max, `min=${min} max=${max}`));
  checks.push(check("budget_min in a plausible ~15-20% band below 3000", min !== undefined && min >= 2300 && min <= 2750, `min=${min}`));
  checks.push(check("budget_max in a plausible ~15-20% band above 3000", max !== undefined && max >= 3250 && max <= 3700, `max=${max}`));
  checks.push(check("status=done (sufficient on first turn)", r.state.status === "done", r.state.status));

  const sql = r.recommendation?.sql ?? "";
  checks.push(check("compiled SQL has both a floor and a ceiling clause", sql.includes("price_frame_only <= ?") && sql.includes("price_frame_only >= ?"), sql));

  return checks;
}

async function runBudgetStatedFloor(): Promise<Check[]> {
  const checks: Check[] = [];
  const state = await opening();

  const r = await runTurn(state, "Not sure on my face shape. I need everyday eyeglasses, budget between ₹2000 and ₹3000.");
  checks.push(check("budget_min=2000 exactly", r.state.slots.budget_min?.value === 2000, JSON.stringify(r.state.slots.budget_min)));
  checks.push(check("budget_max=3000 exactly", r.state.slots.budget_max?.value === 3000, JSON.stringify(r.state.slots.budget_max)));

  return checks;
}

async function runBudgetBareCeiling(): Promise<Check[]> {
  const checks: Check[] = [];
  const state = await opening();

  const r = await runTurn(state, "Not sure on my face shape. I need everyday eyeglasses, keep it under ₹3000.");
  checks.push(check("budget_max=3000", r.state.slots.budget_max?.value === 3000, JSON.stringify(r.state.slots.budget_max)));
  checks.push(check("budget_min NOT set", r.state.slots.budget_min === undefined, JSON.stringify(r.state.slots.budget_min)));

  const sql = r.recommendation?.sql ?? "";
  checks.push(check("compiled SQL has ceiling but no floor clause", sql.includes("price_frame_only <= ?") && !sql.includes("price_frame_only >= ?"), sql));

  return checks;
}

async function main() {
  const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf-8"));
  const caseIds: string[] = golden.cases.map((c: { id: string }) => c.id);

  const runners: Record<string, () => Promise<Check[]>> = {
    "mind-change-partial-update": runMindChange,
    "volunteers-everything-upfront": runVolunteersUpfront,
    "never-gives-prescription": runNeverGivesPrescription,
    "safety-interrupt-turn-four": runSafetyInterruptTurnFour,
    "budget-approximate-produces-range": runBudgetApproximate,
    "budget-stated-floor-produces-exact-range": runBudgetStatedFloor,
    "budget-bare-ceiling-no-minimum": runBudgetBareCeiling,
  };

  let totalPass = 0;
  let totalChecks = 0;

  for (const id of caseIds) {
    const runner = runners[id];
    if (!runner) {
      console.log(`\n[${id}] NO RUNNER REGISTERED -- skipped`);
      continue;
    }
    console.log(`\n[${id}]`);
    const checks = await runner();
    for (const c of checks) {
      totalChecks++;
      if (c.pass) totalPass++;
      console.log(`  ${c.pass ? "✓" : "✗ FAIL"} ${c.label}${c.pass ? "" : `\n      got: ${c.detail}`}`);
    }
  }

  console.log(`\n=== ${totalPass}/${totalChecks} checks passed ===`);
  if (totalPass < totalChecks) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
