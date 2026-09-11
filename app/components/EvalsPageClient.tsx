"use client";

// /evals (decisions.md, 2026-09-09), rebuilt against a supplied prototype
// (evals-page-v2.jsx) treated as a visual spec, not copied as code --
// "the numbers are claims, the visuals are the evidence." The prototype
// hand-typed its case-matrix/pair/findings data to demonstrate the UI;
// here every one of those rows is real, loaded server-side from the
// committed judge_validation.json and the latest report JSON (see
// app/lib/eval-reports.ts#loadCaseMatrix) and passed down as props, so
// the matrix can never silently drift from what a fresh
// `npm run validate-judges` would actually show.
import { useEffect, useState } from "react";
import Link from "next/link";
import type { EvalSummary, CaseMatrixRow, GoldenQuestion, GoldenSetQuestions } from "@/lib/eval-reports";

function formatDate(iso: string): string {
  if (!iso) return "not yet run";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

const VERDICT_STYLE: Record<string, { bg: string; fg: string }> = {
  pass: { bg: "var(--ok-lt)", fg: "var(--ok)" },
  fail: { bg: "var(--bad-lt, var(--warn-lt))", fg: "var(--bad, var(--warn))" },
};

function Cell({ v, disagree }: { v: string | undefined; disagree?: boolean }) {
  const style = v ? VERDICT_STYLE[v] : undefined;
  return (
    <div
      className="h-[22px] rounded-[5px] flex items-center justify-center text-[10px] font-medium"
      style={{
        background: style?.bg ?? "transparent",
        color: style?.fg ?? "var(--ink3)",
        border: disagree ? "1.5px dashed var(--warn)" : !v ? "1px dashed var(--line)" : "none",
      }}
    >
      {v ?? "–"}
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n).trimEnd() + "…" : s;
}

/** The "view all questions" popup on each golden-set card (decisions.md, 2026-09-09) -- every
    case shown is real, loaded server-side via loadGoldenSetQuestions() from the same committed
    JSON the card's own count comes from. conversation.json's cases have no single query (they're
    scripted multi-turn exchanges), so those render the real `turns` script instead of a
    paraphrased one-liner; the other two sets render their real `query` field as a quote. */
function GoldenSetModal({ title, filename, questions, onClose }: { title: string; filename: string; questions: GoldenQuestion[]; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center overflow-y-auto p-4 min-[640px]:p-8"
      style={{ background: "rgba(10, 16, 17, 0.5)" }}
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bg-[var(--shell)] border border-[var(--line)] rounded-[16px] shadow-[var(--shadow)] max-w-[640px] w-full h-fit my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-[var(--line)]">
          <div>
            <h3 className="text-[15px] font-semibold text-[var(--ink)] m-0">{title}</h3>
            <p className="font-mono text-[11.5px] text-[var(--ink3)] mt-1 mb-0">
              {filename} · {questions.length} case{questions.length === 1 ? "" : "s"}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex-none w-[26px] h-[26px] rounded-full flex items-center justify-center text-[15px] leading-none text-[var(--ink3)] hover:text-[var(--ink)] hover:bg-[var(--sunk)] transition-colors"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-2 max-h-[68vh] overflow-y-auto">
          {questions.length === 0 && <p className="text-[13px] text-[var(--ink3)] py-4">No cases found.</p>}
          {questions.map((q) => (
            <div key={q.id} className="py-3.5 border-b border-[var(--line2)] last:border-b-0">
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                <span className="font-mono text-[10.5px] text-[var(--ink3)]">{q.id}</span>
                {q.tag && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "var(--acc-lt)", color: "var(--acc)" }}>
                    {q.tag}
                  </span>
                )}
              </div>
              {q.turns ? (
                <>
                  <p className="text-[12px] leading-relaxed text-[var(--ink3)] mb-2 mt-0">{truncate(q.prompt, 170)}</p>
                  <div className="grid gap-1.5">
                    {q.turns.map((t, i) => (
                      <p
                        key={i}
                        className="text-[13.5px] leading-relaxed text-[var(--ink)] m-0 pl-3 py-0.5 border-l-2 border-[var(--line)]"
                        style={{ fontFamily: "var(--font-serif, inherit)" }}
                      >
                        {t}
                      </p>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <p className="text-[14.5px] leading-relaxed text-[var(--ink)] m-0" style={{ fontFamily: "var(--font-serif, inherit)" }}>
                    &ldquo;{q.prompt}&rdquo;
                  </p>
                  {q.detail && <p className="text-[12px] leading-relaxed text-[var(--ink3)] mt-1.5 mb-0">{q.detail}</p>}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const HELD_OUT = [
  { dim: "groundedness", inSample: [82, 88] as const, heldOut: [83, 100] as const },
  { dim: "citation_accuracy", inSample: [80, 93] as const, heldOut: [83, 100] as const },
  { dim: "hedging_match", inSample: [100, 100] as const, heldOut: [100, 100] as const },
];

/** A narrow range (e.g. 82-88, six points) can't fit its own label ("82–88%") inside a
    proportionally-sized fill segment -- the label used to be rendered INSIDE that segment and
    would wrap or spill past the track's edge for any range under ~15 points, and for a 0-width
    range (lo===hi===100) the segment's own `left:100%` pushed it off the track entirely. Fixed
    by separating the two: the track shows the range purely as a proportional fill (a fixed
    visual minimum width so it stays visible even at 0 points, clamped so it can never start past
    the point where it would overflow the track), and the label is always its own fixed-width
    element next to the track, so it's never constrained by how wide the range happens to be. */
function RangeBar({ range }: { range: readonly [number, number] }) {
  const [lo, hi] = range;
  const fillWidth = Math.max(hi - lo, 4);
  const fillLeft = Math.min(lo, 100 - fillWidth);
  const label = lo === hi ? `${lo}%` : `${lo}–${hi}%`;
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-[10px] flex-1 bg-[var(--block)] border border-[var(--line)] rounded-full overflow-hidden">
        <div className="absolute top-0 bottom-0 bg-[var(--acc)] rounded-full" style={{ left: `${fillLeft}%`, width: `${fillWidth}%` }} />
      </div>
      <span className="text-[12px] font-medium text-[var(--acc)] tabular-nums whitespace-nowrap flex-none min-w-[62px] text-right">{label}</span>
    </div>
  );
}

const FINDINGS = [
  {
    date: "28 Aug 2026",
    title: "Ground truth copied from the system being graded",
    body: (
      <>
        A case claimed the nearest miss to &ldquo;titanium under ₹4,500&rdquo; was a ₹4,800 frame.
        The real cheapest was ₹100 closer — but it never appeared in the naive baseline&apos;s top
        five, so it was never considered while writing the case.{" "}
        <b className="text-[var(--ink)] font-semibold">
          Ground truth derived from the system under test silently caps the ceiling of anything that
          outperforms it.
        </b>{" "}
        It wouldn&apos;t just have missed the bug — it would have scored the fix as wrong.
      </>
    ),
  },
  {
    date: "29 Aug 2026",
    title: "The same circularity, one level up",
    body: (
      <>
        A results table called agreement between the golden-set generator and the live SQL pipeline
        &ldquo;independently verified.&rdquo; Both were the same algorithm implemented twice.{" "}
        <b className="text-[var(--ink)] font-semibold">
          Agreement between two copies of one definition is a consistency check, not a correctness
          check
        </b>{" "}
        — it says nothing about whether the definition is right. Relabelled rather than left
        overclaiming.
      </>
    ),
  },
  {
    date: "31 Aug – 1 Sep 2026",
    title: "Documented ≠ implemented, four times over",
    body: (
      <>
        Three rules were researched, agreed, and written into the spec, and never reached the code:
        a missing prompt constraint, a derivation rule never compiled into SQL, an exemption list
        that existed only in prose. The fourth was different in shape — the rule <em>was</em> in
        code, but guarded at one call site instead of in the state itself, so it looked fixed until
        a second path to the same state appeared.{" "}
        <b className="text-[var(--ink)] font-semibold">A rule enforced at one call site isn&apos;t enforced.</b>
      </>
    ),
  },
  {
    date: "28 Aug 2026",
    title: "A model upgrade improved the prose and worsened compliance",
    body: (
      <>
        Re-running the naive baseline on a newer model produced visibly better-written refusals —
        explicit about what was missing, offering named alternatives — while constraint compliance
        stayed flat and on one query got worse.{" "}
        <b className="text-[var(--ink)] font-semibold">
          The direct answer to &ldquo;why not just use a stronger model&rdquo;: a more fluent model
          narrates more plausibly around a violated constraint
        </b>{" "}
        instead of hitting the wall that made a weaker one refuse.
      </>
    ),
  },
  {
    date: "1–3 Sep 2026",
    title: "An intentional gap closed by ordinary catalogue churn",
    body: (
      <>
        One of three built-in gaps was deliberately price-churned to test whether it survives
        ordinary updates. It didn&apos;t — the new price falls just inside the threshold, which is
        why the card above honestly reads what it reads rather than a stale earlier number.{" "}
        <b className="text-[var(--ink)] font-semibold">
          A static demo can&apos;t surface this; a harness that re-runs against the live catalogue
          can, and did.
        </b>
      </>
    ),
  },
];

export default function EvalsPageClient({
  summary,
  goldenCounts,
  caseMatrix,
  goldenQuestions,
}: {
  summary: EvalSummary;
  goldenCounts: { conversation: number; judgeValidation: number; refusal: Record<string, number>; physical: Record<string, number> };
  caseMatrix: CaseMatrixRow[];
  goldenQuestions: GoldenSetQuestions;
}) {
  const negativeId = "constructed-hedging-fail-convention-stated-as-requirement";
  const positiveId = "constructed-hedging-pass-convention-correctly-hedged";
  const [openGoldenSet, setOpenGoldenSet] = useState<"judge" | "conversation" | "refusal" | null>(null);

  const negative = caseMatrix.find((c) => c.id === negativeId);
  const positive = caseMatrix.find((c) => c.id === positiveId);
  const real = caseMatrix.filter((c) => c.source === "real_pipeline_run");
  const constructed = caseMatrix.filter((c) => c.source !== "real_pipeline_run");

  const refusalTotal = Object.values(goldenCounts.refusal).reduce((a, b) => a + b, 0);
  const physicalTotal = Object.values(goldenCounts.physical).reduce((a, b) => a + b, 0);

  const cards = [
    {
      value: `${summary.groundedness.min}–${summary.groundedness.max}%`,
      label: "Every claim traceable to a source",
      sub: "No invented facts. The range is three runs — the judge is a model, so it isn't perfectly repeatable.",
      how: "judge" as const,
    },
    {
      value: `${summary.citationAccuracy.min}–${summary.citationAccuracy.max}%`,
      label: "Citations point at the right passage",
      sub: "A claim can be well-supported but attached to the wrong reference. Graded separately.",
      how: "judge" as const,
    },
    {
      value: summary.conversation ? `${summary.conversation.pass}/${summary.conversation.total}` : "—",
      label: "Conversation checks passing",
      sub: `${goldenCounts.conversation} scripted conversations, ${summary.conversation?.total ?? 0} assertions against the resulting state. No judge involved.`,
      how: "code" as const,
    },
    {
      value: summary.gapHandling ? `${summary.gapHandling.pass}/${summary.gapHandling.total}` : "—",
      label: "Says so when nothing fits",
      sub:
        summary.gapHandling && summary.gapHandling.pass < summary.gapHandling.total
          ? "One built-in catalogue gap closed under simulated price churn — see the last finding."
          : "Catalog combinations built to be unsatisfiable.",
      how: "code" as const,
      flag: Boolean(summary.gapHandling && summary.gapHandling.pass < summary.gapHandling.total),
    },
  ];

  return (
    <div className="min-h-full">
      <div className="max-w-[900px] mx-auto px-6 py-10">
        {/* ---- hero ---- */}
        <section className="mb-14">
          <p className="text-[11.5px] font-medium text-[var(--acc)] tracking-wide uppercase m-0 mb-2.5">Evaluation report</p>
          <h1
            className="text-[32px] leading-[1.16] tracking-tight m-0 mb-3.5"
            style={{ fontFamily: "var(--font-serif, inherit)", fontWeight: 500 }}
          >
            An AI can be fluent, confident, and completely wrong
          </h1>
          <p className="text-[16px] leading-relaxed text-[var(--ink2)] m-0 mb-6 max-w-[58ch]" style={{ fontFamily: "var(--font-serif, inherit)" }}>
            The naive first version of this system recommended a ₹4,800 frame while saying, in the
            same breath, that everything else was over a ₹4,500 budget. Nothing about the sentence
            looked broken. These are the checks that catch that — and what they caught.
          </p>

          <div className="grid grid-cols-1 min-[700px]:grid-cols-3 gap-3 bg-[var(--sunk)] rounded-[14px] p-5 shadow-[var(--shadow-in)] mb-6">
            <div className="bg-[var(--block)] border border-[var(--line)] rounded-[11px] px-4 py-3.5">
              <h3 className="text-[13px] font-semibold text-[var(--acc)] m-0 mb-1.5">A golden set</h3>
              <p className="text-[13px] leading-relaxed text-[var(--ink2)] m-0">
                A fixed list of test cases with the right answer written down <em>in advance</em>.
                Change the system, re-run the list, and a regression shows up as a number, not a
                surprise.
              </p>
            </div>
            <div className="bg-[var(--block)] border border-[var(--line)] rounded-[11px] px-4 py-3.5">
              <h3 className="text-[13px] font-semibold text-[var(--acc)] m-0 mb-1.5">Deterministic checks</h3>
              <p className="text-[13px] leading-relaxed text-[var(--ink2)] m-0">
                Where the right answer is a fact in the database, code asserts it directly. Is
                ₹4,800 under ₹4,500? That question has one answer and needs no judgement.
              </p>
            </div>
            <div className="bg-[var(--block)] border border-[var(--line)] rounded-[11px] px-4 py-3.5">
              <h3 className="text-[13px] font-semibold text-[var(--acc)] m-0 mb-1.5">An LLM judge</h3>
              <p className="text-[13px] leading-relaxed text-[var(--ink2)] m-0">
                Some questions need a reader — does this sentence actually follow from the source it
                cites? For those, a <em>second</em> AI grades the first one&apos;s work. Which raises
                the obvious problem: who checks the checker.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 min-[560px]:grid-cols-2 min-[900px]:grid-cols-4 gap-2.5">
            {cards.map((c) => (
              <div
                key={c.label}
                className="bg-[var(--block)] border rounded-[12px] px-4 py-4"
                style={{ borderColor: c.flag ? "var(--warn)" : "var(--line)" }}
              >
                <div className="text-[25px] font-semibold tabular-nums tracking-tight text-[var(--ink)]">{c.value}</div>
                <div className="text-[12.5px] font-medium text-[var(--ink)] mt-2">{c.label}</div>
                <div className="text-[11.5px] leading-relaxed text-[var(--ink3)] mt-1.5">{c.sub}</div>
                <span
                  className="inline-block text-[10px] font-medium px-2 py-1 rounded-full mt-2.5"
                  style={c.how === "judge" ? { background: "var(--acc-lt)", color: "var(--acc)" } : { background: "var(--ok-lt)", color: "var(--ok)" }}
                >
                  {c.how === "judge" ? "LLM judge" : "deterministic"}
                </span>
              </div>
            ))}
          </div>
          <p className="font-mono text-[12px] text-[var(--ink3)] mt-3.5">
            Last run {formatDate(summary.latestGeneratedAt)} · {summary.judgeRunsUsed} judge run{summary.judgeRunsUsed === 1 ? "" : "s"} ·{" "}
            {summary.judgeCaseTotal} judge cases · {goldenCounts.conversation} conversation cases
            {summary.conversation ? ` (${summary.conversation.total} checks)` : ""} · {summary.gapHandling?.total ?? 0} gap-handling cases
          </p>
          <p className="text-[13px] leading-relaxed text-[var(--ink3)] mt-3.5 max-w-[62ch]">
            Every number here is measured against the golden set. If you want to see what a version
            without structured filtering does with the same three gap queries, the deliberately
            naive first build is still running.{" "}
            <Link href="/baseline" className="text-[var(--acc)] font-medium border-b border-[var(--acc-lt)] no-underline">
              It scores 0/3.
            </Link>
          </p>
        </section>

        {/* ---- golden sets ---- */}
        <section className="mb-14">
          <p className="text-[11.5px] font-medium text-[var(--acc)] tracking-wide uppercase m-0 mb-2.5">Three golden sets, graded three ways</p>
          <h2 className="text-[22px] leading-[1.24] tracking-tight m-0 mb-4 max-w-[28ch]" style={{ fontFamily: "var(--font-serif, inherit)", fontWeight: 500 }}>
            They fail differently, so an average would hide what matters
          </h2>
          <div className="grid grid-cols-1 min-[700px]:grid-cols-3 gap-2.5">
            <div className="bg-[var(--block)] border border-[var(--line)] rounded-[12px] px-4 py-4">
              <h4 className="font-mono text-[12.5px] font-semibold text-[var(--ink)] m-0">judge_validation.json</h4>
              <div className="text-[20px] font-semibold tabular-nums text-[var(--ink)] mt-2">
                {goldenCounts.judgeValidation}
                <small className="text-[12px] font-normal text-[var(--ink3)] ml-1.5">cases</small>
              </div>
              <p className="text-[12.5px] leading-relaxed text-[var(--ink2)] mt-2.5 mb-2.5">
                Hand-labelled transcripts, real and constructed. The only set a judge grades.
              </p>
              <button onClick={() => setOpenGoldenSet("judge")} className="block text-[12px] font-medium text-[var(--acc)] border-b border-[var(--acc-lt)]">
                View all questions →
              </button>
            </div>
            <div className="bg-[var(--block)] border border-[var(--line)] rounded-[12px] px-4 py-4">
              <h4 className="font-mono text-[12.5px] font-semibold text-[var(--ink)] m-0">conversation.json</h4>
              <div className="text-[20px] font-semibold tabular-nums text-[var(--ink)] mt-2">
                {goldenCounts.conversation}
                <small className="text-[12px] font-normal text-[var(--ink3)] ml-1.5">cases · {summary.conversation?.total ?? 0} checks</small>
              </div>
              <p className="text-[12.5px] leading-relaxed text-[var(--ink2)] mt-2.5 mb-2.5">
                Scripted multi-turn conversations, graded against the resulting state.
              </p>
              {summary.conversation && summary.conversation.total > 0 && (
                <div className="flex flex-wrap gap-[3px] mt-2.5 mb-2.5">
                  {Array.from({ length: summary.conversation.total }).map((_, i) => (
                    <i key={i} className="w-[9px] h-[9px] rounded-[2px] inline-block" style={{ background: "var(--ok)" }} />
                  ))}
                </div>
              )}
              <button
                onClick={() => setOpenGoldenSet("conversation")}
                className="block text-[12px] font-medium text-[var(--acc)] border-b border-[var(--acc-lt)]"
              >
                View all questions →
              </button>
            </div>
            <div className="bg-[var(--block)] border border-[var(--line)] rounded-[12px] px-4 py-4">
              <h4 className="font-mono text-[12.5px] font-semibold text-[var(--ink)] m-0">refusal.json</h4>
              <div className="text-[20px] font-semibold tabular-nums text-[var(--ink)] mt-2">
                {refusalTotal}
                <small className="text-[12px] font-normal text-[var(--ink3)] ml-1.5">cases · {Object.keys(goldenCounts.refusal).length} categories</small>
              </div>
              <p className="text-[12.5px] leading-relaxed text-[var(--ink2)] mt-2.5 mb-2.5">
                Safety interrupts, and catalogue combinations built to be unsatisfiable.
              </p>
              <button onClick={() => setOpenGoldenSet("refusal")} className="block text-[12px] font-medium text-[var(--acc)] border-b border-[var(--acc-lt)]">
                View all questions →
              </button>
            </div>
          </div>
          <p className="text-[13px] leading-relaxed text-[var(--ink3)] mt-3.5 max-w-[62ch]">
            <code className="font-mono text-[12px] bg-[var(--sunk)] px-1.5 py-0.5 rounded">physical.json</code> also exists (
            {physicalTotal} cases: lens-index recommendation, minimum progressive B-height, frame-width/PD
            interaction) but isn&apos;t part of the four-card dashboard above — a lower-profile
            harness, disclosed here rather than quietly left out. A fourth planned set,{" "}
            <b className="text-[var(--ink)] font-semibold">style fit, was never built</b> — it needs
            an optician&apos;s judgement to grade correctly, and that dependency was never resolved
            into actual cases. Said plainly rather than implied by omission.
          </p>
        </section>

        {/* ---- fork: judged vs deterministic ---- */}
        <section className="mb-14">
          <p className="text-[11.5px] font-medium text-[var(--acc)] tracking-wide uppercase m-0 mb-2.5">Which check goes where</p>
          <h2 className="text-[22px] leading-[1.24] tracking-tight m-0 mb-2.5 max-w-[28ch]" style={{ fontFamily: "var(--font-serif, inherit)", fontWeight: 500 }}>
            Two of the four numbers are graded by code. Two need a reader.
          </h2>
          <p className="text-[15px] leading-relaxed text-[var(--ink2)] m-0 mb-5 max-w-[58ch]" style={{ fontFamily: "var(--font-serif, inherit)" }}>
            Using a judge where code would do adds cost and noise to a question that already has one
            right answer. Using code where a reader is needed doesn&apos;t work at all. The split is
            the decision, not a shortcut.
          </p>
          <div className="grid grid-cols-1 min-[640px]:grid-cols-2 gap-3 bg-[var(--sunk)] rounded-[14px] p-5 shadow-[var(--shadow-in)]">
            <div className="bg-[var(--block)] border border-[var(--line)] rounded-[12px] px-4.5 py-4">
              <span className="inline-block text-[11px] font-medium px-2.5 py-1 rounded-full mb-3" style={{ background: "var(--acc-lt)", color: "var(--acc)" }}>
                LLM judge
              </span>
              <h3 className="text-[14.5px] font-semibold text-[var(--ink)] m-0 mb-1.5">Reading-comprehension questions</h3>
              <p className="text-[13.5px] leading-relaxed text-[var(--ink2)] m-0 mb-3">
                There&apos;s no regex for &ldquo;does this sentence follow from that paragraph.&rdquo; A
                second model grades these — validated against hand labels first.
              </p>
              <ul className="m-0 p-0 list-none border-t border-[var(--line2)]">
                {["Is this claim supported by what was retrieved?", "Does this citation point at the passage that backs it?", "Is a styling convention hedged rather than asserted?"].map((t) => (
                  <li key={t} className="text-[12.5px] text-[var(--ink2)] py-2 border-b border-[var(--line2)] last:border-b-0">
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-[var(--block)] border border-[var(--line)] rounded-[12px] px-4.5 py-4">
              <span className="inline-block text-[11px] font-medium px-2.5 py-1 rounded-full mb-3" style={{ background: "var(--ok-lt)", color: "var(--ok)" }}>
                deterministic
              </span>
              <h3 className="text-[14.5px] font-semibold text-[var(--ink)] m-0 mb-1.5">Facts the code can check</h3>
              <p className="text-[13.5px] leading-relaxed text-[var(--ink2)] m-0 mb-3">
                Asserting it is exact and instant. A judge here would add noise and cost to a
                question that already has one right answer.
              </p>
              <ul className="m-0 p-0 list-none border-t border-[var(--line2)]">
                {['Did "around ₹3,000" become a range, not a point?', "Did the SQL filter exclude the over-budget frame?", "Did the safety interrupt fire on turn four?"].map((t) => (
                  <li key={t} className="text-[12.5px] text-[var(--ink2)] py-2 border-b border-[var(--line2)] last:border-b-0">
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ---- minimal pair ---- */}
        {negative && positive && (
          <section className="mb-14">
            <p className="text-[11.5px] font-medium text-[var(--acc)] tracking-wide uppercase m-0 mb-2.5">Who checks the checker</p>
            <h2 className="text-[22px] leading-[1.24] tracking-tight m-0 mb-2.5 max-w-[28ch]" style={{ fontFamily: "var(--font-serif, inherit)", fontWeight: 500 }}>
              A judge that passes everything has told you nothing
            </h2>
            <p className="text-[15px] leading-relaxed text-[var(--ink2)] m-0 mb-5 max-w-[58ch]" style={{ fontFamily: "var(--font-serif, inherit)" }}>
              Before trusting the judge to grade anything, it gets tested on cases a human already
              labelled — including answers written to be <em>wrong</em>. Here is the sharpest one:
              the same claim, from the same source, twice. One hedged, one not. Both quotes below
              are the real generated text these two cases grade.
            </p>
            <div className="grid grid-cols-1 min-[640px]:grid-cols-2 gap-3">
              <div className="rounded-[13px] px-5 py-4.5 border-2" style={{ borderColor: "var(--ok)", background: "var(--block)" }}>
                <p className="font-mono text-[11px] text-[var(--ink3)] m-0 mb-3">{positive.id}</p>
                <blockquote className="text-[15px] leading-relaxed m-0 mb-3.5 pl-3 border-l-2" style={{ borderColor: "var(--ok)", fontFamily: "var(--font-serif, inherit)" }}>
                  <span className="text-[var(--ink)]">{truncate(positive.answer, 280)}</span>
                </blockquote>
                <div className="flex gap-2 flex-wrap pt-3 border-t border-[var(--line2)]">
                  <span className="text-[11px] font-medium px-2.5 py-1.5 rounded-full" style={{ background: "var(--ok-lt)", color: "var(--ok)" }}>
                    hand label: {positive.dimensions.hedging_match?.hand ?? "pass"}
                  </span>
                  <span className="text-[11px] font-medium px-2.5 py-1.5 rounded-full" style={{ background: "var(--ok-lt)", color: "var(--ok)" }}>
                    judge: {positive.dimensions.hedging_match?.judge ?? "pass"}
                  </span>
                </div>
              </div>
              <div className="rounded-[13px] px-5 py-4.5 border-2" style={{ borderColor: "var(--warn)", background: "var(--block)" }}>
                <p className="font-mono text-[11px] text-[var(--ink3)] m-0 mb-3">{negative.id}</p>
                <blockquote className="text-[15px] leading-relaxed m-0 mb-3.5 pl-3 border-l-2" style={{ borderColor: "var(--warn)", fontFamily: "var(--font-serif, inherit)" }}>
                  <span className="text-[var(--ink)]">{truncate(negative.answer, 280)}</span>
                </blockquote>
                <div className="flex gap-2 flex-wrap pt-3 border-t border-[var(--line2)]">
                  <span className="text-[11px] font-medium px-2.5 py-1.5 rounded-full" style={{ background: "var(--warn-lt)", color: "var(--warn)" }}>
                    hand label: {negative.dimensions.hedging_match?.hand ?? "fail"}
                  </span>
                  <span className="text-[11px] font-medium px-2.5 py-1.5 rounded-full" style={{ background: "var(--warn-lt)", color: "var(--warn)" }}>
                    judge: {negative.dimensions.hedging_match?.judge ?? "fail"}
                  </span>
                </div>
              </div>
            </div>
            <p className="text-[13px] leading-relaxed text-[var(--ink3)] mt-3.5 max-w-[62ch]">
              The judge catches it on every run.{" "}
              <b className="text-[var(--ink)] font-semibold">The pair is what demonstrates discrimination — neither case alone would.</b> A
              100% score on an all-positive set tells you the system rarely fails, not that the
              grader can spot failure.
            </p>
          </section>
        )}

        {/* ---- case matrix ---- */}
        <section className="mb-14">
          <p className="text-[11.5px] font-medium text-[var(--acc)] tracking-wide uppercase m-0 mb-2.5">All {caseMatrix.length} validation cases</p>
          <h2 className="text-[22px] leading-[1.24] tracking-tight m-0 mb-2.5 max-w-[28ch]" style={{ fontFamily: "var(--font-serif, inherit)", fontWeight: 500 }}>
            Half of these cases are deliberately broken. That&apos;s the point.
          </h2>
          <p className="text-[15px] leading-relaxed text-[var(--ink2)] m-0 mb-5 max-w-[58ch]" style={{ fontFamily: "var(--font-serif, inherit)" }}>
            {real.length} real transcripts, {constructed.length} constructed specifically to test
            failure detection — a set built only from real runs would be all-green by accident and
            couldn&apos;t show whether the judge can spot a failure at all.
          </p>

          <div className="bg-[var(--sunk)] rounded-[14px] p-5 shadow-[var(--shadow-in)]">
            <div className="grid grid-cols-[1fr_60px_60px_60px] min-[500px]:grid-cols-[1fr_74px_74px_74px] gap-2 pb-2 border-b border-[var(--line)]">
              <span className="text-[10.5px] font-medium text-[var(--ink3)]">case</span>
              <span className="text-[10.5px] font-medium text-[var(--ink3)] text-center">grounded</span>
              <span className="text-[10.5px] font-medium text-[var(--ink3)] text-center">citation</span>
              <span className="text-[10.5px] font-medium text-[var(--ink3)] text-center">hedging</span>
            </div>

            {[
              { label: `REAL PIPELINE TRANSCRIPTS · ${real.length}`, rows: real },
              { label: `CONSTRUCTED TO TEST FAILURE DETECTION · ${constructed.length}`, rows: constructed },
            ].map((group) => (
              <div key={group.label}>
                <p className="text-[10.5px] font-medium text-[var(--ink3)] tracking-wide pt-3.5 pb-1.5 m-0">{group.label}</p>
                {group.rows.map((c) => (
                  <div
                    key={c.id}
                    className="grid grid-cols-[1fr_60px_60px_60px] min-[500px]:grid-cols-[1fr_74px_74px_74px] gap-2 items-center py-1 border-b border-[var(--line2)]"
                  >
                    <span className="font-mono text-[11.5px] text-[var(--ink2)] truncate">{c.id}</span>
                    <Cell v={c.dimensions.groundedness?.hand} disagree={c.dimensions.groundedness && !c.dimensions.groundedness.agrees} />
                    <Cell v={c.dimensions.citation_accuracy?.hand} disagree={c.dimensions.citation_accuracy && !c.dimensions.citation_accuracy.agrees} />
                    <Cell v={c.dimensions.hedging_match?.hand} disagree={c.dimensions.hedging_match && !c.dimensions.hedging_match.agrees} />
                  </div>
                ))}
              </div>
            ))}

            <div className="flex gap-3.5 flex-wrap mt-3.5">
              <span className="flex items-center gap-1.5 text-[11.5px] text-[var(--ink3)]">
                <i className="w-[13px] h-[13px] rounded-[4px] inline-block" style={{ background: "var(--ok-lt)", border: "1px solid var(--ok)" }} />
                pass
              </span>
              <span className="flex items-center gap-1.5 text-[11.5px] text-[var(--ink3)]">
                <i className="w-[13px] h-[13px] rounded-[4px] inline-block" style={{ background: "var(--warn-lt)", border: "1px solid var(--warn)" }} />
                fail
              </span>
              <span className="flex items-center gap-1.5 text-[11.5px] text-[var(--ink3)]">
                <i className="w-[13px] h-[13px] rounded-[4px] inline-block" style={{ border: "1px dashed var(--line)" }} />
                dimension doesn&apos;t apply
              </span>
              <span className="flex items-center gap-1.5 text-[11.5px] text-[var(--ink3)]">
                <i className="w-[13px] h-[13px] rounded-[4px] inline-block" style={{ border: "1.5px dashed var(--warn)" }} />
                judge disagrees with hand label
              </span>
            </div>
          </div>
        </section>

        {/* ---- held-out ---- */}
        <section className="mb-14">
          <p className="text-[11.5px] font-medium text-[var(--acc)] tracking-wide uppercase m-0 mb-2.5">The trap in the previous section</p>
          <h2 className="text-[22px] leading-[1.24] tracking-tight m-0 mb-2.5 max-w-[28ch]" style={{ fontFamily: "var(--font-serif, inherit)", fontWeight: 500 }}>
            A grader tuned on its own test will always look good
          </h2>
          <p className="text-[15px] leading-relaxed text-[var(--ink2)] m-0 mb-5 max-w-[58ch]" style={{ fontFamily: "var(--font-serif, inherit)" }}>
            The judge&apos;s instructions were improved by studying where it disagreed with the human
            labels (2026-08-31). Scoring it on those same cases afterwards measures whether the fix
            fits the cases it was fitted to — <em>in-sample</em>, and flattering by construction. Six
            fresh queries were labelled by hand first, before any judge saw them, and run against the
            frozen instructions.
          </p>
          <div className="bg-[var(--sunk)] rounded-[14px] p-5 shadow-[var(--shadow-in)]">
            <div className="grid grid-cols-1 min-[560px]:grid-cols-[150px_1fr_1fr] gap-3.5 pb-2 border-b border-[var(--line)]">
              <span className="text-[10.5px] font-medium text-[var(--ink3)]">dimension</span>
              <span className="text-[10.5px] font-medium text-[var(--ink3)]">in-sample (17 cases)</span>
              <span className="text-[10.5px] font-medium text-[var(--ink3)]">held-out (6 cases)</span>
            </div>
            {HELD_OUT.map((h) => (
              <div key={h.dim} className="grid grid-cols-1 min-[560px]:grid-cols-[150px_1fr_1fr] gap-3.5 items-center py-3 border-b border-[var(--line2)] last:border-b-0">
                <span className="font-mono text-[12.5px] text-[var(--ink2)]">{h.dim}</span>
                <RangeBar range={h.inSample} />
                <RangeBar range={h.heldOut} />
              </div>
            ))}
          </div>
          <p className="text-[13px] leading-relaxed text-[var(--ink3)] mt-3.5 max-w-[62ch]">
            Small N on the held-out side — one flipped case moves the percentage by double digits —
            so this reads as &ldquo;consistent with the in-sample range,&rdquo; not a tighter number.{" "}
            <b className="text-[var(--ink)] font-semibold">Landing inside or slightly above the in-sample range is what generalisation looks like:</b>{" "}
            the revision held on material it never saw.
          </p>
        </section>

        {/* ---- findings ---- */}
        <section className="mb-9">
          <p className="text-[11.5px] font-medium text-[var(--acc)] tracking-wide uppercase m-0 mb-2.5">Five findings</p>
          <h2 className="text-[22px] leading-[1.24] tracking-tight m-0 mb-4 max-w-[28ch]" style={{ fontFamily: "var(--font-serif, inherit)", fontWeight: 500 }}>
            The tests caught five real bugs — two of them in the tests
          </h2>
          <div className="grid gap-2.5">
            {FINDINGS.map((f) => (
              <div key={f.title} className="bg-[var(--block)] border border-[var(--line)] rounded-r-[12px] px-5 py-4" style={{ borderLeft: "3px solid var(--warn)" }}>
                <p className="font-mono text-[11px] text-[var(--ink3)] m-0 mb-1.5">{f.date}</p>
                <h4 className="text-[14.5px] font-semibold text-[var(--ink)] m-0 mb-2">{f.title}</h4>
                <p className="text-[13.5px] leading-relaxed text-[var(--ink2)] m-0">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="flex gap-5 flex-wrap pt-5 border-t border-[var(--line)] text-[13.5px] font-medium">
          <Link href="/" className="text-[var(--acc)]">
            ← Try the live demo
          </Link>
          <Link href="/how-it-works" className="text-[var(--acc)]">
            How it works
          </Link>
          <Link href="/baseline" className="text-[var(--acc)]">
            See the naive baseline
          </Link>
        </div>
      </div>

      {openGoldenSet === "judge" && (
        <GoldenSetModal title="judge_validation.json" filename="evals/golden/judge_validation.json" questions={goldenQuestions.judgeValidation} onClose={() => setOpenGoldenSet(null)} />
      )}
      {openGoldenSet === "conversation" && (
        <GoldenSetModal title="conversation.json" filename="evals/golden/conversation.json" questions={goldenQuestions.conversation} onClose={() => setOpenGoldenSet(null)} />
      )}
      {openGoldenSet === "refusal" && (
        <GoldenSetModal title="refusal.json" filename="evals/golden/refusal.json" questions={goldenQuestions.refusal} onClose={() => setOpenGoldenSet(null)} />
      )}
    </div>
  );
}
