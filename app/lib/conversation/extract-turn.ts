// Phase 5: turn-by-turn STATED extraction. One LLM call per user turn,
// scoped to "what did THIS message add," never "re-derive the whole
// state" -- the partial-update contract (PROJECT_CONTEXT.md §3) has to be
// enforced here, at the only place new STATED values are minted, or it
// can't be enforced anywhere downstream.
import OpenAI from "openai";
import type { ChatCompletionTool, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { CHAT_MODEL, CHAT_TEMPERATURE } from "../config/model";
import { PRODUCT_TYPES, PURPOSE_TAGS, FIT_ISSUES, LENS_TYPES, STYLE_PREFS } from "./types";
import type { PartialSlots, SafetyFlag, Slots, Turn } from "./types";

const SYSTEM_PROMPT = `You extract what a customer's LATEST message adds to an eyewear-shopping conversation. Only report fields that message actually addresses -- do not restate, re-infer, or re-guess fields already known from earlier turns (they're listed below so you have context, not so you re-emit them). An empty/near-empty result is correct and expected when the message is small talk or doesn't add new information.

The customer is never expected to know eyewear vocabulary. They describe their situation in plain language; you map it to the structured fields:
- fit_issues: map free-text symptom descriptions to the enum -- "sliding down my nose" -> slipping, "feels tight at the sides" or "splays out" -> splaying/pressing (infer direction from their words), "leaves marks" -> marks, "feels heavy" or "I want something light" -> heavy, "the frame catches my cheeks when I smile" -> cheekbone_contact.
- purpose: map activities/situations to tags (sports, outdoor, everyday, computer, driving_day, driving_night, formal_work, reading, dust_travel) -- do not invent a tag their words don't support.
- product_type has no question of its own -- it's inferred from the purpose answer, since asking both separately would be redundant. If the answer clearly implies one (sunglasses -> sunglasses, reading-only -> reading, computer-only -> computer, sports -> sports), set product_type too. Default to eyeglasses only when the answer describes ordinary vision correction (everyday wear, formal work, general purpose) with no sunglasses/reading-only/computer-only/sports signal.
- rx_power: only set this if they state an actual number (e.g. "-3.50", "minus four"). If they say they don't know or aren't sure, set rx_status to "unknown", not a guessed rx_power.
- lens_type: "I need help seeing both far and up close" -> progressive. "just for reading" -> reading. "just one distance" -> single.
- face_shape: this is asked as tappable options at the very start of the conversation, with a "skip / not sure" choice always available. If they name a shape (oval, round, square, heart, rectangle), set it. If they skip, say they don't know, or say anything equivalent to "not sure" in reply to that opener, set face_shape to "unsure" explicitly -- do not leave it unset, since "unset" and "asked and declined" need to look different to the rest of the system.
- budget: approximate language ("around", "about", "roughly", "somewhere near", "-ish") means the number is not a hard boundary -- set BOTH budget_min and budget_max as a range roughly 15-20% below and above the stated figure (e.g. "around ₹3000" -> budget_min≈2500-2600, budget_max≈3400-3500), not budget_min=budget_max=3000. A bare ceiling ("under ₹3000", "up to ₹3000", "keep it under ₹3000", or just a plain number with no qualifier, e.g. "₹3000") means only a maximum was stated -- set budget_max only, leave budget_min unset entirely. Only set an exact budget_min when the customer states a genuine floor ("between ₹2000 and ₹3000", "at least ₹2000", "₹2000 to ₹3000") -- in that case use their exact stated numbers, not a computed range.

safety_flag is independent of everything else and must be checked on every turn regardless of what question is pending: set "vision_symptom" for anything describing a physical eye/vision symptom (pain, floaters, sudden vision change, flashes of light, double vision), "medical_question" for asking whether glasses/a product will treat or fix a medical condition (astigmatism, an eye disease, "will these fix X"). Otherwise "none". Do not skip this check just because the conversation was about frame shopping.

off_topic is also independent and also checked every turn: set it true when the message doesn't engage with the shopping conversation at all -- a joke, small talk ("how's your day"), a question about the assistant itself ("are you an AI", "who made you"), testing/poking at the bot, a fully unrelated tangent. Do NOT set it true for a real (even unhelpful) attempt to answer whatever's pending -- "not sure", "I don't know", "skip that", "none of those" are on-topic non-answers, not off_topic. A message can be off_topic AND still contain no other fields -- that's the expected shape for it.`;

const EXTRACTION_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "extract_turn",
    description: "Structured partial update: only the slots this turn's message actually addressed.",
    parameters: {
      type: "object",
      properties: {
        product_type: { type: "string", enum: PRODUCT_TYPES },
        // Enum added 2026-09-04 (previously free-form array, constrained only by the prose
        // tag list above) -- now the answer-pills feature needed a real, importable list of
        // valid values, and a schema without one was never actually enforcing "do not invent
        // a tag" at the API level, only asking nicely for it in prose.
        purpose: { type: "array", items: { type: "string", enum: PURPOSE_TAGS } },
        screen_hours: { type: "number" },
        rx_status: { type: "string", enum: ["none", "has_rx", "unknown"] },
        rx_power: { type: "number" },
        lens_type: { type: "string", enum: LENS_TYPES },
        reading_power: { type: "number" },
        fit_issues: {
          type: "array",
          items: { type: "string", enum: FIT_ISSUES },
        },
        budget_min: { type: "number" },
        budget_max: { type: "number" },
        face_shape: { type: "string", enum: ["oval", "round", "square", "heart", "rectangle", "unsure"] },
        style_prefs: {
          type: "array",
          items: { type: "string", enum: STYLE_PREFS },
        },
        nose_profile: { type: "string", enum: ["flat", "prominent"] },
        eye_spacing: { type: "string", enum: ["close_set", "wide_set"] },
        face_length_ratio: { type: "string", enum: ["long", "typical"] },
        safety_flag: { type: "string", enum: ["vision_symptom", "medical_question", "none"] },
        off_topic: {
          type: "boolean",
          description:
            "True ONLY when the message doesn't engage with the shopping conversation at all -- a joke, small talk, a question about the assistant itself, testing the bot, a completely unrelated tangent. FALSE for a genuine (even unhelpful) attempt to engage: \"not sure\", \"I don't know\", \"skip that\", a vague or incomplete answer to what was just asked are all on-topic, not off_topic -- they're real answers, just not informative ones. When in doubt, false.",
        },
      },
      required: ["safety_flag"],
      additionalProperties: false,
    },
  },
};

function summarizeKnownSlots(slots: Slots): string {
  const known = Object.entries(slots)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${JSON.stringify((v as { value: unknown }).value)}`);
  return known.length > 0 ? known.join(", ") : "(nothing known yet)";
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

interface ExtractedTurn {
  partial: PartialSlots;
  safetyFlag: SafetyFlag;
  offTopic: boolean;
  usage: TokenUsage;
}

/**
 * gpt-5.6-luna requires reasoning_effort: "none" for tool calls (same
 * constraint as extract-filter.ts). Runs at CHAT_TEMPERATURE (the model
 * rejects temperature=0), so re-running the identical turn can extract
 * slightly differently -- acceptable here since this is a live
 * conversation, not a graded judge; the golden-set runner (Phase 5) checks
 * the resulting slot VALUES and SOURCES, not that this call is
 * deterministic.
 */
export async function extractTurn(
  client: OpenAI,
  history: Turn[],
  latestUserMessage: string,
  knownSlots: Slots
): Promise<ExtractedTurn> {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: `Already known: ${summarizeKnownSlots(knownSlots)}` },
    ...history.map((t): ChatCompletionMessageParam => ({ role: t.role, content: t.content })),
    { role: "user", content: latestUserMessage },
  ];

  const response = await client.chat.completions.create({
    model: CHAT_MODEL,
    temperature: CHAT_TEMPERATURE,
    reasoning_effort: "none",
    messages,
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: "function", function: { name: "extract_turn" } },
  });

  // Real usage, read off the response -- never estimated (decisions.md 2026-09-01, cost
  // instrumentation). Captured before the early-return branches so every call path reports it.
  const usage: TokenUsage = {
    promptTokens: response.usage?.prompt_tokens ?? 0,
    completionTokens: response.usage?.completion_tokens ?? 0,
  };

  const call = response.choices[0]?.message?.tool_calls?.[0];
  if (!call || call.type !== "function") return { partial: {}, safetyFlag: "none", offTopic: false, usage };

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(call.function.arguments);
  } catch {
    return { partial: {}, safetyFlag: "none", offTopic: false, usage };
  }

  const { safety_flag, off_topic, ...rest } = raw;
  const partial: PartialSlots = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined || value === null) continue;
    (partial as Record<string, unknown>)[key] = { value, source: "stated", confidence: 1.0 };
  }

  return { partial, safetyFlag: (safety_flag as SafetyFlag) ?? "none", offTopic: off_topic === true, usage };
}
