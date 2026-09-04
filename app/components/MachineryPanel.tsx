"use client";

import type { TurnMachinery, Slots, SlotValue, LiveStageEvent, LiveSlotsStage, LiveRulesStage, LiveSqlStage, LiveRetrievalStage } from "./conversation-types";

interface Props {
  entry: TurnMachinery;
  /** Cumulative slots as of this turn -- the full page computes this by replaying extractedPartial deltas up to this entry (or, for the last entry, using the live final state, which also carries any cap-assumed slots that never appear in a single turn's extractedPartial). */
  cumulativeSlots: Slots;
}

// Visual rebuild (decisions.md, 2026-09-04), against a supplied prototype
// (specs-light-dark.jsx) treated as a visual spec, not copied as code:
// what's in this panel is evidence -- what was understood, which rule
// applied, what was found, what it cost -- not code, and styling it like
// a dark terminal log undersold that. Every color below is a CSS custom
// property (globals.css, light+dark tokens), never a literal hex, so the
// whole panel re-themes with the rest of the app. Mono is now used ONLY
// where something genuinely is code or an identifier -- the SQL query,
// slot keys, advice source filenames -- per the explicit rule this round
// was built against; everything else (values, rule sentences, timings,
// costs, tags) is the same sans as the rest of the page.
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
 * frame-specific information. A rule whose text never varies by frame
 * (style_prefs_overlap, face_shape_boost, the eye-spacing/nose-profile
 * nudges) naturally lands in one group per distinct explanation, which in
 * practice means one group per rule.
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

/**
 * Short, human names for the ranking-nudge rules specifically -- the only
 * ones `rankCandidates` pushes once per matching FRAME (decisions.md,
 * 2026-09-03), so the only ones that ever collapse into a >1 group below.
 * Naming a stable `ruleId`, same pattern as `ASK_LABELS` elsewhere in this
 * app -- not a hand-written summary sentence that could drift from the
 * real count next to it.
 */
const RULE_SHORT_LABELS: Record<string, string> = {
  style_prefs_overlap: "style preference",
  face_shape_boost: "face shape",
  eye_spacing_close_set: "eye spacing",
  eye_spacing_wide_set: "eye spacing",
  nose_profile_prominent: "nose profile",
  long_face_lens_height: "face length",
};

/**
 * One stage, one card (decisions.md, 2026-09-04) -- the prototype dropped
 * the previous round's connected-circle timeline entirely in favor of
 * independent rounded blocks with real padding, each a `--block` surface
 * sitting on the panel's `--sunk` background (the same elevation
 * relationship stage cards use elsewhere in the app: raised surface on a
 * recessed one). `pending` (live panel only) marks the one stage actually
 * in flight right now -- an accent-colored ring and a pulsing badge
 * instead of the neutral completed-stage badge, so "still working on
 * this" reads as visibly different from "done" without needing a
 * timeline connector to imply sequence.
 */
export function StageWrap({
  n,
  name,
  headline,
  children,
  pending,
}: {
  n: number;
  total: number;
  name: string;
  headline: string;
  children: React.ReactNode;
  isLast: boolean;
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

/** A key/value row -- the ONLY place a name is mono (a slot key is a real identifier); the value beside it is plain sans, per this round's mono-only-for-code rule. */
function KVRow({ k, v, tag }: { k: string; v: string; tag?: { label: string; color: string } }) {
  return (
    <div className="grid grid-cols-[minmax(78px,auto)_1fr_auto] gap-2.5 py-1 border-t border-[var(--line2)] first:border-t-0 items-baseline">
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

export default function MachineryPanel({ entry, cumulativeSlots }: Props) {
  const slotEntries = Object.entries(cumulativeSlots).filter(([, v]) => v !== undefined) as [string, SlotValue<unknown>][];
  const assumedCount = slotEntries.filter(([, v]) => v.source === "assumed").length;

  const rulesFired = distinctRules(entry.derivedFacts);

  const rec = entry.recommendation;
  const citedMarkerSet = new Set((rec?.citations ?? []).flatMap((c) => c.citedMarkers));
  const advicedHitsWithCited = (rec?.adviceHits ?? []).map((h, i) => ({ ...h, cited: citedMarkerSet.has(`[A${i + 1}]`) }));
  const citedCount = advicedHitsWithCited.filter((h) => h.cited).length;
  const belowFloorCount = rec?.adviceNearMisses.length ?? 0;

  const totalMs = entry.timingsMs.total;
  const chatCallCount = entry.modelCalls.filter((c) => c.kind === "chat").length;
  const embeddingCallCount = entry.modelCalls.filter((c) => c.kind === "embedding").length;
  const totalCostInr = entry.modelCalls.reduce((sum, c) => sum + c.costInr, 0);

  // Which stages actually ran this turn -- an ask/interrupt turn only ever runs extraction
  // (stage 1/2 are pure compute over slots already known, stage 5 covers the one model call);
  // no SQL, no retrieval, no cost stage, because no query was compiled at all this turn.
  const stages: { key: string; name: string; headline: string; render: () => React.ReactNode }[] = [];

  stages.push({
    key: "slots",
    name: "Read the conversation",
    headline: `${slotEntries.length} field${slotEntries.length === 1 ? "" : "s"}${assumedCount > 0 ? ` · ${assumedCount} assumed` : ""}`,
    render: () => (
      <div>
        {slotEntries.length === 0 && <div className="text-[12.5px] text-[var(--ink3)]">nothing known yet</div>}
        {slotEntries.map(([key, slot]) => (
          <KVRow key={key} k={key} v={fmtSlotValue(slot.value)} tag={{ label: slot.source, color: sourceColor(slot.source) }} />
        ))}
      </div>
    ),
  });

  stages.push({
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
    key: "timing",
    name: "Wrote the answer",
    headline: `${(totalMs / 1000).toFixed(1)}s total`,
    render: () => (
      <>
        {/* Derived from the same modelCalls this turn actually made, not hand-written (decisions.md,
            2026-09-02) -- a chat call and an embedding call are different things (a language-model
            generation vs. turning text into a vector for similarity search) and the copy has to say
            so, or it drifts out of sync with the table right below it the moment the call count changes. */}
        {chatCallCount > 0 && (
          <Note>
            {chatCallCount} call{chatCallCount === 1 ? "" : "s"} to the language model this turn
            {embeddingCallCount > 0 ? `, plus ${embeddingCallCount} embedding call${embeddingCallCount === 1 ? "" : "s"} to turn the question into a vector` : ""} —
            {" "}{entry.modelCalls.map((c) => c.label.toLowerCase()).join(", ")}. Everything else is database work, which is why it barely registers.
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
      key: "cost",
      name: "What it cost",
      headline: `~₹${totalCostInr.toFixed(2)} est.`,
      render: () => (
        <>
          {/* Token counts get the visual weight here -- they're the real, verifiable number
              (read directly off each API response). The ₹ total is one arithmetic step removed
              from that, at a rate this project can't verify, so "estimated" carries a highlighted
              badge rather than being easy to skim past as plain small text. */}
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

  return (
    <div>
      <div className="text-[12px] text-[var(--ink3)] mb-2.5">
        {stages.length} stage{stages.length === 1 ? "" : "s"} ran this turn. Only {chatCallCount + embeddingCallCount} of them{" "}
        {chatCallCount + embeddingCallCount === 1 ? "calls" : "call"} a model.
      </div>
      {stages.map((s, i) => (
        <StageWrap key={s.key} n={i + 1} total={stages.length} name={s.name} headline={s.headline} isLast={i === stages.length - 1}>
          {s.render()}
        </StageWrap>
      ))}
    </div>
  );
}

function renderLiveSlots(data: LiveSlotsStage["data"]) {
  const entries = Object.entries(data.cumulativeSlots).filter(([, v]) => v !== undefined) as [string, SlotValue<unknown>][];
  return (
    <div>
      {entries.length === 0 && <div className="text-[12.5px] text-[var(--ink3)]">nothing known yet</div>}
      {entries.map(([key, slot]) => (
        <KVRow key={key} k={key} v={fmtSlotValue(slot.value)} tag={{ label: slot.source, color: sourceColor(slot.source) }} />
      ))}
    </div>
  );
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

function liveStageName(stage: LiveStageEvent["stage"]): string {
  switch (stage) {
    case "slots":
      return "Read the conversation";
    case "rules":
      return "Applied the fitting rules";
    case "sql":
      return "Queried the catalogue";
    case "retrieval":
      return "Retrieved optician guidance";
  }
}

function liveStageHeadline(s: LiveStageEvent): string {
  switch (s.stage) {
    case "slots": {
      const entries = Object.entries(s.data.cumulativeSlots).filter(([, v]) => v !== undefined) as [string, SlotValue<unknown>][];
      const assumed = entries.filter(([, v]) => v.source === "assumed").length;
      return `${entries.length} field${entries.length === 1 ? "" : "s"}${assumed > 0 ? ` · ${assumed} assumed` : ""}`;
    }
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

function renderLiveStage(s: LiveStageEvent): React.ReactNode {
  switch (s.stage) {
    case "slots":
      return renderLiveSlots(s.data);
    case "rules":
      return renderLiveRules(s.data);
    case "sql":
      return renderLiveSql(s.data);
    case "retrieval":
      return renderLiveRetrieval(s.data);
  }
}

/**
 * The live panel (decisions.md, 2026-09-02): renders progressively from
 * whatever "stage" SSE events have actually arrived for the turn in
 * flight, in the order the server actually processed them -- genuinely
 * staged, not a fake sequence played back from already-complete data.
 * `stages` grows one element at a time as real computation finishes
 * server-side; each render is a real snapshot of "how far the turn has
 * gotten," not a simulated pace. `generating` covers the gap between the
 * last known stage and the `done` event -- the recommend turn's structured
 * gloss/closing call never streams, so this can span real silence, which
 * is exactly the pre-first-token wait the machinery panel exists to fill
 * with something other than a blank screen.
 */
export function LiveMachineryPanel({ stages, generating, streamingText }: { stages: LiveStageEvent[]; generating: boolean; streamingText: string }) {
  const total = stages.length + (generating ? 1 : 0);
  return (
    <div>
      <div className="text-[12px] text-[var(--ink3)] mb-2.5">
        {total === 0 ? "Watching this turn process…" : `${total} stage${total === 1 ? "" : "s"} so far`}
      </div>
      {stages.map((s, i) => (
        <StageWrap key={i} n={i + 1} total={total} name={liveStageName(s.stage)} headline={liveStageHeadline(s)} isLast={!generating && i === stages.length - 1}>
          {renderLiveStage(s)}
        </StageWrap>
      ))}
      {generating && (
        <StageWrap n={stages.length + 1} total={total} name="Writing the reply" headline="in progress" isLast pending>
          <div className="text-[13px] leading-relaxed text-[var(--ink2)] whitespace-pre-wrap min-h-[1.4em]">
            {streamingText || "…"}
            <span className="inline-block w-[2px] h-[13px] bg-[var(--acc)] ml-0.5 align-text-bottom animate-pulse" />
          </div>
        </StageWrap>
      )}
    </div>
  );
}
