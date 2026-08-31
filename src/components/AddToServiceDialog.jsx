import { useState } from 'react'
import { motion } from 'framer-motion'
import { draftFromActionItem } from '../lib/actionItems'
import { sendActionItem, SERVICE_LABELS, FALLBACK_LINKS } from '../services/action-sync'
import { useToast } from './ui/Toast'

const LABEL = 'font-mono uppercase text-[10px] tracking-wider text-muted block mb-1'
const FIELD = 'glass-input w-full px-3 py-2 text-sm outline-none'

/**
 * Confirm-and-send dialog for one action item.
 *
 * v2.5 — when both Google and Microsoft are connected the dialog carries a
 * provider switch at the top, so the action-item row still needs only the two
 * original buttons (Event / Task).
 *
 * @param {object} props
 * @param {string[]} props.providers active providers, e.g. ['google', 'microsoft']
 */
export default function AddToServiceDialog({ item, type, noteTitle, providers = ['google'], onClose, onAdded }) {
  const initial = draftFromActionItem(item)
  const [title, setTitle] = useState(initial.title)
  const [date, setDate] = useState(initial.date)
  const [time, setTime] = useState(initial.time)
  const [duration, setDuration] = useState(initial.duration)
  const [provider, setProvider] = useState(providers[0] || 'google')
  const [submitting, setSubmitting] = useState(false)
  const toast = useToast()

  const isEvent = type === 'event'
  const destination = SERVICE_LABELS[provider][isEvent ? 'event' : 'task']

  const handleSubmit = async () => {
    if (submitting) return // no double-submit, no duplicate API calls
    if (!title.trim()) {
      toast.show({ message: 'Give the item a title before adding it.', type: 'error' })
      return
    }
    setSubmitting(true)
    try {
      const result = await sendActionItem({
        type,
        draft: { title: title.trim(), date, time, duration: Number(duration) || 30 },
        item,
        noteTitle,
        provider
        // Microsoft re-consent stays non-interactive (see action-sync): a
        // redirect here would throw away the edits sitting in this dialog.
      })

      if (result.success) {
        toast.show({
          message: `${isEvent ? 'Event' : 'Task'} added to ${destination}.`,
          type: 'success',
          link: result.link,
          linkLabel: `Open in ${destination}`
        })
        onAdded({
          provider,
          type,
          id: result.id,
          link: result.link || FALLBACK_LINKS[provider][isEvent ? 'event' : 'task'],
          title: title.trim(),
          date,
          time,
          duration: isEvent ? Number(duration) || 30 : null,
          addedAt: new Date().toISOString()
        })
        onClose()
        return
      }

      if (result.needsReauth) {
        toast.show({
          message: `Please reconnect to ${SERVICE_LABELS[provider].short}.`,
          type: 'error',
          duration: 8000
        })
      } else if (result.network) {
        toast.show({
          message: `Could not reach ${destination}: ${result.error}`,
          type: 'error',
          duration: 10000,
          actionLabel: 'Retry',
          onAction: () => handleSubmit()
        })
      } else {
        toast.show({
          message: result.error || `${SERVICE_LABELS[provider].short} rejected the request.`,
          type: 'error',
          duration: 8000
        })
      }
    } catch (err) {
      console.error('[NeuroNote:Auth] Unexpected failure adding item:', err)
      toast.show({ message: `Something went wrong: ${err.message}`, type: 'error', duration: 8000 })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40"
      style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="glass w-full max-w-md p-5"
        style={{ background: 'rgba(255,255,255,0.92)' }}
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        transition={{ type: 'spring', damping: 26, stiffness: 260 }}
        onClick={e => e.stopPropagation()}
      >
        <h3 className="font-mono uppercase text-xs font-bold tracking-wider typewriter-shadow mb-4">
          {isEvent ? '📅 Add to Calendar' : '✓ Add to Tasks'}
        </h3>

        <div className="space-y-3">
          {providers.length > 1 && (
            <div>
              <label className={LABEL}>Send to</label>
              <div className="flex gap-1 p-0.5 rounded-full bg-white/60 border border-red/15">
                {providers.map(p => (
                  <button
                    key={p}
                    onClick={() => setProvider(p)}
                    disabled={submitting}
                    className="tap-target -my-2.5 flex-1 flex items-center"
                  >
                    <span
                      className={`block w-full px-2 py-1.5 rounded-full font-mono uppercase text-[9px] tracking-wider transition-all ${
                        provider === p ? 'text-white' : 'text-muted hover:text-ink'
                      }`}
                      style={provider === p ? { background: 'linear-gradient(to right, #dc2626, #991b1b)' } : undefined}
                    >
                      {SERVICE_LABELS[p][isEvent ? 'event' : 'task']}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className={LABEL} htmlFor="gad-title">Title</label>
            <input
              id="gad-title"
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              className={FIELD}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL} htmlFor="gad-date">Date</label>
              <input id="gad-date" type="date" value={date} onChange={e => setDate(e.target.value)} className={`${FIELD} font-mono`} />
            </div>
            <div>
              <label className={LABEL} htmlFor="gad-time">{isEvent ? 'Start time' : 'Time (noted)'}</label>
              <input id="gad-time" type="time" value={time} onChange={e => setTime(e.target.value)} className={`${FIELD} font-mono`} />
            </div>
          </div>

          {isEvent && (
            <div>
              <label className={LABEL} htmlFor="gad-duration">Duration (minutes)</label>
              <input
                id="gad-duration"
                type="number"
                min="5"
                step="5"
                value={duration}
                onChange={e => setDuration(e.target.value)}
                className={`${FIELD} font-mono`}
              />
            </div>
          )}

          {!isEvent && (
            <p className="text-[10px] text-muted leading-relaxed">
              {destination} stores dates only — the time is saved in the task notes as &quot;Due time&quot;.
            </p>
          )}
        </div>

        <div className="flex gap-2 mt-5">
          <motion.button
            onClick={handleSubmit}
            disabled={submitting}
            className="tap-target flex-1 inline-flex items-center justify-center px-4 py-2.5 rounded-xl text-white font-mono uppercase text-[10px] tracking-wider disabled:opacity-60"
            style={{ background: 'linear-gradient(to right, #dc2626, #991b1b)' }}
            whileTap={{ scale: 0.97 }}
          >
            {submitting ? 'Adding...' : `Add to ${destination}`}
          </motion.button>
          <motion.button
            onClick={onClose}
            disabled={submitting}
            className="tap-target inline-flex items-center justify-center px-4 py-2.5 rounded-xl border border-red/30 text-red font-mono uppercase text-[10px] tracking-wider disabled:opacity-60"
            whileTap={{ scale: 0.97 }}
          >
            Cancel
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  )
}
