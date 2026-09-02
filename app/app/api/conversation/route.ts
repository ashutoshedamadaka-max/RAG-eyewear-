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
// erroring/rate-limiting upstream -- all send the SAME `fallback` SSE
// event instead of a 4xx/5xx. The client switches into a labelled
// "replaying a recorded conversation" mode on this signal rather than
// showing an error page -- a broken-looking demo is worse than an
// honestly-labelled recorded one.
//
// Real streaming (decisions.md, 2026-09-02): this route now returns a
// Server-Sent Events stream, not a single JSON blob -- `delta` events
// carry real text chunks as runTurn's onDelta callback fires (genuine
// reduced perceived latency, not a client-side animation replayed after
// the full response already arrived), `stage` events carry the live
// machinery panel's progress (onStage -- slots merged, rules derived, SQL
// run, advice retrieved, each fired at the moment that real computation
// actually finished, not synthesized), and one final `done` event carries
// the complete, authoritative TurnResult, identical in shape to what this
// route always returned. A client that doesn't care about deltas/stages
// can ignore both and just wait for `done` -- nothing about the final
// payload changed, only how it arrives.
function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: Request) {
  const body = (await req.json()) as { state?: ConversationState; message?: string };
  const state = body.state ?? emptyState();

  const rateLimit = checkRateLimit(clientIdFor(req));
  const encoder = new TextEncoder();

  if (!rateLimit.allowed) {
    return sseResponse(sseEvent("fallback", { fallback: true, reason: "rate_limited_local" }));
  }
  if (!process.env.OPENAI_API_KEY) {
    return sseResponse(sseEvent("fallback", { fallback: true, reason: "missing_api_key" }));
  }

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const enqueue = (chunk: string) => {
        if (closed) return;
        controller.enqueue(encoder.encode(chunk));
      };
      try {
        const result = await runTurn(
          state,
          body.message,
          undefined,
          undefined,
          (text) => enqueue(sseEvent("delta", { text })),
          (stage, data) => enqueue(sseEvent("stage", { stage, data }))
        );
        enqueue(sseEvent("done", result));
      } catch (err) {
        console.error("[api/conversation] live pipeline failed, falling back to replay:", err);
        enqueue(sseEvent("fallback", { fallback: true, reason: classifyOpenAIError(err) }));
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/** A one-shot "stream" carrying a single event -- used for the two fallback paths that fire before runTurn is ever called, so they still speak the same protocol the client's SSE parser expects rather than needing a second response shape. */
function sseResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function classifyOpenAIError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/429|rate.?limit/i.test(message)) return "upstream_rate_limited";
  if (/401|invalid api key|incorrect api key|authentication/i.test(message)) return "invalid_api_key";
  return "upstream_error";
}
