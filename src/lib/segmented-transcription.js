// v2.3 — chunked transcription.
//
// Before v2.3 a 70-minute meeting was uploaded in one piece the moment the user
// tapped Stop, so the wait scaled with the meeting: ten minutes or more of
// staring at a spinner. Now the recording is cut into five-minute segments that
// are transcribed *while the meeting is still going*, so the only thing left to
// wait for at Stop is the final partial segment — 15 to 30 seconds, whether the
// meeting ran five minutes or two hours.
import {
  uploadAudio,
  requestTranscript,
  getTranscriptStatus,
  applyCorrectionsToResult
} from './assemblyai.js'
import { addUsage } from './storage.js'

const LOG = '[NeuroNote:Chunk]'

/** How much audio goes into one segment. */
export const SEGMENT_SECONDS = 300

/**
 * AssemblyAI's diarizer needs a reasonable amount of audio before it can tell
 * voices apart; below this it either errors or guesses badly. Short segments —
 * which in practice means the final partial one — are transcribed without
 * speaker labels instead of failing.
 */
export const MIN_DIARIZATION_SECONDS = 30

/** A segment gets three shots at the API before its minutes are marked failed. */
export const MAX_RETRIES = 3

export const SEGMENT_STATUS = {
  PENDING: 'pending',
  UPLOADING: 'uploading',
  TRANSCRIBING: 'transcribing',
  COMPLETE: 'complete',
  FAILED: 'failed'
}

/**
 * Build the segment record that both the transcription pipeline and the
 * CAPTURE progress strip read from.
 */
export function createSegment({ segmentId, index, startTimeOffset, endTimeOffset, audioBlob, diarization }) {
  return {
    segmentId,
    index,
    startTimeOffset,          // seconds from the start of the recording
    endTimeOffset,            // seconds from the start of the recording
    audioBlob,
    transcript: '',
    utterances: [],
    status: SEGMENT_STATUS.PENDING,
    retryCount: 0,
    error: null,
    // Diarization is requested per segment: a sub-30s tail cannot be diarized
    // reliably, so it downgrades to plain transcription rather than taking the
    // whole segment down with it.
    diarization: !!diarization && (endTimeOffset - startTimeOffset) >= MIN_DIARIZATION_SECONDS
  }
}

/**
 * Upload one segment and open a transcription job for it. Returns as soon as
 * the job is queued — polling is a separate step so recording is never blocked.
 *
 * @returns {Promise<{transcriptId: string, audioUrl: string}>}
 */
export async function startSegmentTranscription(audioBlob, segmentIndex, useDiarization) {
  console.log(
    `${LOG} Segment ${segmentIndex}: uploading ${(audioBlob.size / 1024).toFixed(0)} KB ` +
    `(diarization ${useDiarization ? 'ON' : 'OFF'})`
  )
  const audioUrl = await uploadAudio(audioBlob)
  const job = await requestTranscript(audioUrl, useDiarization)
  console.log(`${LOG} Segment ${segmentIndex}: transcript job ${job.id} queued`)
  return { transcriptId: job.id, audioUrl }
}

/** One status check against an open transcription job. */
export async function pollSegmentStatus(transcriptId) {
  return await getTranscriptStatus(transcriptId)
}

function wait(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function awaitSegmentResult(transcriptId, segmentIndex) {
  // Segments are short, so a 2s cadence keeps the wait at Stop tight without
  // hammering the API. The ceiling is generous: it covers a five-minute segment
  // even when AssemblyAI is queueing behind other jobs.
  const maxPolls = 600
  for (let attempt = 0; attempt < maxPolls; attempt++) {
    const data = await pollSegmentStatus(transcriptId)
    if (data.status === 'completed') return data
    if (data.status === 'error') throw new Error(data.error || 'AssemblyAI reported an error')
    await wait(2000)
  }
  throw new Error(`Segment ${segmentIndex} timed out while transcribing`)
}

/**
 * Run one segment all the way through: upload, transcribe, correct, retry.
 *
 * The segment object is mutated in place (and reported through onUpdate) so the
 * live progress strip can follow it. This never throws — a segment that fails
 * every retry is marked failed and the rest of the transcript carries on.
 *
 * @param {object} segment   from createSegment()
 * @param {(segment: object) => void} [onUpdate]  called on every status change
 */
export async function transcribeSegment(segment, onUpdate) {
  const report = () => onUpdate?.({ ...segment })

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    segment.retryCount = attempt - 1
    try {
      segment.status = SEGMENT_STATUS.UPLOADING
      segment.error = null
      report()

      const { transcriptId } = await startSegmentTranscription(
        segment.audioBlob,
        segment.index,
        segment.diarization
      )
      segment.transcriptId = transcriptId

      segment.status = SEGMENT_STATUS.TRANSCRIBING
      report()

      const result = await awaitSegmentResult(transcriptId, segment.index)
      addUsage(0.006 * (result.audio_duration || 60) / 60, 'assemblyai')

      const cleaned = applyCorrectionsToResult(result, `Segment ${segment.index}`)
      segment.transcript = cleaned.text
      segment.rawTranscript = cleaned.raw
      segment.utterances = cleaned.utterances
      segment.speakers = cleaned.speakers
      segment.status = SEGMENT_STATUS.COMPLETE
      report()

      console.log(
        `${LOG} Segment ${segment.index} complete — ${cleaned.raw.length} chars, ` +
        `${cleaned.utterances.length} utterance(s), attempt ${attempt}`
      )
      return segment
    } catch (e) {
      console.error(`${LOG} Segment ${segment.index} attempt ${attempt}/${MAX_RETRIES} failed:`, e.message)
      segment.error = e.message
      if (attempt < MAX_RETRIES) {
        // Back off before retrying so a transient 429 or network blip can clear.
        await wait(2000 * attempt)
        continue
      }
      segment.status = SEGMENT_STATUS.FAILED
      report()
      console.error(
        `${LOG} Segment ${segment.index} FAILED after ${MAX_RETRIES} attempts — ` +
        `minutes ${formatMinuteRange(segment)} will be marked in the transcript`
      )
      return segment
    }
  }
  return segment
}

/** "12-17" — the minute range a segment covers, used in failure notices. */
export function formatMinuteRange(segment) {
  const from = Math.floor((segment.startTimeOffset || 0) / 60)
  const to = Math.ceil((segment.endTimeOffset || 0) / 60)
  return `${from}-${Math.max(to, from + 1)}`
}

function orderedSegments(segments) {
  return [...(segments || [])].sort((a, b) => a.index - b.index)
}

/**
 * Concatenate every segment's transcript in recording order.
 *
 * A segment that never transcribed contributes a clearly marked placeholder
 * rather than silently vanishing, so the user can see exactly which minutes are
 * missing instead of reading a transcript with an invisible hole in it.
 */
export function combineSegments(segments) {
  const ordered = orderedSegments(segments)
  const parts = ordered.map(segment => {
    if (segment.status === SEGMENT_STATUS.COMPLETE) {
      return (segment.transcript || '').trim()
    }
    return `[Transcription failed for minutes ${formatMinuteRange(segment)}]`
  })

  const combined = parts.filter(Boolean).join('\n\n')
  const failed = ordered.filter(s => s.status !== SEGMENT_STATUS.COMPLETE).length
  console.log(
    `${LOG} Combined ${ordered.length} segment(s) into ${combined.length} chars` +
    (failed > 0 ? ` — ${failed} segment(s) marked as failed` : '')
  )
  return combined
}

/**
 * Merge speaker-labeled utterances across segments, shifting each segment's
 * timestamps by its offset so the timeline reads continuously.
 *
 * AssemblyAI labels speakers per request, so "Speaker A" in segment 2 is not
 * guaranteed to be the same person as "Speaker A" in segment 1. The labels are
 * preserved exactly as returned — remapping them would take voice fingerprints
 * the API does not hand back.
 */
export function combineUtterances(segments, useDiarization) {
  const ordered = orderedSegments(segments)
  const merged = []

  for (const segment of ordered) {
    if (segment.status !== SEGMENT_STATUS.COMPLETE) continue
    const offsetMs = (segment.startTimeOffset || 0) * 1000

    if (segment.utterances?.length > 0) {
      for (const u of segment.utterances) {
        merged.push({
          ...u,
          speaker: useDiarization ? u.speaker : 'A',
          start: (u.start || 0) + offsetMs,
          end: (u.end || 0) + offsetMs,
          segmentIndex: segment.index
        })
      }
    } else if (segment.rawTranscript) {
      // A segment transcribed without diarization — a short tail, or the toggle
      // turned off — still belongs on the timeline as one block.
      merged.push({
        speaker: 'A',
        text: segment.rawTranscript,
        start: offsetMs,
        end: (segment.endTimeOffset || 0) * 1000,
        segmentIndex: segment.index
      })
    }
  }

  console.log(`${LOG} Combined ${merged.length} utterance(s) across ${ordered.length} segment(s)`)
  return merged
}

/** How many distinct speakers the combined utterances contain. */
export function countSpeakers(utterances) {
  if (!utterances?.length) return 1
  return new Set(utterances.map(u => u.speaker)).size || 1
}
