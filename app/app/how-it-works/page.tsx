"use client";

// Architecture page (decisions.md, 2026-09-04), rebuilt against a supplied
// prototype (how-it-works.jsx) treated as a visual spec, not copied as
// code: "show, don't explain" -- three interactive visuals carry the
// argument, prose is captioning. The prototype's own header/nav/theme-
// toggle are dropped -- this app already has one, shared site-wide via
// Header.tsx in the root shell, so this file is content only.
//
// The similarity-demo numbers are NOT invented to match the prototype's
// placeholder shape -- they're the real top-5 the naive Phase 1 baseline
// actually retrieved for "titanium frames under 4500 rupees"
// (docs/phase1-baseline-failures.md, section 4), byte-for-byte. The
// "natural experiment" callout below it is real too (same doc, "Natural
// experiment: Basalt Form 448 across two budget ceilings").
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

// docs/phase1-baseline-failures.md, section 4 -- the naive baseline's actual
// retrieved top-5 for "titanium frames under 4500 rupees", real cosine scores.
const TITANIUM_QUERY_RESULTS = [
  { name: "Vayu Series 357", price: 6150, score: 0.5397 },
  { name: "Basalt Form 448", price: 4800, score: 0.5391 },
  { name: "Sundial Series 103", price: 5400, score: 0.5377 },
  { name: "Truss Mark 538", price: 9650, score: 0.5341 },
  { name: "Terra Optics Mark 282", price: 6000, score: 0.5324 },
];
const SCORE_SPAN = (
  (Math.max(...TITANIUM_QUERY_RESULTS.map((f) => f.score)) - Math.min(...TITANIUM_QUERY_RESULTS.map((f) => f.score)))
).toFixed(4);
const PRICE_SPAN = Math.max(...TITANIUM_QUERY_RESULTS.map((f) => f.price)) - Math.min(...TITANIUM_QUERY_RESULTS.map((f) => f.price));

type CallKind = "chat" | "embedding" | "none";

interface Stage {
  n: number;
  title: string;
  kind: CallKind;
  headline: string;
  body: React.ReactNode;
}

const STAGES: Stage[] = [
  {
    n: 1,
    title: "Read the conversation",
    kind: "chat",
    headline: "One call, reading only what changed",
    body: (
      <>
        Extracts what THIS turn added — a partial update to what&apos;s already known, never a
        re-reading of the whole conversation. Say &ldquo;actually make it ₹3,000&rdquo; and only the
        budget moves.
      </>
    ),
  },
  {
    n: 2,
    title: "Applied the fitting rules",
    kind: "none",
    headline: "17 rules, checked every turn",
    body: (
      <>
        Optical rules turn what you said into constraints. Some are hard and never dropped —
        daytime driving needs UV400-rated lenses, progressives need at least 32mm of vertical
        lens height. Others are soft nudges, like face shape.
      </>
    ),
  },
  {
    n: 3,
    title: "Queried the catalogue",
    kind: "none",
    headline: "Real SQL, no similarity involved",
    body: (
      <>
        The constraints compile to a database query. A frame either matches or it doesn&apos;t. If
        nothing matches, one constraint relaxes at a time — cheapest first, never a safety rule —
        until something does.
      </>
    ),
  },
  {
    n: 4,
    title: "Retrieved optician guidance",
    kind: "embedding",
    headline: "This is the part that's actually RAG",
    body: (
      <>
        The question is embedded and matched by meaning against a corpus of optical guidance.
        Anything scoring below a similarity floor is discarded before the model ever sees it.
      </>
    ),
  },
  {
    n: 5,
    title: "Wrote the answer",
    kind: "chat",
    headline: "Two calls, run in parallel",
    body: (
      <>
        One writes the opening line, one picks the frames and the wrap-up. Cards carry the facts
        from the database; prose carries the judgement, drawn from the guidance. Every claim maps
        back to a source.
      </>
    ),
  },
  {
    n: 6,
    title: "What it cost",
    kind: "none",
    headline: "Real token counts, not estimates",
    body: (
      <>
        Read directly off the actual API responses. The embedding call&apos;s rate is OpenAI&apos;s
        published price; the chat model&apos;s isn&apos;t public, so the total is a labelled
        estimate, not a verified cost.
      </>
    ),
  },
];

const KIND_LABEL: Record<CallKind, string> = { chat: "chat call", embedding: "embedding call", none: "no model" };
const KIND_STYLE: Record<CallKind, { bg: string; color: string }> = {
  chat: { bg: "var(--acc-lt)", color: "var(--acc)" },
  embedding: { bg: "var(--ok-lt)", color: "var(--ok)" },
  none: { bg: "var(--line2)", color: "var(--ink3)" },
};

export default function HowItWorksPage() {
  const [budget, setBudget] = useState(4500);
  const [stage, setStage] = useState(0);
  const [playing, setPlaying] = useState(true);
  const tick = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    if (!playing) return;
    tick.current = setInterval(() => setStage((s) => (s + 1) % STAGES.length), 2600);
    return () => clearInterval(tick.current);
  }, [playing]);

  const S = STAGES[stage];

  return (
    <div className="min-h-full">
      <div className="max-w-[900px] mx-auto px-6 py-10">
        {/* ---- hero / the fork ---- */}
        <section className="mb-16">
          <p className="text-[11.5px] font-medium text-[var(--acc)] tracking-wide uppercase m-0 mb-2.5">How it works</p>
          <h1
            className="text-[32px] leading-[1.16] tracking-tight m-0 mb-3.5 max-w-[20ch]"
            style={{ fontFamily: "var(--font-serif, inherit)", fontWeight: 500 }}
          >
            Two kinds of question need two kinds of answer
          </h1>
          <p className="text-[16px] leading-relaxed text-[var(--ink2)] m-0 mb-6 max-w-[56ch]" style={{ fontFamily: "var(--font-serif, inherit)" }}>
            A frame catalogue is a database. Optical advice is prose. Treating both the same way
            is where most AI recommenders go wrong.
          </p>

          <div className="grid grid-cols-1 min-[640px]:grid-cols-[1fr_auto_1fr] gap-3.5 min-[640px]:gap-0 items-center bg-[var(--sunk)] rounded-[14px] p-5 shadow-[var(--shadow-in)]">
            <div className="bg-[var(--block)] border border-[var(--line)] rounded-[12px] px-4.5 py-4">
              <h3 className="text-[14px] font-semibold text-[var(--ink)] m-0 mb-1">The catalogue</h3>
              <p className="text-[12px] text-[var(--ink3)] m-0 mb-3">100 frames · prices, sizes, materials, stock</p>
              <span className="inline-block text-[11px] font-medium px-2.5 py-1 rounded-full" style={{ background: "var(--ok-lt)", color: "var(--ok)" }}>
                exact facts → SQL
              </span>
              <p className="text-[13px] leading-relaxed text-[var(--ink2)] mt-3 mb-0">
                A query either matches or it doesn&apos;t. ₹4,800 is not under ₹4,500, no matter
                how similar the words are.
              </p>
            </div>
            <div className="flex flex-row min-[640px]:flex-col items-center gap-1.5 min-[640px]:w-[56px] justify-center py-2">
              <svg width="40" height="60" viewBox="0 0 40 60" aria-hidden="true" className="min-[640px]:block hidden">
                <path d="M20 4 L20 26 M20 34 L20 56" stroke="var(--line)" strokeWidth="2" />
                <circle cx="20" cy="30" r="5" fill="var(--acc)" />
              </svg>
              <span className="text-[11px] text-[var(--ink3)] whitespace-nowrap">one agent</span>
            </div>
            <div className="bg-[var(--block)] border border-[var(--line)] rounded-[12px] px-4.5 py-4">
              <h3 className="text-[14px] font-semibold text-[var(--ink)] m-0 mb-1">The guidance</h3>
              <p className="text-[12px] text-[var(--ink3)] m-0 mb-3">Zeiss, HOYA, Rodenstock, an optician&apos;s guide</p>
              <span className="inline-block text-[11px] font-medium px-2.5 py-1 rounded-full" style={{ background: "var(--acc-lt)", color: "var(--acc)" }}>
                meaning → retrieval
              </span>
              <p className="text-[13px] leading-relaxed text-[var(--ink2)] mt-3 mb-0">
                &ldquo;Why does my prescription rule out rimless?&rdquo; has no column. It&apos;s prose,
                best matched by meaning.
              </p>
            </div>
          </div>
        </section>

        {/* ---- the failure, shown ---- */}
        <section className="mb-16">
          <p className="text-[11.5px] font-medium text-[var(--acc)] tracking-wide uppercase m-0 mb-2.5">The problem, in one slider</p>
          <h2 className="text-[24px] leading-[1.24] tracking-tight m-0 mb-2.5 max-w-[24ch]" style={{ fontFamily: "var(--font-serif, inherit)", fontWeight: 500 }}>
            Similarity can&apos;t count
          </h2>
          <p className="text-[16px] leading-relaxed text-[var(--ink2)] m-0 mb-6 max-w-[56ch]" style={{ fontFamily: "var(--font-serif, inherit)" }}>
            Drag the budget. Watch the scores not move at all while the verdict flips underneath
            them.
          </p>

          <div className="bg-[var(--sunk)] rounded-[14px] p-6 shadow-[var(--shadow-in)]">
            <p className="font-mono text-[13px] text-[var(--ink2)] m-0 mb-1">
              &ldquo;titanium frames under ₹{budget.toLocaleString("en-IN")}&rdquo;
            </p>
            <div className="flex items-center gap-3.5 mb-6 flex-wrap">
              <input
                type="range"
                min={4000}
                max={10000}
                step={50}
                value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
                aria-label="Budget ceiling"
                className="flex-1 min-w-[200px] accent-[var(--acc)]"
              />
              <b className="text-[18px] tabular-nums min-w-[96px] text-[var(--ink)]">₹{budget.toLocaleString("en-IN")}</b>
            </div>

            {TITANIUM_QUERY_RESULTS.map((f) => {
              const ok = f.price <= budget;
              return (
                <div key={f.name} className="grid grid-cols-1 min-[560px]:grid-cols-[150px_1fr_96px] gap-2 min-[560px]:gap-4 items-center py-3.5 border-t border-[var(--line)] first:border-t-0">
                  <div className="text-[13.5px] font-medium text-[var(--ink)]">
                    {f.name}
                    <small className="block text-[12px] font-normal text-[var(--ink3)] tabular-nums mt-0.5">₹{f.price.toLocaleString("en-IN")}</small>
                  </div>
                  <div className="h-[26px] bg-[var(--block)] border border-[var(--line)] rounded-[7px] relative overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 flex items-center justify-end px-2 transition-[width] duration-500"
                      style={{ width: `${(f.score - 0.5) * 1900}%`, background: "var(--acc-mid)" }}
                    >
                      <span className="text-[11px] font-medium text-[var(--shell)] tabular-nums">{f.score.toFixed(4)}</span>
                    </div>
                  </div>
                  <div className="text-[12.5px] font-semibold min-[560px]:text-right" style={{ color: ok ? "var(--ok)" : "var(--warn)" }}>
                    {ok ? "qualifies" : "over budget"}
                  </div>
                </div>
              );
            })}

            <p className="text-[12.5px] leading-relaxed text-[var(--ink3)] mt-4 pt-3.5 border-t border-[var(--line)]">
              These are the naive first build&apos;s real cosine similarity scores for this exact
              query — they span <b className="text-[var(--ink)] font-semibold">{SCORE_SPAN}</b> across
              the whole list, while price spans <b className="text-[var(--ink)] font-semibold">₹{PRICE_SPAN.toLocaleString("en-IN")}</b>.
              It gets stranger: at a ₹8,000 ceiling, Basalt Form 448 scored 0.527 and correctly
              qualified. Drop the ceiling to ₹4,500 and its score didn&apos;t fall as it became
              invalid — it <b className="text-[var(--ink)] font-semibold">rose</b> to 0.539, ranked
              as a <em>better</em> match at the exact moment it became the wrong answer.
            </p>
          </div>
          <p className="text-[13px] leading-relaxed text-[var(--ink3)] mt-3.5 max-w-[62ch]">
            This isn&apos;t hypothetical — to its credit, the naive baseline correctly says nothing
            meets the requirement rather than asserting a false match, but it still recommends two
            over-budget frames as &ldquo;stretch&rdquo; options without naming either overage (₹300 for
            Basalt, ₹900 for Sundial).{" "}
            <Link href="/baseline" className="text-[var(--acc)] font-medium border-b border-[var(--acc-lt)] no-underline">
              It&apos;s still running, if you want to see it.
            </Link>
          </p>
        </section>

        {/* ---- pipeline ---- */}
        <section className="mb-16">
          <p className="text-[11.5px] font-medium text-[var(--acc)] tracking-wide uppercase m-0 mb-2.5">Every turn that recommends something</p>
          <h2 className="text-[24px] leading-[1.24] tracking-tight m-0 mb-2.5 max-w-[24ch]" style={{ fontFamily: "var(--font-serif, inherit)", fontWeight: 500 }}>
            Six stages, four real calls
          </h2>
          <p className="text-[16px] leading-relaxed text-[var(--ink2)] m-0 mb-6 max-w-[56ch]" style={{ fontFamily: "var(--font-serif, inherit)" }}>
            The same six the live panel traces in real time — not a simplified version of them.
            Three calls go to the chat model, one to the embedding model. Every earlier turn only
            ever runs stage 1.
          </p>

          <div className="bg-[var(--sunk)] rounded-[14px] p-5 shadow-[var(--shadow-in)]">
            <div className="flex flex-wrap gap-1.5 mb-5">
              {STAGES.map((s, i) => (
                <button
                  key={s.n}
                  onClick={() => {
                    setPlaying(false);
                    setStage(i);
                  }}
                  className="flex-1 min-w-[110px] text-left rounded-[9px] border px-2.5 py-2.5 transition-colors"
                  style={{
                    borderColor: i === stage ? "var(--acc)" : "var(--line)",
                    background: i === stage ? "var(--acc-lt)" : "var(--block)",
                  }}
                >
                  <span className="block text-[10.5px] font-semibold tabular-nums mb-1.5" style={{ color: i === stage ? "var(--acc)" : "var(--ink3)" }}>
                    {s.n}
                  </span>
                  <span className="block text-[12px] font-medium text-[var(--ink)] leading-tight">{s.title}</span>
                  <span
                    className="inline-block text-[9.5px] font-medium mt-1.5 px-1.5 py-0.5 rounded-full"
                    style={{ background: KIND_STYLE[s.kind].bg, color: KIND_STYLE[s.kind].color }}
                  >
                    {KIND_LABEL[s.kind]}
                  </span>
                </button>
              ))}
            </div>
            <div className="bg-[var(--block)] border border-[var(--line)] rounded-[11px] px-5 py-4.5 min-h-[118px]">
              <h4 className="text-[15px] font-semibold text-[var(--ink)] m-0 mb-2">{S.headline}</h4>
              <p className="text-[14px] leading-relaxed text-[var(--ink2)] m-0 max-w-[64ch]">{S.body}</p>
            </div>
            <div className="flex items-center gap-2 mt-3.5">
              <button
                onClick={() => setPlaying((p) => !p)}
                className="text-[12px] font-medium text-[var(--ink2)] border border-[var(--line)] bg-[var(--block)] rounded-full px-3.5 py-1.5"
              >
                {playing ? "Pause" : "Play"}
              </button>
              <span className="text-[12px] text-[var(--ink3)]">Stage {stage + 1} of {STAGES.length} · tap any stage</span>
            </div>
          </div>
          <p className="text-[13px] leading-relaxed text-[var(--ink3)] mt-3.5 max-w-[62ch]">
            Stages 3 and 4 are different mechanisms, not two settings of one. The catalogue is
            never embedded. The guidance is never queried with SQL.
          </p>
        </section>

        {/* ---- claim types ---- */}
        <section className="mb-9">
          <p className="text-[11.5px] font-medium text-[var(--acc)] tracking-wide uppercase m-0 mb-2.5">One more split</p>
          <h2 className="text-[24px] leading-[1.24] tracking-tight m-0 mb-2.5 max-w-[24ch]" style={{ fontFamily: "var(--font-serif, inherit)", fontWeight: 500 }}>
            Not every claim deserves the same confidence
          </h2>
          <p className="text-[16px] leading-relaxed text-[var(--ink2)] m-0 mb-6 max-w-[56ch]" style={{ fontFamily: "var(--font-serif, inherit)" }}>
            Every retrieved passage is tagged by what kind of claim it is. The answer&apos;s tone
            follows the tag.
          </p>

          <div className="grid grid-cols-1 min-[640px]:grid-cols-2 gap-3">
            <div className="bg-[var(--block)] border border-[var(--line)] rounded-[12px] px-5 py-4.5">
              <span className="inline-block text-[11px] font-medium px-2.5 py-1 rounded-full mb-3" style={{ background: "var(--ok-lt)", color: "var(--ok)" }}>
                physical
              </span>
              <h4 className="text-[14.5px] font-semibold text-[var(--ink)] m-0 mb-1.5">A measurable fact</h4>
              <p className="text-[13.5px] leading-relaxed text-[var(--ink2)] m-0 mb-3">
                From manufacturer documentation. Stated plainly, with a citation.
              </p>
              <blockquote className="text-[14.5px] leading-relaxed m-0 px-3.5 py-3 bg-[var(--sunk)] rounded-[9px] border-l-2" style={{ borderColor: "var(--ok)", fontFamily: "var(--font-serif, inherit)" }}>
                <span className="text-[var(--ink)]">
                  At -6.00D, edge thickness rules out most rimless mounts — the frame needs a
                  documented power rating that actually covers your prescription.
                </span>
              </blockquote>
            </div>
            <div className="bg-[var(--block)] border border-[var(--line)] rounded-[12px] px-5 py-4.5">
              <span className="inline-block text-[11px] font-medium px-2.5 py-1 rounded-full mb-3" style={{ background: "var(--warn-lt)", color: "var(--warn)" }}>
                convention
              </span>
              <h4 className="text-[14.5px] font-semibold text-[var(--ink)] m-0 mb-1.5">A styling norm</h4>
              <p className="text-[13.5px] leading-relaxed text-[var(--ink2)] m-0 mb-3">
                True by custom, not by measurement. Always hedged, and named as convention.
              </p>
              <blockquote className="text-[14.5px] leading-relaxed m-0 px-3.5 py-3 bg-[var(--sunk)] rounded-[9px] border-l-2" style={{ borderColor: "var(--warn)", fontFamily: "var(--font-serif, inherit)" }}>
                <span className="text-[var(--ink)]">
                  Angular frames are conventionally suggested for a round face — a styling nudge,
                  not a fitting requirement.
                </span>
              </blockquote>
            </div>
          </div>
          <p className="text-[13px] leading-relaxed text-[var(--ink3)] mt-3.5 max-w-[62ch]">
            A third tag, <code className="font-mono text-[12px] bg-[var(--sunk)] px-1.5 py-0.5 rounded">opinion</code>, exists for commercial
            advocacy found in the sources. It&apos;s excluded at ingest, so it never reaches
            retrieval at all.
          </p>
        </section>

        <div className="flex gap-5 flex-wrap pt-5 border-t border-[var(--line)] text-[13.5px] font-medium">
          <Link href="/" className="text-[var(--acc)]">
            ← Try the live demo
          </Link>
          <Link href="/evals" className="text-[var(--acc)]">
            Read the evaluation report
          </Link>
          <Link href="/baseline" className="text-[var(--acc)]">
            See the naive version fail
          </Link>
        </div>
      </div>
    </div>
  );
}
