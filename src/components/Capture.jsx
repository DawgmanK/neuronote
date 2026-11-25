import { useState, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRecordingContext, formatDuration } from '../contexts/RecordingContext'
import Waveform from './ui/Waveform'
import GlassCard from './ui/GlassCard'
import LiveActionItems from './LiveActionItems'
import PhotoCapture from './PhotoCapture'
import SegmentProgress from './SegmentProgress'
import DiscreetScreensaver from './DiscreetScreensaver'
import { getApiKey, getItem, setItem } from '../lib/storage'
import { getActiveModel } from '../lib/models'
import { transcribeAudio } from '../lib/assemblyai'
import { applyCorrections } from '../lib/corrections'
import { generateFlashcards, extractImageText, hasActiveApiKey } from '../lib/ai-provider'
import { summarizeTranscript, summaryFields, titleFromSummary } from '../lib/summarize'
import { useToast } from './ui/Toast'
import { hasDriveScope } from '../services/google-auth'

// v2.8.3 — what an uploaded file is, judged by its type AND its name.
// Browsers report .mp4 and .webm as video/* even when they hold only audio
// (NeuroNote's own recordings are .webm), and some files arrive with no type
// at all. Anything that is not recognisably a recording, a picture or text is
// refused: it used to be decoded as text, which turned a video or a PDF into
// megabytes of garbage that was then sent off to be summarized.
const RECORDING_EXT = /\.(mp3|m4a|mp4|wav|webm|ogg|oga|aac|flac|mov)$/i
const RECORDING_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/ogg']
const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i
const TEXT_EXT = /\.(txt|md|markdown|csv|vtt|srt)$/i

function classifyUpload(file) {
  const type = (file.type || '').toLowerCase()
  const name = file.name || ''
  if (type.startsWith('audio/') || RECORDING_VIDEO_TYPES.includes(type) || RECORDING_EXT.test(name)) return 'recording'
  if (type.startsWith('image/') || IMAGE_EXT.test(name)) return 'image'
  if (type.startsWith('text/') || TEXT_EXT.test(name)) return 'text'
  return null
}

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
    discreetMode,
    discreetActive,
    setDiscreetMode,
    enterDiscreet,
    navigateToTab,
    ask
  } = useRecordingContext()

  const [mode, setMode] = useState('record')
  const toast = useToast()
  const [showCamera, setShowCamera] = useState(false)
  const [uploadProcessing, setUploadProcessing] = useState(false)
  const [uploadStep, setUploadStep] = useState('')
  const transcriptRef = useRef(null)

  const fullLiveTranscript = useMemo(
    () => liveTranscript.map(t => `${t.speaker}: ${t.text}`).join('\n'),
    [liveTranscript]
  )

  const processing = isProcessing || uploadProcessing
  const currentStep = processingStep || uploadStep

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
            <li><span className="font-bold text-accent">ILLEGAL</span> in 11 all-party consent states (CA, CT, DE, FL, IL, MD, MA, MT, NV, NH, PA, WA)</li>
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

    // v2.9 — the Sales call tab records exactly like a meeting; what differs
    // is the report the summary produces and where it is sent afterwards.
    const started = await startRecording({ kind: mode === 'sales' ? 'sales-call' : 'meeting' })
    // Only hide the screen once there is genuinely a recording to hide; a failed
    // start must leave the user looking at the error, not at a black screen.
    if (started && discreetMode) enterDiscreet()
  }

  const handleFileUpload = async (files) => {
    if (!files?.length) return
    const file = files[0]

    // A refused or failed upload says why and saves nothing. It used to save a
    // note whose "transcript" was the error message.
    const refuse = (message) => {
      setUploadProcessing(false)
      setUploadStep('')
      toast.show({ message, type: 'error', duration: 9000 })
    }

    const kind = classifyUpload(file)
    if (!kind) {
      refuse(`NeuroNote can't read “${file.name}”. Upload a recording, a photo, or a text file.`)
      return
    }
    if (kind === 'recording' && !(getApiKey('assemblyai') && settings?.useAssemblyAI)) {
      refuse('Transcribing an uploaded recording needs AssemblyAI. Add a key under Settings → Transcripts, then upload it again.')
      return
    }
    if (kind === 'image' && !hasActiveApiKey()) {
      refuse('Reading text from a photo needs an AI key. Add one under Settings → AI, then upload it again.')
      return
    }

    setUploadProcessing(true)

    let content = ''
    let transcriptSource = 'file'
    let speakers = 1

    if (kind === 'recording') {
      transcriptSource = 'assemblyai'
      setUploadStep('Transcribing the recording...')
      try {
        const blob = new Blob([await file.arrayBuffer()], { type: file.type || 'application/octet-stream' })
        const result = await transcribeAudio(blob, { speakerLabels: diarization })
        content = result.text
        speakers = result.speakers || 1
      } catch (e) {
        console.error('[NeuroNote] Upload transcription failed:', e)
        refuse(`That recording couldn't be transcribed: ${e.message}`)
        return
      }
    } else if (kind === 'image') {
      transcriptSource = 'photo'
      setUploadStep('Reading text from the photo...')
      try {
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result)
          reader.onerror = () => reject(new Error('the file could not be read'))
          reader.readAsDataURL(file)
        })
        content = await extractImageText(base64, getActiveModel(settings))
      } catch (e) {
        console.error('[NeuroNote] Upload OCR failed:', e)
        refuse(`The text in that photo couldn't be read: ${e.message}`)
        return
      }
    } else {
      setUploadStep('Reading file...')
      content = applyCorrections(await file.text())
    }

    if (!content || !content.trim()) {
      refuse(kind === 'recording' ? 'No speech was found in that recording.' : `Nothing readable was found in “${file.name}”.`)
      return
    }

    const aiKeyConfigured = hasActiveApiKey()
    let flashcardData = null

    setUploadStep('Writing the summary...')
    const summaryResult = await summarizeTranscript(content, settings)

    try {
      if (aiKeyConfigured) {
        setUploadStep('Generating flashcards...')
        flashcardData = await generateFlashcards(content)
      }
    } catch (e) {
      console.error('[NeuroNote] Upload flashcard gen failed:', e)
    }

    const note = {
      id: Date.now(),
      title: titleFromSummary(summaryResult) || file.name.replace(/\.[^/.]+$/, '').slice(0, 40),
      titleAuto: true,
      date: new Date().toISOString(),
      duration: 0,
      transcript: content,
      originalTranscript: content,
      transcriptSource,
      ...summaryFields(summaryResult),
      flashcards: flashcardData?.flashcards || [],
      quiz: flashcardData?.quiz || [],
      photos: [],
      speakers,
      tags: [],
      type: 'upload'
    }

    setUploadProcessing(false)
    setUploadStep('')
    onSaveNote(note)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    handleFileUpload(e.dataTransfer.files)
  }

  const hasAiKey = hasActiveApiKey()
  const hasTranscriptionKey = !!getApiKey('assemblyai') && !!settings?.useAssemblyAI

  return (
    <div className="px-4 pb-4">
      {/* Mode switch — hidden once a recording is under way, when it would only
          be something to mis-tap. */}
      {!isRecording && !processing && (
        <div className="flex justify-center mb-8">
          <div className="flex gap-1 p-1 rounded-full bg-white/[0.05] border border-white/10" role="tablist" aria-label="Capture mode">
            {[['record', 'Meeting'], ['sales', 'Sales call'], ['upload', 'Upload']].map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={mode === id}
                onClick={() => setMode(id)}
                className="tap-target -my-2 flex items-center"
              >
                <span
                  className={`block px-4 py-1.5 rounded-full font-mono text-[13px] font-medium whitespace-nowrap transition-all ${
                    mode === id ? 'bg-white/[0.12] text-ink chrome-ring' : 'text-muted hover:text-ink'
                  }`}
                >
                  {label}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {mode !== 'upload' || isRecording || isProcessing ? (
        <div className="flex flex-col items-center">
          {!isRecording && !processing && (
            <motion.div
              className="flex flex-col items-center w-full"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {/* The orb: chrome bezel, neon-red core. */}
              <motion.button
                onClick={handleStartRecording}
                className="chrome-ring relative w-40 h-40 rounded-full flex items-center justify-center breathe"
                style={{
                  background: 'radial-gradient(circle at 50% 35%, #1b1d23 0%, #08090b 70%)',
                  boxShadow: '0 0 70px rgba(255,45,85,0.22), inset 0 2px 0 rgba(255,255,255,0.08)'
                }}
                whileTap={{ scale: 0.95 }}
                aria-label="Start recording"
              >
                <span
                  className="w-28 h-28 rounded-full flex items-center justify-center text-white"
                  style={{ background: 'var(--grad-rec)', boxShadow: 'var(--glow-rec), inset 0 2px 6px rgba(255,255,255,0.35)' }}
                >
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="3" width="6" height="11" rx="3" />
                    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
                  </svg>
                </span>
              </motion.button>

              <p className="font-mono font-semibold text-lg mt-6">
                {mode === 'sales' ? 'Tap to record your call report' : 'Tap to record'}
              </p>
              {mode === 'sales' ? (
                <>
                  <p className="text-sm text-muted mt-1 text-center max-w-xs">
                    Say who you saw, what happened, and what comes next. Cover as many customers as you like.
                  </p>
                  {/* v2.9 — where the report goes once it is written. */}
                  {settings?.grokHandoff && hasDriveScope() ? (
                    <p className="pill pill-ok mt-3 !py-1 !px-3 !text-xs">Goes to your Grok folder when you stop</p>
                  ) : settings?.handoffEmail ? (
                    <p className="pill pill-ok mt-3 !py-1 !px-3 !text-xs">You&apos;ll get an Email to Grok button when you stop</p>
                  ) : (
                    <button
                      onClick={() => navigateToTab('system')}
                      className="pill pill-accent mt-3 !py-1.5 !px-3 !text-xs !whitespace-normal text-center hover:brightness-125 transition"
                    >
                      Set up sending to Grok in Settings →
                    </button>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted mt-1 text-center max-w-xs">
                  Keeps recording if you switch tabs or lock your screen.
                </p>
              )}

              {/* v2.8 — the two pre-meeting choices as switches, with one line
                  of explanation that follows whichever is on. */}
              <div className="grid grid-cols-2 gap-3 w-full max-w-sm mt-8">
                {[
                  { label: 'Speakers', on: diarization, toggle: () => setDiarization(!diarization), aria: 'Speaker detection' },
                  { label: 'Discreet', on: discreetMode, toggle: () => handleDiscreetToggle(!discreetMode), aria: 'Discreet mode' }
                ].map(option => (
                  <button
                    key={option.label}
                    role="switch"
                    aria-checked={option.on}
                    aria-label={option.aria}
                    onClick={option.toggle}
                    className={`tap-target flex items-center justify-between gap-2 px-4 py-3 rounded-2xl border transition-all ${
                      option.on ? 'border-accent/50 bg-accent/10' : 'border-white/10 bg-white/[0.04]'
                    }`}
                    style={option.on ? { boxShadow: '0 0 18px rgba(42,168,255,0.18)' } : undefined}
                  >
                    <span className="font-mono text-sm font-medium">{option.label}</span>
                    <span className={`flex items-center gap-1.5 text-xs font-mono ${option.on ? 'text-accent' : 'text-muted'}`}>
                      <span className="w-1.5 h-1.5 rounded-full"
                        style={{ background: option.on ? '#2aa8ff' : '#4a4f59', boxShadow: option.on ? '0 0 8px #2aa8ff' : 'none' }} />
                      {option.on ? 'On' : 'Off'}
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted leading-relaxed text-center max-w-sm mt-3">
                {discreetMode
                  ? 'Discreet: the screen goes dark while recording. Double-tap the left side to pause, the right side to come back.'
                  : diarization
                    ? 'Speakers: the transcript labels who said what. Best for calls and interviews.'
                    : 'Speakers off: one voice, faster transcript.'}
              </p>

              {(!hasAiKey || !hasTranscriptionKey) && (
                <button
                  onClick={() => navigateToTab('system')}
                  className="pill mt-5 !py-1.5 !px-3 !text-xs hover:text-ink transition-colors !whitespace-normal text-center"
                >
                  Basic mode — add {!hasAiKey && !hasTranscriptionKey ? 'your keys' : !hasAiKey ? 'an AI key' : 'a transcription key'} in Settings for {!hasAiKey && !hasTranscriptionKey ? 'accurate transcripts and AI summaries' : hasAiKey ? 'accurate transcripts' : 'AI summaries'} →
                </button>
              )}
            </motion.div>
          )}

          {isRecording && (
            <motion.div
              className="w-full"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="text-center mb-4">
                <p className={`inline-flex items-center gap-2 font-mono text-sm font-medium ${isPaused ? 'text-muted' : 'text-rec'}`}>
                  <span className={`w-2 h-2 rounded-full ${isPaused ? '' : 'dot-pulse-fast'}`}
                    style={{ background: isPaused ? '#6c727d' : '#ff2d55', boxShadow: isPaused ? 'none' : '0 0 10px #ff2d55' }} />
                  {isPaused ? 'Paused' : 'Recording'}
                </p>
                <p className="chrome-text font-mono text-6xl font-bold tracking-tight mt-1">{formatDuration(elapsedSeconds)}</p>
              </div>

              <div className="mb-4">
                <Waveform stream={stream} isRecording={isRecording && !isPaused} />
              </div>

              {/* v2.3 — live proof that chunks are already being transcribed. */}
              <div className="mb-6">
                <SegmentProgress
                  segments={segments}
                  elapsedSeconds={elapsedSeconds}
                  isRecording={isRecording}
                  enabled={chunkedTranscription}
                />
                {chunkedTranscription && (
                  <p className="text-xs text-muted mt-1.5">
                    Transcribing every 5 minutes as you go · speakers {diarization ? 'on' : 'off'}
                  </p>
                )}
              </div>

              {/* Controls */}
              <div className="flex justify-center items-center gap-6 mb-3">
                <motion.button
                  onClick={isPaused ? resumeRecording : pauseRecording}
                  className="btn-ghost w-14 h-14 rounded-full flex items-center justify-center !text-ink"
                  whileTap={{ scale: 0.9 }}
                  aria-label={isPaused ? 'Resume recording' : 'Pause recording'}
                >
                  {isPaused ? (
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M6 4l10 6-10 6z"/></svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><rect x="5" y="4" width="3" height="12" rx="1"/><rect x="12" y="4" width="3" height="12" rx="1"/></svg>
                  )}
                </motion.button>

                <motion.button
                  onClick={stopRecording}
                  className="relative w-[76px] h-[76px] rounded-full flex items-center justify-center text-white"
                  style={{ background: 'var(--grad-rec)', boxShadow: 'var(--glow-rec)' }}
                  whileTap={{ scale: 0.9 }}
                  aria-label="Stop recording"
                >
                  {!isPaused && <span className="orb-halo absolute inset-0 rounded-full border-2 border-rec" />}
                  <svg width="24" height="24" viewBox="0 0 20 20" fill="currentColor"><rect x="4" y="4" width="12" height="12" rx="2.5"/></svg>
                </motion.button>

                <motion.button
                  onClick={() => setShowCamera(true)}
                  className="btn-ghost w-14 h-14 rounded-full flex items-center justify-center !text-ink"
                  whileTap={{ scale: 0.9 }}
                  aria-label="Capture a photo"
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="5" width="16" height="11" rx="2"/><circle cx="10" cy="10.5" r="3"/><path d="M7 5l1-2h4l1 2"/></svg>
                </motion.button>
              </div>
              <p className="text-center text-xs text-muted mb-2">Stop to save and summarize</p>

              <div className="flex justify-center gap-2 mb-6">
                <button
                  onClick={() => discardRecording()}
                  className="tap-target inline-flex items-center justify-center px-4 font-mono text-xs text-muted hover:text-rec transition-colors"
                >
                  Discard recording
                </button>
                {/* v2.4 — re-enter the screensaver mid-recording, e.g. after
                    double-tapping out of it to check on the transcript. */}
                {discreetMode && (
                  <button
                    onClick={enterDiscreet}
                    className="tap-target inline-flex items-center justify-center px-4 font-mono text-xs text-muted hover:text-ink transition-colors"
                  >
                    Hide screen
                  </button>
                )}
              </div>

              {/* Live transcript + Action items */}
              <div className="grid md:grid-cols-2 gap-4">
                <GlassCard hoverable={false} animate={false}>
                  <h3 className="section-label mb-2">Live transcript</h3>
                  <div ref={transcriptRef} className="max-h-48 overflow-y-auto space-y-1.5">
                    {liveTranscript.length === 0 ? (
                      <p className="text-sm text-muted">Listening for speech…</p>
                    ) : (
                      liveTranscript.map((t, i) => (
                        <p key={i} className="text-sm leading-relaxed">
                          <span className="font-mono font-semibold text-accent">{t.speaker}</span> {t.text}
                        </p>
                      ))
                    )}
                  </div>
                </GlassCard>

                <LiveActionItems
                  transcript={fullLiveTranscript}
                  isRecording={isRecording}
                  enabled={settings?.liveActionItems}
                  hasApiKey={hasAiKey}
                />
              </div>

              {photos.length > 0 && (
                <div className="flex gap-2 mt-4 overflow-x-auto">
                  {photos.map((p, i) => (
                    <img key={i} src={p} alt={`Capture ${i + 1}`} className="w-16 h-16 rounded-xl object-cover flex-shrink-0 border border-white/10" />
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
              <div className="chrome-ring w-20 h-20 rounded-full bg-panel-2 flex items-center justify-center mx-auto mb-5"
                style={{ boxShadow: '0 0 50px rgba(42,168,255,0.25)' }}>
                <div className="w-9 h-9 rounded-full border-2 border-accent border-t-transparent animate-spin" />
              </div>
              <p className="font-mono font-semibold text-base">{currentStep || 'Working…'}</p>
              <p className="text-xs text-muted mt-1">You can leave this screen. Your note opens when it is ready.</p>
              {/* Indeterminate on purpose: the steps have no measurable
                  percentage, so the bar sweeps rather than claiming one. */}
              <div className="mt-5 w-56 h-1 bg-white/10 rounded-full mx-auto overflow-hidden">
                <div className="h-full w-full rounded-full shimmer" />
              </div>

              {recordingState === 'processing' && segments.length > 0 && (
                <div className="mt-6 flex justify-center">
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
      ) : uploadProcessing ? (
        <div className="w-full text-center py-12">
          <div className="chrome-ring w-20 h-20 rounded-full bg-panel-2 flex items-center justify-center mx-auto mb-5"
            style={{ boxShadow: '0 0 50px rgba(42,168,255,0.25)' }}>
            <div className="w-9 h-9 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          </div>
          <p className="font-mono font-semibold text-base">{uploadStep || 'Working…'}</p>
          <div className="mt-5 w-56 h-1 bg-white/10 rounded-full mx-auto overflow-hidden">
            <div className="h-full w-full rounded-full shimmer" />
          </div>
        </div>
      ) : (
        /* UPLOAD MODE */
        <div
          className="border border-dashed border-white/20 rounded-3xl p-10 text-center cursor-pointer hover:border-accent/60 hover:bg-accent/[0.04] transition-colors"
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          onClick={() => document.getElementById('file-upload').click()}
          role="button"
          tabIndex={0}
          onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && document.getElementById('file-upload').click()}
        >
          {/* v2.8 — PDFs are no longer offered: the app has no PDF reader, so
              they used to be read as raw bytes and produced a garbage note. */}
          <input
            id="file-upload"
            type="file"
            className="hidden"
            accept=".jpg,.jpeg,.png,.webp,.mp3,.m4a,.mp4,.wav,.webm,.ogg,.aac,.txt,.md,audio/*,image/*,text/plain"
            // Cleared afterwards so choosing the same file again still fires.
            onChange={e => { const picked = e.target.files; handleFileUpload(picked).finally(() => { e.target.value = '' }) }}
          />
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 text-accent bg-accent/10 border border-accent/30"
            style={{ boxShadow: '0 0 24px rgba(42,168,255,0.2)' }}>
            <svg width="24" height="24" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 16h12M10 3v9m-3.5-5.5L10 3l3.5 3.5"/>
            </svg>
          </div>
          <p className="font-mono font-semibold text-base mb-1">Choose a file or drop it here</p>
          <p className="text-sm text-muted">A recording, a photo of a whiteboard, or a text file</p>
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
