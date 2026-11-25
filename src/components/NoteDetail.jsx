import { motion } from 'framer-motion'
import Session from './Session'
import { useToast } from './ui/Toast'
import { normalizeActionItem } from '../lib/actionItems'

/** A plain-text version of a note, for the share sheet or the clipboard. */
function noteAsText(note) {
  const lines = [note.title || 'Untitled']
  if (note.date) {
    lines.push(new Date(note.date).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
    }))
  }

  const section = (heading, items) => {
    if (!items?.length) return
    lines.push('', heading)
    items.forEach(item => lines.push(`- ${item}`))
  }

  if (note.summary?.paragraph) lines.push('', note.summary.paragraph)
  section('Key points', note.summary?.bullets)
  section('Action items', (note.summary?.actions || []).map(normalizeActionItem).map(a => {
    const owner = a.owner && a.owner !== 'Unknown' ? ` (${a.owner})` : ''
    const due = a.dueDate ? ` — due ${a.dueDate}` : ''
    return `[${a.done ? 'x' : ' '}] ${a.text}${owner}${due}`
  }))
  section('Decisions', note.decisions)
  section('Follow-ups', note.followups)
  return lines.join('\n')
}

/**
 * A note, opened over HOME. Since v2.8 this is the only place a note is read:
 * it opens from the list and automatically when a recording finishes.
 */
export default function NoteDetail({ note, onBack, onUpdateNote, onDeleteNote, onOpenSettings, onReindexNote }) {
  const toast = useToast()

  const handleShare = async () => {
    const text = noteAsText(note)
    // The native share sheet where there is one (phones); the clipboard elsewhere.
    if (navigator.share) {
      try {
        await navigator.share({ title: note.title || 'Meeting notes', text })
        return
      } catch (err) {
        if (err?.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(text)
      toast.show({ message: 'Summary copied — paste it anywhere.', type: 'success', duration: 3000 })
    } catch {
      toast.show({ message: 'Could not copy the summary.', type: 'error' })
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-40 overflow-y-auto app-bg"
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 28, stiffness: 240 }}
    >
      {/* v2.2.1 — this overlay covers the app header, so it carries its own
          safe-area padding; without it the back arrow lands under the iPhone
          status bar / dynamic island. */}
      <div className="safe-top pb-24 max-w-4xl mx-auto">
        <div className="px-4 mb-3 flex items-center justify-between">
          {/* Padding (not a bigger icon) does the work: the arrow and label keep
              their size while the tappable box grows past 48x48. */}
          <motion.button
            onClick={onBack}
            aria-label="Back to home"
            className="tap-target-lg inline-flex items-center justify-center gap-1.5 px-3 -mx-3 py-3 text-accent font-mono text-sm font-medium"
            whileTap={{ scale: 0.95 }}
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 15l-5-5 5-5" />
            </svg>
            Home
          </motion.button>

          <div className="flex items-center gap-1">
            <motion.button
              onClick={handleShare}
              className="btn-ghost tap-target inline-flex items-center justify-center gap-1.5 px-3.5 rounded-xl font-mono text-[13px] font-medium"
              whileTap={{ scale: 0.95 }}
            >
              <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13V3m-3.5 3.5L10 3l3.5 3.5M4.5 10.5V16h11v-5.5" />
              </svg>
              Share
            </motion.button>
            {onDeleteNote && (
              <motion.button
                onClick={() => onDeleteNote(note.id)}
                aria-label="Delete this meeting"
                className="tap-target inline-flex items-center justify-center text-muted hover:text-rec transition-colors"
                whileTap={{ scale: 0.95 }}
              >
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 6h12M8 6V4h4v2M6 6l.7 10h6.6L14 6M8.5 9v4.5M11.5 9v4.5" />
                </svg>
              </motion.button>
            )}
          </div>
        </div>
        <Session note={note} onUpdateNote={onUpdateNote} onOpenSettings={onOpenSettings} onReindexNote={onReindexNote} />
      </div>
    </motion.div>
  )
}
