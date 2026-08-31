import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import Flashcards from './Flashcards'
import AddToServiceDialog from './AddToServiceDialog'
import ReviewAddAllModal from './ReviewAddAllModal'
import CorrectableText from './CorrectableText'
import { useToast } from './ui/Toast'
import useIntegration from '../hooks/useIntegration'
import { SIGNED_IN_MESSAGE } from '../services/google-auth'
import { addedLabel } from '../services/action-sync'
import { normalizeActionItem } from '../lib/actionItems'
import { replacePreservingCase } from '../lib/corrections'

const subTabs = ['summary', 'transcript', 'original', 'flashcards']

export default function Session({ note, onUpdateNote }) {
  const [activeSubTab, setActiveSubTab] = useState('summary')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState('')
  const [editingSpeaker, setEditingSpeaker] = useState(null)
  const [speakerName, setSpeakerName] = useState('')
  const [viewingPhoto, setViewingPhoto] = useState(null)
  const [dialog, setDialog] = useState(null)      // { index, type, providers }
  const [showReviewAll, setShowReviewAll] = useState(false)
  const toast = useToast()
  const { provider, google, microsoft, activeProviders, showGoogle, showMicrosoft } = useIntegration()

  // Tracks the freshest note so a batch of rapid updates never reads stale state.
  const noteRef = useRef(note)
  useEffect(() => { noteRef.current = note }, [note])

  if (!note) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted">
        <svg width="48" height="48" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1" className="mb-4 opacity-30">
          <path d="M2 10h2l2-4 2 8 2-6 2 4 2-2 2 3h2" strokeLinecap="round"/>
        </svg>
        <p className="font-mono uppercase text-sm tracking-wider">No active session</p>
        <p className="text-xs mt-1">Record or select a note from Archive</p>
      </div>
    )
  }

  const formatDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

  const handleTitleSave = () => {
    if (titleValue.trim() && titleValue !== note.title) {
      onUpdateNote({ ...note, title: titleValue.trim() })
    }
    setEditingTitle(false)
  }

  const handleSpeakerRename = (oldName) => {
    if (!speakerName.trim() || speakerName === oldName) {
      setEditingSpeaker(null)
      return
    }
    const newTranscript = note.transcript.replaceAll(`${oldName}:`, `${speakerName}:`)
    onUpdateNote({ ...note, transcript: newTranscript })
    setEditingSpeaker(null)
    setSpeakerName('')
  }

  const toggleAction = (idx) => {
    const current = noteRef.current
    const actions = (current.summary?.actions || []).map(normalizeActionItem)
    if (!actions[idx]) return
    actions[idx] = { ...actions[idx], done: !actions[idx].done }
    const updated = { ...current, summary: { ...current.summary, actions } }
    noteRef.current = updated
    onUpdateNote(updated)
  }

  const copyTranscript = () => {
    navigator.clipboard.writeText(note.transcript || '').catch(() => {})
  }

  // --- v2.2 tap-to-correct ------------------------------------------------
  // One find-and-replace across every cached text field of the session. The
  // AI-generated content is never regenerated — that would burn API credits for
  // a spelling fix — so the summary, cards, and quiz are patched in place.
  const handleCorrection = (wrong, right) => {
    const current = noteRef.current
    if (!current) return
    let count = 0

    const fix = (value) => {
      if (typeof value !== 'string' || !value) return value
      const { text, count: n } = replacePreservingCase(value, wrong, right)
      count += n
      return text
    }
    const fixList = (list) => (Array.isArray(list) ? list.map(fix) : list)

    const summary = current.summary || {}
    const updated = {
      ...current,
      title: fix(current.title),
      // Speaker names live inline in the transcript, so they are covered here too.
      transcript: fix(current.transcript),
      summary: {
        ...summary,
        paragraph: fix(summary.paragraph),
        bullets: fixList(summary.bullets),
        actions: Array.isArray(summary.actions)
          ? summary.actions.map(a => {
              const item = normalizeActionItem(a)
              return { ...item, text: fix(item.text), owner: fix(item.owner) }
            })
          : summary.actions
      },
      decisions: fixList(current.decisions),
      followups: fixList(current.followups),
      flashcards: Array.isArray(current.flashcards)
        ? current.flashcards.map(c => ({
            ...c,
            question: fix(c.question),
            answer: fix(c.answer),
            explanation: fix(c.explanation)
          }))
        : current.flashcards,
      quiz: Array.isArray(current.quiz)
        ? current.quiz.map(q => ({
            ...q,
            question: fix(q.question),
            answer: fix(q.answer),
            explanation: fix(q.explanation),
            options: fixList(q.options)
          }))
        : current.quiz
    }

    console.log(`[NeuroNote:Correction] Session fix "${wrong}" -> "${right}": ${count} replacement(s)`)
    noteRef.current = updated
    onUpdateNote(updated)   // persists to localStorage and re-renders the session

    toast.show({
      message: count > 0
        ? `Fixed "${wrong}" → "${right}" (${count} place${count === 1 ? '' : 's'})`
        : `Learned "${wrong}" → "${right}" — nothing left to fix in this session.`,
      type: count > 0 ? 'success' : 'info'
    })
  }

  // --- Calendar & Tasks integration (v2.5) --------------------------------
  // Google, Microsoft, both, or none - the user picks in the SYSTEM tab.
  const integrationOff = provider === 'none'
  const actionItems = (note.summary?.actions || []).map(normalizeActionItem)
  const pendingCount = actionItems.filter(a => !a.sync).length

  const markActionAdded = (index, sync) => {
    const current = noteRef.current
    const actions = (current.summary?.actions || []).map(normalizeActionItem)
    if (!actions[index]) return
    actions[index] = { ...actions[index], sync }
    const updated = { ...current, summary: { ...current.summary, actions } }
    noteRef.current = updated
    onUpdateNote(updated)
  }

  /**
   * Ensure at least one selected provider is connected, prompting a sign-in
   * when none is.
   * @returns {Promise<string[]>} the providers the dialog may offer
   */
  const ensureConnected = async () => {
    if (activeProviders.length > 0) return activeProviders

    // Nothing connected yet: sign in to the first selected provider that
    // already has credentials saved.
    const candidates = []
    if (showGoogle && google.clientId) candidates.push('google')
    if (showMicrosoft && microsoft.clientId) candidates.push('microsoft')

    if (candidates.length === 0) {
      toast.show({
        message: showGoogle
          ? 'Add your Google OAuth Client ID in the SYSTEM tab first.'
          : 'Add your Azure Client ID in the SYSTEM tab first.',
        type: 'error',
        duration: 8000
      })
      return []
    }

    const target = candidates[0]
    const label = target === 'google' ? 'Google' : 'Microsoft'
    try {
      await (target === 'google' ? google.signIn() : microsoft.signIn())
      // v2.6 — a Google sign-in now lasts, so say so instead of just "connected".
      toast.show(target === 'google'
        ? { message: SIGNED_IN_MESSAGE, type: 'success', duration: 7000 }
        : { message: `Connected to ${label}.`, type: 'success' })
      return [target]
    } catch (err) {
      console.error('[NeuroNote:Auth] Sign-in from action item failed:', err)
      toast.show({ message: `${label} sign-in failed: ${err.message}`, type: 'error', duration: 8000 })
      return []
    }
  }

  const openAddDialog = async (index, type) => {
    const providers = await ensureConnected()
    if (providers.length > 0) setDialog({ index, type, providers })
  }

  // The modal renders its own "Sign in to Google first" state, so it opens either way.
  const openReviewAll = () => setShowReviewAll(true)

  return (
    <div className="px-4 pb-4">
      {/* Header */}
      <div className="mb-4">
        {editingTitle ? (
          <input
            autoFocus
            value={titleValue}
            onChange={e => setTitleValue(e.target.value)}
            onBlur={handleTitleSave}
            onKeyDown={e => e.key === 'Enter' && handleTitleSave()}
            className="font-mono uppercase text-lg font-bold tracking-wider bg-transparent border-b-2 border-red outline-none w-full"
          />
        ) : (
          <h1
            className="font-mono uppercase text-lg font-bold tracking-wider typewriter-shadow cursor-pointer hover:text-red transition-colors"
            onClick={() => { setEditingTitle(true); setTitleValue(note.title || '') }}
          >
            {note.title || 'Untitled'}
          </h1>
        )}
        <p className="text-xs text-muted mt-1">
          {formatDate(note.date)}
          {note.duration > 0 && ` • ${Math.floor(note.duration / 60)}:${(note.duration % 60).toString().padStart(2, '0')}`}
          {note.speakers > 1 && ` • ${note.speakers} speakers`}
        </p>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 p-1 rounded-full bg-white/40 backdrop-blur mb-4 overflow-x-auto">
        {/* v2.2.1 — the pill keeps its size; the button around it grows to 44px
            tall and the negative margin keeps the bar the same height. */}
        {subTabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveSubTab(tab)}
            className="tap-target -my-2 flex items-center"
          >
            <span
              className={`block px-4 py-1.5 rounded-full font-mono uppercase text-[10px] tracking-wider whitespace-nowrap transition-all ${
                activeSubTab === tab ? 'text-white' : 'text-muted hover:text-ink'
              }`}
              style={activeSubTab === tab ? { background: 'linear-gradient(to right, #dc2626, #991b1b)' } : undefined}
            >
              {tab}
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeSubTab}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
        >
          {activeSubTab === 'summary' && (
            <div className="space-y-4">
              <GlassCard hoverable={false}>
                {note.summary?.paragraph ? (
                  <CorrectableText
                    as="p"
                    className="text-sm leading-relaxed"
                    text={note.summary.paragraph}
                    onCorrection={handleCorrection}
                  />
                ) : (
                  <p className="text-sm leading-relaxed">No summary available.</p>
                )}
              </GlassCard>

              {note.summary?.bullets?.length > 0 && (
                <GlassCard hoverable={false}>
                  <h3 className="font-mono uppercase text-xs font-bold tracking-wider mb-3">Key Points</h3>
                  <ul className="space-y-2">
                    {note.summary.bullets.map((b, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <span className="w-1.5 h-1.5 rounded-full bg-red mt-1.5 flex-shrink-0" />
                        <CorrectableText className="leading-relaxed" text={b} onCorrection={handleCorrection} />
                      </li>
                    ))}
                  </ul>
                </GlassCard>
              )}

              {actionItems.length > 0 && (
                <GlassCard hoverable={false}>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <h3 className="font-mono uppercase text-xs font-bold tracking-wider">Action Items</h3>
                    {pendingCount > 0 && !integrationOff && (
                      <motion.button
                        onClick={openReviewAll}
                        className="tap-target -my-2.5 flex items-center"
                        whileTap={{ scale: 0.95 }}
                      >
                        <span
                          className="block px-3 py-1.5 rounded-full text-white font-mono uppercase text-[9px] tracking-wider whitespace-nowrap"
                          style={{ background: 'linear-gradient(to right, #dc2626, #991b1b)' }}
                        >
                          Review &amp; Add All
                        </span>
                      </motion.button>
                    )}
                  </div>
                  <ul className="space-y-3">
                    {actionItems.map((a, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <button
                          onClick={() => toggleAction(i)}
                          aria-label={a.done ? 'Mark action item as not done' : 'Mark action item as done'}
                          className="tap-target -m-3.5 flex-shrink-0 flex items-center justify-center"
                        >
                          <span
                            className={`w-4 h-4 mt-0.5 rounded border flex items-center justify-center transition-colors ${
                              a.done ? 'bg-red border-red text-white' : 'border-red/30'
                            }`}
                          >
                            {a.done && <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor"><path d="M5 10l3 3 7-7"/></svg>}
                          </span>
                        </button>
                        <div className="flex-1 min-w-0">
                          <span className={`leading-relaxed ${a.done ? 'line-through text-muted' : ''}`}>
                            <CorrectableText text={a.text} onCorrection={handleCorrection} />
                            {a.owner && a.owner !== 'Unknown' && (
                              <span className="text-[10px] bg-red/10 text-red-dark px-1.5 py-0.5 rounded-full ml-2">
                                <CorrectableText text={a.owner} onCorrection={handleCorrection} />
                              </span>
                            )}
                            {a.dueDate && (
                              <span className="text-[10px] text-muted font-mono ml-2 whitespace-nowrap">
                                {a.dueDate}{a.dueTime ? ` ${a.dueTime}` : ''}
                              </span>
                            )}
                          </span>

                          {a.sync ? (
                            <div className="mt-1.5">
                              <a
                                href={a.sync.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="tap-target -my-3 inline-flex items-center"
                              >
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-500/10 border border-green-500/30 font-mono uppercase text-[9px] tracking-wider text-green-700 hover:bg-green-500/20 transition-colors">
                                  ✓ Added to {addedLabel(a.sync.provider, a.sync.type)} ↗
                                </span>
                              </a>
                            </div>
                          ) : integrationOff ? null : (
                            <div className="flex gap-2 mt-1.5">
                              {/* v2.2.1 — 44px-tall hit boxes around the same pills;
                                  the negative margin keeps the row spacing intact. */}
                              <motion.button
                                onClick={() => openAddDialog(i, 'event')}
                                className="tap-target -my-3 flex items-center"
                                whileTap={{ scale: 0.95 }}
                              >
                                <span className="block px-2.5 py-1 rounded-full border border-red/30 bg-white/40 font-mono uppercase text-[9px] tracking-wider text-red hover:bg-red/10 transition-colors">
                                  📅 Event
                                </span>
                              </motion.button>
                              <motion.button
                                onClick={() => openAddDialog(i, 'task')}
                                className="tap-target -my-3 flex items-center"
                                whileTap={{ scale: 0.95 }}
                              >
                                <span className="block px-2.5 py-1 rounded-full border border-red/30 bg-white/40 font-mono uppercase text-[9px] tracking-wider text-red hover:bg-red/10 transition-colors">
                                  ✓ Task
                                </span>
                              </motion.button>
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </GlassCard>
              )}

              {note.decisions?.length > 0 && (
                <GlassCard hoverable={false}>
                  <h3 className="font-mono uppercase text-xs font-bold tracking-wider mb-3">Decisions</h3>
                  <ol className="space-y-2 list-decimal list-inside">
                    {note.decisions.map((d, i) => (
                      <li key={i} className="text-sm leading-relaxed">
                        <CorrectableText text={d} onCorrection={handleCorrection} />
                      </li>
                    ))}
                  </ol>
                </GlassCard>
              )}

              {note.followups?.length > 0 && (
                <GlassCard hoverable={false}>
                  <h3 className="font-mono uppercase text-xs font-bold tracking-wider mb-3">Follow-ups</h3>
                  <ul className="space-y-2">
                    {note.followups.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <span className="text-red">→</span>
                        <CorrectableText className="leading-relaxed" text={f} onCorrection={handleCorrection} />
                      </li>
                    ))}
                  </ul>
                </GlassCard>
              )}
            </div>
          )}

          {activeSubTab === 'transcript' && (
            <GlassCard hoverable={false}>
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-mono uppercase text-xs font-bold tracking-wider">Transcript</h3>
                <button onClick={copyTranscript} className="tap-target -my-3 -mr-3 px-3 inline-flex items-center justify-center text-xs text-muted hover:text-red font-mono uppercase tracking-wider">
                  Copy
                </button>
              </div>
              <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {(note.transcript || '').split('\n').filter(Boolean).map((line, i) => {
                  const speakerMatch = line.match(/^(Speaker \d+|[A-Za-z]+):\s*(.*)/)
                  if (speakerMatch) {
                    const speaker = speakerMatch[1]
                    const text = speakerMatch[2]
                    return (
                      <p key={i} className="text-sm leading-relaxed">
                        {editingSpeaker === speaker ? (
                          <span className="inline-flex items-center gap-1">
                            <input
                              autoFocus
                              value={speakerName}
                              onChange={e => setSpeakerName(e.target.value)}
                              onBlur={() => handleSpeakerRename(speaker)}
                              onKeyDown={e => e.key === 'Enter' && handleSpeakerRename(speaker)}
                              className="font-mono font-bold text-red bg-red/5 border-b border-red outline-none w-24 text-sm"
                            />
                            <span>:</span>
                          </span>
                        ) : (
                          <span
                            className="font-mono font-bold text-red cursor-pointer hover:bg-red/5 rounded px-1 -mx-1"
                            onClick={() => { setEditingSpeaker(speaker); setSpeakerName(speaker) }}
                          >
                            <CorrectableText text={speaker} onCorrection={handleCorrection} />:
                          </span>
                        )}
                        {' '}
                        <CorrectableText text={text} onCorrection={handleCorrection} />
                      </p>
                    )
                  }
                  return (
                    <p key={i} className="text-sm leading-relaxed">
                      <CorrectableText text={line} onCorrection={handleCorrection} />
                    </p>
                  )
                })}
              </div>
            </GlassCard>
          )}

          {activeSubTab === 'original' && (
            <GlassCard hoverable={false}>
              <h3 className="font-mono uppercase text-xs font-bold tracking-wider mb-3">Original Content</h3>
              <pre className="text-sm leading-relaxed whitespace-pre-wrap font-mono text-muted max-h-[60vh] overflow-y-auto">
                {note.originalTranscript || note.transcript || 'No original content available.'}
              </pre>
            </GlassCard>
          )}

          {activeSubTab === 'flashcards' && (
            <Flashcards flashcards={note.flashcards} quiz={note.quiz} onCorrection={handleCorrection} />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Photo gallery */}
      {note.photos?.length > 0 && (
        <div className="mt-6">
          <h3 className="font-mono uppercase text-xs font-bold tracking-wider mb-2">Photos</h3>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {note.photos.map((photo, i) => (
              <img
                key={i}
                src={photo}
                alt={`Capture ${i + 1}`}
                className="w-24 h-24 rounded-xl object-cover flex-shrink-0 cursor-pointer hover:ring-2 ring-red transition-all"
                onClick={() => setViewingPhoto(photo)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Full-screen photo viewer */}
      <AnimatePresence>
        {viewingPhoto && (
          <motion.div
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setViewingPhoto(null)}
          >
            <img src={viewingPhoto} alt="Full view" className="max-w-full max-h-full object-contain rounded-xl" />
            <button
              aria-label="Close photo"
              className="absolute right-4 w-11 h-11 rounded-full bg-white/20 text-white flex items-center justify-center text-lg"
              style={{ top: 'max(1rem, env(safe-area-inset-top))' }}
            >
              ×
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Calendar / Tasks confirmation dialog (Google and/or Microsoft) */}
      <AnimatePresence>
        {dialog && actionItems[dialog.index] && (
          <AddToServiceDialog
            item={actionItems[dialog.index]}
            type={dialog.type}
            providers={dialog.providers}
            noteTitle={note.title}
            onClose={() => setDialog(null)}
            onAdded={(sync) => markActionAdded(dialog.index, sync)}
          />
        )}
      </AnimatePresence>

      {/* Review & Add All batch modal */}
      <AnimatePresence>
        {showReviewAll && (
          <ReviewAddAllModal
            items={actionItems}
            noteTitle={note.title}
            onClose={() => setShowReviewAll(false)}
            onAdded={markActionAdded}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
