import { NextResponse } from "next/server";
import { runTurn } from "@/lib/conversation/converse";
import { emptyState, type ConversationState } from "@/lib/conversation/types";
import { checkRateLimit, clientIdFor } from "@/lib/rate-limit";

// Phase 5: turn-based conversation endpoint. Deliberately stateless on the
// server -- no session store, no DB. The client holds `state` (plain JSON,
// round-trips exactly) and sends it back each turn; this route is a pure
// function of (state, message) -> (state', message). Simplest thing that
// satisfies "partial update each turn, never the whole state" without
// adding session infrastructure this demo doesn't need (same "don't add
// infra the scale doesn't need" judgment call as the in-memory vector
// store and node:sqlite elsewhere in this project).
//
// Deployment readiness (decisions.md, 2026-09-02): three conditions -- the
// per-IP cap firing, no API key configured, or the live call itself
// erroring/rate-limiting upstream -- all return the SAME `{ fallback: true,
// reason }` shape instead of a 4xx/5xx. The client (app/conversation/page.tsx)
// switches into a labelled "replaying a recorded conversation" mode on
// this signal rather than showing an error page -- a broken-looking demo
// is worse than an honestly-labelled recorded one.
export async function POST(req: Request) {
  const body = (await req.json()) as { state?: ConversationState; message?: string };
  const state = body.state ?? emptyState();

  const rateLimit = checkRateLimit(clientIdFor(req));
  if (!rateLimit.allowed) {
    return NextResponse.json({ fallback: true, reason: "rate_limited_local" });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ fallback: true, reason: "missing_api_key" });
  }

  try {
    const result = await runTurn(state, body.message);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/conversation] live pipeline failed, falling back to replay:", err);
    return NextResponse.json({ fallback: true, reason: classifyOpenAIError(err) });
  }
}

function classifyOpenAIError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/429|rate.?limit/i.test(message)) return "upstream_rate_limited";
  if (/401|invalid api key|incorrect api key|authentication/i.test(message)) return "invalid_api_key";
  return "upstream_error";
}
