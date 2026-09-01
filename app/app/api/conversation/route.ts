import { NextResponse } from "next/server";
import { runTurn } from "@/lib/conversation/converse";
import { emptyState, type ConversationState } from "@/lib/conversation/types";

// Phase 5: turn-based conversation endpoint. Deliberately stateless on the
// server -- no session store, no DB. The client holds `state` (plain JSON,
// round-trips exactly) and sends it back each turn; this route is a pure
// function of (state, message) -> (state', message). Simplest thing that
// satisfies "partial update each turn, never the whole state" without
// adding session infrastructure this demo doesn't need (same "don't add
// infra the scale doesn't need" judgment call as the in-memory vector
// store and node:sqlite elsewhere in this project).
export async function POST(req: Request) {
  const body = (await req.json()) as { state?: ConversationState; message?: string };

  const state = body.state ?? emptyState();
  const result = await runTurn(state, body.message);

  return NextResponse.json(result);
}
