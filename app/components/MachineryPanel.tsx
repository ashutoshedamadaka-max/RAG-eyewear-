"use client";

import type { TurnMachinery, Slots, SlotValue, LiveStageEvent, LiveSlotsStage, LiveRulesStage, LiveSqlStage, LiveRetrievalStage } from "./conversation-types";

interface Props {
  entry: TurnMachinery;
  /** Cumulative slots as of this turn -- the full page computes this by replaying extractedPartial deltas up to this entry (or, for the last entry, using the live final state, which also carries any cap-assumed slots that never appear in a single turn's extractedPartial). */
  cumulativeSlots: Slots;
}

export function sourceColor(source: string): string {
  if (source === "assumed") return "#E8CF9B";
  if (source === "derived") return "#9FC8E0";
  return "#9FE0C0"; // stated
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

/** `pending` (live panel only, decisions.md 2026-09-02): the stage that's actually in flight right now -- a dashed, pulsing ring instead of the solid completed-stage circle, so "still working on this" reads as visibly different from "done." */
export function StageWrap({ n, name, headline, children, isLast, pending }: { n: number; total: number; name: string; headline: string; children: React.ReactNode; isLast: boolean; pending?: boolean }) {
  return (
    <div className="grid grid-cols-[26px_1fr] gap-3.5">
      <div className="flex flex-col items-center">
        <div
          className={`w-[22px] h-[22px] rounded-full flex-none border text-[11px] leading-[20px] text-center tabular-nums ${
            pending ? "border-dashed border-[#4E7F6B] bg-[#131E1B] text-[#9FE0C0] animate-pulse" : "border-[#26332E] bg-[#131E1B] text-[#C4D2CB]"
          }`}
        >
          {n}
        </div>
        {!isLast && <div className="w-px flex-1 bg-[#26332E] mt-1" />}
      </div>
      <div className={isLast ? "pb-0" : "pb-6"}>
        <div className="flex justify-between gap-3 items-baseline flex-wrap mb-2.5">
          <div className="text-[14px] font-medium text-[#C4D2CB]">{name}</div>
          <div className={`text-[12px] font-mono tabular-nums ${pending ? "text-[#9FE0C0]" : "text-[#7B9089]"}`}>{headline}</div>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] leading-relaxed text-[#7B9089] mb-3 max-w-[72ch]">{children}</p>;
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
        {slotEntries.length === 0 && <div className="text-[12.5px] text-[#7B9089] font-mono">nothing known yet</div>}
        {slotEntries.map(([key, slot]) => (
          <div key={key} className="flex gap-3 items-baseline py-0.5">
            <span className="font-mono text-[12.5px] text-[#7B9089] min-w-[110px]">{key}</span>
            <span className="font-mono text-[12.5px] text-[#C4D2CB] flex-1 tabular-nums">{fmtSlotValue(slot.value)}</span>
            <span className="text-[10.5px] font-medium" style={{ color: sourceColor(slot.source) }}>{slot.source}</span>
          </div>
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
        {entry.derivedFacts.length === 0 && <div className="text-[12.5px] text-[#5E7269] font-mono">none fired this turn</div>}
        {groupFactsForDisplay(entry.derivedFacts).map((g, i) => (
          <div key={i} className="py-1 border-t border-[#26332E] first:border-t-0">
            <div className="font-mono text-[12.5px] leading-relaxed text-[#C4D2CB]">
              {g.count > 1
                ? `${RULE_SHORT_LABELS[g.ruleId ?? ""] ?? g.explanation} → soft ranking nudge, ${g.count} candidates boosted`
                : g.explanation}
            </div>
            {g.source && <div className="font-mono text-[11px] text-[#7B9089] mt-0.5">{g.source}</div>}
          </div>
        ))}
        {entry.assumptions.map((a, i) => (
          <div key={`a${i}`} className="py-1 border-t border-[#26332E]">
            <div className="font-mono text-[12.5px] leading-relaxed text-[#E8CF9B]">{a.explanation}</div>
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
          <pre className="font-mono text-[12px] leading-relaxed text-[#B9D4C6] bg-[#080F0D] px-3.5 py-3 rounded border-l-2 border-[#14493E] overflow-x-auto m-0">
            {rec.sql}
          </pre>
          {rec.relaxed && (
            <div className="mt-2.5 text-[12px] text-[#E8CF9B]">
              Exact match failed — relaxation ladder engaged.
              {rec.relaxedDetails && rec.relaxedDetails.length > 0 && (
                <ul className="list-disc list-inside mt-1">
                  {rec.relaxedDetails.map((d, i) => (
                    <li key={i} className="font-mono text-[11.5px]">dropped <code>{d.droppedClause}</code> → {d.frame_id}</li>
                  ))}
                </ul>
              )}
              {rec.neverRelaxBlocked && rec.neverRelaxBlocked.length > 0 && (
                <div className="mt-1.5 text-[11.5px] text-[#7B9089]">
                  Never-relax constraint{rec.neverRelaxBlocked.length > 1 ? "s" : ""} blocked a would-be match and {rec.neverRelaxBlocked.length > 1 ? "were" : "was"} correctly NOT offered: {rec.neverRelaxBlocked.map((b) => b.describe).join("; ")}
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
            Guidance is tagged by how certain it is. <b className="text-[#C4D2CB] font-medium">Physical</b> means a
            measurable fact from manufacturer documentation, stated plainly. <b className="text-[#C4D2CB] font-medium">Convention</b> means
            style guidance — true by custom, not by measurement — so the answer hedges it rather than stating it as fact.
            The score is how closely each passage matches the question; anything under <b className="text-[#C4D2CB] font-medium">0.25</b> is
            too loosely related to trust, and is dropped before the model ever sees it.
          </Note>
          {advicedHitsWithCited.map((h, i) => (
            <div key={h.chunk_id} className="grid grid-cols-[1fr_auto_48px] gap-3 py-1.5 items-baseline border-t border-[#26332E]">
              <div>
                <div className="font-mono text-[12.5px] text-[#C4D2CB]">[A{i + 1}] {h.doc_id} — {h.section_heading}</div>
                <div className="text-[10.5px] font-medium mt-0.5" style={{ color: h.cited ? "#9FE0C0" : "#7B9089" }}>
                  {h.cited ? "cited" : "retrieved, not cited"}
                </div>
              </div>
              <span className="text-[10.5px] font-medium" style={{ color: h.claim_type === "convention" ? "#9FE0C0" : "#9FC8E0" }}>{h.claim_type}</span>
              <span className="font-mono text-[12.5px] text-[#7B9089] text-right tabular-nums">{h.score.toFixed(3)}</span>
            </div>
          ))}
          {(rec.adviceNearMisses ?? []).map((h) => (
            <div key={h.chunk_id} className="grid grid-cols-[1fr_auto_48px] gap-3 py-1.5 items-baseline border-t border-[#26332E] opacity-60">
              <div>
                <div className="font-mono text-[12.5px] text-[#5E7269]">{h.doc_id} — {h.section_heading}</div>
                <div className="text-[10.5px] font-medium mt-0.5 text-[#5E7269]">below 0.25 floor</div>
              </div>
              <span className="text-[10.5px] font-medium text-[#5E7269]">{h.claim_type}</span>
              <span className="font-mono text-[12.5px] text-[#5E7269] text-right tabular-nums">{h.score.toFixed(3)}</span>
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
        <div className="flex gap-0.5 mb-3">
          {entry.modelCalls.map((c, i) => (
            <div key={i} title={`${c.label} — ${c.ms}ms`} className="h-[7px] rounded-sm" style={{ flexGrow: c.ms, background: "#4E7F6B" }} />
          ))}
          {entry.timingsMs.sqlQuery !== undefined && (
            <div title={`SQL — ${entry.timingsMs.sqlQuery}ms`} className="h-[7px] rounded-sm bg-[#26332E]" style={{ flexGrow: Math.max(entry.timingsMs.sqlQuery, 1) }} />
          )}
          {entry.timingsMs.adviceSearch !== undefined && (
            <div title={`Similarity search — ${entry.timingsMs.adviceSearch}ms`} className="h-[7px] rounded-sm bg-[#26332E]" style={{ flexGrow: Math.max(entry.timingsMs.adviceSearch, 1) }} />
          )}
          {entry.timingsMs.relaxationSearch !== undefined && (
            <div title={`Relaxation search — ${entry.timingsMs.relaxationSearch}ms`} className="h-[7px] rounded-sm bg-[#26332E]" style={{ flexGrow: Math.max(entry.timingsMs.relaxationSearch, 1) }} />
          )}
        </div>
        {entry.modelCalls.map((c, i) => (
          <div key={i} className="flex gap-3 items-baseline py-1 border-t border-[#26332E]">
            <span className="text-[12.5px] text-[#C4D2CB] flex-1">{c.label}</span>
            <span className="text-[10.5px] font-medium text-[#9FE0C0]">model call</span>
            <span className="font-mono text-[12.5px] text-[#7B9089] min-w-[52px] text-right tabular-nums">{c.ms} ms</span>
          </div>
        ))}
        {entry.timingsMs.sqlQuery !== undefined && (
          <div className="flex gap-3 items-baseline py-1 border-t border-[#26332E]">
            <span className="text-[12.5px] text-[#C4D2CB] flex-1">Searching the catalogue</span>
            <span className="text-[10.5px] font-medium text-[#7B9089]">SQL</span>
            <span className="font-mono text-[12.5px] text-[#7B9089] min-w-[52px] text-right tabular-nums">{entry.timingsMs.sqlQuery} ms</span>
          </div>
        )}
        {entry.timingsMs.adviceSearch !== undefined && (
          <div className="flex gap-3 items-baseline py-1 border-t border-[#26332E]">
            <span className="text-[12.5px] text-[#C4D2CB] flex-1">Finding matching guidance</span>
            <span className="text-[10.5px] font-medium text-[#7B9089]">similarity search</span>
            <span className="font-mono text-[12.5px] text-[#7B9089] min-w-[52px] text-right tabular-nums">{entry.timingsMs.adviceSearch} ms</span>
          </div>
        )}
        {entry.timingsMs.relaxationSearch !== undefined && (
          <div className="flex gap-3 items-baseline py-1 border-t border-[#26332E]">
            <span className="text-[12.5px] text-[#C4D2CB] flex-1">Searching for the nearest alternative</span>
            <span className="text-[10.5px] font-medium text-[#7B9089]">relaxation ladder</span>
            <span className="font-mono text-[12.5px] text-[#7B9089] min-w-[52px] text-right tabular-nums">{entry.timingsMs.relaxationSearch} ms</span>
          </div>
        )}
        <div className="flex gap-3 pt-2 mt-1 border-t border-[#26332E]">
          <span className="text-[12.5px] font-medium text-[#C4D2CB] flex-1">Total</span>
          <span className="font-mono text-[12.5px] font-medium text-[#C4D2CB] tabular-nums">{totalMs} ms</span>
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
              from that, at a rate this project can't verify, so it's deliberately smaller and
              carries its caveat inline rather than in a footnote a reader could miss. */}
          <div className="grid grid-cols-[1fr_auto_auto] gap-4 pb-1.5 border-b border-[#26332E]">
            <span className="text-[10.5px] font-medium text-[#7B9089]">Model call</span>
            <span className="text-[10.5px] font-medium text-[#7B9089] min-w-[70px] text-right">Tokens in</span>
            <span className="text-[10.5px] font-medium text-[#7B9089] min-w-[70px] text-right">Tokens out</span>
          </div>
          {entry.modelCalls.map((c, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-4 py-2 border-b border-[#26332E] items-baseline">
              <span className="text-[13px] text-[#C4D2CB]">{c.label}</span>
              <span className="font-mono text-[15px] font-medium text-[#E4EEE8] min-w-[70px] text-right tabular-nums">{c.promptTokens.toLocaleString()}</span>
              <span className="font-mono text-[15px] font-medium text-[#E4EEE8] min-w-[70px] text-right tabular-nums">{c.completionTokens.toLocaleString()}</span>
            </div>
          ))}
          <div className="flex gap-2.5 items-baseline pt-2.5 flex-wrap">
            <span className="text-[12px] text-[#7B9089] flex-1">Cost of this recommendation</span>
            <span className="font-mono text-[12.5px] text-[#9FE0C0] tabular-nums">~₹{totalCostInr.toFixed(2)}</span>
            <span className="text-[10.5px] font-medium text-[#E8CF9B] bg-[#26332E] px-1.5 py-0.5 rounded whitespace-nowrap">
              estimated
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-[#5E7269] mt-2 max-w-[72ch]">
            The token counts above are exact, read directly off each API response. The embedding
            call&apos;s rate is OpenAI&apos;s real published price; the chat model&apos;s rate has
            no public list to cite, so the ₹ total is a labelled estimate, not a verified cost.
          </p>
        </>
      ),
    });
  }

  return (
    <div className="bg-[#0E1614] rounded-md px-5 pt-5 pb-5 mt-1.5">
      <div className="flex justify-between gap-3 items-baseline flex-wrap pb-3.5 mb-4 border-b border-[#26332E]">
        <div className="text-[13px] font-medium text-[#C4D2CB]">
          {stages.length} stage{stages.length === 1 ? "" : "s"} ran this turn
        </div>
        <div className="text-[12px] font-mono text-[#7B9089]">
          {rec ? "catalogue → SQL · advice → retrieval" : "no query compiled yet"}
        </div>
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
      {entries.length === 0 && <div className="text-[12.5px] text-[#7B9089] font-mono">nothing known yet</div>}
      {entries.map(([key, slot]) => (
        <div key={key} className="flex gap-3 items-baseline py-0.5">
          <span className="font-mono text-[12.5px] text-[#7B9089] min-w-[110px]">{key}</span>
          <span className="font-mono text-[12.5px] text-[#C4D2CB] flex-1 tabular-nums">{fmtSlotValue(slot.value)}</span>
          <span className="text-[10.5px] font-medium" style={{ color: sourceColor(slot.source) }}>{slot.source}</span>
        </div>
      ))}
    </div>
  );
}

function renderLiveRules(data: LiveRulesStage["data"]) {
  return (
    <div>
      {data.derivedFacts.length === 0 && <div className="text-[12.5px] text-[#5E7269] font-mono">none fired this turn</div>}
      {groupFactsForDisplay(data.derivedFacts).map((g, i) => (
        <div key={i} className="py-1 border-t border-[#26332E] first:border-t-0">
          <div className="font-mono text-[12.5px] leading-relaxed text-[#C4D2CB]">
            {g.count > 1
              ? `${RULE_SHORT_LABELS[g.ruleId ?? ""] ?? g.explanation} → soft ranking nudge, ${g.count} candidates boosted`
              : g.explanation}
          </div>
          {g.source && <div className="font-mono text-[11px] text-[#7B9089] mt-0.5">{g.source}</div>}
        </div>
      ))}
      {data.assumptions.map((a, i) => (
        <div key={`a${i}`} className="py-1 border-t border-[#26332E]">
          <div className="font-mono text-[12.5px] leading-relaxed text-[#E8CF9B]">{a.explanation}</div>
        </div>
      ))}
    </div>
  );
}

function renderLiveSql(data: LiveSqlStage["data"]) {
  return (
    <>
      <pre className="font-mono text-[12px] leading-relaxed text-[#B9D4C6] bg-[#080F0D] px-3.5 py-3 rounded border-l-2 border-[#14493E] overflow-x-auto m-0">
        {data.sql}
      </pre>
      {data.relaxed && (
        <div className="mt-2.5 text-[12px] text-[#E8CF9B]">
          Exact match failed — relaxation ladder engaged.
          {data.relaxedDetails && data.relaxedDetails.length > 0 && (
            <ul className="list-disc list-inside mt-1">
              {data.relaxedDetails.map((d, i) => (
                <li key={i} className="font-mono text-[11.5px]">dropped <code>{d.droppedClause}</code> → {d.frame_id}</li>
              ))}
            </ul>
          )}
          {data.neverRelaxBlocked && data.neverRelaxBlocked.length > 0 && (
            <div className="mt-1.5 text-[11.5px] text-[#7B9089]">
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
        Guidance is tagged by how certain it is. <b className="text-[#C4D2CB] font-medium">Physical</b> means a
        measurable fact from manufacturer documentation, stated plainly. <b className="text-[#C4D2CB] font-medium">Convention</b> means
        style guidance — true by custom, not by measurement — so the answer hedges it rather than stating it as fact.
        The score is how closely each passage matches the question; anything under <b className="text-[#C4D2CB] font-medium">0.25</b> is
        too loosely related to trust, and is dropped before the model ever sees it. Which of these end up actually
        cited will show once the reply is written.
      </Note>
      {data.adviceHits.map((h, i) => (
        <div key={h.chunk_id} className="grid grid-cols-[1fr_auto_48px] gap-3 py-1.5 items-baseline border-t border-[#26332E]">
          <div>
            <div className="font-mono text-[12.5px] text-[#C4D2CB]">[A{i + 1}] {h.doc_id} — {h.section_heading}</div>
            <div className="text-[10.5px] font-medium mt-0.5 text-[#7B9089]">retrieved</div>
          </div>
          <span className="text-[10.5px] font-medium" style={{ color: h.claim_type === "convention" ? "#9FE0C0" : "#9FC8E0" }}>{h.claim_type}</span>
          <span className="font-mono text-[12.5px] text-[#7B9089] text-right tabular-nums">{h.score.toFixed(3)}</span>
        </div>
      ))}
      {data.adviceNearMisses.map((h) => (
        <div key={h.chunk_id} className="grid grid-cols-[1fr_auto_48px] gap-3 py-1.5 items-baseline border-t border-[#26332E] opacity-60">
          <div>
            <div className="font-mono text-[12.5px] text-[#5E7269]">{h.doc_id} — {h.section_heading}</div>
            <div className="text-[10.5px] font-medium mt-0.5 text-[#5E7269]">below 0.25 floor</div>
          </div>
          <span className="text-[10.5px] font-medium text-[#5E7269]">{h.claim_type}</span>
          <span className="font-mono text-[12.5px] text-[#5E7269] text-right tabular-nums">{h.score.toFixed(3)}</span>
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
    <div className="bg-[#0E1614] rounded-md px-5 pt-5 pb-5 mt-1.5">
      <div className="flex justify-between gap-3 items-baseline flex-wrap pb-3.5 mb-4 border-b border-[#26332E]">
        <div className="text-[13px] font-medium text-[#C4D2CB]">Watching this turn process…</div>
        <div className="text-[12px] font-mono text-[#7B9089]">
          {total === 0 ? "waiting…" : `${total} stage${total === 1 ? "" : "s"} so far`}
        </div>
      </div>
      {stages.map((s, i) => (
        <StageWrap key={i} n={i + 1} total={total} name={liveStageName(s.stage)} headline={liveStageHeadline(s)} isLast={!generating && i === stages.length - 1}>
          {renderLiveStage(s)}
        </StageWrap>
      ))}
      {generating && (
        <StageWrap n={stages.length + 1} total={total} name="Writing the reply" headline="in progress" isLast pending>
          <div className="font-mono text-[12.5px] leading-relaxed text-[#8FADA0] whitespace-pre-wrap min-h-[1.4em]">
            {streamingText || "…"}
            <span className="inline-block w-[2px] h-[13px] bg-[#9FE0C0] ml-0.5 align-text-bottom animate-pulse" />
          </div>
        </StageWrap>
      )}
    </div>
  );
}
