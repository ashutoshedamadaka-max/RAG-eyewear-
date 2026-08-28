// Shared by every pipeline so the Phase 3 A/B isolates the retrieval
// mechanism (vector similarity vs. SQL) as the only variable -- both
// pipelines must use the identical chat model and temperature, or a
// difference in results could be attributed to the wrong cause.
// See decisions.md 2026-08-28 for the model-selection rationale.
export const CHAT_MODEL = "gpt-5.6-luna";
export const CHAT_TEMPERATURE = 1;
