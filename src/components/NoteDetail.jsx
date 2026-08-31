import { motion } from 'framer-motion'
import Session from './Session'

export default function NoteDetail({ note, onBack, onUpdateNote }) {
  return (
    <motion.div
      className="fixed inset-0 z-40 overflow-y-auto"
      style={{ background: '#f5f0e8' }}
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
    >
      {/* v2.2.1 — this overlay covers the app header, so it carries its own
          safe-area padding; without it the back arrow lands under the iPhone
          status bar / dynamic island. */}
      <div className="safe-top pb-20">
        <div className="px-4 mb-2">
          {/* Padding (not a bigger icon) does the work: the arrow and label keep
              their size while the tappable box grows past 48x48. */}
          <motion.button
            onClick={onBack}
            aria-label="Back to archive"
            className="tap-target-lg inline-flex items-center justify-center gap-2 px-3 -mx-3 py-3 text-red font-mono uppercase text-xs tracking-wider"
            whileTap={{ scale: 0.95 }}
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
              <path d="M12 15l-5-5 5-5" />
            </svg>
            Back
          </motion.button>
        </div>
        <Session note={note} onUpdateNote={onUpdateNote} />
      </div>
    </motion.div>
  )
}
