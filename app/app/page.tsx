"use client";

// Phase 7 (interface): the real conversational UI, wired to the live
// pipeline -- no mock data. Built from the pasted React mock as a VISUAL
// SPEC (colors, type hierarchy, layout patterns, the six-stage machinery
// panel), not copied as code: every number on this page is either read
// straight off a live API response or computed client-side from that
// response's own fields, per the explicit "never hardcoded" requirement
// (decisions.md 2026-09-01).
//
// Moved to the root route from `/conversation` (decisions.md, 2026-09-02)
// -- this is the product; the deliberately-naive Phase 1 comparison it's
// measured against now lives at the explicit `/baseline` path instead of
// competing for the root URL.
//
// Deployment readiness (decisions.md, 2026-09-02): if /api/conversation
// signals `{ fallback: true, reason }` (missing key, our own per-IP cap,
// or the live call erroring/rate-limiting upstream -- see that route),
// this page switches into a labelled replay of one of four real recorded
// conversations (app/lib/conversation/fixtures/*.json, captured by
// actually running the live pipeline once -- see
// app/scripts/generate-replay-fixtures.ts) instead of showing an error.
// Replay reuses every existing rendering path unmodified: a recorded
// TurnResult is applied via the exact same setState/setRecommendation
// calls a real network response goes through, so the machinery panel
// renders identically either way.
import { useState } from "react";
import Link from "next/link";
import { Newsreader, Instrument_Sans, IBM_Plex_Mono } from "next/font/google";
import FaceShapePicker from "@/components/FaceShapePicker";
import RecommendationCard from "@/components/RecommendationCard";
import MachineryPanel, { LiveMachineryPanel } from "@/components/MachineryPanel";
import EvalSection from "@/components/EvalSection";
import { parseFrameBlurb } from "@/components/conversation-types";
import type { ConversationState, TurnResult, Slots, RecommendedFrame, LiveStageEvent } from "@/components/conversation-types";

import straightforwardFixture from "@/lib/conversation/fixtures/straightforward.json";
import intentionalGapFixture from "@/lib/conversation/fixtures/intentional-gap.json";
import safetyInterruptFixture from "@/lib/conversation/fixtures/safety-interrupt.json";
import conventionHeavyFixture from "@/lib/conversation/fixtures/convention-heavy.json";

const serif = Newsreader({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-serif" });
const sans = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400"], variable: "--font-mono" });

interface ReplayFixture {
  id: string;
  label: string;
  description: string;
  turns: TurnResult[];
}

const REPLAY_SCENARIOS = [
  straightforwardFixture,
  intentionalGapFixture,
  safetyInterruptFixture,
  conventionHeavyFixture,
] as unknown as ReplayFixture[];

const FALLBACK_REASON_LABELS: Record<string, string> = {
  missing_api_key: "no model API key is configured on this deployment",
  rate_limited_local: "this demo has a per-visitor limit and you've reached it for now",
  upstream_rate_limited: "the model API is rate-limiting requests right now",
  invalid_api_key: "the configured model API key isn't valid",
  upstream_error: "the live model call failed",
};

function cumulativeSlotsAt(history: ConversationState["history"], index: number, finalSlots: Slots): Slots {
  if (index === history.length - 1) return finalSlots;
  let acc: Slots = {};
  for (let i = 0; i <= index; i++) acc = { ...acc, ...history[i].extractedPartial };
  return acc;
}

export default function ConversationPage() {
  const [state, setState] = useState<ConversationState | null>(null);
  const [recommendation, setRecommendation] = useState<TurnResult["recommendation"] | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [selectedFaceShape, setSelectedFaceShape] = useState<string | undefined>();

  // Replay mode: set once /api/conversation signals fallback:true. `null`
  // reason = live mode (default). Non-null = show the labelled banner;
  // `replayScenario` is which of the 4 recordings the visitor picked, and
  // `replayStep` is how many of its turns have been played so far.
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [replayScenario, setReplayScenario] = useState<ReplayFixture | null>(null);
  const [replayStep, setReplayStep] = useState(0);

  // Real streaming (decisions.md, 2026-09-02): accumulates as `delta` SSE events arrive from
  // the server -- genuine token-by-token text, not a client-side animation replayed after the
  // full response already showed up. Rendered as a temporary bubble at the end of the
  // transcript while a turn is in flight; cleared the moment the authoritative `done` event
  // lands and the real state takes over.
  const [streamingText, setStreamingText] = useState("");

  // Live machinery panel (decisions.md, 2026-09-02): accumulates as `stage` SSE events arrive
  // for the turn currently in flight -- one entry per real computation milestone runTurn passes
  // through (slots merged, rules derived, SQL run, advice retrieved), in the order they actually
  // happen. Reset at the start of every post() and cleared once `done`/`fallback` lands, since
  // the finalized data lives in state.history from that point on.
  const [liveStages, setLiveStages] = useState<LiveStageEvent[]>([]);
  // Turn stepper: null = follow the current/live turn automatically (the default, and the
  // point of a LIVE panel). A number pins the panel to that history index instead, so a
  // reader can step back through previous turns without the panel yanking them back on every
  // re-render -- only a genuinely NEW message (post()) resets this back to null.
  const [pinnedTurnIndex, setPinnedTurnIndex] = useState<number | null>(null);
  // Narrow viewports (decisions.md, 2026-09-02): the panel collapses behind a toggle rather
  // than disappearing -- reachable, not amputated. Irrelevant at lg+ (always shown there).
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);

  function applyTurnResult(result: TurnResult) {
    setState(result.state);
    if (result.recommendation) setRecommendation(result.recommendation);
  }

  async function post(message?: string) {
    setLoading(true);
    setError(null);
    setStreamingText("");
    setLiveStages([]);
    setPinnedTurnIndex(null);
    try {
      const res = await fetch("/api/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, message }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }

      // Server-Sent Events, hand-parsed -- no library needed for a protocol this small.
      // `delta` events carry real text chunks; one final `done` (or `fallback`) event carries
      // the complete, authoritative payload, identical in shape to what a plain JSON response
      // always carried. JSON.stringify on the server escapes any real newlines inside the data
      // itself, so splitting on a literal blank line ("\n\n") to find event boundaries is safe.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sepIndex: number;
        while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, sepIndex);
          buffer = buffer.slice(sepIndex + 2);

          const eventMatch = rawEvent.match(/^event: (.+)$/m);
          const dataMatch = rawEvent.match(/^data: (.+)$/m);
          if (!eventMatch || !dataMatch) continue;
          const eventType = eventMatch[1];
          const data = JSON.parse(dataMatch[1]);

          if (eventType === "delta") {
            setStreamingText((t) => t + data.text);
          } else if (eventType === "stage") {
            setLiveStages((prev) => [...prev, { stage: data.stage, data: data.data } as LiveStageEvent]);
          } else if (eventType === "fallback") {
            setFallbackReason(data.reason ?? "upstream_error");
            setStarted(true);
            setStreamingText("");
            setLiveStages([]);
          } else if (eventType === "done") {
            applyTurnResult(data as TurnResult);
            setStreamingText("");
            setLiveStages([]);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
      setStreamingText("");
    }
  }

  async function start() {
    setStarted(true);
    await post(undefined);
  }

  async function send(message: string) {
    if (!message.trim()) return;
    setInput("");
    await post(message.trim());
  }

  function selectFaceShape(label: string) {
    setSelectedFaceShape(label);
    const message = label === "Not sure" ? "Not sure about my face shape, let's skip that." : `My face shape is ${label.toLowerCase()}.`;
    send(message);
  }

  function chooseReplayScenario(fixture: ReplayFixture) {
    setError(null);
    setReplayScenario(fixture);
    setReplayStep(1);
    applyTurnResult(fixture.turns[0]);
  }

  function advanceReplay() {
    if (!replayScenario) return;
    const next = replayScenario.turns[replayStep];
    if (!next) return;
    applyTurnResult(next);
    setReplayStep((i) => i + 1);
  }

  function restartReplayPicker() {
    setReplayScenario(null);
    setReplayStep(0);
    setState(null);
    setRecommendation(null);
  }

  const turns = state?.turns ?? [];
  // New-opening flow (decisions.md, 2026-09-02): the face-shape ask is no
  // longer positional (turn 0) -- it's whichever turn the server flagged
  // askingFaceShape, and only the LAST turn can still be "awaiting a
  // reply" (every earlier one already has one, or the conversation
  // wouldn't have continued).
  const lastEntry = state?.history[state.history.length - 1];
  const waitingForFaceShapeReply = !fallbackReason && state?.status === "in_progress" && Boolean(lastEntry?.askingFaceShape);
  const recommendedFrames: (RecommendedFrame & { parsed: ReturnType<typeof parseFrameBlurb> })[] =
    (recommendation?.frames ?? []).map((f) => ({ ...f, parsed: parseFrameBlurb(f.frame_id, f.text) }));

  const inReplay = fallbackReason !== null;
  const replayNextUserLine =
    replayScenario && replayStep < replayScenario.turns.length
      ? replayScenario.turns[replayStep].state.turns.at(-2)?.content
      : undefined;
  const replayExhausted = Boolean(replayScenario) && replayStep >= (replayScenario?.turns.length ?? 0);

  // Turn stepper (decisions.md, 2026-09-02): the panel shows the CURRENT turn by default --
  // "live" while one is actually in flight (real streaming, not replay), otherwise the latest
  // completed entry -- with a way to step back through history. Replay never has a live phase
  // (fixtures apply a complete TurnResult synchronously on each "Continue" click), so it always
  // falls through to the historical per-index view, same rendering path a live turn uses once done.
  const isLiveView = pinnedTurnIndex === null && loading && !inReplay;
  const viewIndex = pinnedTurnIndex ?? (state ? state.history.length - 1 : -1);
  const totalKnownTurns = state ? state.history.length + (isLiveView ? 1 : 0) : 0;
  const displayTurnNumber = isLiveView ? totalKnownTurns : viewIndex + 1;
  const stepperPrevDisabled = displayTurnNumber <= 1;
  const stepperNextDisabled = pinnedTurnIndex === null;

  function stepTurn(delta: number) {
    if (!state) return;
    const base = pinnedTurnIndex ?? state.history.length - 1;
    const target = base + delta;
    if (target < 0) return;
    // Stepping forward past the second-to-last real entry returns to "follow the live/current
    // turn" (null) rather than pinning to the last index explicitly -- so a reader who steps
    // forward lands back in auto-follow mode, not in a stale pin that happens to equal latest.
    if (delta > 0 && target >= state.history.length - 1) setPinnedTurnIndex(null);
    else setPinnedTurnIndex(target);
  }

  return (
    <div
      className={`${serif.variable} ${sans.variable} ${mono.variable} min-h-screen bg-[#F6F8F7] pb-16`}
      style={{ fontFamily: "var(--font-sans)" }}
    >
      <header className="border-b border-[#DFE6E2] bg-[#FDFEFD] px-6 pt-6 pb-5">
        <div className="max-w-[800px] mx-auto">
          <h1
            className="text-[25px] leading-tight text-[#14201C] tracking-tight m-0"
            style={{ fontFamily: "var(--font-serif)", fontWeight: 500 }}
          >
            A fitting conversation
          </h1>
          <p className="text-[12.8px] leading-relaxed text-[#5F6F68] mt-1.5 max-w-[58ch]">
            A retrieval system that recommends eyewear the way an optician would — by asking
            first. The catalog is synthetic; the optical guidance it cites is not.
          </p>
        </div>
      </header>

      <main className="max-w-[1160px] mx-auto px-6 pt-6">
        {inReplay && (
          <div className="mb-5 max-w-[800px] rounded-md border border-[#E3C989] bg-[#FBF3DF] px-3.5 py-2.5 text-[12.8px] text-[#6B4E14]">
            <strong>Replaying a recorded conversation.</strong> The live model isn&apos;t
            available right now ({FALLBACK_REASON_LABELS[fallbackReason ?? ""] ?? "the live call failed"}).
            Everything below — including the machinery panel — is real data from an actual run of
            this pipeline, captured earlier, not a live response.
          </div>
        )}

        {!started && !inReplay && (
          <button
            onClick={start}
            className="rounded-md bg-[#14201C] text-white px-4 py-2 text-[13px] font-medium"
          >
            Start
          </button>
        )}

        {inReplay && !replayScenario && (
          <div className="space-y-2 max-w-[800px]">
            <p className="text-[13px] text-[#5F6F68] mb-2">Pick a recorded conversation to replay:</p>
            {REPLAY_SCENARIOS.map((fixture) => (
              <button
                key={fixture.id}
                onClick={() => chooseReplayScenario(fixture)}
                className="block w-full text-left rounded-md border border-[#DFE6E2] bg-[#FDFEFD] px-3.5 py-2.5 hover:border-[#14201C]"
              >
                <div className="text-[13.5px] font-medium text-[#14201C]">{fixture.label}</div>
                <div className="text-[12px] text-[#5F6F68] mt-0.5">{fixture.description}</div>
              </button>
            ))}
          </div>
        )}

        {started && state && (
          <div className="lg:grid lg:grid-cols-[3fr_2fr] lg:gap-8 lg:items-start">
          <div className="min-w-0">
            {state.history.map((entry, i) => {
              const isOpening = i === 0;
              const userContent = isOpening ? undefined : turns[2 * i - 1]?.content;
              const assistantContent = isOpening ? turns[0]?.content : turns[2 * i]?.content;
              // Follow-up path (decisions.md, 2026-09-02): dropped the "last entry" requirement --
              // once a follow-up turn can be appended after the recommendation, the recommend
              // entry is no longer necessarily last, but it's still the ONLY entry that will ever
              // have `recommendation` set, so checking that alone still identifies it correctly
              // regardless of how many follow-ups come after.
              const isRecommendTurn = Boolean(entry.recommendation);
              const isLastEntry = i === state.history.length - 1;

              return (
                <div key={entry.turnIndex} className="mb-5">
                  {userContent && (
                    <div className="flex justify-end mb-3">
                      <div
                        className="bg-[#E7F0EC] text-[#14201C] px-3.5 py-2 rounded-[6px_6px_2px_6px] max-w-[76%]"
                        style={{ fontFamily: "var(--font-serif)", fontSize: 16, lineHeight: 1.55 }}
                      >
                        {userContent}
                      </div>
                    </div>
                  )}

                  {assistantContent && !isRecommendTurn && (
                    <p
                      className="text-[#14201C] m-0 max-w-[62ch]"
                      style={{ fontFamily: "var(--font-serif)", fontSize: 16, lineHeight: 1.65 }}
                    >
                      {assistantContent}
                    </p>
                  )}

                  {!inReplay && isLastEntry && entry.askingFaceShape && waitingForFaceShapeReply && (
                    <FaceShapePicker selected={selectedFaceShape} onSelect={selectFaceShape} disabled={loading} />
                  )}

                  {isRecommendTurn && recommendation && (
                    <div>
                      {/* Product decision, not a formatting preference (decisions.md, 2026-09-02):
                          cards carry facts, prose carries judgement. framing opens (no frame
                          names/prices), cards follow, closing (practical starting point, any
                          assumption) comes after -- never a numbered list duplicating card specs. */}
                      <p
                        className="text-[#14201C] m-0 mb-4 max-w-[62ch] whitespace-pre-wrap"
                        style={{ fontFamily: "var(--font-serif)", fontSize: 16, lineHeight: 1.65 }}
                      >
                        {recommendation.framing}
                      </p>
                      {recommendedFrames.map((f) => {
                        if (!f.parsed) return null;
                        // Convention badge scoped to face_shape_boost only (decisions.md, 2026-09-02) --
                        // style_prefs_overlap fires on almost any shared tag (common catalog tagging),
                        // so including it made the badge show on nearly every card, carrying no
                        // information. face_shape_boost is genuinely rare (only fires when a face
                        // shape was stated AND this frame is conventionally suited to it) and is the
                        // one that actually cites a convention-tagged source (optician-guide-style-
                        // and-complexion), unlike style_prefs_overlap which cites none.
                        const isConvention = f.reasons.some((r) => r.ruleId === "face_shape_boost");
                        return (
                          <RecommendationCard
                            key={f.frame_id}
                            frame={f.parsed}
                            gloss={f.gloss}
                            claimType={isConvention ? "convention" : undefined}
                            droppedClause={f.droppedClause}
                          />
                        );
                      })}
                      {recommendation.closing && (
                        <p
                          className="text-[#14201C] m-0 mt-4 max-w-[62ch] whitespace-pre-wrap"
                          style={{ fontFamily: "var(--font-serif)", fontSize: 16, lineHeight: 1.65 }}
                        >
                          {recommendation.closing}
                        </p>
                      )}
                    </div>
                  )}

                </div>
              );
            })}

            {/* Real streaming (decisions.md, 2026-09-02): a temporary bubble showing the
                turn actually being written, chunk by chunk, as the server produces it -- not
                a placeholder, not a client-side animation of an already-complete response.
                Vanishes the instant the authoritative `done` event lands and the real
                transcript entry (state.history) takes over rendering in its place. */}
            {loading && streamingText && !inReplay && (
              <div className="mb-5">
                <p
                  className="text-[#14201C] m-0 max-w-[62ch] whitespace-pre-wrap"
                  style={{ fontFamily: "var(--font-serif)", fontSize: 16, lineHeight: 1.65 }}
                >
                  {streamingText}
                  <span className="inline-block w-[2px] h-[17px] bg-[#14201C] ml-0.5 align-text-bottom animate-pulse" />
                </p>
              </div>
            )}

            {state.status === "safety_interrupt" && (
              <p className="text-[12.5px] text-[#8A5A0B] mb-4">
                Safety interrupt fired — sales flow paused, recommend continuing with an
                optometrist first.
              </p>
            )}

            {inReplay && replayScenario && !replayExhausted && (
              <button
                onClick={advanceReplay}
                className="rounded-md bg-[#14201C] text-white px-4 py-2 text-[13px] font-medium mt-2"
              >
                Continue{replayNextUserLine ? `: "${replayNextUserLine}"` : ""} →
              </button>
            )}

            {inReplay && replayExhausted && (
              <button
                onClick={restartReplayPicker}
                className="rounded-md border border-[#14201C] text-[#14201C] px-4 py-2 text-[13px] font-medium mt-2"
              >
                ← Try a different recorded conversation
              </button>
            )}

            {/* Follow-up path (decisions.md, 2026-09-02): the input used to disappear once
                status="done", ending the conversation at the recommendation. Now it stays --
                a "done" conversation still accepts follow-ups ("does it come in tortoise?",
                "which would you pick?"), it just stops being a clarify/recommend cycle. Only
                a genuine hard stop (safety_interrupt) or the face-shape chip wait hides it. */}
            {!inReplay &&
              (state.status === "in_progress" || state.status === "done") &&
              !(waitingForFaceShapeReply) && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    send(input);
                  }}
                  className="flex gap-2 mt-2"
                >
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={state.status === "done" ? "Ask about these frames..." : "Type your reply..."}
                    className="flex-1 rounded-md border border-[#DFE6E2] bg-[#FDFEFD] text-[#14201C] placeholder:text-[#8A9992] px-3 py-2 text-[14px]"
                    style={{ fontFamily: "var(--font-serif)" }}
                    disabled={loading}
                  />
                  <button
                    type="submit"
                    disabled={loading}
                    className="rounded-md bg-[#14201C] text-white px-4 py-2 text-[13px] font-medium disabled:opacity-50"
                  >
                    {loading ? "..." : "Send"}
                  </button>
                </form>
              )}

            {error && <p className="text-[13px] text-red-600 mt-2">{error}</p>}

            {/* Moved below the follow-up input (decisions.md, 2026-09-02) -- it used to sit
                between the recommendation and where the conversation would have continued,
                which now visibly interrupts an active follow-up chat. Evaluation info reads
                better as a closing "about this system" section than a wall in the middle of
                a conversation. */}
            {state.status === "done" && !inReplay && (
              <div className="mt-8">
                <div className="text-[13.5px] font-semibold text-[#14201C] mb-2.5">
                  How this is evaluated
                </div>
                <EvalSection />
              </div>
            )}
          </div>

          {/* Two-column layout, live machinery panel (decisions.md, 2026-09-02): moved out of
              the message thread entirely -- no more per-message "Show how this was built"
              toggle. Sticky alongside the chat on wide viewports; a collapsed toggle on narrow
              ones (mobilePanelOpen), never gone entirely. Shows the CURRENT turn by default
              (live, while one is in flight; otherwise the latest completed entry) with a
              stepper to walk back through history. */}
          <aside className="mt-8 lg:mt-0 lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <h2 className="text-[13.5px] font-semibold text-[#14201C] m-0">How this is built</h2>
              <button
                onClick={() => setMobilePanelOpen((v) => !v)}
                aria-expanded={mobilePanelOpen}
                className="lg:hidden text-[12px] font-medium text-[#14493E] border border-[#C9DDD4] rounded px-2.5 py-1 whitespace-nowrap"
              >
                {mobilePanelOpen ? "Hide ▾" : "Show ▸"}
              </button>
            </div>
            <div className={mobilePanelOpen ? "block" : "hidden lg:block"}>
              {state.history.length > 0 && (
                <div className="flex items-center justify-between gap-2 mb-2.5">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => stepTurn(-1)}
                      disabled={stepperPrevDisabled}
                      className="w-6 h-6 rounded border border-[#DFE6E2] text-[#14201C] text-[12px] leading-none disabled:opacity-30"
                      aria-label="Previous turn"
                    >
                      ‹
                    </button>
                    <span className="text-[12px] font-mono text-[#5F6F68] tabular-nums">
                      Turn {displayTurnNumber} of {totalKnownTurns}
                      {isLiveView && <span className="text-[#4E7F6B]"> · live</span>}
                    </span>
                    <button
                      onClick={() => stepTurn(1)}
                      disabled={stepperNextDisabled}
                      className="w-6 h-6 rounded border border-[#DFE6E2] text-[#14201C] text-[12px] leading-none disabled:opacity-30"
                      aria-label="Next turn"
                    >
                      ›
                    </button>
                  </div>
                  {pinnedTurnIndex !== null && (
                    <button onClick={() => setPinnedTurnIndex(null)} className="text-[11.5px] underline text-[#14493E]">
                      Jump to current
                    </button>
                  )}
                </div>
              )}

              {isLiveView ? (
                <LiveMachineryPanel stages={liveStages} generating={loading} streamingText={streamingText} />
              ) : viewIndex >= 0 ? (
                <MachineryPanel entry={state.history[viewIndex]} cumulativeSlots={cumulativeSlotsAt(state.history, viewIndex, state.slots)} />
              ) : (
                <div className="bg-[#0E1614] rounded-md px-5 py-5 text-[12.5px] text-[#7B9089] font-mono">
                  Nothing to show yet.
                </div>
              )}
            </div>
          </aside>
          </div>
        )}

        <footer className="mt-10 pt-4.5 border-t border-[#DFE6E2] flex gap-4 flex-wrap text-[12.5px] text-[#8A9992]">
          <span>Ashutosh Edamadaka</span>
          <Link href="/baseline" className="underline hover:text-[#5F6F68]">
            See the naive baseline it&apos;s measured against
          </Link>
        </footer>
      </main>
    </div>
  );
}
