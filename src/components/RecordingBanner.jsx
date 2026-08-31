import { motion, AnimatePresence } from 'framer-motion'
import { useRecordingContext, formatDuration } from '../contexts/RecordingContext'

/**
 * v2.3 — the always-visible proof that a recording is still running.
 *
 * The recorder now outlives the CAPTURE tab, which is the whole point of the
 * v2.3 rewrite — but a recorder the user cannot see is its own kind of bug. This
 * banner rides above every tab so the meeting is never quietly recording in the
 * background: tap it to jump back to CAPTURE, or use the × to stop from here.
 */
export default function RecordingBanner() {
  const { recordingState, elapsedSeconds, isPaused, navigateToTab, stopRecording, ask, discreetActive } = useRecordingContext()

  // v2.4 — in Discreet Mode the banner is suppressed everywhere. A "Recording"
  // badge on any tab would defeat the entire point of the screensaver.
  const visible = (recordingState === 'recording' || recordingState === 'paused') && !discreetActive

  const handleStop = async (e) => {
    e.stopPropagation()
    const choice = await ask({
      title: 'Stop recording?',
      message: `This ends the ${formatDuration(elapsedSeconds)} recording and starts transcribing it.`,
      options: [
        { label: 'Keep Recording', value: 'keep', primary: true },
        { label: 'Stop & Transcribe', value: 'stop' }
      ],
      dismissValue: 'keep'
    })
    if (choice === 'stop') {
      navigateToTab('capture')
      stopRecording()
    }
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed left-0 right-0 z-40 flex justify-center px-4 pointer-events-none"
          // Sits just below the fixed header, clear of the notch.
          style={{ top: 'calc(56px + env(safe-area-inset-top))' }}
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.2 }}
        >
          <div className="glass pointer-events-auto flex items-center gap-2 pl-3 pr-1 py-1 shadow-md"
            style={{ borderColor: '#dc262655' }}>
            <button
              onClick={() => navigateToTab('capture')}
              className="tap-target -my-2 flex items-center gap-2 pr-1"
              aria-label="Return to the capture tab"
            >
              <span
                className={`w-2.5 h-2.5 rounded-full bg-red ${isPaused ? '' : 'dot-pulse-fast'}`}
                style={{ background: '#dc2626' }}
              />
              <span className="font-mono uppercase text-[11px] tracking-wider font-bold whitespace-nowrap">
                {isPaused ? 'Paused' : 'Recording'} — {formatDuration(elapsedSeconds)}
              </span>
            </button>
            {/* The label is distinct from CAPTURE's Stop button: on CAPTURE both
                are on screen at once, and two controls labelled "Stop recording"
                are ambiguous to a screen reader. */}
            <button
              onClick={handleStop}
              className="tap-target -my-2 flex items-center justify-center text-muted hover:text-red text-base leading-none"
              aria-label="Stop recording from banner"
            >
              ×
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
