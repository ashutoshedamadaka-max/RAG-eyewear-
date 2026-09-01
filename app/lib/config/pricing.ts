// Phase 7 (interface): cost instrumentation for the machinery panel's
// "what it cost" stage. Token COUNTS are always real, read directly off
// each OpenAI response's `usage` field (app/lib/conversation/converse.ts,
// extract-turn.ts) -- never estimated. The per-token RATE is a different
// matter and is honestly labeled as such below.
//
// text-embedding-3-small's rate is OpenAI's real published price
// ($0.02 / 1M tokens, unchanged since its 2024 release). CHAT_MODEL
// ("gpt-5.6-luna", app/lib/config/model.ts) is this project's own
// placeholder for a model with no public price list -- there is nothing
// real to look up. The rate below is an ILLUSTRATIVE assumption, modeled
// on real current-generation chat-model API pricing, used only to
// demonstrate that the cost-instrumentation mechanism works end-to-end
// (real token counts -> a real-shaped cost figure). It is not a claim
// about actual billing, and the UI says so next to the number rather
// than presenting it as fact -- see decisions.md for the write-up note
// this distinction needs.
export const USD_TO_INR = 83; // approximate, not live-updated -- a demo needs a fixed rate, not a currency API

export const PRICING = {
  chatModel: {
    inputPerMTokUsd: 2.5, // illustrative -- see file header
    outputPerMTokUsd: 10, // illustrative -- see file header
  },
  embeddingModel: {
    perMTokUsd: 0.02, // real, OpenAI's published text-embedding-3-small rate
  },
};

export function costUsd(promptTokens: number, completionTokens: number, kind: "chat" | "embedding"): number {
  if (kind === "embedding") {
    return (promptTokens / 1_000_000) * PRICING.embeddingModel.perMTokUsd;
  }
  return (
    (promptTokens / 1_000_000) * PRICING.chatModel.inputPerMTokUsd +
    (completionTokens / 1_000_000) * PRICING.chatModel.outputPerMTokUsd
  );
}

export function costInr(promptTokens: number, completionTokens: number, kind: "chat" | "embedding"): number {
  return costUsd(promptTokens, completionTokens, kind) * USD_TO_INR;
}
