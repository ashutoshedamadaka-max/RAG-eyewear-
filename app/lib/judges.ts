// Phase 4 evaluation: LLM judges, used ONLY where a deterministic check
// can't work. Groundedness, citation accuracy, and hedging-matches-claim-type
// are properties of prose, not of a database column -- app/lib/constraints.ts
// (Phase 2) is the right tool for "does this frame satisfy this WHERE
// clause" and the wrong tool for "does this sentence overclaim what its
// citation actually says." Contrast is deliberate: deterministic checks for
// the catalog half, validated judges for the advice half, chosen because of
// what the data is (PROJECT_CONTEXT.md §6).
//
// Structured output (reasoning field before verdict field), binary grades
// (pass/fail, not a 1-5 scale -- a scale invites averaging away exactly the
// disagreement a judge exists to surface). Every judge here must be run
// through app/scripts/validate-judges.ts against hand-labelled examples
// before its output is trusted for anything -- see decisions.md 2026-08-31.
import OpenAI from "openai";
import { CHAT_MODEL, CHAT_TEMPERATURE } from "./config/model";

export type Verdict = "pass" | "fail";

export interface JudgeResult {
  reasoning: string;
  verdict: Verdict;
}

export interface JudgeInput {
  query: string;
  answer: string;
  frameContext: string;
  adviceContext: string;
}

const RESPONSE_SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "judge_verdict",
    strict: true,
    schema: {
      type: "object",
      properties: {
        // Order matters for the "reasoning before verdict" requirement --
        // structured-output models generate fields in schema-property
        // order, so putting the verdict after reasoning in the schema is
        // what makes the model reason before committing, not after.
        reasoning: {
          type: "string",
          description: "Step-by-step reasoning about the specific claims/citations in the answer, before reaching a verdict.",
        },
        verdict: { type: "string", enum: ["pass", "fail"] },
      },
      required: ["reasoning", "verdict"],
      additionalProperties: false,
    },
  },
};

async function runJudge(client: OpenAI, systemPrompt: string, input: JudgeInput): Promise<JudgeResult> {
  const response = await client.chat.completions.create({
    model: CHAT_MODEL,
    // gpt-5.6-luna rejects temperature=0 outright ("does not support 0
    // with this model, only the default (1) value is supported" --
    // confirmed against the live API 2026-08-31). The usual
    // judge-determinism move isn't available on this model; using the
    // same shared temperature as generation instead, and noting in
    // decisions.md that judge verdicts aren't perfectly reproducible
    // run-to-run as a result -- one more reason the hand-labelled
    // validation in app/scripts/validate-judges.ts matters, and should be
    // re-run occasionally, not treated as a one-time check.
    temperature: CHAT_TEMPERATURE,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content:
          `Customer query: ${input.query}\n\n` +
          `Retrieved catalog frames (cited as [1]-[5]):\n${input.frameContext || "(none)"}\n\n` +
          `Retrieved advice (cited as [A1]-[A4], each labeled with its claim_type):\n${input.adviceContext || "(none)"}\n\n` +
          `Assistant's answer to grade:\n${input.answer}`,
      },
    ],
    response_format: RESPONSE_SCHEMA,
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as JudgeResult;
  return parsed;
}

const GROUNDEDNESS_PROMPT = `You are grading whether an eyewear assistant's answer is GROUNDED in the context provided to it (retrieved catalog frames + retrieved advice chunks) -- SOMEWHERE in that context, not necessarily behind the specific bracket number the answer happens to cite. Whether a citation points at the right source is a SEPARATE property, graded by a different judge -- do not fail an answer here just because a true, context-supported claim is attached to the wrong bracket number; that is a citation-accuracy failure, not a groundedness one. Judge only: does the provided context, taken as a whole, actually contain support for this claim.

A claim is grounded only if the provided context actually supports it. This is stricter than "is it true": a claim that happens to be correct general optical knowledge, but that the provided context does not contain, is UNGROUNDED and must be penalized exactly as if it were false -- this specifically includes invented comparisons to information never provided (e.g. comparing a recommended frame's weight to the customer's unstated current frame) and comparisons that conflate two different measurements the context explicitly distinguishes (e.g. treating a frame's B-height/lens-height figure as if it satisfies a fitting-height requirement, when the retrieved advice explicitly says those are different numbers). The property being measured is whether the system stayed inside its retrieved evidence, not whether it got lucky.

Two things are NOT claims requiring their own citation: (1) purely conversational content (acknowledging the customer, asking a clarifying question, expressing warmth), and (2) a brief, generic definitional or mechanical explanation of a technical term that is already present in the provided context (e.g. explaining that "rimless" means the lens is drilled and mounted without a surrounding frame, or that a named material is a type of plastic) -- the system is separately required to explain jargon in plain language, and doing so is not itself a checkable factual claim unless it asserts a specific number, comparison, or contested property that isn't common, uncontested terminology.

Reason step by step through each specific factual claim in the answer and whether the provided context (anywhere in it) supports it, applying the two carve-outs above. Then give one verdict for the whole answer: "pass" only if every checkable claim is grounded in the provided context, "fail" if at least one is not.`;

const CITATION_ACCURACY_PROMPT = `You are grading whether an eyewear assistant's citations are ACCURATE -- not just present, but correctly attached to the claim they're cited for.

Frame facts are cited [1]-[5]; advice claims are cited [A1]-[A4]. A citation is WRONG if the source it points to does not actually support the specific claim it's attached to in the sentence -- even if that citation number exists, even if the claim is true, and even if a DIFFERENT citation in the list would have supported it correctly. Misattributed citations (right fact, wrong pointer) count as wrong, exactly as much as fabricated ones. This also covers a citation attached to a claim the source directly contradicts or overstates -- e.g. citing a source for "you need X" when the source itself says X is a preference, not a requirement, is a misattribution: the citation is being used to claim more than its source supports.

Do not fail a citation over a brief, generic definitional or mechanical gloss attached to it (e.g. "TR90, a thermoplastic material, appears in..." when the source just says "TR90") -- explaining common, uncontested terminology in plain language is required elsewhere in this system's instructions and is not itself a claim the citation needs to separately support, as long as the specific fact the citation is actually offered for (which frame, what material, what number) is correct.

Only grade claims that have an explicit bracketed citation attached to them. A claim with NO citation at all is not this judge's concern -- whether an uncited claim needed one is a groundedness question, graded separately; do not fail an answer here just because it contains an uncited assertion.

Reason through each CITED claim individually: what claim is it attached to, and does that specific source support that specific claim. Then give one verdict for the whole answer: "pass" only if every cited claim's citation correctly supports it, "fail" if at least one cited claim is misattributed, contradicted, or overstated relative to its source.`;

const HEDGING_MATCH_PROMPT = `You are grading whether an eyewear assistant's confidence register matches each advice citation's claim_type.

Every advice reference in the context is labeled "physical" or "convention". PHYSICAL claims should be stated plainly and confidently, optionally with a citation, e.g. "rimless mounting isn't reliable at this prescription [A2]." CONVENTION claims must be hedged and explicitly named as convention or style preference, not stated with the confidence of a physical fact -- e.g. "rectangular frames are conventionally suggested for rounder faces, though that's style convention, not a fitting requirement [A3]" is correct; "rectangular frames suit round faces [A3]" stated with no hedge is wrong even though it cites the same source.

If the answer contains no advice-sourced claims at all, or only cites physical-labeled advice, and hedges nothing (correctly, since there's nothing conventional to hedge), that is a pass. Reason through each advice-sourced claim: what is the source's claim_type, and does the answer's confidence level match it. Then give one verdict: "pass" if every advice-sourced claim's register matches its claim_type, "fail" if at least one convention claim is stated as plain fact (or, less commonly, a physical fact is hedged as if it were merely conventional).`;

export function judgeGroundedness(client: OpenAI, input: JudgeInput): Promise<JudgeResult> {
  return runJudge(client, GROUNDEDNESS_PROMPT, input);
}

export function judgeCitationAccuracy(client: OpenAI, input: JudgeInput): Promise<JudgeResult> {
  return runJudge(client, CITATION_ACCURACY_PROMPT, input);
}

export function judgeHedgingMatch(client: OpenAI, input: JudgeInput): Promise<JudgeResult> {
  return runJudge(client, HEDGING_MATCH_PROMPT, input);
}

export const JUDGES = {
  groundedness: judgeGroundedness,
  citation_accuracy: judgeCitationAccuracy,
  hedging_match: judgeHedgingMatch,
};
