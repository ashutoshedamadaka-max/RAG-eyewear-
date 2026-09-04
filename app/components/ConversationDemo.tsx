"use client";

// Phase 7 (interface): the real conversational UI, wired to the live
// pipeline -- no mock data. Every number on this page is either read
// straight off a live API response, computed client-side from that
// response's own fields, or passed down from the server-computed
// `evalOneLiner` prop (see app/app/page.tsx) -- per the explicit "never
// hardcoded" requirement (decisions.md 2026-09-01).
//
// Visual rebuild (decisions.md, 2026-09-04), against a supplied prototype
// (specs-light-dark.jsx) treated as a visual spec, not copied as code:
// "one continuous light surface," the app as an object floating on a
// tinted field (root layout.tsx), not an edge-to-edge dark-terminal-
// beside-a-light-chat layout. The previous round's fixed-viewport dual-
// scroll-region shell is gone -- the page scrolls normally now, and the
// machinery panel column uses `position: sticky` with its own bounded
// `overflow-y: auto`, matching the prototype's actual CSS rather than a
// hand-rolled alternative.
//
// Deployment readiness (decisions.md, 2026-09-02): if /api/conversation
// signals `{ fallback: true, reason }` (missing key, our own per-IP cap,
// or the live call erroring/rate-limiting upstream -- see that route),
// this page switches into a labelled replay of one of four real recorded
// conversations (app/lib/conversation/fixtures/*.json, captured by
// actually running the live pipeline once -- see
// app/scripts/generate-replay-fixtures.ts) instead of showing an error.
import { useState } from "react";
import Link from "next/link";
import { Newsreader, Instrument_Sans, IBM_Plex_Mono } from "next/font/google";
import FaceShapePicker from "@/components/FaceShapePicker";
import AnswerPills from "@/components/AnswerPills";
import { TOPIC_PILLS } from "@/components/pill-options";
import RecommendationCard from "@/components/RecommendationCard";
import MachineryPanel, { LiveMachineryPanel } from "@/components/MachineryPanel";
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

/**
 * Starter pills (decisions.md, 2026-09-04) -- PROJECT_CONTEXT.md §7's
 * original, never-implemented demo-scope requirement ("seed the landing
 * state with 3-4 clickable example queries so someone gets value before
 * typing"), resurfaced by the supplied prototype. Deliberately NOT
 * TOPIC_PILLS: these are open-ended example prompts for the greeting's
 * free-text question, not a fixed-enum slot answer -- a tap just sends
 * the label as plain text through the same extraction path typing would,
 * same as everything else here. Distinct from answer pills, which
 * explicitly do NOT appear on the opening turn (the greeting is a real
 * open question, not a closed one) -- these exist BECAUSE that turn has
 * no enum to offer pills for, as a lighter-weight nudge instead.
 */
const STARTER_PROMPTS = ["Glasses for office work", "Sunglasses for driving", "Reading glasses", "Not sure yet"];

function cumulativeSlotsAt(history: ConversationState["history"], index: number, finalSlots: Slots): Slots {
  if (index === history.length - 1) return finalSlots;
  let acc: Slots = {};
  for (let i = 0; i <= index; i++) acc = { ...acc, ...history[i].extractedPartial };
  return acc;
}

export interface EvalOneLiner {
  groundednessMin: number;
  groundednessMax: number;
  conversationPass: number;
  conversationTotal: number;
  gapPass: number;
  gapTotal: number;
}

export default function ConversationDemo({ evalOneLiner }: { evalOneLiner: EvalOneLiner }) {
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
  // Answer pills (decisions.md, 2026-09-04): same "is this the one turn actually waiting on
  // a reply" gate as the face-shape picker above, keyed on askedTopic instead of
  // askingFaceShape. Never true on the opening turn (askedTopic is unset there -- the
  // greeting is a free-text-only open question, by design) and never true once the topic's
  // answer has already landed (a new history entry appends, so this stops being isLastEntry).
  const waitingForTopicReply = !fallbackReason && state?.status === "in_progress" && Boolean(lastEntry?.askedTopic);
  // Starter pills: only true for the single turn between the static greeting and the
  // customer's first reply -- history.length===1 means only the greeting has been processed.
  const waitingForOpeningReply =
    !fallbackReason && state?.status === "in_progress" && state.history.length === 1 && !lastEntry?.askingFaceShape && !lastEntry?.askedTopic;
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

  const showingDemo = started && state;

  return (
    <div className={`${serif.variable} ${sans.variable} ${mono.variable}`} style={{ fontFamily: "var(--font-sans)" }}>
      {showingDemo ? (
        <div className="grid grid-cols-1 min-[1061px]:grid-cols-[1.3fr_1fr] gap-3.5 p-3.5 items-start">
          <section className="min-w-0 px-2 min-[600px]:px-4 pt-3 pb-2">
            <div className="pb-4 mb-5 border-b border-[var(--line2)]">
              <h1 className="text-[24px] leading-tight text-[var(--ink)] tracking-tight m-0" style={{ fontFamily: "var(--font-serif)", fontWeight: 500 }}>
                A fitting conversation
              </h1>
              <p className="text-[13.5px] leading-relaxed text-[var(--ink2)] mt-1.5 max-w-[52ch]">
                Recommends eyewear the way an optician would — by asking first. The panel beside
                this fills in as we talk. The catalog is synthetic; the optical guidance it cites
                is not.
              </p>
            </div>

            {inReplay && (
              <div className="mb-5 rounded-[10px] border px-3.5 py-2.5 text-[12.8px]" style={{ borderColor: "var(--warn)", background: "var(--warn-lt)", color: "var(--warn)" }}>
                <strong>Replaying a recorded conversation.</strong> The live model isn&apos;t
                available right now ({FALLBACK_REASON_LABELS[fallbackReason ?? ""] ?? "the live call failed"}).
                Everything below — including the machinery panel — is real data from an actual run of
                this pipeline, captured earlier, not a live response.
              </div>
            )}

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
                        className="bg-[var(--acc-lt)] text-[var(--ink)] px-3.5 py-2.5 rounded-[15px_15px_4px_15px] max-w-[76%]"
                        style={{ fontFamily: "var(--font-serif)", fontSize: 16, lineHeight: 1.5 }}
                      >
                        {userContent}
                      </div>
                    </div>
                  )}

                  {assistantContent && !isRecommendTurn && (
                    <p
                      className="text-[var(--ink)] m-0 max-w-[56ch]"
                      style={{ fontFamily: "var(--font-serif)", fontSize: 16.5, lineHeight: 1.62 }}
                    >
                      {assistantContent}
                    </p>
                  )}

                  {!inReplay && isLastEntry && waitingForOpeningReply && (
                    <div className="flex gap-1.5 flex-wrap mt-4">
                      {STARTER_PROMPTS.map((p) => (
                        <button
                          key={p}
                          onClick={() => send(p)}
                          disabled={loading}
                          className="rounded-full border border-[var(--line)] bg-[var(--block)] px-3.5 py-2 text-[13px] font-medium text-[var(--ink2)] disabled:opacity-50 hover:border-[var(--acc)] hover:text-[var(--acc)] transition-colors"
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  )}

                  {!inReplay && isLastEntry && entry.askingFaceShape && waitingForFaceShapeReply && (
                    <FaceShapePicker selected={selectedFaceShape} onSelect={selectFaceShape} disabled={loading} />
                  )}

                  {/* Answer pills (decisions.md, 2026-09-04): a shortcut alongside the text
                      input for any topic with a fixed enum, never the only path -- the input
                      stays rendered below regardless. Keyed by turnIndex so toggle/dismiss
                      state resets cleanly on every new ask-turn instead of leaking forward. */}
                  {!inReplay && isLastEntry && entry.askedTopic && waitingForTopicReply && TOPIC_PILLS[entry.askedTopic] && (
                    <AnswerPills
                      key={entry.turnIndex}
                      topic={entry.askedTopic}
                      config={TOPIC_PILLS[entry.askedTopic]}
                      onSubmit={send}
                      disabled={loading}
                    />
                  )}

                  {isRecommendTurn && recommendation && (
                    <div>
                      {/* Product decision, not a formatting preference (decisions.md, 2026-09-02):
                          cards carry facts, prose carries judgement. framing opens (no frame
                          names/prices), cards follow, closing (practical starting point, any
                          assumption) comes after -- never a numbered list duplicating card specs. */}
                      <p
                        className="text-[var(--ink)] m-0 mb-4 max-w-[56ch] whitespace-pre-wrap"
                        style={{ fontFamily: "var(--font-serif)", fontSize: 16.5, lineHeight: 1.62 }}
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
                          className="text-[var(--ink)] m-0 mt-4 max-w-[56ch] whitespace-pre-wrap"
                          style={{ fontFamily: "var(--font-serif)", fontSize: 16.5, lineHeight: 1.62 }}
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
                  className="text-[var(--ink)] m-0 max-w-[56ch] whitespace-pre-wrap"
                  style={{ fontFamily: "var(--font-serif)", fontSize: 16.5, lineHeight: 1.62 }}
                >
                  {streamingText}
                  <span className="inline-block w-[2px] h-[17px] bg-[var(--ink)] ml-0.5 align-text-bottom animate-pulse" />
                </p>
              </div>
            )}

            {state.status === "safety_interrupt" && (
              <p className="text-[12.5px] mb-4" style={{ color: "var(--warn)" }}>
                Safety interrupt fired — sales flow paused, recommend continuing with an
                optometrist first.
              </p>
            )}

            {inReplay && replayScenario && !replayExhausted && (
              <button
                onClick={advanceReplay}
                className="rounded-full bg-[var(--ink)] text-[var(--shell)] px-4 py-2 text-[13px] font-medium mt-2"
              >
                Continue{replayNextUserLine ? `: "${replayNextUserLine}"` : ""} →
              </button>
            )}

            {inReplay && replayExhausted && (
              <button
                onClick={restartReplayPicker}
                className="rounded-full border border-[var(--ink)] text-[var(--ink)] px-4 py-2 text-[13px] font-medium mt-2"
              >
                ← Try a different recorded conversation
              </button>
            )}

            {/* Follow-up path (decisions.md, 2026-09-02): the input used to disappear once
                status="done", ending the conversation at the recommendation. Now it stays --
                a "done" conversation still accepts follow-ups ("does it come in tortoise?",
                "which would you pick?"), it just stops being a clarify/recommend cycle. Only
                a genuine hard stop (safety_interrupt) or the face-shape chip wait hides it.
                Composer redesign (decisions.md, 2026-09-04): controls live INSIDE a single
                bordered/rounded container -- the input itself is borderless, the Send button
                and a hint line sit in a row below it -- rather than a thin bordered input with
                a button beside it. */}
            {!inReplay &&
              (state.status === "in_progress" || state.status === "done") &&
              !waitingForFaceShapeReply && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    send(input);
                  }}
                  className="rounded-[16px] border border-[var(--line)] bg-[var(--block)] px-4 pt-3.5 pb-2.5 mt-2"
                >
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={state.status === "done" ? "Ask about these frames…" : "Type your reply…"}
                    className="w-full border-0 bg-transparent outline-none text-[var(--ink)] placeholder:text-[var(--ink3)] pb-2.5"
                    style={{ fontFamily: "var(--font-serif)", fontSize: 15.5 }}
                    disabled={loading}
                  />
                  <div className="flex items-center gap-2">
                    <small className="text-[11.5px] text-[var(--ink3)] mr-auto">
                      Type, or tap an option above
                    </small>
                    <button
                      type="submit"
                      disabled={loading}
                      className="rounded-[10px] bg-[var(--ink)] text-[var(--shell)] px-4 py-2 text-[13.5px] font-medium disabled:opacity-50"
                    >
                      {loading ? "…" : "Send"}
                    </button>
                  </div>
                </form>
              )}

            {error && (
              <p className="text-[13px] mt-2" style={{ color: "var(--warn)" }}>
                {error}
              </p>
            )}

            {/* Eval cards moved off this page entirely (decisions.md, 2026-09-03) -- one line,
                sized like body text, real numbers from the server-computed evalOneLiner prop
                (app/app/page.tsx reads the committed report JSON), linking to the full report. */}
            {state.status === "done" && !inReplay && (
              <p className="mt-5 pt-4 border-t border-[var(--line2)] text-[13px] leading-relaxed text-[var(--ink2)] max-w-[56ch]">
                <span className="font-semibold text-[var(--ink)]">Evaluated against a golden set.</span>{" "}
                {evalOneLiner.groundednessMin}–{evalOneLiner.groundednessMax}% of claims traceable to a
                source, {evalOneLiner.conversationPass}/{evalOneLiner.conversationTotal} conversation
                checks passing, {evalOneLiner.gapPass}/{evalOneLiner.gapTotal} unanswerable requests
                correctly refused.{" "}
                <Link href="/evals" className="text-[var(--acc)] font-medium border-b border-[var(--acc-lt)] no-underline">
                  Read the full evaluation report →
                </Link>
              </p>
            )}

            <div className="mt-6 pt-3 flex gap-4 flex-wrap text-[12.5px] text-[var(--ink3)]">
              <span>Ashutosh Edamadaka</span>
            </div>
          </section>

          {/* Live machinery panel (decisions.md, 2026-09-04): a recessed surface (--sunk,
              inset shadow) sticky alongside the chat -- what's in it is evidence, not code, so
              it's styled as a light panel of real cards, not a dark terminal log. Shows the
              CURRENT turn by default -- live while one is in flight, otherwise the latest
              completed entry -- with a stepper to walk back through history. Stacks below the
              chat, still fully visible (never hidden behind a toggle), under 1061px. */}
          <aside className="bg-[var(--sunk)] rounded-[14px] shadow-[var(--shadow-in)] p-4 min-[1061px]:sticky min-[1061px]:top-3.5 min-[1061px]:max-h-[calc(100vh-100px)] min-[1061px]:overflow-y-auto">
            <div className="px-0.5 pb-3">
              <h2 className="text-[13.5px] font-semibold text-[var(--ink)] m-0">How this is built</h2>
              {state.history.length > 0 && (
                <div className="flex items-center gap-2 mt-2.5">
                  <button
                    onClick={() => stepTurn(-1)}
                    disabled={stepperPrevDisabled}
                    className="w-6 h-6 rounded-full border border-[var(--line)] bg-[var(--block)] text-[var(--ink)] text-[12px] leading-none disabled:opacity-30"
                    aria-label="Previous turn"
                  >
                    ‹
                  </button>
                  <span className="text-[11.5px] text-[var(--ink3)] tabular-nums">
                    Turn {displayTurnNumber} of {totalKnownTurns}
                    {isLiveView && <span className="text-[var(--acc)]"> · live</span>}
                  </span>
                  <button
                    onClick={() => stepTurn(1)}
                    disabled={stepperNextDisabled}
                    className="w-6 h-6 rounded-full border border-[var(--line)] bg-[var(--block)] text-[var(--ink)] text-[12px] leading-none disabled:opacity-30"
                    aria-label="Next turn"
                  >
                    ›
                  </button>
                  {pinnedTurnIndex !== null && (
                    <button onClick={() => setPinnedTurnIndex(null)} className="text-[11px] underline text-[var(--acc)] ml-auto">
                      Jump to current
                    </button>
                  )}
                </div>
              )}
            </div>

            {isLiveView ? (
              <LiveMachineryPanel stages={liveStages} generating={loading} streamingText={streamingText} />
            ) : viewIndex >= 0 ? (
              <MachineryPanel entry={state.history[viewIndex]} cumulativeSlots={cumulativeSlotsAt(state.history, viewIndex, state.slots)} />
            ) : (
              <div className="text-[12.5px] text-[var(--ink3)] px-0.5">Nothing to show yet.</div>
            )}
          </aside>
        </div>
      ) : (
        <div className="px-4 py-8 min-[600px]:px-8">
          <h1 className="text-[24px] leading-tight text-[var(--ink)] tracking-tight m-0" style={{ fontFamily: "var(--font-serif)", fontWeight: 500 }}>
            A fitting conversation
          </h1>
          <p className="text-[13.5px] leading-relaxed text-[var(--ink2)] mt-1.5 mb-6 max-w-[52ch]">
            Recommends eyewear the way an optician would — by asking first. The catalog is
            synthetic; the optical guidance it cites is not.
          </p>

          {inReplay && (
            <div className="mb-5 max-w-[560px] rounded-[10px] border px-3.5 py-2.5 text-[12.8px]" style={{ borderColor: "var(--warn)", background: "var(--warn-lt)", color: "var(--warn)" }}>
              <strong>Replaying a recorded conversation.</strong> The live model isn&apos;t
              available right now ({FALLBACK_REASON_LABELS[fallbackReason ?? ""] ?? "the live call failed"}).
            </div>
          )}

          {!started && !inReplay && (
            <button onClick={start} className="rounded-full bg-[var(--ink)] text-[var(--shell)] px-4 py-2.5 text-[13.5px] font-medium">
              Start
            </button>
          )}

          {inReplay && !replayScenario && (
            <div className="space-y-2 max-w-[560px]">
              <p className="text-[13px] text-[var(--ink2)] mb-2">Pick a recorded conversation to replay:</p>
              {REPLAY_SCENARIOS.map((fixture) => (
                <button
                  key={fixture.id}
                  onClick={() => chooseReplayScenario(fixture)}
                  className="block w-full text-left rounded-[12px] border border-[var(--line)] bg-[var(--block)] px-3.5 py-2.5 hover:border-[var(--acc)] transition-colors"
                >
                  <div className="text-[13.5px] font-medium text-[var(--ink)]">{fixture.label}</div>
                  <div className="text-[12px] text-[var(--ink3)] mt-0.5">{fixture.description}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
