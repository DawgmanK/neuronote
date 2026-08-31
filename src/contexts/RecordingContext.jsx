// v2.3 — the recorder lives here, at the app root, and nowhere else.
//
// Until v2.3 the MediaRecorder was owned by <Capture>. Navigating to ARCHIVE
// mid-meeting unmounted the component, and with it the only reference to the
// audio chunks — one user lost a real 70-minute recording that way. This
// provider sits above the tab switcher, so tabs can come and go while the
// recorder keeps running, the timer keeps counting, and IndexedDB keeps a
// 30-second-fresh copy of everything captured so far.
//
// It also owns the fix for the "record button stuck" bug: every path out of a
// recording — normal stop, discard, or a failed start — runs the same teardown
// that stops the MediaRecorder, releases the microphone tracks, clears every
// interval, and returns the state machine to 'idle'.
import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react'
import useLiveTranscript from '../hooks/useLiveTranscript'
import { getApiKey, getItem, setItem } from '../lib/storage'
import { getActiveModel } from '../lib/models'
import { transcribeAudio } from '../lib/assemblyai'
import { applyCorrections } from '../lib/corrections'
import { generateSummary, generateFlashcards, extractImageText } from '../lib/openai'
import { extractSummary } from '../lib/extractive'
import {
  saveInProgress,
  loadInProgress,
  clearInProgress,
  blobFromRecord
} from '../lib/recording-store'
import {
  SEGMENT_SECONDS,
  SEGMENT_STATUS,
  createSegment,
  transcribeSegment,
  combineSegments,
  combineUtterances,
  countSpeakers
} from '../lib/segmented-transcription'
import { useToast } from '../components/ui/Toast'

const LOG = '[NeuroNote:Recording]'

/** How often the in-progress recording is mirrored into IndexedDB. */
const AUTOSAVE_SECONDS = 30

const DIARIZATION_KEY = 'recording:diarization'
const DISCREET_KEY = 'recording:discreet'
const DISCREET_LOG = '[NeuroNote:Discreet]'

const RecordingContext = createContext(null)

export function useRecordingContext() {
  const ctx = useContext(RecordingContext)
  if (!ctx) throw new Error('useRecordingContext must be used inside <RecordingProvider>')
  return ctx
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0))
  const m = Math.floor(total / 60).toString().padStart(2, '0')
  const s = (total % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function newSessionId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `session-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm'
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus'
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm'
  return 'audio/mp4'
}

export function loadDiarizationPreference() {
  const stored = getItem(DIARIZATION_KEY)
  // Speaker detection is on by default — it is what makes a multi-person
  // meeting readable, and the user can turn it off for speed.
  return stored === null ? true : !!stored
}

export function loadDiscreetPreference() {
  // v2.4 — off by default. Hiding that a recording is running is a deliberate
  // choice, never something the app decides on the user's behalf.
  return !!getItem(DISCREET_KEY)
}

export function RecordingProvider({ settings, onSaveNote, onNavigate, children }) {
  const toast = useToast()

  const [recordingState, setRecordingState] = useState('idle') // idle | recording | paused | processing
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [currentSessionId, setCurrentSessionId] = useState(null)
  const [recordingStartTime, setRecordingStartTime] = useState(null)
  const [stream, setStream] = useState(null)
  const [segments, setSegments] = useState([])
  const [photos, setPhotos] = useState([])
  const [processingStep, setProcessingStep] = useState('')
  const [generatedNote, setGeneratedNote] = useState(null)
  const [diarization, setDiarizationState] = useState(loadDiarizationPreference)
  // v2.4 — discreetMode is the saved preference; discreetActive is whether the
  // screensaver is on screen right now. It is deliberately not persisted: a
  // recovered session after a crash must come back to the normal UI.
  const [discreetMode, setDiscreetModeState] = useState(loadDiscreetPreference)
  const [discreetActive, setDiscreetActive] = useState(false)
  const [recovery, setRecovery] = useState(null)
  const [confirmRequest, setConfirmRequest] = useState(null)
  // Whether this session is being transcribed in chunks. Mirrored into state so
  // the CAPTURE progress strip re-renders when it flips.
  const [chunkedTranscription, setChunkedTranscription] = useState(false)

  // --- refs: everything the recorder needs that must not re-render anything ---
  const mediaRecorderRef = useRef(null)
  const mediaStreamRef = useRef(null)
  const audioChunksRef = useRef([])        // every chunk of the whole recording
  const segmentChunksRef = useRef([])      // chunks since the last segment cut
  const headerChunkRef = useRef(null)      // container header, see cutSegment()
  const mimeTypeRef = useRef('audio/webm')
  const segmentsRef = useRef([])
  const segmentJobsRef = useRef([])
  const segmentStartRef = useRef(0)
  const nextCutRef = useRef(SEGMENT_SECONDS)
  const cuttingRef = useRef(false)
  const chunkedRef = useRef(false)
  const timerRef = useRef(null)
  const autosaveRef = useRef(null)
  const elapsedRef = useRef(0)
  const sessionIdRef = useRef(null)
  const startTimeRef = useRef(null)
  const stateRef = useRef('idle')
  const diarizationRef = useRef(diarization)
  const photosRef = useRef([])
  const settingsRef = useRef(settings)
  const onSaveNoteRef = useRef(onSaveNote)
  const onNavigateRef = useRef(onNavigate)
  const confirmResolveRef = useRef(null)
  const recoveryCheckedRef = useRef(false)

  const { transcript: liveTranscript, startListening, stopListening, clearTranscript } = useLiveTranscript()
  const liveTranscriptRef = useRef([])

  useEffect(() => { liveTranscriptRef.current = liveTranscript }, [liveTranscript])
  useEffect(() => { settingsRef.current = settings }, [settings])
  useEffect(() => { onSaveNoteRef.current = onSaveNote }, [onSaveNote])
  useEffect(() => { onNavigateRef.current = onNavigate }, [onNavigate])
  useEffect(() => { photosRef.current = photos }, [photos])
  useEffect(() => { diarizationRef.current = diarization }, [diarization])

  const setState = useCallback((next) => {
    stateRef.current = next
    setRecordingState(next)
  }, [])

  // ---------------------------------------------------------------------------
  // Confirm dialogs
  //
  // window.confirm() blocks the whole page and cannot offer three choices, so
  // the provider hands the UI a request and waits on a promise instead.
  // ---------------------------------------------------------------------------
  const ask = useCallback((config) => {
    return new Promise(resolve => {
      // A second prompt replaces the first rather than stacking; the caller
      // that raised the old one is told the user dismissed it, so its await
      // never dangles.
      const previous = confirmResolveRef.current
      if (previous) previous(null)
      confirmResolveRef.current = resolve
      setConfirmRequest(config)
    })
  }, [])

  const resolveConfirm = useCallback((value) => {
    setConfirmRequest(null)
    const resolve = confirmResolveRef.current
    confirmResolveRef.current = null
    resolve?.(value)
  }, [])

  // ---------------------------------------------------------------------------
  // Teardown
  // ---------------------------------------------------------------------------
  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
      console.log(`${LOG} Cleanup: elapsed-time interval cleared`)
    }
    if (autosaveRef.current) {
      clearInterval(autosaveRef.current)
      autosaveRef.current = null
      console.log(`${LOG} Cleanup: auto-save interval cleared`)
    }
  }, [])

  const releaseMicrophone = useCallback(() => {
    const activeStream = mediaStreamRef.current
    if (activeStream) {
      activeStream.getTracks().forEach(t => t.stop())
      console.log(`${LOG} Cleanup: ${activeStream.getTracks().length} microphone track(s) stopped`)
    }
    mediaStreamRef.current = null
    setStream(null)
  }, [])

  /**
   * Stop the MediaRecorder and resolve once its final dataavailable has landed.
   * Resolves even if the recorder is already gone, so callers never hang.
   */
  const stopMediaRecorder = useCallback(() => {
    return new Promise(resolve => {
      const recorder = mediaRecorderRef.current
      if (!recorder || recorder.state === 'inactive') {
        console.log(`${LOG} Cleanup: no active MediaRecorder to stop`)
        mediaRecorderRef.current = null
        resolve()
        return
      }
      // A recorder that never fires onstop (a revoked permission mid-session,
      // for instance) must not strand the user in 'processing' forever.
      const failsafe = setTimeout(() => {
        console.warn(`${LOG} MediaRecorder did not fire onstop within 5s — continuing anyway`)
        mediaRecorderRef.current = null
        resolve()
      }, 5000)

      recorder.onstop = () => {
        clearTimeout(failsafe)
        console.log(`${LOG} Cleanup: MediaRecorder stopped (final data flushed)`)
        mediaRecorderRef.current = null
        resolve()
      }
      try {
        recorder.stop()
      } catch (e) {
        clearTimeout(failsafe)
        console.error(`${LOG} MediaRecorder.stop() threw:`, e)
        mediaRecorderRef.current = null
        resolve()
      }
    })
  }, [])

  /**
   * The single teardown path. Every exit from a recording runs this, which is
   * what keeps the record button responsive: no orphaned recorder, no held
   * microphone, no interval still ticking, state back at 'idle'.
   */
  const hardReset = useCallback(async (reason) => {
    console.log(`${LOG} hardReset(${reason}) — resetting all recording state`)
    clearTimers()
    const recorder = mediaRecorderRef.current
    if (recorder) {
      recorder.ondataavailable = null
      recorder.onstop = null
      recorder.onerror = null
      if (recorder.state !== 'inactive') {
        try { recorder.stop() } catch (e) { console.warn(`${LOG} stop() during reset:`, e.message) }
      }
      mediaRecorderRef.current = null
      console.log(`${LOG} Cleanup: MediaRecorder reference set to null`)
    }
    releaseMicrophone()
    try { stopListening() } catch { /* Web Speech may already be down */ }

    audioChunksRef.current = []
    segmentChunksRef.current = []
    headerChunkRef.current = null
    segmentsRef.current = []
    segmentJobsRef.current = []
    segmentStartRef.current = 0
    nextCutRef.current = SEGMENT_SECONDS
    cuttingRef.current = false
    elapsedRef.current = 0
    console.log(`${LOG} Cleanup: audio chunk buffers cleared`)

    setSegments([])
    setElapsedSeconds(0)
    setStream(null)
    // v2.4 — the screensaver must never outlive the recording it was hiding.
    // Whatever ends a recording also drops the user back into the normal UI.
    setDiscreetActive(false)
    setState('idle')
    console.log(`${LOG} Cleanup complete — recordingState is 'idle', ready to record again`)
  }, [clearTimers, releaseMicrophone, stopListening, setState])

  // ---------------------------------------------------------------------------
  // Auto-save
  // ---------------------------------------------------------------------------
  const autosave = useCallback(async () => {
    if (!sessionIdRef.current) return
    await saveInProgress(sessionIdRef.current, audioChunksRef.current.slice(), {
      startTime: startTimeRef.current,
      elapsedSeconds: elapsedRef.current,
      diarization: diarizationRef.current,
      segmentCount: segmentsRef.current.length,
      mimeType: mimeTypeRef.current
    })
  }, [])

  // ---------------------------------------------------------------------------
  // Segment cutting
  // ---------------------------------------------------------------------------
  const syncSegments = useCallback(() => {
    setSegments(segmentsRef.current.map(s => ({ ...s })))
  }, [])

  /**
   * Close off the audio captured since the last cut and hand it to AssemblyAI
   * while the meeting keeps running.
   *
   * Only the first chunk MediaRecorder emits carries the container header, so
   * every later segment is rebuilt as [header, ...its own chunks]. Without that
   * prefix a mid-stream slice is just a run of clusters that no decoder will open.
   */
  const cutSegment = useCallback(async ({ flush = true } = {}) => {
    if (!chunkedRef.current || cuttingRef.current) return null
    cuttingRef.current = true
    try {
      const recorder = mediaRecorderRef.current
      if (flush && recorder && recorder.state === 'recording') {
        try {
          recorder.requestData()
          // Give the dataavailable event a tick to land before we take the buffer.
          await new Promise(r => setTimeout(r, 150))
        } catch (e) {
          console.warn(`${LOG} requestData() failed, cutting on the buffer we have:`, e.message)
        }
      }

      const chunks = segmentChunksRef.current
      segmentChunksRef.current = []
      if (chunks.length === 0) {
        console.log('[NeuroNote:Chunk] Nothing captured since the last cut — no segment created')
        return null
      }

      const index = segmentsRef.current.length
      const startTimeOffset = segmentStartRef.current
      const endTimeOffset = elapsedRef.current
      const parts = index === 0 || !headerChunkRef.current
        ? chunks
        : [headerChunkRef.current, ...chunks]
      const audioBlob = new Blob(parts, { type: 'audio/webm' })

      const segment = createSegment({
        segmentId: `${sessionIdRef.current}-seg-${index}`,
        index,
        startTimeOffset,
        endTimeOffset,
        audioBlob,
        diarization: diarizationRef.current
      })
      segmentsRef.current.push(segment)
      segmentStartRef.current = endTimeOffset
      nextCutRef.current = endTimeOffset + SEGMENT_SECONDS
      syncSegments()

      console.log(
        `[NeuroNote:Chunk] Cut segment ${index} covering ${startTimeOffset}s–${endTimeOffset}s ` +
        `(${(audioBlob.size / 1024).toFixed(0)} KB) — sending to AssemblyAI in the background`
      )

      const job = transcribeSegment(segment, () => syncSegments())
        .catch(e => {
          console.error(`[NeuroNote:Chunk] Segment ${index} rejected unexpectedly:`, e)
          segment.status = SEGMENT_STATUS.FAILED
          segment.error = e.message
          syncSegments()
          return segment
        })
      segmentJobsRef.current.push(job)
      return segment
    } finally {
      cuttingRef.current = false
    }
  }, [syncSegments])

  // ---------------------------------------------------------------------------
  // Start / pause / resume
  // ---------------------------------------------------------------------------
  const startTimers = useCallback(() => {
    clearTimers()
    timerRef.current = setInterval(() => {
      elapsedRef.current += 1
      setElapsedSeconds(elapsedRef.current)
      if (chunkedRef.current && elapsedRef.current >= nextCutRef.current) {
        cutSegment({ flush: true })
      }
    }, 1000)
    autosaveRef.current = setInterval(() => { autosave() }, AUTOSAVE_SECONDS * 1000)
  }, [clearTimers, cutSegment, autosave])

  const startRecording = useCallback(async () => {
    if (stateRef.current === 'recording' || stateRef.current === 'paused') {
      console.warn(`${LOG} startRecording() ignored — already ${stateRef.current}`)
      return false
    }
    if (stateRef.current === 'processing') {
      toast.show({ message: 'Still finishing the last recording — one moment.', type: 'info' })
      return false
    }

    console.log(`${LOG} startRecording() requested`)
    // Start from a guaranteed-clean slate. If a previous session died badly and
    // left a recorder holding the mic, this is what frees it.
    await hardReset('before-start')
    setGeneratedNote(null)
    setPhotos([])
    clearTranscript()

    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = pickMimeType()
      mimeTypeRef.current = mimeType
      const recorder = new MediaRecorder(micStream, { mimeType })

      recorder.ondataavailable = (e) => {
        if (!e.data || e.data.size === 0) return
        if (!headerChunkRef.current) headerChunkRef.current = e.data
        audioChunksRef.current.push(e.data)
        segmentChunksRef.current.push(e.data)
        // Save as soon as there is anything worth saving, so a crash in the
        // first half-minute still leaves a recoverable recording behind rather
        // than waiting for the 30-second tick.
        if (audioChunksRef.current.length === 1) autosave()
      }
      recorder.onerror = (e) => {
        console.error(`${LOG} MediaRecorder error:`, e.error || e)
        toast.show({ message: `Recording error: ${e.error?.message || 'unknown'}`, type: 'error' })
      }

      const sessionId = newSessionId()
      sessionIdRef.current = sessionId
      startTimeRef.current = Date.now()
      elapsedRef.current = 0
      segmentStartRef.current = 0
      nextCutRef.current = SEGMENT_SECONDS
      segmentsRef.current = []
      segmentJobsRef.current = []
      audioChunksRef.current = []
      segmentChunksRef.current = []
      headerChunkRef.current = null

      // Chunked transcription only makes sense when AssemblyAI is actually
      // wired up; without it the Web Speech fallback still runs as it did in v2.2.
      chunkedRef.current = !!getApiKey('assemblyai') && !!settingsRef.current?.useAssemblyAI
      setChunkedTranscription(chunkedRef.current)

      mediaRecorderRef.current = recorder
      mediaStreamRef.current = micStream
      recorder.start(1000)

      setCurrentSessionId(sessionId)
      setRecordingStartTime(startTimeRef.current)
      setStream(micStream)
      setSegments([])
      setElapsedSeconds(0)
      setState('recording')
      startTimers()
      startListening()

      console.log(
        `${LOG} Recording started — session ${sessionId}, mime ${mimeType}, ` +
        `chunked transcription ${chunkedRef.current ? 'ON' : 'OFF'}, ` +
        `diarization ${diarizationRef.current ? 'ON' : 'OFF'}`
      )
      // Write an immediate marker so even a crash in the first 30 seconds
      // leaves something recoverable behind.
      autosave()
      return true
    } catch (e) {
      console.error(`${LOG} startRecording() FAILED:`, e)
      const message = e.name === 'NotAllowedError'
        ? 'Microphone permission denied. Allow mic access and try again.'
        : e.name === 'NotReadableError'
          ? 'The microphone is in use by another app. Close it and try again.'
          : `Could not start recording: ${e.message}`
      toast.show({ message, type: 'error' })
      // Force everything back to idle so the record button works on the next
      // tap — no app restart required.
      await hardReset('start-failed')
      return false
    }
  }, [hardReset, clearTranscript, startTimers, startListening, autosave, setState, toast])

  const pauseRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (recorder?.state !== 'recording') return
    recorder.pause()
    clearTimers()
    setState('paused')
    console.log(`${LOG} Paused at ${elapsedRef.current}s`)
    autosave()
  }, [clearTimers, setState, autosave])

  const resumeRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (recorder?.state !== 'paused') return
    recorder.resume()
    setState('recording')
    startTimers()
    console.log(`${LOG} Resumed at ${elapsedRef.current}s`)
  }, [setState, startTimers])

  const addPhoto = useCallback((base64) => {
    setPhotos(prev => [...prev, base64])
  }, [])

  const navigateToTab = useCallback((tab) => {
    onNavigateRef.current?.(tab)
  }, [])

  const clearGeneratedNote = useCallback(() => setGeneratedNote(null), [])

  // ---------------------------------------------------------------------------
  // Turning a transcript into a saved note
  // ---------------------------------------------------------------------------
  const buildAndSaveNote = useCallback(async ({ transcriptText, speakers, duration, capturedPhotos, type }) => {
    let text = transcriptText

    // Photo OCR — same flow as v2.2, just running from the provider so photos
    // taken mid-meeting survive a tab switch.
    for (const photo of capturedPhotos || []) {
      try {
        if (getApiKey('openai')) {
          const ocrText = await extractImageText(photo, getActiveModel(settingsRef.current))
          text += `\n\n[PHOTO CAPTURE - ${new Date().toLocaleTimeString()}]\n${ocrText}`
        }
      } catch (e) {
        console.error('OCR failed:', e)
      }
    }

    let summaryData = null
    let flashcardData = null

    try {
      setProcessingStep('Generating summary...')
      if (getApiKey('openai')) {
        console.log('[NeuroNote] Calling generateSummary with', text.length, 'chars, model:', getActiveModel(settingsRef.current))
        summaryData = await generateSummary(text, getActiveModel(settingsRef.current))
        console.log('[NeuroNote] Summary result:', JSON.stringify(summaryData).slice(0, 500))
      } else {
        console.log('[NeuroNote] No OpenAI key, using extractive fallback')
        summaryData = extractSummary(text)
      }
    } catch (e) {
      console.error('[NeuroNote] Summary generation FAILED, falling back to extractive:', e.message, e)
      summaryData = extractSummary(text)
    }

    try {
      setProcessingStep('Generating flashcards...')
      if (getApiKey('openai')) {
        console.log('[NeuroNote] Calling generateFlashcards...')
        flashcardData = await generateFlashcards(text)
        console.log('[NeuroNote] Flashcards result:', flashcardData?.flashcards?.length, 'cards,', flashcardData?.quiz?.length, 'quiz items')
      }
    } catch (e) {
      console.error('[NeuroNote] Flashcard generation FAILED:', e.message, e)
    }

    const firstLine = text.split('\n')[0]?.slice(0, 50) || 'Meeting'
    const title = firstLine.replace(/^(Speaker \d+|Speaker [A-Z]|You): /i, '').slice(0, 40) || `Meeting ${new Date().toLocaleDateString()}`

    const note = {
      id: Date.now(),
      title,
      date: new Date().toISOString(),
      duration,
      transcript: text,
      originalTranscript: text,
      summary: summaryData?.summary || { paragraph: '', bullets: [], actions: [] },
      decisions: summaryData?.decisions || [],
      followups: summaryData?.followups || [],
      flashcards: flashcardData?.flashcards || [],
      quiz: flashcardData?.quiz || [],
      photos: capturedPhotos || [],
      speakers,
      tags: [],
      type: type || 'recording'
    }

    setGeneratedNote(note)
    onSaveNoteRef.current?.(note)
    return note
  }, [])

  // ---------------------------------------------------------------------------
  // Stop
  // ---------------------------------------------------------------------------
  const stopRecording = useCallback(async () => {
    if (stateRef.current !== 'recording' && stateRef.current !== 'paused') {
      console.warn(`${LOG} stopRecording() ignored — state is ${stateRef.current}`)
      return null
    }

    console.log(`${LOG} stopRecording() requested at ${elapsedRef.current}s`)
    setState('processing')
    setProcessingStep('Finalizing recording...')
    const progressToast = toast.show({ message: 'Finalizing recording...', type: 'progress', duration: 0 })

    const duration = elapsedRef.current
    const sessionId = sessionIdRef.current
    const capturedPhotos = photosRef.current.slice()
    const wasChunked = chunkedRef.current
    const useDiarization = diarizationRef.current

    clearTimers()
    try { stopListening() } catch { /* already down */ }

    // Persist one last time before touching anything, so a failure from here on
    // still leaves a recoverable copy in IndexedDB.
    await autosave()

    // Flush and tear the recorder down first: the microphone is released and the
    // recorder reference is dropped before any network work begins, which is
    // what lets the user record again immediately afterwards.
    await stopMediaRecorder()
    releaseMicrophone()

    let transcriptText = ''
    let speakers = 1

    try {
      if (wasChunked) {
        await cutSegment({ flush: false })

        const pending = segmentsRef.current.filter(
          s => s.status !== SEGMENT_STATUS.COMPLETE && s.status !== SEGMENT_STATUS.FAILED
        ).length
        if (pending > 0) {
          setProcessingStep(`Transcribing final segment (${pending} pending)...`)
          toast.update(progressToast, { message: 'Transcribing final segment (15 sec)...' })
        }

        console.log(`[NeuroNote:Chunk] Waiting on ${segmentJobsRef.current.length} segment job(s)`)
        await Promise.allSettled(segmentJobsRef.current)
        syncSegments()

        transcriptText = combineSegments(segmentsRef.current)
        const utterances = combineUtterances(segmentsRef.current, useDiarization)
        speakers = useDiarization ? countSpeakers(utterances) : 1

        const allFailed = segmentsRef.current.length > 0 &&
          segmentsRef.current.every(s => s.status === SEGMENT_STATUS.FAILED)
        if (allFailed || !transcriptText.trim()) {
          console.warn('[NeuroNote:Chunk] No usable segment transcript — falling back to the live transcript')
          const fallback = applyCorrections(
            liveTranscriptRef.current.map(t => `${t.speaker}: ${t.text}`).join('\n')
          )
          transcriptText = fallback || transcriptText || 'Transcription failed.'
        }
      } else {
        // No AssemblyAI configured: v2.2 behaviour, the Web Speech transcript.
        setProcessingStep('Transcribing...')
        transcriptText = applyCorrections(
          liveTranscriptRef.current.map(t => `${t.speaker}: ${t.text}`).join('\n')
        ) || 'No transcript available.'
      }
    } catch (e) {
      console.error(`${LOG} Transcription stage failed:`, e)
      transcriptText = applyCorrections(
        liveTranscriptRef.current.map(t => `${t.speaker}: ${t.text}`).join('\n')
      ) || 'Transcription failed.'
    }

    let note = null
    try {
      toast.update(progressToast, { message: 'Generating summary...' })
      note = await buildAndSaveNote({
        transcriptText,
        speakers,
        duration,
        capturedPhotos,
        type: 'recording'
      })
      toast.update(progressToast, { message: 'Done! Opening session...', type: 'success', duration: 2500 })
      // The recording is safely inside a note now, so the crash-recovery copy
      // has done its job.
      await clearInProgress(sessionId)
    } catch (e) {
      console.error(`${LOG} Could not build the note:`, e)
      toast.update(progressToast, {
        message: 'Could not finish the note. Your audio is still recoverable on next launch.',
        type: 'error',
        duration: 8000
      })
    }

    setProcessingStep('')
    await hardReset('after-stop')
    setPhotos([])
    return note
  }, [
    setState, toast, clearTimers, stopListening, autosave, stopMediaRecorder,
    releaseMicrophone, cutSegment, syncSegments, buildAndSaveNote, hardReset
  ])

  // ---------------------------------------------------------------------------
  // Discard
  // ---------------------------------------------------------------------------
  const discardRecording = useCallback(async ({ confirm = true } = {}) => {
    if (stateRef.current !== 'recording' && stateRef.current !== 'paused') return false
    if (confirm) {
      const choice = await ask({
        title: 'Discard recording?',
        message: `This throws away ${formatDuration(elapsedRef.current)} of audio. It cannot be undone.`,
        options: [
          { label: 'Keep Recording', value: 'keep', primary: true },
          { label: 'Discard', value: 'discard', tone: 'danger' }
        ]
      })
      if (choice !== 'discard') return false
    }
    const sessionId = sessionIdRef.current
    console.log(`${LOG} discardRecording() — abandoning session ${sessionId} at ${elapsedRef.current}s`)
    await hardReset('discard')
    await clearInProgress(sessionId)
    setPhotos([])
    clearTranscript()
    toast.show({ message: 'Recording discarded.', type: 'info' })
    return true
  }, [ask, hardReset, clearTranscript, toast])

  // ---------------------------------------------------------------------------
  // Diarization preference
  // ---------------------------------------------------------------------------
  const setDiarization = useCallback((next) => {
    setDiarizationState(next)
    diarizationRef.current = next
    setItem(DIARIZATION_KEY, next)
    console.log(`${LOG} Speaker detection ${next ? 'ON' : 'OFF'} (saved to localStorage)`)
  }, [])

  // ---------------------------------------------------------------------------
  // v2.4 — Discreet Mode
  // ---------------------------------------------------------------------------
  const setDiscreetMode = useCallback((next) => {
    setDiscreetModeState(next)
    setItem(DISCREET_KEY, next)
    console.log(`${DISCREET_LOG} Discreet Mode ${next ? 'ON' : 'OFF'} (saved to localStorage)`)
  }, [])

  const enterDiscreet = useCallback(() => {
    console.log(`${DISCREET_LOG} Entering discreet mode — screensaver up, recording banner suppressed`)
    setDiscreetActive(true)
  }, [])

  const exitDiscreet = useCallback(() => {
    setDiscreetActive(prev => {
      if (prev) console.log(`${DISCREET_LOG} Leaving discreet mode — normal UI restored`)
      return false
    })
  }, [])

  // ---------------------------------------------------------------------------
  // Crash recovery
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (recoveryCheckedRef.current) return
    recoveryCheckedRef.current = true
    loadInProgress().then(record => {
      // Any stored audio at all is worth offering back.
      if (record && record.chunkCount > 0) setRecovery(record)
    })
  }, [])

  const dismissRecovery = useCallback(() => {
    console.log(`${LOG} Recovery deferred — the recording stays in IndexedDB for next launch`)
    setRecovery(null)
  }, [])

  const discardRecovery = useCallback(async () => {
    const record = recovery
    setRecovery(null)
    if (record) await clearInProgress(record.sessionId)
    toast.show({ message: 'Unsaved recording discarded.', type: 'info' })
  }, [recovery, toast])

  /**
   * Turn a recovered recording into a note. The audio is complete, so it goes
   * through whole-file transcription rather than the live segment pipeline.
   */
  const recoverRecording = useCallback(async () => {
    const record = recovery
    if (!record) return null
    setRecovery(null)

    if (stateRef.current === 'recording' || stateRef.current === 'paused') {
      toast.show({ message: 'Finish the current recording before recovering the old one.', type: 'error' })
      return null
    }

    const blob = blobFromRecord(record)
    if (!blob) {
      toast.show({ message: 'That recording could not be rebuilt.', type: 'error' })
      await clearInProgress(record.sessionId)
      return null
    }

    console.log(
      `${LOG} Recovering session ${record.sessionId} — ${(blob.size / 1024 / 1024).toFixed(1)} MB, ` +
      `${record.elapsedSeconds}s of audio`
    )
    setState('processing')
    setProcessingStep('Transcribing recovered recording...')
    const progressToast = toast.show({ message: 'Transcribing recovered recording...', type: 'progress', duration: 0 })
    onNavigateRef.current?.('capture')

    let transcriptText = ''
    let speakers = 1
    try {
      if (getApiKey('assemblyai') && settingsRef.current?.useAssemblyAI) {
        const result = await transcribeAudio(blob, { speakerLabels: record.diarization !== false })
        transcriptText = result.text
        speakers = result.speakers
      } else {
        transcriptText = 'Recovered audio could not be transcribed: AssemblyAI is not configured.'
      }
    } catch (e) {
      console.error(`${LOG} Recovery transcription failed:`, e)
      transcriptText = `Recovered audio could not be transcribed: ${e.message}`
    }

    let note = null
    try {
      toast.update(progressToast, { message: 'Generating summary...' })
      note = await buildAndSaveNote({
        transcriptText,
        speakers,
        duration: record.elapsedSeconds,
        capturedPhotos: [],
        type: 'recording'
      })
      toast.update(progressToast, { message: 'Recovered! Opening session...', type: 'success', duration: 2500 })
      await clearInProgress(record.sessionId)
    } catch (e) {
      console.error(`${LOG} Could not build the recovered note:`, e)
      toast.update(progressToast, { message: `Recovery failed: ${e.message}`, type: 'error', duration: 8000 })
    }

    setProcessingStep('')
    setState('idle')
    return note
  }, [recovery, toast, buildAndSaveNote, setState])

  // One last save if the tab is closed mid-recording.
  useEffect(() => {
    const onHide = () => {
      if (stateRef.current === 'recording' || stateRef.current === 'paused') {
        console.log(`${LOG} Page hidden while recording — flushing to IndexedDB`)
        autosave()
      }
    }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [autosave])

  const value = {
    // state
    recordingState,
    isRecording: recordingState === 'recording' || recordingState === 'paused',
    isPaused: recordingState === 'paused',
    isProcessing: recordingState === 'processing',
    elapsedSeconds,
    currentSessionId,
    recordingStartTime,
    stream,
    segments,
    photos,
    processingStep,
    generatedNote,
    liveTranscript,
    diarization,
    chunkedTranscription,
    discreetMode,
    discreetActive,
    // actions
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    discardRecording,
    addPhoto,
    setDiarization,
    setDiscreetMode,
    enterDiscreet,
    exitDiscreet,
    clearGeneratedNote,
    navigateToTab,
    // confirm plumbing
    ask,
    confirmRequest,
    resolveConfirm,
    // recovery
    recovery,
    recoverRecording,
    discardRecovery,
    dismissRecovery
  }

  return <RecordingContext.Provider value={value}>{children}</RecordingContext.Provider>
}
