import { useState, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRecordingContext, formatDuration } from '../contexts/RecordingContext'
import Waveform from './ui/Waveform'
import GlassCard from './ui/GlassCard'
import Toggle from './ui/Toggle'
import LiveActionItems from './LiveActionItems'
import PhotoCapture from './PhotoCapture'
import SegmentProgress from './SegmentProgress'
import DiscreetScreensaver from './DiscreetScreensaver'
import { getApiKey, getItem, setItem } from '../lib/storage'
import { getActiveModel } from '../lib/models'
import { transcribeAudio } from '../lib/assemblyai'
import { applyCorrections } from '../lib/corrections'
import { generateSummary, generateFlashcards, extractImageText } from '../lib/openai'
import { extractSummary } from '../lib/extractive'

/** Set once the v2.4 legal notice has been acknowledged. */
const DISCLAIMER_KEY = 'discreet-disclaimer-acknowledged'

/**
 * v2.3 — CAPTURE no longer owns the recorder.
 *
 * Every piece of recording state (the MediaRecorder, the chunks, the elapsed
 * timer, the segment queue) now lives in RecordingContext at the app root, so
 * this component is free to unmount when the user switches tabs. It reads state
 * and calls actions; it never holds audio.
 *
 * Upload mode is unchanged from v2.2.1 and still processes locally — a dropped
 * file has nothing to lose if the component goes away mid-parse.
 */
export default function Capture({ onSaveNote, settings }) {
  const {
    recordingState,
    isRecording,
    isPaused,
    isProcessing,
    elapsedSeconds,
    stream,
    segments,
    photos,
    processingStep,
    generatedNote,
    liveTranscript,
    diarization,
    chunkedTranscription,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    discardRecording,
    addPhoto,
    setDiarization,
    clearGeneratedNote,
    discreetMode,
    discreetActive,
    setDiscreetMode,
    enterDiscreet,
    ask
  } = useRecordingContext()

  const [mode, setMode] = useState('record')
  const [showCamera, setShowCamera] = useState(false)
  const [uploadProcessing, setUploadProcessing] = useState(false)
  const [uploadStep, setUploadStep] = useState('')
  const [uploadNote, setUploadNote] = useState(null)
  const transcriptRef = useRef(null)

  const fullLiveTranscript = useMemo(
    () => liveTranscript.map(t => `${t.speaker}: ${t.text}`).join('\n'),
    [liveTranscript]
  )

  const processing = isProcessing || uploadProcessing
  const currentStep = processingStep || uploadStep
  const finishedNote = generatedNote || uploadNote

  /**
   * v2.4 — the one-time legal notice, shown the first time Discreet Mode is
   * switched on. Hiding the recording UI does not change consent law, and the
   * user should read that once before they ever rely on it.
   */
  const confirmDiscreetLegal = async () => {
    if (getItem(DISCLAIMER_KEY)) return true

    const choice = await ask({
      title: 'Legal reminder',
      message: (
        <>
          <p className="mb-2">
            Discreet Mode hides that you&rsquo;re recording, but doesn&rsquo;t change recording laws.
            Recording without consent is:
          </p>
          <ul className="list-disc pl-4 space-y-1 mb-2">
            <li><span className="font-bold text-ink">LEGAL</span> in Georgia and 36 other one-party consent states</li>
            <li><span className="font-bold text-red">ILLEGAL</span> in 11 all-party consent states (CA, CT, DE, FL, IL, MD, MA, MT, NV, NH, PA, WA)</li>
            <li>Federal law is one-party consent</li>
          </ul>
          <p>
            You are responsible for compliance. When crossing state lines, the stricter law usually applies.
          </p>
        </>
      ),
      options: [
        { label: 'I Understand', value: 'ok', primary: true },
        { label: 'Cancel', value: 'cancel' }
      ],
      dismissValue: 'cancel'
    })

    if (choice !== 'ok') {
      console.log('[NeuroNote:Discreet] Legal notice declined — Discreet Mode stays off')
      return false
    }
    setItem(DISCLAIMER_KEY, true)
    console.log('[NeuroNote:Discreet] Legal notice acknowledged — it will not be shown again')
    return true
  }

  const handleDiscreetToggle = async (next) => {
    if (next && !(await confirmDiscreetLegal())) return
    setDiscreetMode(next)
  }

  /**
   * Recording start. With Discreet Mode armed the screen is about to go black,
   * so the user is asked to confirm — a toggle left on from a previous session
   * should never be a surprise.
   */
  const handleStartRecording = async () => {
    if (discreetMode) {
      const choice = await ask({
        title: 'Discreet Mode is on',
        message: 'Discreet Mode is ON — screen will hide recording. Continue?',
        options: [
          { label: 'Yes, Start Recording', value: 'yes', primary: true },
          { label: 'Cancel', value: 'cancel' }
        ],
        dismissValue: 'cancel'
      })
      if (choice !== 'yes') {
        console.log('[NeuroNote:Discreet] Discreet recording cancelled at the confirm')
        return
      }
    }

    const started = await startRecording()
    // Only hide the screen once there is genuinely a recording to hide; a failed
    // start must leave the user looking at the error, not at a black screen.
    if (started && discreetMode) enterDiscreet()
  }

  const handleFileUpload = async (files) => {
    if (!files?.length) return
    const file = files[0]
    setUploadProcessing(true)

    let content = ''
    const type = file.type

    if (type.startsWith('audio/')) {
      setUploadStep('Transcribing audio...')
      const blob = new Blob([await file.arrayBuffer()], { type })
      try {
        const assemblyKey = getApiKey('assemblyai')
        if (assemblyKey && settings?.useAssemblyAI) {
          const result = await transcribeAudio(blob, { speakerLabels: diarization })
          content = result.text
        } else {
          content = 'Audio upload requires AssemblyAI key for transcription.'
        }
      } catch (e) {
        content = 'Failed to transcribe audio: ' + e.message
      }
    } else if (type.startsWith('image/')) {
      setUploadStep('Extracting text from image...')
      const reader = new FileReader()
      const base64 = await new Promise(resolve => {
        reader.onload = () => resolve(reader.result)
        reader.readAsDataURL(file)
      })
      try {
        content = await extractImageText(base64, getActiveModel(settings))
      } catch (e) {
        content = 'Failed to extract text: ' + e.message
      }
    } else {
      setUploadStep('Reading file...')
      content = applyCorrections(await file.text())
    }

    const openaiKey = getApiKey('openai')
    let summaryData = null
    let flashcardData = null

    try {
      setUploadStep('Summarizing...')
      if (openaiKey) {
        console.log('[NeuroNote] Upload: calling generateSummary with', content.length, 'chars')
        summaryData = await generateSummary(content, getActiveModel(settings))
      } else {
        summaryData = extractSummary(content)
      }
    } catch (e) {
      console.error('[NeuroNote] Upload summary failed:', e)
      summaryData = extractSummary(content)
    }

    try {
      if (openaiKey) {
        setUploadStep('Generating flashcards...')
        flashcardData = await generateFlashcards(content)
      }
    } catch (e) {
      console.error('[NeuroNote] Upload flashcard gen failed:', e)
    }

    const note = {
      id: Date.now(),
      title: file.name.replace(/\.[^/.]+$/, '').slice(0, 40),
      date: new Date().toISOString(),
      duration: 0,
      transcript: content,
      originalTranscript: content,
      summary: summaryData?.summary || { paragraph: '', bullets: [], actions: [] },
      decisions: summaryData?.decisions || [],
      followups: summaryData?.followups || [],
      flashcards: flashcardData?.flashcards || [],
      quiz: flashcardData?.quiz || [],
      photos: [],
      speakers: 1,
      tags: [],
      type: 'upload'
    }

    setUploadNote(note)
    setUploadProcessing(false)
    setUploadStep('')
    onSaveNote(note)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    handleFileUpload(e.dataTransfer.files)
  }

  const dismissFinishedNote = () => {
    clearGeneratedNote()
    setUploadNote(null)
  }

  return (
    <div className={`px-4 pb-4 ${isRecording ? 'recording-pulse' : ''}`}>
      {/* Mode toggle */}
      <div className="flex justify-center mb-6">
        <div className="flex gap-1 p-1 rounded-full bg-white/40 backdrop-blur">
          {['record', 'upload'].map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="tap-target -my-2 flex items-center"
            >
              <span
                className={`block px-5 py-1.5 rounded-full font-mono uppercase text-xs tracking-wider transition-all ${
                  mode === m ? 'text-white' : 'text-muted hover:text-ink'
                }`}
                style={mode === m ? { background: 'linear-gradient(to right, #dc2626, #991b1b)' } : undefined}
              >
                {m}
              </span>
            </button>
          ))}
        </div>
      </div>

      {mode === 'record' ? (
        <div className="flex flex-col items-center">
          {/* v2.3 — the "note saved" card no longer stands between the user and
              the next recording. It sits above a record button that is always
              live the moment processing finishes. */}
          {finishedNote && !processing && (
            <motion.div
              className="w-full mb-6"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <GlassCard className="text-center">
                <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-3">
                  <svg width="24" height="24" viewBox="0 0 20 20" fill="none" stroke="#22c55e" strokeWidth="2"><path d="M5 10l3 3 7-7"/></svg>
                </div>
                <h3 className="font-mono uppercase text-sm font-bold mb-1">{finishedNote.title}</h3>
                <p className="text-xs text-muted mb-3">Note saved successfully</p>
                <button
                  onClick={dismissFinishedNote}
                  className="tap-target inline-flex items-center justify-center px-4 font-mono uppercase text-xs text-red tracking-wider hover:underline"
                >
                  Dismiss
                </button>
              </GlassCard>
            </motion.div>
          )}

          {!isRecording && !processing && (
            <motion.div className="flex flex-col items-center gap-6 w-full">
              <motion.button
                onClick={handleStartRecording}
                className="w-24 h-24 rounded-full flex items-center justify-center text-white shadow-lg breathe"
                style={{ background: 'linear-gradient(135deg, #dc2626, #991b1b)' }}
                whileTap={{ scale: 0.95 }}
                aria-label="Start recording"
              >
                <svg width="32" height="32" viewBox="0 0 20 20" fill="currentColor">
                  <circle cx="10" cy="10" r="6" />
                </svg>
              </motion.button>
              <p className="font-mono uppercase text-xs text-muted tracking-wider">Tap to record</p>

              {/* v2.3 — speaker detection lives next to the record button so the
                  choice is made before the meeting starts, not after. */}
              <GlassCard hoverable={false} animate={false} className="w-full max-w-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-mono uppercase text-xs font-bold tracking-wider">Speaker Detection</h3>
                    <p className="text-[11px] text-muted mt-0.5">
                      {diarization ? 'ON — identifying who said what' : 'OFF — faster transcription'}
                    </p>
                  </div>
                  <Toggle enabled={diarization} onChange={setDiarization} label="Speaker detection" />
                </div>
                <p className="text-[11px] text-muted leading-snug mt-2">
                  OFF: faster transcription. ON: identifies who said what (best for interviews/calls with multiple people).
                </p>

                {/* v2.4 — Discreet Mode sits with Speaker Detection: both are
                    decisions made before the meeting starts, not during it. */}
                <div className="border-t border-black/5 mt-4 pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-mono uppercase text-xs font-bold tracking-wider">Discreet Mode</h3>
                      <p className="text-[11px] text-muted mt-0.5">
                        {discreetMode ? 'ON — screen hides the recording' : 'OFF — normal recording UI'}
                      </p>
                    </div>
                    <Toggle enabled={discreetMode} onChange={handleDiscreetToggle} label="Discreet mode" />
                  </div>
                  <p className="text-[11px] text-muted leading-snug mt-2">
                    Hides recording UI behind a screensaver. Double-tap middle-left to pause, middle-right to exit.
                  </p>
                </div>
              </GlassCard>
            </motion.div>
          )}

          {isRecording && (
            <motion.div
              className="w-full"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="text-center mb-4">
                <p className="font-mono text-4xl font-bold text-ink">{formatDuration(elapsedSeconds)}</p>
                <p className="font-mono uppercase text-[10px] text-red tracking-wider mt-1">
                  {isPaused ? '// PAUSED' : '// RECORDING'}
                </p>
              </div>

              <div className="mb-4">
                <Waveform stream={stream} isRecording={isRecording && !isPaused} />
              </div>

              {/* v2.3 — live proof that chunks are already being transcribed. */}
              <div className="mb-5">
                <SegmentProgress
                  segments={segments}
                  elapsedSeconds={elapsedSeconds}
                  isRecording={isRecording}
                  enabled={chunkedTranscription}
                />
                {chunkedTranscription && (
                  <p className="text-[10px] text-muted font-mono tracking-wider mt-1">
                    Transcribing in 5-minute chunks — speaker detection {diarization ? 'ON' : 'OFF'}
                  </p>
                )}
              </div>

              {/* Controls */}
              <div className="flex justify-center gap-4 mb-3">
                <motion.button
                  onClick={isPaused ? resumeRecording : pauseRecording}
                  className="w-14 h-14 rounded-full bg-white/65 backdrop-blur flex items-center justify-center border border-red/20"
                  whileTap={{ scale: 0.9 }}
                  aria-label={isPaused ? 'Resume recording' : 'Pause recording'}
                >
                  {isPaused ? (
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="#dc2626"><path d="M6 4l10 6-10 6z"/></svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="#dc2626"><rect x="5" y="4" width="3" height="12" rx="1"/><rect x="12" y="4" width="3" height="12" rx="1"/></svg>
                  )}
                </motion.button>

                <motion.button
                  onClick={stopRecording}
                  className="w-14 h-14 rounded-full bg-red flex items-center justify-center text-white"
                  whileTap={{ scale: 0.9 }}
                  aria-label="Stop recording"
                >
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><rect x="4" y="4" width="12" height="12" rx="2"/></svg>
                </motion.button>

                <motion.button
                  onClick={() => setShowCamera(true)}
                  className="w-14 h-14 rounded-full bg-white/65 backdrop-blur flex items-center justify-center border border-red/20"
                  whileTap={{ scale: 0.9 }}
                  aria-label="Capture a photo"
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#dc2626" strokeWidth="1.5"><rect x="2" y="5" width="16" height="11" rx="2"/><circle cx="10" cy="10.5" r="3"/><path d="M7 5l1-2h4l1 2"/></svg>
                </motion.button>
              </div>

              <div className="flex justify-center gap-2 mb-6">
                <button
                  onClick={() => discardRecording()}
                  className="tap-target inline-flex items-center justify-center px-4 font-mono uppercase text-[10px] text-muted tracking-wider hover:text-red"
                >
                  Discard
                </button>
                {/* v2.4 — re-enter the screensaver mid-recording, e.g. after
                    double-tapping out of it to check on the transcript. */}
                {discreetMode && (
                  <button
                    onClick={enterDiscreet}
                    className="tap-target inline-flex items-center justify-center px-4 font-mono uppercase text-[10px] text-muted tracking-wider hover:text-red"
                  >
                    Hide Screen
                  </button>
                )}
              </div>

              {/* Live transcript + Action items */}
              <div className="grid md:grid-cols-2 gap-4">
                <GlassCard hoverable={false} animate={false}>
                  <h3 className="font-mono uppercase text-xs font-bold tracking-wider mb-2">Live Transcript</h3>
                  <div ref={transcriptRef} className="max-h-48 overflow-y-auto space-y-1">
                    {liveTranscript.length === 0 ? (
                      <p className="text-xs text-muted">Listening for speech...</p>
                    ) : (
                      liveTranscript.map((t, i) => (
                        <p key={i} className="text-xs">
                          <span className="font-mono font-bold text-red">{t.speaker}:</span> {t.text}
                        </p>
                      ))
                    )}
                  </div>
                </GlassCard>

                <div className="hidden md:block">
                  <LiveActionItems
                    transcript={fullLiveTranscript}
                    isRecording={isRecording}
                    enabled={settings?.liveActionItems}
                    hasApiKey={!!getApiKey('openai')}
                  />
                </div>
              </div>

              {/* Mobile action items drawer */}
              <div className="md:hidden mt-4">
                <LiveActionItems
                  transcript={fullLiveTranscript}
                  isRecording={isRecording}
                  enabled={settings?.liveActionItems}
                  hasApiKey={!!getApiKey('openai')}
                />
              </div>

              {photos.length > 0 && (
                <div className="flex gap-2 mt-4 overflow-x-auto">
                  {photos.map((p, i) => (
                    <img key={i} src={p} alt={`Capture ${i + 1}`} className="w-16 h-16 rounded-xl object-cover flex-shrink-0" />
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {processing && (
            <motion.div
              className="w-full text-center py-12"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <div className="w-16 h-16 rounded-full bg-red/10 flex items-center justify-center mx-auto mb-4">
                <div className="w-8 h-8 rounded-full border-2 border-red border-t-transparent animate-spin" />
              </div>
              <p className="font-mono uppercase text-sm tracking-wider">{currentStep}</p>
              <div className="mt-4 w-48 h-1 bg-white/30 rounded-full mx-auto overflow-hidden">
                <div className="h-full bg-red rounded-full shimmer" style={{ width: '60%' }} />
              </div>

              {recordingState === 'processing' && segments.length > 0 && (
                <div className="mt-5 flex justify-center">
                  <SegmentProgress
                    segments={segments}
                    elapsedSeconds={elapsedSeconds}
                    isRecording={false}
                    enabled
                  />
                </div>
              )}
            </motion.div>
          )}

        </div>
      ) : (
        /* UPLOAD MODE */
        <div
          className="border-2 border-dashed border-red/30 rounded-2xl p-8 text-center cursor-pointer hover:border-red/50 transition-colors"
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          onClick={() => document.getElementById('file-upload').click()}
        >
          <input
            id="file-upload"
            type="file"
            className="hidden"
            accept=".pdf,.jpg,.jpeg,.png,.mp3,.wav,.webm,.txt,.md"
            onChange={e => handleFileUpload(e.target.files)}
          />
          <svg width="40" height="40" viewBox="0 0 20 20" fill="none" stroke="#dc2626" strokeWidth="1" className="mx-auto mb-4 opacity-50">
            <path d="M4 17h12M10 3v10m-4-4 4-4 4 4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <p className="font-mono uppercase text-sm text-muted tracking-wider mb-2">Drop files here</p>
          <p className="text-xs text-muted">PDF, images, audio, or text files</p>
        </div>
      )}

      <AnimatePresence>
        {showCamera && (
          <PhotoCapture
            onCapture={(base64) => addPhoto(base64)}
            onClose={() => setShowCamera(false)}
          />
        )}
      </AnimatePresence>

      {/* v2.4 — the screensaver. It covers the whole viewport, so CAPTURE stays
          mounted underneath and the v2.3 recorder never notices it is there. */}
      {discreetActive && <DiscreetScreensaver />}
    </div>
  )
}
