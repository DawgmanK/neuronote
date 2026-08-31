import { getApiKey, addUsage } from './storage.js'
import { getBoostList, applyCorrectionsWithStats } from './corrections.js'

const BASE = 'https://api.assemblyai.com/v2'

function getKey() {
  const key = getApiKey('assemblyai')
  if (!key) throw new Error('AssemblyAI API key not configured. Add it in System settings.')
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

export async function requestTranscript(audioUrl, speakerLabels = true) {
  const body = { audio_url: audioUrl, speaker_labels: speakerLabels }

  // v2.2 — steer the model toward spellings the user has already taught us.
  const boost = getBoostList()
  if (boost.length > 0) {
    body.word_boost = boost
    body.boost_param = 'high'
    console.log(`[NeuroNote:Corrections] Boosting ${boost.length} learned term(s) in AssemblyAI request:`, boost.join(', '))
  } else {
    console.log('[NeuroNote:Corrections] No learned terms to boost')
  }

  const res = await fetch(`${BASE}/transcript`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`Transcript request failed: ${res.status}`)
  return await res.json()
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
    if (data.status === 'completed') return data
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
  addUsage(0.006 * (result.audio_duration || 60) / 60, 'assemblyai')
  return applyCorrectionsToResult(result)
}

export function connectRealtime(onTranscript) {
  const key = getApiKey('assemblyai')
  if (!key) throw new Error('AssemblyAI key required for real-time transcription')

  const ws = new WebSocket(`wss://api.assemblyai.com/realtime/ws?sample_rate=16000&token=${key}`)

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data)
    if (data.message_type === 'FinalTranscript' && data.text) {
      onTranscript(data.text)
    }
  }

  ws.onerror = (err) => console.error('AssemblyAI WS error:', err)

  return {
    send: (audioData) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ audio_data: btoa(String.fromCharCode(...new Uint8Array(audioData))) }))
      }
    },
    close: () => ws.close()
  }
}
