import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { draftFromActionItem } from '../lib/actionItems'
import { sendActionItem, SERVICE_LABELS, FALLBACK_LINKS } from '../services/action-sync'
import { useToast } from './ui/Toast'
import useIntegration from '../hooks/useIntegration'
import { SIGNED_IN_MESSAGE } from '../services/google-auth'

const LABEL = 'font-mono uppercase text-[9px] tracking-wider text-muted block mb-1'
const FIELD = 'glass-input w-full px-2 py-1.5 text-xs outline-none'

export default function ReviewAddAllModal({ items, noteTitle, onClose, onAdded }) {
  // Only items not already pushed to a calendar/task service are candidates.
  const [rows, setRows] = useState(() =>
    items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !item.sync)
      .map(({ item, index }) => ({ index, ...draftFromActionItem(item), include: true }))
  )
  const [running, setRunning] = useState(false)
  const toast = useToast()
  const { google, microsoft, activeProviders, showGoogle, showMicrosoft, bothActive } = useIntegration()

  // v2.5 — the whole batch goes to one service; the user picks it once here.
  const [target, setTarget] = useState(() => activeProviders[0] || (showGoogle ? 'google' : 'microsoft'))

  // Signing in mid-modal changes what is available, so keep the choice valid.
  useEffect(() => {
    if (activeProviders.length > 0 && !activeProviders.includes(target)) {
      setTarget(activeProviders[0])
    }
  }, [activeProviders, target])

  const connected = activeProviders.length > 0
  const account = target === 'microsoft' ? microsoft.email : google.email
  const calendarLink = FALLBACK_LINKS[target].event

  const patchRow = (index, patch) => {
    setRows(prev => prev.map(r => (r.index === index ? { ...r, ...patch } : r)))
  }

  const handleSignIn = async (which) => {
    const label = which === 'google' ? 'Google' : 'Microsoft'
    try {
      // Microsoft leaves the page here (and this modal with it); Google's
      // popup flow still resolves in place.
      await (which === 'google' ? google.signIn() : microsoft.signIn())
      setTarget(which)
      // v2.6 — a Google sign-in now lasts, so say so instead of just "connected".
      toast.show(which === 'google'
        ? { message: SIGNED_IN_MESSAGE, type: 'success', duration: 7000 }
        : { message: `Connected to ${label}.`, type: 'success' })
    } catch (err) {
      console.error('[NeuroNote:Auth] Sign-in from Review & Add All failed:', err)
      toast.show({ message: `${label} sign-in failed: ${err.message}`, type: 'error', duration: 8000 })
    }
  }

  const handleAddAll = async () => {
    if (running) return // guard against duplicate batch runs
    const selected = rows.filter(r => r.include && r.title.trim())
    if (selected.length === 0) {
      toast.show({ message: 'Nothing selected to add.', type: 'info' })
      return
    }

    setRunning(true)
    const progressId = toast.show({ message: `0 of ${selected.length} added...`, type: 'progress', duration: 0 })

    let events = 0
    let tasks = 0
    const failures = []
    let reauthNeeded = false

    for (let i = 0; i < selected.length; i++) {
      const row = selected[i]
      try {
        const result = await sendActionItem({
          type: row.type,
          draft: { title: row.title.trim(), date: row.date, time: row.time, duration: Number(row.duration) || 30 },
          item: items[row.index],
          noteTitle,
          provider: target,
          // v2.5.1 — an interactive Microsoft prompt is a full-page redirect
          // now, so it would abandon the rest of the batch. Let an expired
          // session surface as needsReauth and ask the user to reconnect.
          allowInteractive: false
        })

        if (result.success) {
          if (row.type === 'event') events++
          else tasks++
          // Lock the row so a partial-failure retry cannot create it twice.
          patchRow(row.index, { include: false, added: true })
          onAdded(row.index, {
            provider: target,
            type: row.type,
            id: result.id,
            link: result.link || FALLBACK_LINKS[target][row.type === 'event' ? 'event' : 'task'],
            title: row.title.trim(),
            date: row.date,
            time: row.time,
            duration: row.type === 'event' ? Number(row.duration) || 30 : null,
            addedAt: new Date().toISOString()
          })
        } else {
          failures.push({ title: row.title, error: result.error })
          if (result.needsReauth) {
            reauthNeeded = true
            break // no point continuing without a valid token
          }
        }
      } catch (err) {
        console.error('[NeuroNote:Auth] Batch add failed for item:', row.title, err)
        failures.push({ title: row.title, error: err.message })
      }

      toast.update(progressId, { message: `${events + tasks} of ${selected.length} added...` })
    }

    toast.dismiss(progressId)
    setRunning(false)

    const serviceName = SERVICE_LABELS[target].short
    const openLabel = target === 'microsoft' ? 'Open Outlook' : 'Open Calendar'

    if (reauthNeeded) {
      toast.show({
        message: `Please reconnect to ${serviceName} — the session expired mid-batch.`,
        type: 'error',
        duration: 10000
      })
    } else if (failures.length > 0) {
      console.error('[NeuroNote:Auth] Batch completed with failures:', failures)
      toast.show({
        message: `${events} event${events === 1 ? '' : 's'} + ${tasks} task${tasks === 1 ? '' : 's'} added. ${failures.length} failed.`,
        type: 'error',
        duration: 10000,
        link: calendarLink,
        linkLabel: openLabel
      })
    } else {
      toast.show({
        message: `${events} event${events === 1 ? '' : 's'} + ${tasks} task${tasks === 1 ? '' : 's'} added to ${serviceName}.`,
        type: 'success',
        duration: 8000,
        link: calendarLink,
        linkLabel: openLabel
      })
    }

    if (failures.length === 0) onClose()
  }

  const signInButton = (which, disabled) => (
    <motion.button
      key={which}
      onClick={() => handleSignIn(which)}
      disabled={disabled}
      className="tap-target inline-flex items-center justify-center px-5 py-2.5 rounded-xl text-white font-mono uppercase text-[10px] tracking-wider disabled:opacity-60"
      style={{ background: 'linear-gradient(to right, #dc2626, #991b1b)' }}
      whileTap={{ scale: 0.97 }}
    >
      {disabled ? 'Connecting...' : `Sign In with ${which === 'google' ? 'Google' : 'Microsoft'}`}
    </motion.button>
  )

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-4 bg-black/40"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={running ? undefined : onClose}
    >
      <motion.div
        className="glass w-full max-w-2xl p-5 max-h-[85vh] flex flex-col"
        style={{ background: 'rgba(255,255,255,0.92)' }}
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        transition={{ type: 'spring', damping: 26, stiffness: 260 }}
        onClick={e => e.stopPropagation()}
      >
        <h3 className="font-mono uppercase text-xs font-bold tracking-wider typewriter-shadow mb-1">
          Review &amp; Add All
        </h3>
        <p className="text-[11px] text-muted mb-4">
          Edit anything below, flip Event/Task per item, then add them all at once.
        </p>

        {!connected ? (
          <div className="text-center py-8">
            <p className="font-mono uppercase text-xs tracking-wider mb-3">Connect a calendar first</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {showGoogle && google.clientId && signInButton('google', google.signingIn)}
              {showMicrosoft && microsoft.clientId && signInButton('microsoft', microsoft.signingIn)}
            </div>
            {!(showGoogle && google.clientId) && !(showMicrosoft && microsoft.clientId) && (
              <p className="text-[11px] text-muted">
                Add a Client ID under Calendar &amp; Tasks Integration in the SYSTEM tab to enable this.
              </p>
            )}
          </div>
        ) : (
          <>
            {bothActive && (
              <div className="mb-3">
                <label className={LABEL}>Send events/tasks to</label>
                <div className="flex gap-1 p-0.5 rounded-full bg-white/60 border border-red/15 max-w-xs">
                  {['google', 'microsoft'].map(p => (
                    <button
                      key={p}
                      onClick={() => setTarget(p)}
                      disabled={running}
                      className="tap-target -my-2.5 flex-1 flex items-center"
                    >
                      <span
                        className={`block w-full px-3 py-1.5 rounded-full font-mono uppercase text-[9px] tracking-wider transition-all ${
                          target === p ? 'text-white' : 'text-muted hover:text-ink'
                        }`}
                        style={target === p ? { background: 'linear-gradient(to right, #dc2626, #991b1b)' } : undefined}
                      >
                        {SERVICE_LABELS[p].short}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="text-[10px] text-muted font-mono tracking-wider mb-3">
              {SERVICE_LABELS[target].short.toUpperCase()} // {account || 'CONNECTED'}
            </p>
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {rows.length === 0 && (
                <p className="text-sm text-muted py-6 text-center">
                  Every action item has already been added.
                </p>
              )}
              {rows.map(row => (
                <div key={row.index} className="rounded-xl border border-red/15 bg-white/50 p-3">
                  <div className="flex items-start gap-2 mb-2">
                    <button
                      onClick={() => !row.added && patchRow(row.index, { include: !row.include })}
                      disabled={row.added}
                      className="tap-target -m-3.5 flex-shrink-0 flex items-center justify-center"
                      aria-label={row.added ? 'Already added' : row.include ? 'Exclude this item' : 'Include this item'}
                    >
                      <span
                        className={`w-4 h-4 mt-2 rounded border flex items-center justify-center transition-colors ${
                          row.added ? 'bg-green-600 border-green-600 text-white' : row.include ? 'bg-red border-red text-white' : 'border-red/30'
                        }`}
                      >
                        {(row.include || row.added) && <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor"><path d="M5 10l3 3 7-7" /></svg>}
                      </span>
                    </button>
                    <input
                      value={row.title}
                      onChange={e => patchRow(row.index, { title: e.target.value })}
                      disabled={row.added}
                      className={`${FIELD} flex-1 disabled:opacity-50`}
                    />
                    {row.added && (
                      <span className="font-mono uppercase text-[9px] tracking-wider text-green-700 mt-2 whitespace-nowrap">
                        ✓ Added
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pl-6">
                    <div>
                      <label className={LABEL}>Date</label>
                      <input type="date" value={row.date} onChange={e => patchRow(row.index, { date: e.target.value })} className={`${FIELD} font-mono`} />
                    </div>
                    <div>
                      <label className={LABEL}>Time</label>
                      <input type="time" value={row.time} onChange={e => patchRow(row.index, { time: e.target.value })} className={`${FIELD} font-mono`} />
                    </div>
                    <div>
                      <label className={LABEL}>Duration</label>
                      <input
                        type="number"
                        min="5"
                        step="5"
                        value={row.duration}
                        disabled={row.type !== 'event'}
                        onChange={e => patchRow(row.index, { duration: e.target.value })}
                        className={`${FIELD} font-mono disabled:opacity-40`}
                      />
                    </div>
                    <div>
                      <label className={LABEL}>Type</label>
                      <div className="flex gap-1 p-0.5 rounded-full bg-white/60 border border-red/15">
                        {['event', 'task'].map(t => (
                          <button
                            key={t}
                            onClick={() => patchRow(row.index, { type: t })}
                            className="tap-target -my-3 flex-1 flex items-center"
                          >
                            <span
                              className={`block w-full px-2 py-1 rounded-full font-mono uppercase text-[9px] tracking-wider transition-all ${
                                row.type === t ? 'text-white' : 'text-muted hover:text-ink'
                              }`}
                              style={row.type === t ? { background: 'linear-gradient(to right, #dc2626, #991b1b)' } : undefined}
                            >
                              {t === 'event' ? '📅 Event' : '✓ Task'}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2 mt-4">
              <motion.button
                onClick={handleAddAll}
                disabled={running || rows.length === 0}
                className="tap-target flex-1 inline-flex items-center justify-center px-4 py-2.5 rounded-xl text-white font-mono uppercase text-[10px] tracking-wider disabled:opacity-60"
                style={{ background: 'linear-gradient(to right, #dc2626, #991b1b)' }}
                whileTap={{ scale: 0.97 }}
              >
                {running ? 'Adding...' : `Add All to ${SERVICE_LABELS[target].short}`}
              </motion.button>
              <motion.button
                onClick={onClose}
                disabled={running}
                className="tap-target inline-flex items-center justify-center px-4 py-2.5 rounded-xl border border-red/30 text-red font-mono uppercase text-[10px] tracking-wider disabled:opacity-60"
                whileTap={{ scale: 0.97 }}
              >
                Cancel
              </motion.button>
            </div>
          </>
        )}

        {!connected && (
          <div className="flex justify-center mt-4">
            <button onClick={onClose} className="tap-target inline-flex items-center justify-center px-4 font-mono uppercase text-[10px] tracking-wider text-muted hover:text-red">
              Cancel
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}
