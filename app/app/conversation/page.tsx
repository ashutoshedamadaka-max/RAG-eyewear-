"use client";

// Phase 7 (interface): the real /conversation UI, wired to the live
// pipeline -- no mock data. Built from the pasted React mock as a VISUAL
// SPEC (colors, type hierarchy, layout patterns, the six-stage machinery
// panel), not copied as code: every number on this page is either read
// straight off a live API response or computed client-side from that
// response's own fields, per the explicit "never hardcoded" requirement
// (decisions.md 2026-09-01).
//
// Kept as a separate route from the root page rather than replacing it --
// the root page is Phase 1's deliberately-naive baseline, kept intact as
// the case study's "here's the failure we're measuring against" evidence.
import { useState } from "react";
import { Newsreader, Instrument_Sans, IBM_Plex_Mono } from "next/font/google";
import FaceShapePicker from "@/components/FaceShapePicker";
import RecommendationCard from "@/components/RecommendationCard";
import { MachineryToggle } from "@/components/MachineryPanel";
import EvalSection from "@/components/EvalSection";
import { parseFrameBlurb } from "@/components/conversation-types";
import type { ConversationState, TurnResult, Slots, RecommendedFrame } from "@/components/conversation-types";

const serif = Newsreader({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-serif" });
const sans = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400"], variable: "--font-mono" });

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
      const result: TurnResult = await res.json();
      setState(result.state);
      if (result.recommendation) setRecommendation(result.recommendation);
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

  const turns = state?.turns ?? [];
  const waitingForFaceShapeReply = state?.status === "in_progress" && turns.length === 1;
  const recommendedFrames: (RecommendedFrame & { parsed: ReturnType<typeof parseFrameBlurb> })[] =
    (recommendation?.frames ?? []).map((f) => ({ ...f, parsed: parseFrameBlurb(f.frame_id, f.text) }));

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
        {!started && (
          <button
            onClick={start}
            className="rounded-md bg-[#14201C] text-white px-4 py-2 text-[13px] font-medium"
          >
            Start
          </button>
        )}

        {started && state && (
          <div>
            {state.history.map((entry, i) => {
              const isOpening = i === 0;
              const userContent = isOpening ? undefined : turns[2 * i - 1]?.content;
              const assistantContent = isOpening ? turns[0]?.content : turns[2 * i]?.content;
              const cumulative = cumulativeSlotsAt(state.history, i, state.slots);
              const isFinalRecommendTurn = Boolean(entry.recommendation) && i === state.history.length - 1 && state.status === "done";

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

                  {isOpening && waitingForFaceShapeReply && (
                    <FaceShapePicker selected={selectedFaceShape} onSelect={selectFaceShape} disabled={loading} />
                  )}

                  {isFinalRecommendTurn && (
                    <div>
                      <p
                        className="text-[#14201C] m-0 mb-4 max-w-[62ch] whitespace-pre-wrap"
                        style={{ fontFamily: "var(--font-serif)", fontSize: 16, lineHeight: 1.65 }}
                      >
                        {assistantContent}
                      </p>
                      {recommendedFrames.map((f) => {
                        if (!f.parsed) return null;
                        const primaryReason = f.reasons[0];
                        const isConvention = f.reasons.some((r) => r.ruleId === "face_shape_boost" || r.ruleId === "style_prefs_overlap");
                        return (
                          <RecommendationCard
                            key={f.frame_id}
                            frame={f.parsed}
                            gloss={primaryReason?.explanation}
                            claimType={isConvention ? "convention" : undefined}
                            droppedClause={f.droppedClause}
                          />
                        );
                      })}
                    </div>
                  )}

                  <MachineryToggle entry={entry} cumulativeSlots={cumulative} />
                </div>
              );
            })}

            {state.status === "safety_interrupt" && (
              <p className="text-[12.5px] text-[#8A5A0B] mb-4">
                Safety interrupt fired — sales flow paused, recommend continuing with an
                optometrist first.
              </p>
            )}

            {state.status === "done" && (
              <div className="mt-8">
                <div className="text-[13.5px] font-semibold text-[#14201C] mb-2.5">
                  How this is evaluated
                </div>
                <EvalSection />
              </div>
            )}

            {state.status !== "done" &&
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
                    className="flex-1 rounded-md border border-[#DFE6E2] bg-[#FDFEFD] px-3 py-2 text-[14px]"
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
        </footer>
      </main>
    </div>
  );
}
