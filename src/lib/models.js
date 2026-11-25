// Map NeuroNote tiers to real OpenAI model identifiers.
// v2.8 — moved from the GPT-5.6 family to the GPT-6 family (ids confirmed
// against developers.openai.com/api/docs/models on 2026-11-24).
// Terra (default) → gpt-6.1-terra — fast, capable, cost-effective
// Luna (cheap/fast) → gpt-6-luna — cheapest, used for flashcards/live actions
// Sol (flagship) → gpt-6.2-sol — best quality for high-stakes sessions
// Mirrors the OPENAI_MODELS constant in openai.js (kept separate to avoid a
// circular import — openai.js already imports MODEL_COSTS from this file).
export const MODEL_TERRA = 'gpt-6.1-terra'
export const MODEL_LUNA = 'gpt-6-luna'
export const MODEL_SOL = 'gpt-6.2-sol'
export const EMBEDDING_MODEL = 'text-embedding-3-small'

// v2.7 — Google Gemini, the alternative AI provider. One model covers every
// task (summary/flashcards/live actions/vision/Q&A); Gemini has no separate
// "flagship" tier the way OpenAI's Sol does, so Flagship Mode stays OpenAI-only.
// v2.7.1 — the previous Flash Experimental model was shut down June 1, 2026;
// this mirrors the GEMINI_MODEL constant in gemini.js (kept separate to
// avoid a circular import — gemini.js already imports MODEL_COSTS from this
// file).
// v2.8 — Gemini 4 Hydrogen (GA 2026-11-12) is the current everyday model and
// is on the free tier. text-embedding-004 was shut down on 2026-01-14; its
// replacement is gemini-embedding-2. The constant keeps its FLASH name so the
// rest of the app does not have to change.
export const GEMINI_MODEL_FLASH = 'gemini-4-hydrogen'
export const GEMINI_EMBEDDING_MODEL = 'gemini-embedding-2'
// gemini-embedding-2 defaults to 3072 dimensions. Embeddings live in
// localStorage, so the app asks for 768 — a size Google recommends, and the
// one the retired model produced.
export const GEMINI_EMBEDDING_DIMENSIONS = 768

// Blended estimates in dollars per 1K tokens, assuming roughly three input
// tokens for every output token (a transcript in, a summary out). From the
// list prices: Terra $1/$5, Sol $2/$10, Luna $0.10/$0.50 per 1M in/out.
export const MODEL_COSTS = {
  [MODEL_TERRA]: 0.002,
  [MODEL_SOL]: 0.004,
  [MODEL_LUNA]: 0.0002,
  [EMBEDDING_MODEL]: 0.00002,
  // Gemini's free tier has no per-token bill — tracked at $0 so Usage still
  // logs a row per call instead of silently skipping Gemini activity.
  [GEMINI_MODEL_FLASH]: 0,
  [GEMINI_EMBEDDING_MODEL]: 0
}

// Display names for the UI
export const MODEL_DISPLAY = {
  [MODEL_TERRA]: 'GPT-6.1 Terra',
  [MODEL_SOL]: 'GPT-6.2 Sol',
  [MODEL_LUNA]: 'GPT-6 Luna',
  [GEMINI_MODEL_FLASH]: 'Gemini 4 Hydrogen'
}

export function getActiveModel(settings) {
  return settings?.flagshipMode ? MODEL_SOL : MODEL_TERRA
}

export function getDisplayName(settings) {
  return settings?.flagshipMode ? MODEL_DISPLAY[MODEL_SOL] : MODEL_DISPLAY[MODEL_TERRA]
}

// v2.7 — the STATUS card's MODEL line, provider-aware. OpenAI keeps its
// existing Terra/Sol display; Gemini always shows the one Flash model.
export function getProviderDisplayName(provider, settings) {
  return provider === 'gemini' ? MODEL_DISPLAY[GEMINI_MODEL_FLASH] : getDisplayName(settings)
}

export function estimateSessionCost(model) {
  if (model === MODEL_SOL) return 0.27
  return 0.20
}
