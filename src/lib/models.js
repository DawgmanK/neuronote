// Map NeuroNote tiers to real OpenAI model identifiers
// Terra (default) → gpt-4o  — fast, capable, cost-effective
// Luna (cheap/fast) → gpt-4o-mini — cheapest, used for flashcards/live actions
// Sol (flagship) → o3 — best quality for high-stakes sessions
export const MODEL_TERRA = 'gpt-4o'
export const MODEL_LUNA = 'gpt-4o-mini'
export const MODEL_SOL = 'o3'
export const EMBEDDING_MODEL = 'text-embedding-3-small'

export const MODEL_COSTS = {
  [MODEL_TERRA]: 0.005,
  [MODEL_SOL]: 0.015,
  [MODEL_LUNA]: 0.00015,
  [EMBEDDING_MODEL]: 0.00002
}

// Display names for the UI
export const MODEL_DISPLAY = {
  [MODEL_TERRA]: 'TERRA (GPT-4o)',
  [MODEL_SOL]: 'SOL (o3)',
  [MODEL_LUNA]: 'LUNA (GPT-4o-mini)'
}

export function getActiveModel(settings) {
  return settings?.flagshipMode ? MODEL_SOL : MODEL_TERRA
}

export function getDisplayName(settings) {
  return settings?.flagshipMode ? MODEL_DISPLAY[MODEL_SOL] : MODEL_DISPLAY[MODEL_TERRA]
}

export function estimateSessionCost(model) {
  if (model === MODEL_SOL) return 0.27
  return 0.20
}
