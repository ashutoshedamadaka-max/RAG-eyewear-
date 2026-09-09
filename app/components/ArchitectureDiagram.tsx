"use client";

// Rebuilt as a real themed component, not an embedded static SVG (decisions.md, 2026-09-09) --
// live feedback: the image's text was unreadable and it didn't fit its container cleanly, and
// neither is really fixable on a static image. A 1420x1300 diagram scaled down to a ~900px
// column shrinks every label to well under readable size, and a fixed-viewBox image can't
// respond to the page's own light/dark tokens or resize itself except by getting blurrier. This
// version is normal HTML at the app's own font-size scale, styled with the same CSS custom
// properties every other component uses (so it re-themes automatically), and reveals itself
// stage by stage as it scrolls into view with a small animated pulse travelling down each
// connector -- a passive preview of the order these stages actually run in, complementing the
// clickable stage-by-stage tracker just below it on the page rather than duplicating it.
import { useEffect, useRef, useState } from "react";

type ChipKind = "model" | "code" | "data";

const CHIP_STYLE: Record<ChipKind, { bg: string; fg: string }> = {
  model: { bg: "var(--acc-lt)", fg: "var(--acc)" },
  code: { bg: "var(--ok-lt)", fg: "var(--ok)" },
  data: { bg: "var(--line2)", fg: "var(--ink3)" },
};

function Chip({ kind, children }: { kind: ChipKind; children: React.ReactNode }) {
  const s = CHIP_STYLE[kind];
  return (
    <span className="inline-block text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: s.bg, color: s.fg }}>
      {children}
    </span>
  );
}

/** Scroll-triggered entrance: each stage rises/fades in once, staggered by `delay` -- a passive
    animated preview of the pipeline's real order, not just a static wall of boxes. */
function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let revealed = false;
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      setVisible(true);
      io.disconnect();
      window.removeEventListener("scroll", checkPosition);
      clearInterval(poll);
    };
    const checkPosition = () => {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight * 1.5 && rect.bottom > -window.innerHeight * 1.5) reveal();
    };
    // A large rootMargin (half a viewport worth of slack, both directions) catches ordinary
    // scrolling well before the element is on screen. The scroll listener and the short-lived
    // poll below are both safety nets for what IntersectionObserver can miss entirely: a single
    // instant jump -- a same-page anchor link, a browser scroll-restore on back/forward
    // navigation -- can resolve to a resting scroll position without ever dispatching a `scroll`
    // event near this element (ordinary wheel/trackpad/keyboard scrolling does, and is caught
    // immediately by either mechanism below; an instant jump may dispatch none at all). The poll
    // re-checks actual position every 200ms for 3 seconds after mount regardless of events, so
    // any resting position -- however the page got there -- still gets caught; it costs nothing
    // once `revealed` is true, since `reveal()` clears it immediately.
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) reveal();
      },
      { threshold: 0, rootMargin: "50% 0px 50% 0px" }
    );
    io.observe(el);
    window.addEventListener("scroll", checkPosition, { passive: true });
    const poll = setInterval(checkPosition, 200);
    checkPosition();
    const stopPoll = setTimeout(() => clearInterval(poll), 3000);
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", checkPosition);
      clearInterval(poll);
      clearTimeout(stopPoll);
    };
  }, []);

  return (
    <div ref={ref} style={visible ? { animation: `rise-in 620ms ease-out ${delay}ms both` } : { opacity: 0 }}>
      {children}
    </div>
  );
}

/** A vertical connector between stages, with a small dot travelling down it on a loop -- the
    "machinery trace" idea (every stage is logged, in order) as a passive ambient animation
    instead of a rotated, hard-to-read side label. */
function Connector({ height = 30, delay = 0 }: { height?: number; delay?: number }) {
  return (
    <div className="flex justify-center" style={{ height }} aria-hidden="true">
      <div className="relative w-px" style={{ background: "var(--line)" }}>
        <span
          className="absolute left-1/2 -translate-x-1/2 w-[6px] h-[6px] rounded-full"
          style={{ background: "var(--acc)", animation: `flow-dot 2.4s ease-in-out ${delay}ms infinite` }}
        />
      </div>
    </div>
  );
}

/** The fork: one vertical stub splitting into two branches, drawn with plain divs (percentage-
    based, so it holds at any width) rather than a fixed-size SVG path. */
function ForkJunction() {
  return (
    <div className="relative h-[38px]" aria-hidden="true">
      <div className="absolute left-1/2 top-0 -translate-x-1/2 w-px h-1/2" style={{ background: "var(--line)" }} />
      <div className="absolute top-1/2 h-px" style={{ left: "12%", right: "12%", background: "var(--line)" }} />
      <div className="absolute top-1/2 left-[12%] w-px h-1/2" style={{ background: "var(--line)" }} />
      <div className="absolute top-1/2 right-[12%] w-px h-1/2" style={{ background: "var(--line)" }} />
    </div>
  );
}

/** The merge: mirror of ForkJunction, two branches rejoining into one line down to stage 5. */
function MergeJunction() {
  return (
    <div className="relative h-[38px]" aria-hidden="true">
      <div className="absolute bottom-1/2 left-[12%] w-px h-1/2" style={{ background: "var(--line)" }} />
      <div className="absolute bottom-1/2 right-[12%] w-px h-1/2" style={{ background: "var(--line)" }} />
      <div className="absolute bottom-1/2 h-px" style={{ left: "12%", right: "12%", background: "var(--line)" }} />
      <div className="absolute left-1/2 bottom-0 -translate-x-1/2 w-px h-1/2" style={{ background: "var(--line)" }} />
    </div>
  );
}

function StageCard({
  n,
  chips,
  title,
  headline,
  children,
}: {
  n: number;
  chips: ChipKind[];
  title: string;
  headline?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-[var(--block)] border border-[var(--line)] rounded-[14px] px-5 py-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          {chips.map((k) => (
            <Chip key={k} kind={k}>
              {k === "model" ? "model call" : k}
            </Chip>
          ))}
        </div>
        <span className="font-mono text-[12.5px] font-semibold text-[var(--ink3)]">{n}</span>
      </div>
      <h4 className="text-[16px] font-semibold text-[var(--ink)] m-0 mb-1">{title}</h4>
      {headline && <p className="text-[11.5px] font-medium text-[var(--ink3)] m-0 mb-2">{headline}</p>}
      <div className="text-[13px] leading-relaxed text-[var(--ink2)]">{children}</div>
    </div>
  );
}

/** A cumulative/reference block -- slot state, the catalogue, the advice index -- styled as an
    inset (--sunk) dashed surface, matching MachineryPanel's own "this is data, not a step"
    convention elsewhere in the app. */
function DataBlock({ label, right, children }: { label: string; right?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[14px] px-5 py-4 border" style={{ background: "var(--sunk)", borderColor: "var(--line)", borderStyle: "dashed" }}>
      <div className="flex items-baseline justify-between gap-3 mb-2.5 flex-wrap">
        <span className="text-[10.5px] font-bold text-[var(--ink3)] uppercase tracking-wide">{label}</span>
        {right && <span className="text-[11px] font-medium text-[var(--ink3)]">{right}</span>}
      </div>
      {children}
    </div>
  );
}

const SLOTS: [string, string][] = [
  ["product_type", "eyeglasses"],
  ["purpose", "everyday, computer"],
  ["face_shape", "oval"],
  ["rx_power", "−3.00"],
  ["budget", "3,000–5,000"],
  ["style_prefs", "professional"],
];

const RULES: [string, string, string][] = [
  ["HARD · never dropped", "var(--warn)", "UV400 for daytime driving · minimum lens height for progressives"],
  ["HARD · relaxable", "var(--ink2)", "price ceiling · material · rim type"],
  ["SOFT · ranking nudge", "var(--ink3)", "face shape · style preference"],
];

export default function ArchitectureDiagram() {
  let i = 0;
  // Capped so the stagger stays snappy near the top of the diagram without letting the last
  // few elements (there are 16 Reveal/Connector calls below) pile up multiple seconds of pure
  // delay before their own 620ms rise starts -- each element still fires independently, on its
  // own scroll timing, so a reader scrolling normally never waits on this at all; it only bounds
  // how long an ALREADY-visible run of elements takes to finish settling in together.
  const d = () => Math.min(i++ * 60, 360);

  return (
    <div className="bg-[var(--shell)] border border-[var(--line)] rounded-[16px] shadow-[var(--shadow)] px-4 py-6 min-[560px]:px-7 min-[560px]:py-8">
      {/* legend */}
      <Reveal delay={d()}>
        <div className="flex flex-wrap gap-x-5 gap-y-2 mb-7 justify-center">
          <span className="flex items-center gap-2">
            <Chip kind="model">model call</Chip>
            <span className="text-[11.5px] text-[var(--ink3)]">an LLM does the work</span>
          </span>
          <span className="flex items-center gap-2">
            <Chip kind="code">code</Chip>
            <span className="text-[11.5px] text-[var(--ink3)]">deterministic, exact</span>
          </span>
          <span className="flex items-center gap-2">
            <Chip kind="data">data</Chip>
            <span className="text-[11.5px] text-[var(--ink3)]">what it reads from</span>
          </span>
        </div>
      </Reveal>

      <div className="max-w-[560px] mx-auto">
        {/* user message */}
        <Reveal delay={d()}>
          <p className="text-[10.5px] font-semibold text-[var(--ink3)] uppercase tracking-wide text-center mb-2">User message</p>
          <div className="bg-[var(--block)] border border-[var(--line)] rounded-[14px] px-5 py-4 text-center">
            <p className="text-[15px] leading-relaxed text-[var(--ink)] m-0" style={{ fontFamily: "var(--font-serif, inherit)" }}>
              &ldquo;Everyday glasses, I work on a screen a lot, oval face, ₹3,000&ndash;5,000, professional&rdquo;
            </p>
          </div>
        </Reveal>

        <Connector delay={d()} />

        {/* stage 1 */}
        <Reveal delay={d()}>
          <StageCard n={1} chips={["model"]} title="Read what THIS turn added">
            A partial update only — never a re-read of the whole conversation. Say &ldquo;actually
            make it ₹3,000&rdquo; and only the budget moves.
          </StageCard>
        </Reveal>

        <Connector delay={d()} />

        {/* slot state */}
        <Reveal delay={d()}>
          <DataBlock label="Slot state" right="grows across the whole conversation">
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-x-6 gap-y-2.5">
              {SLOTS.map(([k, v]) => (
                <div key={k}>
                  <div className="font-mono text-[10.5px] text-[var(--ink3)]">{k}</div>
                  <div className="text-[12.5px] font-medium text-[var(--ink)]">{v}</div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-[var(--ink3)] text-center mt-3 mb-0">every value tagged stated · derived · assumed</p>
          </DataBlock>
        </Reveal>

        <Connector delay={d()} />

        {/* stage 2 */}
        <Reveal delay={d()}>
          <StageCard n={2} chips={["code"]} title="Turn what they said into constraints" headline="17 rules checked every turn">
            <div className="grid gap-1.5">
              {RULES.map(([label, color, ex]) => (
                <div key={label} className="flex flex-col min-[480px]:flex-row min-[480px]:items-baseline gap-x-2.5">
                  <span className="text-[11px] font-bold whitespace-nowrap" style={{ color }}>
                    {label}
                  </span>
                  <span className="text-[11.5px] text-[var(--ink3)]">{ex}</span>
                </div>
              ))}
            </div>
          </StageCard>
        </Reveal>

        <div className="flex justify-center">
          <span className="text-[11px] font-semibold text-[var(--ink3)] uppercase tracking-wide -mb-1 relative top-2 bg-[var(--shell)] px-2">
            one query, two mechanisms
          </span>
        </div>
        <ForkJunction />
      </div>

      {/* the fork */}
      <div className="grid grid-cols-1 min-[720px]:grid-cols-2 gap-6 max-w-[1000px] mx-auto">
        <div>
          <Reveal delay={d()}>
            <StageCard n={3} chips={["code"]} title="Query the catalogue">
              Constraints compile to real SQL. A frame either matches or it doesn&apos;t — there is
              no &ldquo;close enough&rdquo; for a number.
              <pre className="font-mono text-[11px] leading-relaxed text-[var(--ok)] bg-[var(--ok-lt)] px-3 py-2.5 rounded-[8px] mt-2.5 mb-0 overflow-x-auto whitespace-pre-wrap break-words">
                WHERE price {"<="} 5000 AND product_type = &apos;eyeglasses&apos; …
              </pre>
            </StageCard>
          </Reveal>
          <Connector delay={d()} height={26} />
          <Reveal delay={d()}>
            <DataBlock label="SQLite · 101 frames">
              <p className="text-[12px] text-[var(--ink2)] m-0 mb-2.5">prices, sizes, materials, stock, prescription limits</p>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Chip kind="data">never embedded</Chip>
                <span className="text-[10.5px] text-[var(--ink3)] text-right">
                  0 matches → drop one constraint,
                  <br />
                  cheapest first, never a safety rule
                </span>
              </div>
            </DataBlock>
          </Reveal>
        </div>

        <div>
          <Reveal delay={d()}>
            <StageCard n={4} chips={["model", "code"]} title="Retrieve the optician guidance">
              The question becomes a vector, then matched by meaning. This is the part that&apos;s
              actually RAG — prose, where no column holds the answer.
              <pre className="font-mono text-[11px] leading-relaxed text-[var(--acc)] bg-[var(--acc-lt)] px-3 py-2.5 rounded-[8px] mt-2.5 mb-0 overflow-x-auto whitespace-pre-wrap break-words">
                cosine similarity · anything below 0.25 discarded
              </pre>
            </StageCard>
          </Reveal>
          <Connector delay={d()} height={26} />
          <Reveal delay={d()}>
            <DataBlock label="Advice index · Zeiss, HOYA, Rodenstock, optician's guide">
              <p className="text-[12px] text-[var(--ink2)] m-0 mb-2.5">every chunk tagged by claim type</p>
              <div className="flex items-center gap-2 flex-wrap">
                <Chip kind="code">physical</Chip>
                <Chip kind="data">convention</Chip>
                <span className="text-[10.5px] text-[var(--ink3)]">— a third tag, opinion, is excluded at ingest</span>
              </div>
            </DataBlock>
          </Reveal>
        </div>
      </div>

      <div className="max-w-[560px] mx-auto">
        <MergeJunction />

        {/* stage 5 */}
        <Reveal delay={d()}>
          <StageCard n={5} chips={["model"]} title="Write the answer from both halves at once">
            <div className="grid grid-cols-1 min-[480px]:grid-cols-3 gap-3.5">
              <div>
                <p className="text-[12px] font-semibold text-[var(--ink)] m-0 mb-1">Cards carry the facts</p>
                <p className="text-[11px] text-[var(--ink3)] m-0">price, size, weight, stock — straight from the database</p>
              </div>
              <div>
                <p className="text-[12px] font-semibold text-[var(--ink)] m-0 mb-1">Prose carries the judgement</p>
                <p className="text-[11px] text-[var(--ink3)] m-0">which one to start with, and what it gives up</p>
              </div>
              <div>
                <p className="text-[12px] font-semibold text-[var(--ink)] m-0 mb-1">Every claim maps to a source</p>
                <p className="text-[11px] text-[var(--ink3)] m-0">physical stated plainly, convention hedged</p>
              </div>
            </div>
          </StageCard>
        </Reveal>
      </div>

      <Reveal delay={d()}>
        <p className="text-[11.5px] font-medium text-[var(--acc)] text-center mt-6 mb-0">
          Every stage above is logged and shown live in the demo, in this order.
        </p>
      </Reveal>
    </div>
  );
}
