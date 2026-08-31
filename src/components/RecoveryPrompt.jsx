import { motion, AnimatePresence } from 'framer-motion'
import { useRecordingContext } from '../contexts/RecordingContext'

function minutesAgo(timestamp) {
  const mins = Math.round((Date.now() - (timestamp || Date.now())) / 60000)
  if (mins < 1) return 'moments ago'
  if (mins === 1) return '1 minute ago'
  if (mins < 60) return `${mins} minutes ago`
  const hours = Math.round(mins / 60)
  return hours === 1 ? '1 hour ago' : `${hours} hours ago`
}

function lengthLabel(seconds) {
  const mins = Math.floor((seconds || 0) / 60)
  const secs = Math.floor((seconds || 0) % 60)
  if (mins < 1) return `${secs} seconds long`
  return mins === 1 ? '1 minute long' : `${mins} minutes long`
}

/**
 * v2.3 — the payoff for auto-saving to IndexedDB.
 *
 * If the app was closed, crashed, or reloaded mid-meeting, the audio is still
 * sitting in IndexedDB. On the next launch this offers it back rather than
 * letting it rot in storage the user never sees.
 */
export default function RecoveryPrompt() {
  const { recovery, recoverRecording, discardRecovery, dismissRecovery } = useRecordingContext()

  // elapsedSeconds is exact as of the last auto-save, which can be up to 30
  // seconds stale. Where it is missing entirely, fall back to how long the
  // recording had been running when it was last written.
  const lengthSeconds = recovery
    ? recovery.elapsedSeconds || Math.round(((recovery.savedAt || 0) - (recovery.startTime || 0)) / 1000)
    : 0

  return (
    <AnimatePresence>
      {recovery && (
        <motion.div
          className="fixed inset-0 z-[65] flex items-center justify-center px-6"
          style={{ background: 'rgba(30, 25, 20, 0.35)', backdropFilter: 'blur(4px)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="glass w-full max-w-sm p-5"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            role="dialog"
            aria-modal="true"
            aria-label="Unsaved recording found"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#dc2626' }} />
              <h3 className="font-mono uppercase text-xs font-bold tracking-wider">Unsaved Recording Found</h3>
            </div>
            <p className="text-sm leading-snug mb-1">
              You have an unsaved recording from {minutesAgo(recovery.startTime)} ({lengthLabel(lengthSeconds)}). Recover it?
            </p>
            <p className="text-[11px] text-muted mb-4">
              Recovering transcribes the saved audio and turns it into a session note.
            </p>

            <div className="flex flex-col gap-2">
              <button
                onClick={() => recoverRecording()}
                className="tap-target w-full flex items-center justify-center px-4 rounded-xl font-mono uppercase text-xs tracking-wider text-white"
                style={{ background: 'linear-gradient(to right, #dc2626, #991b1b)' }}
              >
                Recover
              </button>
              <button
                onClick={() => dismissRecovery()}
                className="tap-target w-full flex items-center justify-center px-4 rounded-xl font-mono uppercase text-xs tracking-wider text-muted border border-black/10 bg-white/40 hover:text-ink"
              >
                Later
              </button>
              <button
                onClick={() => discardRecovery()}
                className="tap-target w-full flex items-center justify-center px-4 rounded-xl font-mono uppercase text-xs tracking-wider text-red border border-red/30 bg-white/40"
              >
                Discard
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
