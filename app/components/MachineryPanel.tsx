"use client";

import { useEffect, useState } from "react";
import type {
  TurnMachinery,
  Slots,
  SlotValue,
  LiveStageEvent,
  LiveSlotsStage,
  LiveRulesStage,
  LiveSqlStage,
  LiveRetrievalStage,
} from "./conversation-types";

interface Props {
  /** Every completed turn, oldest first. */
  history: TurnMachinery[];
  /** Cumulative slots as of the last completed turn -- `state.slots` from the server, which is
      the one place the full accumulated picture (including any cap-assumed slot that never
      shows up in a single turn's own extractedPartial) actually lives. */
  finalSlots: Slots;
  /** True while a new turn is being generated (and not a replay). */
  isLiveTurn: boolean;
  liveStages: LiveStageEvent[];
  streamingText: string;
}

// Single live instrument, not a per-turn log (decisions.md, 2026-09-09) -- the
// previous round (2026-09-04) rendered one full six-stage block per history
// entry, so by turn seven there were seven copies of "Read the conversation"
// stacked on top of each other. Live report: that's a transcript, not an
// instrument. Rebuilt around the actual shape of the six stages, which split
// into two kinds. Stage 1 (slots) is genuinely CUMULATIVE -- it never resets,
// so it's now the one persistent card at the top, growing turn over turn,
// with whatever changed on the currently-viewed turn briefly highlighted.
// Stages 2-6 describe one turn's work and nothing else, so they're replaced
// wholesale when the viewed turn changes rather than appended below the
// previous turn's copies. A small stepper (kept from the pre-2026-09-04
// design, reintroduced here on purpose) lets a reader step back through
// completed turns; the default view always snaps back to whichever turn is
// most current the moment a new one starts generating.

// Visual rebuild (decisions.md, 2026-09-04), against a supplied prototype
// (specs-light-dark.jsx) treated as a visual spec, not copied as code: what's
// in this panel is evidence -- what was understood, which rule applied, what
// was found, what it cost -- not code, and styling it like a dark terminal
// log undersold that. Every color below is a CSS custom property (globals.css,
// light+dark tokens), never a literal hex. Mono is used ONLY where something
// genuinely is code or an identifier -- the SQL query, slot keys, advice
// source filenames -- everything else is the same sans as the rest of the page.
export function sourceColor(source: string): string {
  if (source === "assumed") return "var(--warn)";
  if (source === "derived") return "var(--acc)";
  return "var(--ok)"; // stated
}

export function fmtSlotValue(v: unknown): string {
  if (Array.isArray(v)) return v.length === 0 ? "[ ]" : v.join(", ");
  return String(v);
}

/** Dedupe facts by ruleId (rankCandidates pushes one fact per matching frame) -- the count shown must match what a reader can count in the rows below it. */
export function distinctRules(facts: { ruleId?: string }[]): Set<string> {
  return new Set(facts.map((f) => f.ruleId).filter((x): x is string => Boolean(x)));
}

/**
 * Collapses a per-frame rule (rankCandidates pushes one fact per matching
 * FRAME, not once per rule -- style_prefs_overlap firing on 3 candidates
 * used to print 3 identical rows) down to one row with a count (decisions.md,
 * 2026-09-02). Grouped by (ruleId, explanation) together, not ruleId alone,
 * because one ruleId genuinely produces different text per frame
 * (lens_index_annotation cites that frame's own lens width and suggested
 * index) -- those rows must NOT collapse, since each carries different,
 * frame-specific information.
 */
export function groupFactsForDisplay(facts: { explanation: string; source?: string; ruleId?: string }[]) {
  const groups = new Map<string, { explanation: string; source?: string; ruleId?: string; count: number }>();
  for (const f of facts) {
    const key = `${f.ruleId ?? ""}::${f.explanation}`;
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else groups.set(key, { explanation: f.explanation, source: f.source, ruleId: f.ruleId, count: 1 });
  }
  return [...groups.values()];
}

/** Short, human names for the ranking-nudge rules specifically -- the only ones that ever collapse into a >1 group above. */
const RULE_SHORT_LABELS: Record<string, string> = {
  style_prefs_overlap: "style preference",
  face_shape_boost: "face shape",
  eye_spacing_close_set: "eye spacing",
  eye_spacing_wide_set: "eye spacing",
  nose_profile_prominent: "nose profile",
  long_face_lens_height: "face length",
};

/** One stage, one card -- independent rounded blocks with real padding, each a `--block` surface on the panel's `--sunk` background. `pending` marks the one stage actually in flight right now. */
export function StageWrap({
  n,
  name,
  headline,
  children,
  pending,
}: {
  n: number;
  name: string;
  headline: string;
  children: React.ReactNode;
  pending?: boolean;
}) {
  return (
    <div
      className="rounded-[11px] bg-[var(--block)] border px-[15px] py-[13px] mb-2"
      style={{ borderColor: pending ? "var(--acc)" : "var(--line2)" }}
    >
      <div className="flex items-baseline gap-2.5 mb-2.5">
        <div
          className={`w-[19px] h-[19px] rounded-full flex-none text-[10.5px] font-semibold leading-[19px] text-center tabular-nums bg-[var(--acc-lt)] text-[var(--acc)] ${
            pending ? "animate-pulse" : ""
          }`}
        >
          {n}
        </div>
        <div className="text-[13px] font-semibold text-[var(--ink)] flex-1">{name}</div>
        <div className="text-[11.5px] text-[var(--ink3)] tabular-nums whitespace-nowrap">{headline}</div>
      </div>
      {children}
    </div>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-[11.5px] leading-relaxed text-[var(--ink3)] mb-2.5 -mt-0.5">{children}</p>;
}

function slotChanged(prev: SlotValue<unknown> | undefined, next: SlotValue<unknown>): boolean {
  if (!prev) return true;
  if (prev.source !== next.source) return true;
  return JSON.stringify(prev.value) !== JSON.stringify(next.value);
}

/** A key/value row -- the ONLY place a name is mono (a slot key is a real identifier). `highlighted` briefly tints a row that's new or changed on the turn currently being viewed -- the negative margin cancels the added padding so the text itself doesn't shift when the tint appears. */
function KVRow({ k, v, tag, highlighted }: { k: string; v: string; tag?: { label: string; color: string }; highlighted?: boolean }) {
  return (
    <div
      className="grid grid-cols-[minmax(78px,auto)_1fr_auto] gap-2.5 py-1 px-1.5 -mx-1.5 rounded-[6px] border-t border-[var(--line2)] first:border-t-0 items-baseline transition-colors duration-700"
      style={{ background: highlighted ? "var(--acc-lt)" : "transparent" }}
    >
      <span className="font-mono text-[11px] text-[var(--ink3)]">{k}</span>
      <span className="text-[13px] text-[var(--ink)] tabular-nums">{v}</span>
      {tag && (
        <span className="text-[10px] font-medium" style={{ color: tag.color }}>
          {tag.label}
        </span>
      )}
    </div>
  );
}

/** Stage 1: cumulative, persistent, never replaced -- the one stage a reader can watch build up.
    The caller keys this component by `turnKey` (which turn is being viewed: a history index, or
    "live"), so a change of turn remounts it and `highlightOn` naturally restarts at its initial
    `true` -- no setState-on-mount inside the effect, just the fade-out timer and its cleanup. */
function SlotsStageCard({ slots, previousSlots }: { slots: Slots; previousSlots: Slots }) {
  const slotEntries = Object.entries(slots).filter(([, v]) => v !== undefined) as [string, SlotValue<unknown>][];
  const assumedCount = slotEntries.filter(([, v]) => v.source === "assumed").length;

  const [highlightOn, setHighlightOn] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setHighlightOn(false), 2600);
    return () => clearTimeout(t);
  }, []);

  return (
    <StageWrap
      n={1}
      name="Read the conversation"
      headline={`${slotEntries.length} field${slotEntries.length === 1 ? "" : "s"}${assumedCount > 0 ? ` · ${assumedCount} assumed` : ""}`}
    >
      {slotEntries.length === 0 && <div className="text-[12.5px] text-[var(--ink3)]">nothing known yet</div>}
      {slotEntries.map(([key, slot]) => (
        <KVRow
          key={key}
          k={key}
          v={fmtSlotValue(slot.value)}
          tag={{ label: slot.source, color: sourceColor(slot.source) }}
          highlighted={highlightOn && slotChanged(previousSlots[key], slot)}
        />
      ))}
    </StageWrap>
  );
}

function cumulativeSlotsThrough(history: TurnMachinery[], index: number, finalSlots: Slots): Slots {
  if (index === history.length - 1) return finalSlots;
  let acc: Slots = {};
  for (let i = 0; i <= index; i++) acc = { ...acc, ...history[i].extractedPartial };
  return acc;
}

type PerTurnStage = { n: number; key: string; name: string; headline: string; pending?: boolean; render: () => React.ReactNode };

/** Stages 2-6, for one COMPLETED turn: fixed numbering per stage identity (rules is always 2, timing is
    always 5, whichever of them actually show up) rather than positional, so a reader who's stepped through
    several turns sees the same stage keep the same number whether it appears or not. Stages 3/4/6
    (sql/advice/cost) simply don't exist on an ask-turn -- no placeholder box, matching what already ran. */
function historicalPerTurnStages(entry: TurnMachinery): PerTurnStage[] {
  const rulesFired = distinctRules(entry.derivedFacts);
  const rec = entry.recommendation;
  const citedMarkerSet = new Set((rec?.citations ?? []).flatMap((c) => c.citedMarkers));
  const advicedHitsWithCited = (rec?.adviceHits ?? []).map((h, i) => ({ ...h, cited: citedMarkerSet.has(`[A${i + 1}]`) }));
  const citedCount = advicedHitsWithCited.filter((h) => h.cited).length;
  const belowFloorCount = rec?.adviceNearMisses.length ?? 0;
  const totalMs = entry.timingsMs.total;
  const totalCostInr = entry.modelCalls.reduce((sum, c) => sum + c.costInr, 0);

  const stages: PerTurnStage[] = [];

  stages.push({
    n: 2,
    key: "rules",
    name: "Applied the fitting rules",
    headline: `${rulesFired.size} of ${entry.fittingRulesTotalCount} fired`,
    render: () => (
      <div>
        {entry.derivedFacts.length === 0 && <div className="text-[12.5px] text-[var(--ink3)]">none fired this turn</div>}
        {groupFactsForDisplay(entry.derivedFacts).map((g, i) => (
          <div key={i} className="py-1.5 border-t border-[var(--line2)] first:border-t-0">
            <p className="text-[13px] leading-relaxed text-[var(--ink)] m-0">
              {g.count > 1
                ? `${RULE_SHORT_LABELS[g.ruleId ?? ""] ?? g.explanation} → soft ranking nudge, ${g.count} candidates boosted`
                : g.explanation}
            </p>
            {g.source && <div className="font-mono text-[10.5px] text-[var(--ink3)] mt-1">{g.source}</div>}
          </div>
        ))}
        {entry.assumptions.map((a, i) => (
          <div key={`a${i}`} className="py-1.5 border-t border-[var(--line2)]">
            <p className="text-[13px] leading-relaxed m-0" style={{ color: "var(--warn)" }}>
              {a.explanation}
            </p>
          </div>
        ))}
      </div>
    ),
  });

  if (rec) {
    stages.push({
      n: 3,
      key: "sql",
      name: "Queried the catalogue",
      headline: `${rec.sqlMatchCount} of ${rec.catalogTotalCount} frames matched`,
      render: () => (
        <>
          <pre className="font-mono text-[11.5px] leading-relaxed text-[var(--ink2)] bg-[var(--sunk)] px-3.5 py-3 rounded-[8px] border-l-2 border-[var(--acc)] overflow-x-auto m-0">
            {rec.sql}
          </pre>
          {rec.relaxed && (
            <div className="mt-2.5 text-[12.5px] leading-relaxed" style={{ color: "var(--warn)" }}>
              Exact match failed — relaxation ladder engaged.
              {rec.relaxedDetails && rec.relaxedDetails.length > 0 && (
                <ul className="list-disc list-inside mt-1">
                  {rec.relaxedDetails.map((d, i) => (
                    <li key={i} className="text-[12.5px]">
                      dropped <code className="font-mono text-[11.5px]">{d.droppedClause}</code> → {d.frame_id}
                    </li>
                  ))}
                </ul>
              )}
              {rec.neverRelaxBlocked && rec.neverRelaxBlocked.length > 0 && (
                <div className="mt-1.5 text-[11.5px] text-[var(--ink3)]">
                  Never-relax constraint{rec.neverRelaxBlocked.length > 1 ? "s" : ""} blocked a would-be match and{" "}
                  {rec.neverRelaxBlocked.length > 1 ? "were" : "was"} correctly NOT offered:{" "}
                  {rec.neverRelaxBlocked.map((b) => b.describe).join("; ")}
                </div>
              )}
            </div>
          )}
        </>
      ),
    });

    stages.push({
      n: 4,
      key: "advice",
      name: "Retrieved optician guidance",
      headline: `${advicedHitsWithCited.length} retrieved · ${citedCount} cited${belowFloorCount > 0 ? ` · ${belowFloorCount} below floor` : ""}`,
      render: () => (
        <>
          <Note>
            Guidance is tagged by how certain it is. <b className="text-[var(--ink)] font-medium">Physical</b> means a
            measurable fact from manufacturer documentation, stated plainly. <b className="text-[var(--ink)] font-medium">Convention</b> means
            style guidance — true by custom, not by measurement — so the answer hedges it rather than stating it as fact.
            The score is how closely each passage matches the question; anything under <b className="text-[var(--ink)] font-medium">0.25</b> is
            too loosely related to trust, and is dropped before the model ever sees it.
          </Note>
          {advicedHitsWithCited.map((h, i) => (
            <div key={h.chunk_id} className="grid grid-cols-[1fr_auto_48px] gap-3 py-1.5 items-baseline border-t border-[var(--line2)]">
              <div>
                <div className="font-mono text-[12.5px] text-[var(--ink)] break-words">
                  [A{i + 1}] {h.doc_id} — {h.section_heading}
                </div>
                <div className="text-[10.5px] font-medium mt-0.5" style={{ color: h.cited ? "var(--ok)" : "var(--ink3)" }}>
                  {h.cited ? "cited" : "retrieved, not cited"}
                </div>
              </div>
              <span className="text-[10.5px] font-medium" style={{ color: h.claim_type === "convention" ? "var(--acc)" : "var(--ink2)" }}>
                {h.claim_type}
              </span>
              <span className="font-mono text-[12.5px] font-medium text-[var(--ink2)] text-right tabular-nums">{h.score.toFixed(3)}</span>
            </div>
          ))}
          {(rec.adviceNearMisses ?? []).map((h) => (
            <div key={h.chunk_id} className="grid grid-cols-[1fr_auto_48px] gap-3 py-1.5 items-baseline border-t border-[var(--line2)] opacity-55">
              <div>
                <div className="font-mono text-[12.5px] text-[var(--ink3)] break-words">
                  {h.doc_id} — {h.section_heading}
                </div>
                <div className="text-[10.5px] font-medium mt-0.5 text-[var(--ink3)]">below 0.25 floor</div>
              </div>
              <span className="text-[10.5px] font-medium text-[var(--ink3)]">{h.claim_type}</span>
              <span className="font-mono text-[12.5px] text-[var(--ink3)] text-right tabular-nums">{h.score.toFixed(3)}</span>
            </div>
          ))}
        </>
      ),
    });
  }

  stages.push({
    n: 5,
    key: "timing",
    name: "Wrote the answer",
    headline: `${(totalMs / 1000).toFixed(1)}s total`,
    render: () => (
      <>
        {entry.modelCalls.length > 0 && (
          <Note>
            {entry.modelCalls.filter((c) => c.kind === "chat").length} call
            {entry.modelCalls.filter((c) => c.kind === "chat").length === 1 ? "" : "s"} to the language model this turn
            {entry.modelCalls.some((c) => c.kind === "embedding")
              ? `, plus ${entry.modelCalls.filter((c) => c.kind === "embedding").length} embedding call${
                  entry.modelCalls.filter((c) => c.kind === "embedding").length === 1 ? "" : "s"
                } to turn the question into a vector`
              : ""}{" "}
            — {entry.modelCalls.map((c) => c.label.toLowerCase()).join(", ")}. Everything else is database work, which is why it barely registers.
          </Note>
        )}
        <div className="flex gap-0.5 mb-2.5">
          {entry.modelCalls.map((c, i) => (
            <div key={i} title={`${c.label} — ${c.ms}ms`} className="h-[6px] rounded-sm" style={{ flexGrow: c.ms, background: "var(--acc)" }} />
          ))}
          {entry.timingsMs.sqlQuery !== undefined && (
            <div title={`SQL — ${entry.timingsMs.sqlQuery}ms`} className="h-[6px] rounded-sm bg-[var(--line)]" style={{ flexGrow: Math.max(entry.timingsMs.sqlQuery, 1) }} />
          )}
          {entry.timingsMs.adviceSearch !== undefined && (
            <div title={`Similarity search — ${entry.timingsMs.adviceSearch}ms`} className="h-[6px] rounded-sm bg-[var(--line)]" style={{ flexGrow: Math.max(entry.timingsMs.adviceSearch, 1) }} />
          )}
          {entry.timingsMs.relaxationSearch !== undefined && (
            <div title={`Relaxation search — ${entry.timingsMs.relaxationSearch}ms`} className="h-[6px] rounded-sm bg-[var(--line)]" style={{ flexGrow: Math.max(entry.timingsMs.relaxationSearch, 1) }} />
          )}
        </div>
        {entry.modelCalls.map((c, i) => (
          <div key={i} className="flex gap-2.5 items-baseline py-1 border-t border-[var(--line2)]">
            <span className="text-[13px] text-[var(--ink)] flex-1">{c.label}</span>
            <span className="text-[10px] font-medium text-[var(--acc)]">model call</span>
            <span className="text-[12px] text-[var(--ink3)] min-w-[48px] text-right tabular-nums">{c.ms} ms</span>
          </div>
        ))}
        {entry.timingsMs.sqlQuery !== undefined && (
          <div className="flex gap-2.5 items-baseline py-1 border-t border-[var(--line2)]">
            <span className="text-[13px] text-[var(--ink)] flex-1">Searching the catalogue</span>
            <span className="text-[10px] font-medium text-[var(--ink3)]">SQL</span>
            <span className="text-[12px] text-[var(--ink3)] min-w-[48px] text-right tabular-nums">{entry.timingsMs.sqlQuery} ms</span>
          </div>
        )}
        {entry.timingsMs.adviceSearch !== undefined && (
          <div className="flex gap-2.5 items-baseline py-1 border-t border-[var(--line2)]">
            <span className="text-[13px] text-[var(--ink)] flex-1">Finding matching guidance</span>
            <span className="text-[10px] font-medium text-[var(--ink3)]">similarity search</span>
            <span className="text-[12px] text-[var(--ink3)] min-w-[48px] text-right tabular-nums">{entry.timingsMs.adviceSearch} ms</span>
          </div>
        )}
        {entry.timingsMs.relaxationSearch !== undefined && (
          <div className="flex gap-2.5 items-baseline py-1 border-t border-[var(--line2)]">
            <span className="text-[13px] text-[var(--ink)] flex-1">Searching for the nearest alternative</span>
            <span className="text-[10px] font-medium text-[var(--ink3)]">relaxation ladder</span>
            <span className="text-[12px] text-[var(--ink3)] min-w-[48px] text-right tabular-nums">{entry.timingsMs.relaxationSearch} ms</span>
          </div>
        )}
        <div className="flex gap-2.5 pt-2 mt-1 border-t border-[var(--line)]">
          <span className="text-[13px] font-semibold text-[var(--ink)] flex-1">Total</span>
          <span className="text-[13px] font-semibold text-[var(--ink)] tabular-nums">{totalMs} ms</span>
        </div>
      </>
    ),
  });

  if (rec) {
    stages.push({
      n: 6,
      key: "cost",
      name: "What it cost",
      headline: `~₹${totalCostInr.toFixed(2)} est.`,
      render: () => (
        <>
          <div className="grid grid-cols-[1fr_auto_auto] gap-4 pb-1.5 border-b border-[var(--line2)]">
            <span className="text-[10.5px] font-medium text-[var(--ink3)]">Model call</span>
            <span className="text-[10.5px] font-medium text-[var(--ink3)] min-w-[70px] text-right">Tokens in</span>
            <span className="text-[10.5px] font-medium text-[var(--ink3)] min-w-[70px] text-right">Tokens out</span>
          </div>
          {entry.modelCalls.map((c, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-4 py-2 border-b border-[var(--line2)] items-baseline">
              <span className="text-[13px] text-[var(--ink)]">{c.label}</span>
              <span className="font-mono text-[15px] font-semibold text-[var(--ink)] min-w-[70px] text-right tabular-nums">{c.promptTokens.toLocaleString()}</span>
              <span className="font-mono text-[15px] font-semibold text-[var(--ink)] min-w-[70px] text-right tabular-nums">{c.completionTokens.toLocaleString()}</span>
            </div>
          ))}
          <div className="flex gap-2.5 items-baseline pt-2.5 flex-wrap">
            <span className="text-[12px] text-[var(--ink3)] flex-1">Cost of this recommendation</span>
            <span className="font-mono text-[12.5px] font-semibold text-[var(--ok)] tabular-nums">~₹{totalCostInr.toFixed(2)}</span>
            <span className="text-[10.5px] font-medium text-[var(--warn)] bg-[var(--warn-lt)] px-1.5 py-0.5 rounded whitespace-nowrap">
              estimated
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-[var(--ink3)] mt-2">
            The token counts above are exact, read directly off each API response. The embedding
            call&apos;s rate is OpenAI&apos;s real published price; the chat model&apos;s rate has
            no public list to cite, so the ₹ total is a labelled estimate, not a verified cost.
          </p>
        </>
      ),
    });
  }

  return stages;
}

type PerTurnLiveStageEvent = Exclude<LiveStageEvent, LiveSlotsStage>;

function liveStageName(stage: PerTurnLiveStageEvent["stage"]): string {
  switch (stage) {
    case "rules":
      return "Applied the fitting rules";
    case "sql":
      return "Queried the catalogue";
    case "retrieval":
      return "Retrieved optician guidance";
  }
}

function liveStageHeadline(s: PerTurnLiveStageEvent): string {
  switch (s.stage) {
    case "rules": {
      const distinct = distinctRules(s.data.derivedFacts);
      return `${distinct.size} of ${s.data.fittingRulesTotalCount} fired`;
    }
    case "sql":
      return `${s.data.sqlMatchCount} of ${s.data.catalogTotalCount} frames matched`;
    case "retrieval":
      return `${s.data.adviceHits.length} retrieved${s.data.adviceNearMisses.length > 0 ? ` · ${s.data.adviceNearMisses.length} below floor` : ""}`;
  }
}

function renderLiveRules(data: LiveRulesStage["data"]) {
  return (
    <div>
      {data.derivedFacts.length === 0 && <div className="text-[12.5px] text-[var(--ink3)]">none fired this turn</div>}
      {groupFactsForDisplay(data.derivedFacts).map((g, i) => (
        <div key={i} className="py-1.5 border-t border-[var(--line2)] first:border-t-0">
          <p className="text-[13px] leading-relaxed text-[var(--ink)] m-0">
            {g.count > 1
              ? `${RULE_SHORT_LABELS[g.ruleId ?? ""] ?? g.explanation} → soft ranking nudge, ${g.count} candidates boosted`
              : g.explanation}
          </p>
          {g.source && <div className="font-mono text-[10.5px] text-[var(--ink3)] mt-1">{g.source}</div>}
        </div>
      ))}
      {data.assumptions.map((a, i) => (
        <div key={`a${i}`} className="py-1.5 border-t border-[var(--line2)]">
          <p className="text-[13px] leading-relaxed m-0" style={{ color: "var(--warn)" }}>
            {a.explanation}
          </p>
        </div>
      ))}
    </div>
  );
}

function renderLiveSql(data: LiveSqlStage["data"]) {
  return (
    <>
      <pre className="font-mono text-[11.5px] leading-relaxed text-[var(--ink2)] bg-[var(--sunk)] px-3.5 py-3 rounded-[8px] border-l-2 border-[var(--acc)] overflow-x-auto m-0">
        {data.sql}
      </pre>
      {data.relaxed && (
        <div className="mt-2.5 text-[12.5px] leading-relaxed" style={{ color: "var(--warn)" }}>
          Exact match failed — relaxation ladder engaged.
          {data.relaxedDetails && data.relaxedDetails.length > 0 && (
            <ul className="list-disc list-inside mt-1">
              {data.relaxedDetails.map((d, i) => (
                <li key={i} className="text-[12.5px]">
                  dropped <code className="font-mono text-[11.5px]">{d.droppedClause}</code> → {d.frame_id}
                </li>
              ))}
            </ul>
          )}
          {data.neverRelaxBlocked && data.neverRelaxBlocked.length > 0 && (
            <div className="mt-1.5 text-[11.5px] text-[var(--ink3)]">
              Never-relax constraint{data.neverRelaxBlocked.length > 1 ? "s" : ""} blocked a would-be match and{" "}
              {data.neverRelaxBlocked.length > 1 ? "were" : "was"} correctly NOT offered: {data.neverRelaxBlocked.map((b) => b.describe).join("; ")}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function renderLiveRetrieval(data: LiveRetrievalStage["data"]) {
  return (
    <>
      <Note>
        Guidance is tagged by how certain it is. <b className="text-[var(--ink)] font-medium">Physical</b> means a
        measurable fact from manufacturer documentation, stated plainly. <b className="text-[var(--ink)] font-medium">Convention</b> means
        style guidance — true by custom, not by measurement — so the answer hedges it rather than stating it as fact.
        The score is how closely each passage matches the question; anything under <b className="text-[var(--ink)] font-medium">0.25</b> is
        too loosely related to trust, and is dropped before the model ever sees it. Which of these end up actually
        cited will show once the reply is written.
      </Note>
      {data.adviceHits.map((h, i) => (
        <div key={h.chunk_id} className="grid grid-cols-[1fr_auto_48px] gap-3 py-1.5 items-baseline border-t border-[var(--line2)]">
          <div>
            <div className="font-mono text-[12.5px] text-[var(--ink)] break-words">
              [A{i + 1}] {h.doc_id} — {h.section_heading}
            </div>
            <div className="text-[10.5px] font-medium mt-0.5 text-[var(--ink3)]">retrieved</div>
          </div>
          <span className="text-[10.5px] font-medium" style={{ color: h.claim_type === "convention" ? "var(--acc)" : "var(--ink2)" }}>
            {h.claim_type}
          </span>
          <span className="font-mono text-[12.5px] font-medium text-[var(--ink2)] text-right tabular-nums">{h.score.toFixed(3)}</span>
        </div>
      ))}
      {data.adviceNearMisses.map((h) => (
        <div key={h.chunk_id} className="grid grid-cols-[1fr_auto_48px] gap-3 py-1.5 items-baseline border-t border-[var(--line2)] opacity-55">
          <div>
            <div className="font-mono text-[12.5px] text-[var(--ink3)] break-words">
              {h.doc_id} — {h.section_heading}
            </div>
            <div className="text-[10.5px] font-medium mt-0.5 text-[var(--ink3)]">below 0.25 floor</div>
          </div>
          <span className="text-[10.5px] font-medium text-[var(--ink3)]">{h.claim_type}</span>
          <span className="font-mono text-[12.5px] text-[var(--ink3)] text-right tabular-nums">{h.score.toFixed(3)}</span>
        </div>
      ))}
    </>
  );
}

function renderLiveStage(s: PerTurnLiveStageEvent): React.ReactNode {
  switch (s.stage) {
    case "rules":
      return renderLiveRules(s.data);
    case "sql":
      return renderLiveSql(s.data);
    case "retrieval":
      return renderLiveRetrieval(s.data);
  }
}

/** Stages 2-6 for the turn currently generating -- positional numbering as events actually arrive
    (rules, then sql/retrieval on a recommend turn), starting at 2 since stage 1 is rendered
    separately. "Writing the reply" fills the gap between the last known stage and the `done`
    event with a real streaming preview, and keeps sliding down as later stages land. */
function livePerTurnStages(liveStages: LiveStageEvent[], generating: boolean, streamingText: string): PerTurnStage[] {
  const perTurnEvents = liveStages.filter((s): s is PerTurnLiveStageEvent => s.stage !== "slots");
  const stages: PerTurnStage[] = [];
  let n = 2;

  for (const s of perTurnEvents) {
    stages.push({ n: n++, key: s.stage, name: liveStageName(s.stage), headline: liveStageHeadline(s), render: () => renderLiveStage(s) });
  }

  if (generating) {
    stages.push({
      n,
      key: "writing",
      name: "Writing the reply",
      headline: "in progress",
      pending: true,
      render: () => (
        <div className="text-[13px] leading-relaxed text-[var(--ink2)] whitespace-pre-wrap min-h-[1.4em]">
          {streamingText || "…"}
          <span className="inline-block w-[2px] h-[13px] bg-[var(--acc)] ml-0.5 align-text-bottom animate-pulse" />
        </div>
      ),
    });
  }

  return stages;
}

/** "N stages ran this turn" always names a real count; the connecting word is generated from the
    ratio of model calls to stages rather than a fixed "Only N of them..." template, which read
    oddly once N was most of the total (decisions.md, 2026-09-09: "3 of them" vs "4 of 6" both
    used to say "Only", even though one is a minority and the other a majority). */
function modelTouchPhrase(modelCallCount: number, totalStages: number): string {
  if (modelCallCount <= 0) return "None of them call a model.";
  if (modelCallCount >= totalStages) return "All of them call a model.";
  const ratio = modelCallCount / totalStages;
  if (ratio > 0.5) return "Most of them call a model.";
  if (ratio === 0.5) return "Half of them call a model.";
  return `Only ${modelCallCount} ${modelCallCount === 1 ? "of them calls" : "of them call"} a model.`;
}

function StepButton({ dir, onClick, disabled }: { dir: "prev" | "next"; onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "prev" ? "Previous turn" : "Next turn"}
      className="w-[22px] h-[22px] rounded-full flex-none flex items-center justify-center text-[13px] leading-none text-[var(--ink2)] border border-[var(--line)] disabled:opacity-30 enabled:hover:border-[var(--acc)] enabled:hover:text-[var(--acc)] transition-colors"
    >
      {dir === "prev" ? "‹" : "›"}
    </button>
  );
}

/**
 * The instrument (decisions.md, 2026-09-09): one persistent slots card (stage 1) plus whichever
 * of stages 2-6 apply to the turn currently being viewed. `following` tracks whether the panel is
 * pinned to a reader-chosen turn (`false`) or auto-tracking the latest one (`true`, the default --
 * and what a brand-new turn starting generation always snaps back to, so "the default view is
 * always the current turn" holds even mid-review).
 */
export default function MachineryPanel({ history, finalSlots, isLiveTurn, liveStages, streamingText }: Props) {
  const [following, setFollowing] = useState(true);
  const [manualPosition, setManualPosition] = useState(0);

  // "The default view is always the current turn": whenever a NEW turn starts generating, snap
  // back to following it, even if a reader had stepped away to review an earlier one. Adjusted
  // during render (React's documented pattern for state that tracks a prop but can be locally
  // overridden) rather than in a useEffect, so this doesn't cost an extra render pass.
  const [prevIsLiveTurn, setPrevIsLiveTurn] = useState(isLiveTurn);
  if (isLiveTurn !== prevIsLiveTurn) {
    setPrevIsLiveTurn(isLiveTurn);
    if (isLiveTurn) setFollowing(true);
  }

  const totalPositions = history.length + (isLiveTurn ? 1 : 0);

  if (totalPositions === 0) {
    return <div className="text-[12.5px] text-[var(--ink3)] px-0.5">Nothing to show yet.</div>;
  }

  const lastPosition = totalPositions - 1;
  const currentPosition = following ? lastPosition : Math.min(manualPosition, lastPosition);
  const viewingLive = isLiveTurn && currentPosition === history.length;
  const historyIndex = viewingLive ? -1 : currentPosition;

  function goPrev() {
    setFollowing(false);
    setManualPosition(Math.max(0, currentPosition - 1));
  }
  function goNext() {
    const next = currentPosition + 1;
    if (next >= lastPosition) setFollowing(true);
    else {
      setFollowing(false);
      setManualPosition(next);
    }
  }

  const currentSlots = viewingLive
    ? liveStages.find((s): s is LiveSlotsStage => s.stage === "slots")?.data.cumulativeSlots ?? finalSlots
    : cumulativeSlotsThrough(history, historyIndex, finalSlots);
  const previousSlots = viewingLive
    ? finalSlots
    : historyIndex === 0
      ? {}
      : cumulativeSlotsThrough(history, historyIndex - 1, finalSlots);
  const turnKey = viewingLive ? "live" : `h${historyIndex}`;

  let perTurn: PerTurnStage[];
  let summary: React.ReactNode;

  if (viewingLive) {
    perTurn = livePerTurnStages(liveStages, true, streamingText);
    summary = perTurn.length === 0 ? "Watching this turn process…" : `${perTurn.length} stage${perTurn.length === 1 ? "" : "s"} so far`;
  } else {
    const entry = history[historyIndex];
    perTurn = historicalPerTurnStages(entry);
    const totalStages = 1 + perTurn.length;
    const modelCallCount = entry.modelCalls.length;
    summary = (
      <>
        {totalStages} stage{totalStages === 1 ? "" : "s"} ran this turn. {modelTouchPhrase(modelCallCount, totalStages)}
      </>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between px-0.5 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-[11px] font-semibold text-[var(--ink3)] uppercase tracking-wide whitespace-nowrap">Turn {currentPosition + 1}</span>
          {viewingLive && (
            <span className="text-[10px] font-semibold text-[var(--acc)] uppercase tracking-wide bg-[var(--acc-lt)] px-1.5 py-0.5 rounded-full whitespace-nowrap">
              live
            </span>
          )}
          {!following && (
            <button onClick={() => setFollowing(true)} className="text-[10.5px] font-medium text-[var(--acc)] whitespace-nowrap truncate">
              Jump to latest →
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 flex-none">
          <StepButton dir="prev" onClick={goPrev} disabled={currentPosition <= 0} />
          <StepButton dir="next" onClick={goNext} disabled={currentPosition >= lastPosition} />
        </div>
      </div>

      <div className="text-[12px] text-[var(--ink3)] mb-2.5">{summary}</div>

      <SlotsStageCard key={turnKey} slots={currentSlots} previousSlots={previousSlots} />

      {perTurn.map((s) => (
        <StageWrap key={s.key} n={s.n} name={s.name} headline={s.headline} pending={s.pending}>
          {s.render()}
        </StageWrap>
      ))}
    </div>
  );
}
