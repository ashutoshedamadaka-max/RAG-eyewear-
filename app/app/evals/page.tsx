import Link from "next/link";
import { loadEvalSummary, loadGoldenCaseCounts } from "@/lib/eval-reports";

// Four-page restructure (decisions.md, 2026-09-03): the full evaluation
// report, moved off the demo page. Rendered from the committed report
// JSON (evals/harness/reports/, mirrored into app/data/ at build time --
// see scripts/copy-runtime-data.ts) and the golden-set files themselves,
// not hardcoded, so re-running an eval and committing its report is what
// keeps this page current. Section 4's findings are the exception: real,
// dated history pulled from decisions.md, presented as case-study prose
// because that's what they are -- a past finding doesn't get "recomputed"
// by re-running today's suite, it gets cited accurately.
function formatDate(iso: string): string {
  if (!iso) return "not yet run";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

interface CardData {
  value: string;
  label: string;
  detail: string;
}

function SummaryCard({ c }: { c: CardData }) {
  return (
    <div className="flex-1 min-w-[220px] px-4 py-3.5 border-l border-[#DFE6E2] first:border-l-0">
      <div className="text-[21px] font-semibold text-[#14201C] tabular-nums">{c.value}</div>
      <div className="text-[12.8px] font-medium text-[#14201C] mt-1">{c.label}</div>
      <div className="text-[11.5px] leading-relaxed text-[#8A9992] mt-1.5">{c.detail}</div>
    </div>
  );
}

function SectionHeading({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <div className="w-6 h-6 rounded-full bg-[#14201C] text-white text-[12px] leading-[24px] text-center flex-none tabular-nums">{n}</div>
      <h2 className="text-[17px] font-semibold text-[#14201C] m-0">{title}</h2>
    </div>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[13.5px] leading-relaxed text-[#5F6F68] mt-3 max-w-[68ch]">{children}</p>;
}

export default function EvalsPage() {
  const summary = loadEvalSummary();
  const goldenCounts = loadGoldenCaseCounts();

  const cards: CardData[] = [
    {
      value: `${summary.groundedness.min}–${summary.groundedness.max}%`,
      label: "Every claim traceable to a source",
      detail: "No invented facts. The range is three runs of the same test — the judge is itself a language model, so it isn't perfectly repeatable run to run.",
    },
    {
      value: `${summary.citationAccuracy.min}–${summary.citationAccuracy.max}%`,
      label: "Citations point at the right passage",
      detail: "A claim can be well-supported but attached to the wrong reference. Measured as a separate dimension from groundedness.",
    },
    {
      value: summary.conversation ? `${summary.conversation.pass}/${summary.conversation.total}` : "—",
      label: "Conversation handled correctly",
      detail: "Budget phrasing, mid-conversation changes of mind, the safety interrupt firing on any turn, off-topic input redirected rather than dropped — checked against known-correct outcomes, not graded.",
    },
    {
      value: summary.gapHandling ? `${summary.gapHandling.pass}/${summary.gapHandling.total}` : "—",
      label: "Says so when nothing fits",
      detail: "Catalog combinations built to be unsatisfiable. Correct behavior is naming what's missing and offering the closest real alternative, not silence and not a bare refusal.",
    },
  ];

  const latestReport = summary.latestJudgeReport;
  const negativeCase = latestReport?.cases.find((c) => c.id === "constructed-hedging-fail-convention-stated-as-requirement");
  const negativeHedging = negativeCase?.hedging_match as { hand: string; judge: string; agrees: boolean } | undefined;

  const currentDisagreements = latestReport
    ? Object.entries(latestReport.summary).flatMap(([dim, s]) => s.disagreements.map((d) => ({ dim, ...d })))
    : [];

  return (
    <div className="min-h-full">
      <div className="max-w-[860px] mx-auto px-6 py-10">
        <h1
          className="text-[26px] leading-tight text-[#14201C] tracking-tight m-0"
          style={{ fontFamily: "var(--font-serif, inherit)", fontWeight: 600 }}
        >
          Evaluation report
        </h1>
        <p className="text-[13.5px] leading-relaxed text-[#5F6F68] mt-2 max-w-[64ch]">
          Every number below is measured against a golden set — a fixed list of test cases with
          the correct answer written down in advance — and rendered directly from the committed
          report this suite produced, not typed in by hand.
        </p>

        <div className="flex flex-wrap border border-[#DFE6E2] rounded-md overflow-hidden bg-[#FDFEFD] mt-6">
          {cards.map((c) => (
            <SummaryCard key={c.label} c={c} />
          ))}
        </div>
        <p className="text-[12px] font-mono text-[#8A9992] mt-2.5">
          Last run {formatDate(summary.latestGeneratedAt)} · {summary.judgeRunsUsed} judge run{summary.judgeRunsUsed === 1 ? "" : "s"} ·{" "}
          {summary.judgeCaseTotal} judge cases · {goldenCounts.conversation} conversation cases
          {summary.conversation ? ` (${summary.conversation.total} checks)` : ""} · {summary.gapHandling?.total ?? 0} gap-handling cases
        </p>

        <p className="text-[13.5px] leading-relaxed text-[#5F6F68] mt-5 max-w-[68ch]">
          Every number here is measured against the golden set — a fixed list of test
          conversations with the correct answer written down in advance. If you want to see what
          a version without structured filtering does with the same three gap queries, the
          deliberately naive first build is still running.{" "}
          <Link href="/baseline" className="underline text-[#14493E] font-medium">
            It scores 0/3.
          </Link>
        </p>

        {/* ---- 1. Methodology ---- */}
        <section className="mt-11">
          <SectionHeading n={1} title="Methodology" />
          <P>
            Two of the four numbers above come from an LLM judge; two come from deterministic
            code. That split is deliberate, not a shortcut: <b className="text-[#14201C] font-medium">whether a claim in a generated
            answer is actually supported by what was retrieved</b> is a reading-comprehension
            question only a language model can grade at any scale — there&apos;s no regex for &ldquo;does
            this sentence follow from that paragraph.&rdquo; But <b className="text-[#14201C] font-medium">whether a slot value merged
            correctly</b> or <b className="text-[#14201C] font-medium">whether a SQL filter excluded an out-of-budget frame</b> is a fact
            the code can check directly — asserting it is exact and instant, and using a judge for
            it would just add noise and cost to a question that already has one right answer.
          </P>
          <P>
            <b className="text-[#14201C] font-medium">Groundedness</b> and <b className="text-[#14201C] font-medium">citation accuracy</b> are graded as
            separate dimensions on purpose, after an early revision found they were unintentionally
            overlapping: a misattributed citation (the right fact, attached to the wrong bracket
            number) was failing both judges for the same underlying reason. Groundedness now asks
            only &ldquo;is this claim supported <em>somewhere</em> in the retrieved context, regardless of
            which reference is attached to it&rdquo; — citation accuracy only grades claims that carry an
            explicit citation at all, and asks whether that specific reference actually supports
            that specific claim. An uncited claim is purely a groundedness question; a claim cited
            to the wrong source is a citation-accuracy failure even if the fact itself is true
            somewhere else in context.
          </P>
          <P>
            <b className="text-[#14201C] font-medium">Hedging match</b> is the third dimension: every retrieved advice chunk carries a{" "}
            <code className="text-[12.5px] bg-[#EEF2F0] px-1 py-0.5 rounded">claim_type</code> —{" "}
            <b className="text-[#14201C] font-medium">physical</b> (a measurable fact) or <b className="text-[#14201C] font-medium">convention</b> (a styling
            norm, true by custom). The judge checks that the generated answer&apos;s confidence
            register matches: a physical claim stated plainly, a convention claim named and hedged
            as one — never the reverse, and never a convention claim borrowing the confidence of a
            physical fact just because it&apos;s said warmly.
          </P>
        </section>

        {/* ---- 2. Judge validation ---- */}
        <section className="mt-11">
          <SectionHeading n={2} title="Judge validation" />
          <P>
            Before trusting an LLM judge to grade anything, it has to be checked against cases a
            human has already labelled. <code className="text-[12.5px] bg-[#EEF2F0] px-1 py-0.5 rounded">evals/golden/judge_validation.json</code> has{" "}
            {goldenCounts.judgeValidation} hand-labelled cases — real transcripts from the actual
            pipeline, verified claim-by-claim against the catalog and advice text before labelling,
            plus deliberately corrupted or synthesized ones built specifically to test failure
            detection. An all-real, all-positive set would say nothing about whether a judge can
            actually catch a failure, only that this system usually doesn&apos;t produce one — so the
            constructed cases exist to force the question.
          </P>

          <div className="mt-4 rounded-md border border-[#DFE6E2] bg-[#FDFEFD] p-4">
            <div className="text-[12.5px] font-semibold text-[#14201C] mb-1.5">The negative case, proving the hedging judge discriminates</div>
            <p className="text-[12.5px] leading-relaxed text-[#5F6F68] m-0">
              <code className="text-[11.5px] bg-[#EEF2F0] px-1 py-0.5 rounded">constructed-hedging-fail-convention-stated-as-requirement</code>{" "}
              states a styling convention (&ldquo;angular frames for a round face&rdquo;) as if it were a
              fitting requirement — a deliberately wrong register. Hand label: fail.{" "}
              {negativeHedging ? (
                <>
                  Judge on the latest run: <b className="text-[#14201C] font-medium">{negativeHedging.judge}</b>, agreeing with the hand label
                  ({negativeHedging.agrees ? "correctly caught" : "currently disagrees — see below"}). Run alongside its
                  positive-control twin (<code className="text-[11.5px] bg-[#EEF2F0] px-1 py-0.5 rounded">constructed-hedging-pass-convention-correctly-hedged</code>,
                  same convention claim, correctly hedged, hand label pass) — the pair is what actually
                  demonstrates discrimination, not either case alone.
                </>
              ) : (
                "No judge report committed yet — run npm run validate-judges to populate this."
              )}
            </p>
          </div>

          <P>
            <b className="text-[#14201C] font-medium">In-sample vs. held-out, reported separately (2026-08-31).</b> The groundedness/citation
            prompts were revised by looking at where they disagreed with hand labels on the
            then-15/17-case set — reporting agreement on that same set is in-sample by
            construction, since it measures whether the prompts fit the cases used to fit them.
            Six fresh queries were then run through the real pipeline, hand-labelled independently
            before any judge saw them, against the frozen (unmodified) prompts:
          </P>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[12.5px] border-collapse">
              <thead>
                <tr className="text-left text-[#8A9992] border-b border-[#DFE6E2]">
                  <th className="py-1.5 pr-4 font-medium">dimension</th>
                  <th className="py-1.5 pr-4 font-medium">in-sample</th>
                  <th className="py-1.5 font-medium">held-out</th>
                </tr>
              </thead>
              <tbody className="text-[#14201C]">
                <tr className="border-b border-[#DFE6E2]">
                  <td className="py-1.5 pr-4">groundedness</td>
                  <td className="py-1.5 pr-4 tabular-nums">82–88% (3 runs, 17 cases)</td>
                  <td className="py-1.5 tabular-nums">83–100% (2 runs, 6 cases)</td>
                </tr>
                <tr className="border-b border-[#DFE6E2]">
                  <td className="py-1.5 pr-4">citation_accuracy</td>
                  <td className="py-1.5 pr-4 tabular-nums">80–93%</td>
                  <td className="py-1.5 tabular-nums">83–100%</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-4">hedging_match</td>
                  <td className="py-1.5 pr-4 tabular-nums">100% (5 cases)</td>
                  <td className="py-1.5 tabular-nums">100% (2 cases)</td>
                </tr>
              </tbody>
            </table>
          </div>
          <P>
            Small N on the held-out side — one flipped case moves the percentage by double digits
            — so this reads as &ldquo;consistent with the in-sample range,&rdquo; not a tighter number. The
            held-out set landing inside (or slightly above) the in-sample range is what
            generalization looks like: the prompt revision held on material it never saw, not just
            on what it was tuned against.
          </P>

          <P>
            <b className="text-[#14201C] font-medium">Two disagreements, deliberately left unresolved (2026-08-31).</b> Not every judge/hand
            disagreement gets chased until it disappears — two from that same validation round were
            judged to be genuinely ambiguous prose, not a judge error, and kept rather than massaged
            into agreement: whether a frame correctly counts as &ldquo;nearest by size&rdquo; when it&apos;s
            narrowest on one dimension and widest on another; whether 1.67-index lens material
            counts as &ldquo;very-high-index&rdquo; against a source that only explicitly names anything above
            1.67 as &ldquo;ultra-high-index.&rdquo; The goal was validating the judges, not producing a clean
            number.
          </P>
          {currentDisagreements.length > 0 && (
            <div className="mt-4 rounded-md border border-[#E3C989] bg-[#FBF3DF] p-4">
              <div className="text-[12.5px] font-semibold text-[#6B4E14] mb-1.5">
                Current disagreements, latest run ({formatDate(summary.latestGeneratedAt)})
              </div>
              <p className="text-[12px] leading-relaxed text-[#6B4E14] mb-2">
                Reported as-is, not filtered to only the two above — the full 18-case set is
                re-graded on every run, and run-to-run judge variance (temperature 1, can&apos;t be
                pinned to 0) means the exact set of disagreements shifts between runs. See{" "}
                <code className="text-[11px] bg-[#F3E9CE] px-1 py-0.5 rounded">decisions.md</code> for the fuller run-by-run spread.
              </p>
              <ul className="text-[12px] text-[#6B4E14] leading-relaxed list-disc list-inside space-y-0.5">
                {currentDisagreements.slice(0, 6).map((d, i) => (
                  <li key={i}>
                    <code className="text-[11px] bg-[#F3E9CE] px-1 py-0.5 rounded">{d.id}</code> ({d.dim}): hand={d.hand}, judge={d.judge}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* ---- 3. The three golden sets ---- */}
        <section className="mt-11">
          <SectionHeading n={3} title="The three golden sets" />
          <P>
            They fail differently and need different graders — an overall average would hide
            exactly what matters.
          </P>

          <div className="mt-4 space-y-3">
            <div className="rounded-md border border-[#DFE6E2] bg-[#FDFEFD] p-4">
              <div className="text-[13px] font-semibold text-[#14201C]">
                judge_validation.json — {goldenCounts.judgeValidation} cases
              </div>
              <p className="text-[12.5px] leading-relaxed text-[#5F6F68] mt-1.5 mb-0">
                Hand-labelled transcripts (real and constructed) for validating the groundedness,
                citation-accuracy, and hedging judges — see section 2. This is the only golden set
                a judge grades; the other two are checked programmatically.
              </p>
            </div>
            <div className="rounded-md border border-[#DFE6E2] bg-[#FDFEFD] p-4">
              <div className="text-[13px] font-semibold text-[#14201C]">
                conversation.json — {goldenCounts.conversation} cases
              </div>
              <p className="text-[12.5px] leading-relaxed text-[#5F6F68] mt-1.5 mb-0">
                Scripted multi-turn conversations, graded programmatically against the resulting
                state — partial slot updates, the question-cap and its stated assumptions, the
                safety interrupt firing on any turn regardless of what was pending, and (added
                2026-09-02) off-topic input getting acknowledged and redirected instead of silently
                dropped.
              </p>
            </div>
            <div className="rounded-md border border-[#DFE6E2] bg-[#FDFEFD] p-4">
              <div className="text-[13px] font-semibold text-[#14201C]">
                refusal.json — {Object.values(goldenCounts.refusal).reduce((a, b) => a + b, 0)} cases across{" "}
                {Object.keys(goldenCounts.refusal).length} categories
              </div>
              <p className="text-[12.5px] leading-relaxed text-[#5F6F68] mt-1.5 mb-0">
                Safety-interrupt cases (astigmatism, floaters, sudden vision change) and
                constraint-violation cases — catalog combinations built to be unsatisfiable,
                including the three intentional gaps this page&apos;s &ldquo;says so when nothing fits&rdquo; card
                measures. <b className="text-[#14201C] font-medium">Unanswerable questions are deliberately included</b> because bare
                refusal isn&apos;t the target: the correct behavior on a real gap is naming the violated
                constraint and offering the nearest alternative, saying explicitly what it drops —
                not silence, and not a useless-but-honest &ldquo;I can&apos;t help with that.&rdquo; Reserving actual
                refusal for the safety cases, where declining outright genuinely is correct, is the
                whole point of splitting this set out from the constraint-violation cases at all.
              </p>
            </div>
          </div>

          <P>
            <code className="text-[12.5px] bg-[#EEF2F0] px-1 py-0.5 rounded">physical.json</code> also exists (
            {Object.values(goldenCounts.physical).reduce((a, b) => a + b, 0)} cases: lens-index
            recommendation, minimum progressive B-height, frame-width/PD interaction) but isn&apos;t
            part of the four-card dashboard above — a lower-profile harness, disclosed here rather
            than quietly left out. A fourth planned set, style fit, was never built: it needs an
            optician&apos;s judgment to grade correctly, and that dependency was never resolved into
            actual cases. Said plainly rather than implied by omission.
          </P>
        </section>

        {/* ---- 4. What the evals caught ---- */}
        <section className="mt-11">
          <SectionHeading n={4} title="What the evals caught" />
          <P>
            The evals aren&apos;t just a scoreboard — building them surfaced real defects, including
            defects in the evals themselves. Four findings, pulled from the project&apos;s decision
            log rather than summarized from memory:
          </P>

          <div className="mt-4 space-y-4">
            <div>
              <div className="text-[13px] font-semibold text-[#14201C]">
                Ground truth copied from the system being graded (2026-08-28)
              </div>
              <p className="text-[12.5px] leading-relaxed text-[#5F6F68] mt-1">
                A refusal-set case claimed the nearest miss to &ldquo;titanium under ₹4,500&rdquo; was a
                ₹4,800 frame. Checked against the catalog directly: wrong — the actual cheapest
                titanium frame was ₹100 closer, but it never appeared in the naive baseline&apos;s
                top-5 results, so it was never considered while writing the case. The golden set&apos;s
                &ldquo;ground truth&rdquo; had been quietly inherited from the failing pipeline&apos;s own output.
                The general lesson: ground truth derived from the system under test silently caps
                the ceiling of anything that later outperforms it — it doesn&apos;t just fail to catch
                the bug, it would have scored the fix as wrong for finding the answer the bug
                missed. Fixed by computing every near-miss directly from the catalog
                (<code className="text-[11.5px] bg-[#EEF2F0] px-1 py-0.5 rounded">nearest-miss.ts</code>), not by hand.
              </p>
            </div>

            <div>
              <div className="text-[13px] font-semibold text-[#14201C]">
                The same circularity, one level up (2026-08-29)
              </div>
              <p className="text-[12.5px] leading-relaxed text-[#5F6F68] mt-1">
                A results table called agreement between the golden-set generator and the live SQL
                pipeline &ldquo;independently-verified ground truth.&rdquo; It wasn&apos;t: both were the same
                algorithm (relax one constraint, walk an ordered domain, take the cheapest
                qualifying frame) implemented twice — once as an in-memory filter, once as live
                SQL. Agreement between them is a consistency check confirming the two
                implementations aren&apos;t buggy relative to each other; it says nothing about whether
                that notion of &ldquo;nearest miss&rdquo; is the right one. Relabelled rather than left
                overclaiming what it showed.
              </p>
            </div>

            <div>
              <div className="text-[13px] font-semibold text-[#14201C]">
                &ldquo;Documented ≠ implemented,&rdquo; four instances across three mechanisms (2026-08-31 – 2026-09-01)
              </div>
              <p className="text-[12.5px] leading-relaxed text-[#5F6F68] mt-1">
                Three rules were correctly researched and written into the project&apos;s own spec but
                never reached the code at all — a missing system-prompt constraint, a derivation
                rule never compiled into an actual SQL clause, an exemption list that only existed
                in prose. A fourth was different in shape: the rule DID exist in code, but the
                guard against showing it prematurely was implemented in one caller, not in the
                rule&apos;s own state — so it looked fixed until a second, independent call path to the
                same underlying state was added, and the same bug reappeared through the new path.
                A rule enforced at one call site isn&apos;t enforced — it&apos;s suppressed at that call
                site, and the difference only shows up once a second site exists.
              </p>
            </div>

            <div>
              <div className="text-[13px] font-semibold text-[#14201C]">
                A model upgrade improved prose and worsened compliance (2026-08-28)
              </div>
              <p className="text-[12.5px] leading-relaxed text-[#5F6F68] mt-1">
                Re-running the naive baseline on a newer chat model produced visibly better-written
                refusals — explicit about what was missing, offering named alternatives — while
                constraint compliance did not improve, and on one query got worse. The direct
                answer to &ldquo;why not just use a stronger model&rdquo;: a more fluent model narrates more
                plausibly <em>around</em> a violated constraint instead of hitting the wall that made a
                weaker model refuse outright. Prose quality and constraint compliance are separate
                axes, and a harness that only reads the prose would have reported this as an
                improvement.
              </p>
            </div>

            <div>
              <div className="text-[13px] font-semibold text-[#14201C]">
                An intentional gap closed by ordinary catalog churn (2026-09-01 – 2026-09-03)
              </div>
              <p className="text-[12.5px] leading-relaxed text-[#5F6F68] mt-1">
                One of the catalog&apos;s three built-in gaps (no titanium frame under ₹4,500) was
                deliberately price-churned during a freshness-simulation exercise, specifically to
                test whether the gap survives ordinary catalog updates. It didn&apos;t — the churned
                price now falls just inside the threshold, and the &ldquo;says so when nothing fits&rdquo;
                card above measures that honestly (
                {summary.gapHandling ? `${summary.gapHandling.pass}/${summary.gapHandling.total}` : "—"}, not a stale 3/3) rather than
                quoting the number from before the churn. A static demo can&apos;t surface this kind of
                thing; a harness that re-runs against the live catalog can, and did.
              </p>
            </div>
          </div>
        </section>

        <div className="mt-11 pt-5 border-t border-[#DFE6E2] flex gap-4 flex-wrap text-[13px]">
          <Link href="/" className="underline text-[#14493E] font-medium">
            ← Try the live demo
          </Link>
          <Link href="/how-it-works" className="underline text-[#14493E] font-medium">
            How it works
          </Link>
          <Link href="/baseline" className="underline text-[#14493E] font-medium">
            See the naive baseline
          </Link>
        </div>
      </div>
    </div>
  );
}
