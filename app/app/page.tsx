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
import { MachineryToggle } from "@/components/MachineryPanel";
import EvalSection from "@/components/EvalSection";
import { parseFrameBlurb } from "@/components/conversation-types";
import type { ConversationState, TurnResult, Slots, RecommendedFrame } from "@/components/conversation-types";

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

  function applyTurnResult(result: TurnResult) {
    setState(result.state);
    if (result.recommendation) setRecommendation(result.recommendation);
  }

  async function post(message?: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, message }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const body = await res.json();
      if (body && body.fallback) {
        setFallbackReason(body.reason ?? "upstream_error");
        setStarted(true);
        return;
      }
      applyTurnResult(body as TurnResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
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

      <main className="max-w-[800px] mx-auto px-6 pt-6">
        {inReplay && (
          <div className="mb-5 rounded-md border border-[#E3C989] bg-[#FBF3DF] px-3.5 py-2.5 text-[12.8px] text-[#6B4E14]">
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
          <div className="space-y-2">
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
          <div>
            {state.history.map((entry, i) => {
              const isOpening = i === 0;
              const userContent = isOpening ? undefined : turns[2 * i - 1]?.content;
              const assistantContent = isOpening ? turns[0]?.content : turns[2 * i]?.content;
              const cumulative = cumulativeSlotsAt(state.history, i, state.slots);
              const isFinalRecommendTurn = Boolean(entry.recommendation) && i === state.history.length - 1 && state.status === "done";
              const isLastEntry = i === state.history.length - 1;
              // "Show how this was built" only where there's something to see: the
              // recommendation turn, or any turn where a rule fired or an assumption
              // was made (decisions.md, 2026-09-02) -- not every plain question turn.
              const hasMachineryToShow = Boolean(entry.recommendation) || entry.derivedFacts.length > 0 || entry.assumptions.length > 0;

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

                  {assistantContent && !isFinalRecommendTurn && (
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

                  {isFinalRecommendTurn && recommendation && (
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
                        const isConvention = f.reasons.some((r) => r.ruleId === "face_shape_boost" || r.ruleId === "style_prefs_overlap");
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

                  {hasMachineryToShow && <MachineryToggle entry={entry} cumulativeSlots={cumulative} />}
                </div>
              );
            })}

            {state.status === "safety_interrupt" && (
              <p className="text-[12.5px] text-[#8A5A0B] mb-4">
                Safety interrupt fired — sales flow paused, recommend continuing with an
                optometrist first.
              </p>
            )}

            {state.status === "done" && !inReplay && (
              <div className="mt-8">
                <div className="text-[13.5px] font-semibold text-[#14201C] mb-2.5">
                  How this is evaluated
                </div>
                <EvalSection />
              </div>
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

            {!inReplay &&
              state.status !== "done" &&
              state.status !== "safety_interrupt" &&
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
                    placeholder="Type your reply..."
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
