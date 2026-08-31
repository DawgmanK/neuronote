// v2.3 — durable storage for IN-PROGRESS recordings.
//
// Recordings used to live only in a component's memory, so navigating away or a
// React remount orphaned the audio. This module mirrors every active recording
// into IndexedDB (via idb-keyval) on a 30-second cadence so a crash, a reload,
// or a killed tab can never take more than the last 30 seconds with it.
//
// IndexedDB is used rather than localStorage because Blobs survive a structured
// clone intact and the quota is measured in hundreds of MB rather than ~5 MB —
// a 70-minute Opus recording is roughly 35 MB.
import { get, set, del, createStore } from 'idb-keyval'

const LOG = '[NeuroNote:Recording]'

// Own database so clearing NeuroNote's audio never touches other idb-keyval users.
const store = createStore('neuronote', 'recordings')

const KEY_PREFIX = 'neuronote:recording:in-progress:'
const INDEX_KEY = 'neuronote:recording:in-progress:index'

function recordKey(sessionId) {
  return `${KEY_PREFIX}${sessionId}`
}

async function readIndex() {
  try {
    return (await get(INDEX_KEY, store)) || []
  } catch (e) {
    console.error(`${LOG} Could not read the in-progress index:`, e)
    return []
  }
}

async function writeIndex(ids) {
  try {
    await set(INDEX_KEY, ids, store)
  } catch (e) {
    console.error(`${LOG} Could not write the in-progress index:`, e)
  }
}

/**
 * Persist the current state of an active recording. Called every 30 seconds by
 * RecordingContext, and once more the moment a recording stops being active.
 *
 * @param {string} sessionId  UUID minted when the recording started
 * @param {Blob[]} chunks     every chunk captured so far, in order
 * @param {object} meta       { startTime, elapsedSeconds, diarization, segmentCount }
 */
export async function saveInProgress(sessionId, chunks, meta = {}) {
  if (!sessionId) return false
  const record = {
    sessionId,
    startTime: meta.startTime || Date.now(),
    elapsedSeconds: meta.elapsedSeconds || 0,
    chunkCount: chunks.length,
    diarization: meta.diarization !== false,
    segmentCount: meta.segmentCount || 0,
    mimeType: meta.mimeType || 'audio/webm',
    savedAt: Date.now(),
    chunks
  }

  try {
    await set(recordKey(sessionId), record, store)
    const ids = await readIndex()
    if (!ids.includes(sessionId)) await writeIndex([...ids, sessionId])
    console.log(
      `${LOG} Auto-saved session ${sessionId} to IndexedDB — ${record.chunkCount} chunk(s), ${record.elapsedSeconds}s elapsed`
    )
    return true
  } catch (e) {
    // A full disk or a private-browsing quota must never kill the recording
    // itself, so this failure is logged and swallowed.
    console.error(`${LOG} Auto-save FAILED for session ${sessionId}:`, e)
    return false
  }
}

/**
 * The newest recording left behind by a previous run, or null when the last
 * session shut down cleanly.
 */
export async function loadInProgress() {
  try {
    const ids = await readIndex()
    if (ids.length === 0) {
      console.log(`${LOG} No in-progress recording found in IndexedDB`)
      return null
    }

    const records = []
    for (const id of ids) {
      const record = await get(recordKey(id), store)
      if (record) records.push(record)
    }

    if (records.length === 0) {
      await writeIndex([])
      return null
    }

    records.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
    const newest = records[0]
    console.log(
      `${LOG} Recoverable recording found: session ${newest.sessionId}, ${newest.chunkCount} chunk(s), ${newest.elapsedSeconds}s of audio`
    )
    return newest
  } catch (e) {
    console.error(`${LOG} Could not read in-progress recordings:`, e)
    return null
  }
}

/** Delete one in-progress record — after it is recovered, saved, or discarded. */
export async function clearInProgress(sessionId) {
  if (!sessionId) return
  try {
    await del(recordKey(sessionId), store)
    const ids = await readIndex()
    await writeIndex(ids.filter(id => id !== sessionId))
    console.log(`${LOG} Cleared in-progress record for session ${sessionId}`)
  } catch (e) {
    console.error(`${LOG} Could not clear in-progress record ${sessionId}:`, e)
  }
}

/** Drop every in-progress record. Used by the SYSTEM tab's storage controls. */
export async function clearAllInProgress() {
  try {
    const ids = await readIndex()
    for (const id of ids) await del(recordKey(id), store)
    await writeIndex([])
    console.log(`${LOG} Cleared ${ids.length} in-progress record(s)`)
  } catch (e) {
    console.error(`${LOG} Could not clear in-progress records:`, e)
  }
}

/** Rebuild a playable/uploadable Blob from a recovered record. */
export function blobFromRecord(record) {
  if (!record?.chunks?.length) return null
  return new Blob(record.chunks, { type: record.mimeType || 'audio/webm' })
}
