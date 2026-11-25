import { getApiKey, addUsage } from './storage.js'
import { getBoostList, applyCorrectionsWithStats } from './corrections.js'

const BASE = 'https://api.assemblyai.com/v2'

function getKey() {
  const key = getApiKey('assemblyai')
  if (!key) throw new Error('AssemblyAI API key not configured. Add it in Settings.')
  return key
}

function headers() {
  return {
    'Authorization': getKey(),
    'Content-Type': 'application/json'
  }
}

export async function uploadAudio(blob) {
  const res = await fetch(`${BASE}/upload`, {
    method: 'POST',
    headers: { 'Authorization': getKey(), 'Content-Type': 'application/octet-stream' },
    body: blob
  })
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
  const data = await res.json()
  return data.upload_url
}

// v2.8.1 — the speech model is named explicitly. Until now the request named
// none and rode whatever default the account had, which AssemblyAI changes on
// its own schedule (accounts on the older Pro default move on 2026-12-08).
// Ids confirmed against the submit API reference on 2026-11-24. Universal-2 is
// listed second so audio in a language the primary model does not cover is
// still transcribed instead of failing.
export const SPEECH_MODEL_PRIMARY = 'assemblyai-stt-3-7'
export const SPEECH_MODEL_FALLBACK = 'universal-2'
export const SPEECH_MODELS = [SPEECH_MODEL_PRIMARY, SPEECH_MODEL_FALLBACK]

// List prices in dollars per hour of audio (assemblyai.com/pricing, 2026-11).
const HOURLY_RATE = { [SPEECH_MODEL_PRIMARY]: 0.21, [SPEECH_MODEL_FALLBACK]: 0.15 }
const SPEAKER_LABELS_RATE = 0.02
const KEYTERMS_RATE = 0.05

// Key terms: at most 6 words per phrase. The word budget is held to the
// fallback model's limit (200) so the same list is valid on either model.
const KEYTERM_MAX_WORDS_PER_PHRASE = 6
const KEYTERM_WORD_BUDGET = 200

/**
 * v2.8.1 — the learned corrections, shaped for AssemblyAI's `keyterms_prompt`.
 *
 * This replaces `word_boost` / `boost_param`, which the current models treat as
 * legacy: sending them quietly routed the whole request to the older model.
 */
export function getKeyterms() {
  const terms = []
  let words = 0
  for (const raw of getBoostList()) {
    const term = (raw || '').trim()
    if (!term) continue
    const count = term.split(/\s+/).length
    if (count > KEYTERM_MAX_WORDS_PER_PHRASE) continue
    if (words + count > KEYTERM_WORD_BUDGET) break
    terms.push(term)
    words += count
  }
  return terms
}

/** Estimated cost of one finished transcript, from what was actually used. */
export function estimateTranscriptionCost(result) {
  const hours = (result?.audio_duration || 60) / 3600
  let rate = HOURLY_RATE[result?.speech_model_used] ?? HOURLY_RATE[SPEECH_MODEL_PRIMARY]
  if (result?.speaker_labels) rate += SPEAKER_LABELS_RATE
  const keyterms = Array.isArray(result?.keyterms_prompt) ? result.keyterms_prompt : getKeyterms()
  if (keyterms.length > 0) rate += KEYTERMS_RATE
  return rate * hours
}

async function postTranscript(body) {
  const res = await fetch(`${BASE}/transcript`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body)
  })
  if (res.ok) return { ok: true, data: await res.json() }
  let detail = ''
  try { detail = (await res.text()).slice(0, 300) } catch { /* body unreadable */ }
  return { ok: false, status: res.status, detail }
}

export async function requestTranscript(audioUrl, speakerLabels = true) {
  const body = { audio_url: audioUrl, speaker_labels: speakerLabels, speech_models: SPEECH_MODELS }

  // v2.2 — steer the model toward spellings the user has already taught us.
  const keyterms = getKeyterms()
  if (keyterms.length > 0) {
    body.keyterms_prompt = keyterms
    console.log(`[NeuroNote:Corrections] Sending ${keyterms.length} learned term(s) to AssemblyAI as key terms:`, keyterms.join(', '))
  } else {
    console.log('[NeuroNote:Corrections] No learned terms to send')
  }

  let attempt = await postTranscript(body)

  // A 400 here means the account rejected the request as written — most likely
  // the model name or the key terms. A meeting must never be lost to that, so
  // the request is sent once more in its plainest form, on the account's own
  // default model, and the downgrade is logged loudly.
  if (!attempt.ok && attempt.status === 400) {
    console.warn(
      `[NeuroNote:AssemblyAI] Request with speech_models ${JSON.stringify(SPEECH_MODELS)} was rejected (400): ${attempt.detail} ` +
      '— retrying on the account default model without key terms'
    )
    attempt = await postTranscript({ audio_url: audioUrl, speaker_labels: speakerLabels })
  }

  if (!attempt.ok) {
    throw new Error(`Transcript request failed: ${attempt.status}${attempt.detail ? ` — ${attempt.detail}` : ''}`)
  }
  return attempt.data
}

/**
 * v2.3 — one non-blocking status check. pollTranscript() below still loops for
 * callers that just want the finished result; chunked transcription needs to
 * check many jobs at once without any single one blocking the others.
 */
export async function getTranscriptStatus(transcriptId) {
  const res = await fetch(`${BASE}/transcript/${transcriptId}`, {
    headers: { 'Authorization': getKey() }
  })
  if (!res.ok) throw new Error(`Poll failed: ${res.status}`)
  return await res.json()
}

export async function pollTranscript(transcriptId) {
  while (true) {
    const data = await getTranscriptStatus(transcriptId)
    if (data.status === 'completed') {
      console.log(`[NeuroNote:AssemblyAI] Transcript ${transcriptId} completed on ${data.speech_model_used || 'an unreported model'}`)
      return data
    }
    if (data.status === 'error') throw new Error(`Transcription error: ${data.error}`)
    await new Promise(r => setTimeout(r, 3000))
  }
}

export function formatWithSpeakers(result) {
  if (!result.utterances || result.utterances.length === 0) {
    return result.text || ''
  }
  return result.utterances
    .map(u => `Speaker ${u.speaker}: ${u.text}`)
    .join('\n')
}

export function getSpeakerCount(result) {
  if (!result.utterances) return 1
  const speakers = new Set(result.utterances.map(u => u.speaker))
  return speakers.size
}

/**
 * v2.2 cleanup pass, shared by whole-file and per-segment transcription.
 *
 * Each stretch of text is corrected exactly once so useCount stays honest: when
 * diarization gave us utterances, the flat text is rebuilt from them.
 */
export function applyCorrectionsToResult(result, label = 'Transcript') {
  const boostedCount = getBoostList().length
  const rawUtterances = result.utterances || []
  let utterances = rawUtterances
  let rawText = result.text || ''
  let replacements = 0

  if (rawUtterances.length > 0) {
    utterances = rawUtterances.map(u => {
      const stats = applyCorrectionsWithStats(u.text || '')
      replacements += stats.replacements
      return { ...u, text: stats.text }
    })
    rawText = utterances.map(u => u.text).join(' ')
  } else {
    const stats = applyCorrectionsWithStats(rawText)
    replacements = stats.replacements
    rawText = stats.text
  }

  console.log(`[NeuroNote:Corrections] ${label} cleanup: ${replacements} correction(s) applied, ${boostedCount} term(s) boosted`)

  return {
    text: formatWithSpeakers({ ...result, text: rawText, utterances }),
    raw: rawText,
    speakers: getSpeakerCount({ ...result, utterances }),
    utterances
  }
}

/**
 * Whole-file transcription. Still used by the upload flow and by recovery of an
 * orphaned recording; live recordings go through segmented-transcription.js.
 *
 * @param {Blob} blob
 * @param {object} [options]  { speakerLabels } — diarization defaults to on.
 */
export async function transcribeAudio(blob, options = {}) {
  const speakerLabels = options.speakerLabels !== false
  const uploadUrl = await uploadAudio(blob)
  const { id } = await requestTranscript(uploadUrl, speakerLabels)
  const result = await pollTranscript(id)
  addUsage(estimateTranscriptionCost(result), 'assemblyai')
  return applyCorrectionsToResult(result)
}
