// v2.7 — thin dispatch layer between the app and its two AI backends.
//
// Every component used to import summary/flashcard/Q&A/OCR functions
// straight from openai.js. They now import the same-named functions from
// here instead: this module reads the user's provider choice out of
// localStorage and forwards the call to openai.js or gemini.js, which keep
// matching signatures and return shapes so neither caller nor result differs
// between providers.
import {
  getApiKey, getAIProvider, saveAIProvider, getGeminiApiKey, saveGeminiApiKey, clearGeminiApiKey,
  getAIStatus, saveAIStatus, clearAIStatus
} from './storage.js'
import * as openai from './openai.js'
import * as gemini from './gemini.js'

const LOG = '[NeuroNote:AIProvider]'

export {
  getAIProvider, saveAIProvider, getGeminiApiKey, saveGeminiApiKey, clearGeminiApiKey,
  getAIStatus, clearAIStatus
}

/** Whether the currently selected provider has a key saved — the gate every
 *  call site used to check with `getApiKey('openai')`. */
export function hasActiveApiKey() {
  return getAIProvider() === 'gemini' ? !!getGeminiApiKey() : !!getApiKey('openai')
}

function backend() {
  return getAIProvider() === 'gemini' ? gemini : openai
}

// v2.7.2 — turns a raw error message ("OpenAI API error (400): {...}") into
// the short inline reason the STATUS card shows, e.g. "400 invalid request".
function shortenReason(message) {
  if (!message) return 'request failed'
  const codeMatch = message.match(/\((\d{3})\)/)
  const code = codeMatch?.[1]
  let desc
  if (code === '400') desc = 'invalid request'
  else if (code === '401' || code === '403') desc = 'invalid key'
  else if (code === '429') desc = 'rate limited'
  else if (code?.[0] === '5') desc = 'server error'
  else desc = message.slice(0, 60)
  return code ? `${code} ${desc}` : desc
}

/**
 * v2.7.2 — wraps a dispatched call so the SYSTEM tab's API STATUS reflects
 * the outcome of the most recent AI call instead of just "a key exists".
 * `usesLocalFallback` is true only for generateSummary, the one function
 * whose caller substitutes the local extractive engine on failure — every
 * other function just comes back empty, so its failure is a plain ERROR.
 */
async function withStatusTracking(provider, fnName, usesLocalFallback, fn) {
  try {
    const result = await fn()
    saveAIStatus(provider, { ok: true, fallback: false, reason: null, timestamp: Date.now() })
    return result
  } catch (err) {
    console.error(`${LOG} ${fnName} failed via ${provider}:`, err.message)
    saveAIStatus(provider, {
      ok: false,
      fallback: usesLocalFallback,
      reason: shortenReason(err.message),
      timestamp: Date.now()
    })
    throw err
  }
}

export async function generateSummary(transcript, model) {
  const provider = getAIProvider()
  console.log(`${LOG} generateSummary via ${provider}`)
  return withStatusTracking(provider, 'generateSummary', true, () => backend().generateSummary(transcript, model))
}

export async function generateFlashcards(transcript) {
  const provider = getAIProvider()
  console.log(`${LOG} generateFlashcards via ${provider}`)
  return withStatusTracking(provider, 'generateFlashcards', false, () => backend().generateFlashcards(transcript))
}

export async function detectActionItems(partialTranscript) {
  const provider = getAIProvider()
  console.log(`${LOG} detectActionItems via ${provider}`)
  return withStatusTracking(provider, 'detectActionItems', false, () => backend().detectActionItems(partialTranscript))
}

export async function extractImageText(base64Image, model) {
  const provider = getAIProvider()
  console.log(`${LOG} extractImageText via ${provider}`)
  return withStatusTracking(provider, 'extractImageText', false, () => backend().extractImageText(base64Image, model))
}

export async function generateEmbedding(text) {
  const provider = getAIProvider()
  console.log(`${LOG} generateEmbedding via ${provider}`)
  return withStatusTracking(provider, 'generateEmbedding', false, () => backend().generateEmbedding(text))
}

export async function generateAnswer(question, contextChunks, conversationHistory = []) {
  const provider = getAIProvider()
  console.log(`${LOG} generateAnswer via ${provider}`)
  return withStatusTracking(provider, 'generateAnswer', false, () => backend().generateAnswer(question, contextChunks, conversationHistory))
}

export async function gradeAnswer(question, correctAnswer, userAnswer) {
  const provider = getAIProvider()
  console.log(`${LOG} gradeAnswer via ${provider}`)
  return withStatusTracking(provider, 'gradeAnswer', false, () => backend().gradeAnswer(question, correctAnswer, userAnswer))
}
