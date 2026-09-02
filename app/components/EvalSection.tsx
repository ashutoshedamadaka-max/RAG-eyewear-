"use client";

import Link from "next/link";

// Real numbers, not placeholders:
// - groundedness/citation_accuracy ranges: three real runs of `npm run validate-judges`
//   against the 18-case hand-labelled set (decisions.md 2026-09-02, the persona-round spread).
// - conversation eval 77/77: `npm run eval-conversation` against the 18-case
//   evals/golden/conversation.json (decisions.md 2026-09-02).
// - gap handling 3/3: `npm run eval-gap-handling` against PROJECT_CONTEXT.md §4's
//   three intentional catalog gaps (added this session, decisions.md 2026-09-01).
// If any of these numbers change, this component must be updated from a fresh
// run, not edited to keep the page looking finished -- these were true as of
// 2026-09-02 and are labelled that way in the write-up, not asserted as timeless.

const LLM_JUDGED = [
  {
    value: "89–100%",
    label: "Every claim traceable to a source",
    detail: "No invented facts. The range is three runs of the same test — the judge is itself a language model, so it isn't perfectly repeatable run to run.",
  },
  {
    value: "75–88%",
    label: "Citations point at the right passage",
    detail: "A claim can be well-supported but attached to the wrong reference. Measured as a separate dimension from groundedness.",
  },
];

const DETERMINISTIC = [
  {
    value: "77/77",
    label: "Conversation handled correctly",
    detail: "Budget phrasing (a range vs. an exact floor vs. a bare ceiling), mid-conversation changes of mind, the safety interrupt firing on any turn, off-topic input getting acknowledged and redirected rather than dropped — checked against known-correct outcomes, not graded.",
  },
  {
    value: "3/3",
    label: "Says so when nothing fits",
    detail: "Three catalog combinations built to be unsatisfiable. Correct behavior is naming what's missing and offering the closest real alternative, not silence and not a bare refusal.",
  },
];

function Group({ head, sub, rows }: { head: string; sub: string; rows: typeof LLM_JUDGED }) {
  return (
    <div>
      <div className="text-[13px] font-semibold text-[#14201C]">{head}</div>
      <p className="text-[12.8px] leading-relaxed text-[#5F6F68] mt-1 mb-2.5 max-w-[68ch]">{sub}</p>
      <div className="flex flex-wrap border border-[#DFE6E2] rounded overflow-hidden bg-[#FDFEFD]">
        {rows.map((r, i) => (
          <div key={r.label} className={`flex-1 min-w-[260px] px-4 py-3.5 ${i ? "border-l border-[#DFE6E2]" : ""}`}>
            <div className="text-[19px] font-semibold text-[#14201C] tabular-nums">{r.value}</div>
            <div className="text-[12.8px] font-medium text-[#14201C] mt-1">{r.label}</div>
            <div className="text-[11.5px] leading-relaxed text-[#8A9992] mt-1.5">{r.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function EvalSection() {
  return (
    <div>
      <Group
        head="Graded by an LLM judge"
        sub="Some questions only a reader can answer — whether a claim actually follows from what was retrieved. A second language model grades these, itself validated against 18 hand-labelled cases before being trusted."
        rows={LLM_JUDGED}
      />
      <div className="mt-5">
        <Group
          head="Deterministic checks — no judge involved"
          sub="Where the correct answer is a fact the code can check directly (a slot value, a SQL result), it's asserted, not graded. Exact, instant, and re-run on every change."
          rows={DETERMINISTIC}
        />
      </div>
      <p className="text-[12.8px] leading-relaxed text-[#5F6F68] mt-3">
        All four run against a <b className="font-medium text-[#14201C]">golden set</b> — a
        fixed list of test conversations with the correct answer written down in advance, so a
        change that breaks something shows up as a number, not a surprise.
      </p>
      <p className="text-[12.8px] leading-relaxed text-[#5F6F68] mt-2">
        For a sense of what these numbers are actually measured against, see{" "}
        <Link href="/baseline" className="underline hover:text-[#14201C]">
          the deliberately-naive Phase 1 baseline
        </Link>{" "}
        this system is evaluated relative to — not the product, the comparison point.
      </p>
    </div>
  );
}
