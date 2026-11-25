// v2.8.2 — one place that turns a transcript into a summary, and says how.
//
// Until now three call sites (the recorder, crash recovery, file upload) each
// called the AI and, on any failure or with no key saved, quietly swapped in
// the on-device sentence-picker. The note looked the same either way, so a
// rough stand-in summary was indistinguishable from a real one — and there was
// no way to try again. Every summary now carries where it came from, and the
// same function powers "Redo summary" on a note.
import { generateSummary, hasActiveApiKey, getAIProvider } from './ai-provider.js'
import { extractSummary } from './extractive.js'
import { getActiveModel, getProviderDisplayName } from './models.js'

const LOG = '[NeuroNote:Summary]'

/** A short, human reason for a failed AI call, for the note's banner. */
function describeFailure(message) {
  const text = message || ''
  const code = text.match(/\((\d{3})\)/)?.[1]
  if (code === '401' || code === '403') return 'the AI key was rejected'
  if (code === '429') return 'the AI service was rate-limiting requests'
  if (code === '404') return 'the AI model was not available to this key'
  if (code === '400') return 'the AI service rejected the request'
  if (code?.[0] === '5') return 'the AI service had an error'
  if (/parse|JSON|format|empty/i.test(text)) return 'the AI reply came back incomplete'
  if (/fetch|network|load failed/i.test(text)) return 'the AI service could not be reached'
  return text.slice(0, 120) || 'the request failed'
}

/**
 * @param {string} text      the transcript (or other text) to summarize
 * @param {object} settings  app settings, for the model tier
 * @returns {Promise<{data: object, source: 'ai'|'local', reason: string|null, model: string|null}>}
 *   `reason` is 'no-key' when no AI key is saved, a short description when the
 *   AI call failed, and null when the AI summary succeeded. Never rejects.
 */
export async function summarizeTranscript(text, settings) {
  if (!hasActiveApiKey()) {
    console.log(`${LOG} No AI key saved — using the on-device summary`)
    return { data: extractSummary(text), source: 'local', reason: 'no-key', model: null }
  }

  const modelName = getProviderDisplayName(getAIProvider(), settings)
  try {
    console.log(`${LOG} Asking ${modelName} to summarize ${text.length} chars`)
    const data = await generateSummary(text, getActiveModel(settings))
    if (!data?.summary || typeof data.summary.paragraph !== 'string' || !data.summary.paragraph.trim()) {
      throw new Error('The AI reply was empty or not in the expected format')
    }
    return { data, source: 'ai', reason: null, model: modelName }
  } catch (e) {
    console.error(`${LOG} AI summary FAILED — using the on-device summary instead:`, e.message, e)
    return { data: extractSummary(text), source: 'local', reason: describeFailure(e.message), model: modelName }
  }
}

/** The note fields a summary result fills in. */
export function summaryFields(result) {
  const data = result?.data || {}
  return {
    summary: data.summary || { paragraph: '', bullets: [], actions: [] },
    decisions: data.decisions || [],
    followups: data.followups || [],
    summarySource: result?.source || 'local',
    summaryModel: result?.model || null,
    summaryReason: result?.reason || null
  }
}

/** The AI's title when it wrote a usable one, otherwise null. */
export function titleFromSummary(result) {
  const title = typeof result?.data?.title === 'string' ? result.data.title.trim() : ''
  if (result?.source !== 'ai' || title.length < 3) return null
  return title.replace(/^["“]|["”.]$/g, '').slice(0, 70)
}
