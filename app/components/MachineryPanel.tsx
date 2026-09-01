"use client";

import { useState } from "react";
import type { TurnMachinery, Slots, SlotValue } from "./conversation-types";

interface Props {
  entry: TurnMachinery;
  /** Cumulative slots as of this turn -- the full page computes this by replaying extractedPartial deltas up to this entry (or, for the last entry, using the live final state, which also carries any cap-assumed slots that never appear in a single turn's extractedPartial). */
  cumulativeSlots: Slots;
}

function sourceColor(source: string): string {
  if (source === "assumed") return "#E8CF9B";
  if (source === "derived") return "#9FC8E0";
  return "#9FE0C0"; // stated
}

function fmtSlotValue(v: unknown): string {
  if (Array.isArray(v)) return v.length === 0 ? "[ ]" : v.join(", ");
  return String(v);
}

/** Dedupe facts by ruleId (rankCandidates pushes one fact per matching frame) -- the count shown must match what a reader can count in the rows below it. */
function distinctRules(facts: { ruleId?: string }[]): Set<string> {
  return new Set(facts.map((f) => f.ruleId).filter((x): x is string => Boolean(x)));
}

function StageWrap({ n, total, name, headline, children, isLast }: { n: number; total: number; name: string; headline: string; children: React.ReactNode; isLast: boolean }) {
  return (
    <div className="grid grid-cols-[26px_1fr] gap-3.5">
      <div className="flex flex-col items-center">
        <div className="w-[22px] h-[22px] rounded-full flex-none border border-[#26332E] bg-[#131E1B] text-[#C4D2CB] text-[11px] leading-[20px] text-center tabular-nums">
          {n}
        </div>
        {!isLast && <div className="w-px flex-1 bg-[#26332E] mt-1" />}
      </div>
      <div className={isLast ? "pb-0" : "pb-6"}>
        <div className="flex justify-between gap-3 items-baseline flex-wrap mb-2.5">
          <div className="text-[14px] font-medium text-[#C4D2CB]">{name}</div>
          <div className="text-[12px] font-mono text-[#7B9089] tabular-nums">{headline}</div>
        </div>
        {children}
      </div>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
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
  const modelCallCount = entry.modelCalls.length;
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
        {entry.derivedFacts.map((f, i) => (
          <div key={i} className="py-1 border-t border-[#26332E] first:border-t-0">
            <div className="font-mono text-[12.5px] leading-relaxed text-[#C4D2CB]">{f.explanation}</div>
            {f.source && <div className="font-mono text-[11px] text-[#7B9089] mt-0.5">{f.source}</div>}
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
        {modelCallCount > 1 && (
          <Note>Two calls to the language model this turn — one to read your answer into fields, one to write the reply. Everything else is database work, which is why it barely registers.</Note>
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
              estimated — no public rate published for this model
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

export function MachineryToggle({ entry, cumulativeSlots }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`text-[12.5px] font-medium rounded border px-2.5 py-1.5 inline-flex items-center gap-1.5 ${
          open ? "text-[#14201C] border-[#DFE6E2]" : "text-[#14493E] border-[#C9DDD4]"
        }`}
      >
        <span className={`inline-block text-[10px] transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        {open ? "Hide the machinery" : "Show how this was built"}
      </button>
      {open && <MachineryPanel entry={entry} cumulativeSlots={cumulativeSlots} />}
    </div>
  );
}
