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
import { summarizeTranscript, summaryFields, titleFromSummary } from '../lib/summarize'
import { hasActiveApiKey, generateFlashcards } from '../lib/ai-provider'
import { getSettings } from '../lib/storage'
import { useRecordingContext } from '../contexts/RecordingContext'

const subTabs = [
  { id: 'summary', label: 'Summary' },
  { id: 'transcript', label: 'Transcript' },
  { id: 'flashcards', label: 'Study' },
  { id: 'original', label: 'Unedited' }
]

/** "2026-11-27" + "09:00" -> "Fri, Nov 27 · 9:00 AM". Falls back to the raw text. */
function formatDue(dueDate, dueTime) {
  if (!dueDate) return ''
  const date = new Date(`${dueDate}T${dueTime || '00:00'}`)
  if (Number.isNaN(date.getTime())) return `${dueDate}${dueTime ? ` ${dueTime}` : ''}`
  const sameYear = date.getFullYear() === new Date().getFullYear()
  const day = date.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' })
  })
  if (!dueTime) return day
  return `${day} · ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

export default function Session({ note, onUpdateNote, onOpenSettings, onReindexNote }) {
  const [activeSubTab, setActiveSubTab] = useState('summary')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState('')
  const [editingSpeaker, setEditingSpeaker] = useState(null)
  const [speakerName, setSpeakerName] = useState('')
  const [viewingPhoto, setViewingPhoto] = useState(null)
  const [dialog, setDialog] = useState(null)      // { index, type, providers }
  const [showReviewAll, setShowReviewAll] = useState(false)
  const [resummarizing, setResummarizing] = useState(false)
  const { ask } = useRecordingContext()
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
        <p className="font-mono text-sm font-medium">No meeting selected</p>
        <p className="text-xs mt-1">Pick one from Home</p>
      </div>
    )
  }

  const formatDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

  const handleTitleSave = () => {
    if (titleValue.trim() && titleValue !== note.title) {
      // A title the user typed is theirs: "Redo summary" will leave it alone.
      onUpdateNote({ ...note, title: titleValue.trim(), titleAuto: false })
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

  /**
   * v2.8.2 — write the summary again from the saved transcript.
   *
   * This is the way out of a stand-in summary (recorded before a key was
   * added, or when the AI call failed), and a second try for one that simply
   * is not good. Ticked and already-sent action items are kept when the new
   * summary contains the same item; a note that has some asks first.
   */
  const redoSummary = async () => {
    if (resummarizing) return
    const current = noteRef.current
    if (!current) return

    const previous = (current.summary?.actions || []).map(normalizeActionItem)
    if (previous.some(a => a.done || a.sync)) {
      const choice = await ask({
        title: 'Redo the summary?',
        message: 'The action items are rewritten too. Ones you have ticked or sent to a calendar keep their state only if the new summary words them the same way.',
        options: [
          { label: 'Redo summary', value: 'redo', primary: true },
          { label: 'Cancel', value: 'cancel' }
        ],
        dismissValue: 'cancel'
      })
      if (choice !== 'redo') return
    }

    setResummarizing(true)
    try {
      const result = await summarizeTranscript(current.transcript || '', getSettings())

      // Never replace a summary with the on-device stand-in from here: record
      // why the AI did not answer, and leave the text alone.
      if (result.source !== 'ai') {
        if (current.summarySource === 'local') {
          const updated = { ...noteRef.current, summaryReason: result.reason, summaryModel: result.model }
          noteRef.current = updated
          onUpdateNote(updated)
        }
        toast.show({
          message: result.reason === 'no-key'
            ? 'Add an AI key in Settings first.'
            : `The AI summary didn't go through: ${result.reason}.`,
          type: 'error',
          duration: 8000
        })
        return
      }

      const fields = summaryFields(result)
      const actions = (fields.summary.actions || []).map(a => {
        const item = normalizeActionItem(a)
        const match = previous.find(old => old.text === item.text)
        return match ? { ...item, done: match.done, sync: match.sync } : item
      })
      const latest = noteRef.current
      let updated = {
        ...latest,
        ...fields,
        summary: { ...fields.summary, actions },
        title: latest.titleAuto ? (titleFromSummary(result) || latest.title) : latest.title
      }
      noteRef.current = updated
      onUpdateNote(updated)
      toast.show({ message: `Summary rewritten by ${result.model}.`, type: 'success' })

      // A note first made without AI has no study cards either. Fill them in
      // now; cards that already exist are left alone.
      if (!(updated.flashcards?.length) && !(updated.quiz?.length)) {
        try {
          const cards = await generateFlashcards(updated.transcript || '')
          updated = { ...noteRef.current, flashcards: cards?.flashcards || [], quiz: cards?.quiz || [] }
          noteRef.current = updated
          onUpdateNote(updated)
        } catch (e) {
          console.error('[NeuroNote] Study cards could not be generated after the redo:', e)
        }
      }

      // Ask searches the note's indexed text, which included the old summary.
      onReindexNote?.(noteRef.current)
    } finally {
      setResummarizing(false)
    }
  }

  const copyTranscript = () => {
    navigator.clipboard.writeText(note.transcript || '')
      .then(() => toast.show({ message: 'Transcript copied.', type: 'success', duration: 2500 }))
      .catch(() => toast.show({ message: 'Could not copy the transcript.', type: 'error' }))
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
  // Google, Microsoft, both, or none - the user picks in Settings.
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
          ? 'Add your Google OAuth Client ID in Settings first.'
          : 'Add your Azure Client ID in Settings first.',
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
            aria-label="Meeting title"
            className="font-mono text-2xl font-bold tracking-tight bg-transparent border-b-2 border-accent outline-none w-full text-ink"
          />
        ) : (
          <button
            className="group flex items-start gap-2 text-left"
            onClick={() => { setEditingTitle(true); setTitleValue(note.title || '') }}
            aria-label={`Rename ${note.title || 'Untitled'}`}
          >
            <h1 className="chrome-text font-mono text-2xl font-bold tracking-tight leading-tight">
              {note.title || 'Untitled'}
            </h1>
            <svg className="text-muted group-hover:text-accent transition-colors mt-1.5 flex-shrink-0" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.5 3.5l3 3L7 16H4v-3z"/>
            </svg>
          </button>
        )}
        <p className="text-sm text-muted mt-1.5">
          {formatDate(note.date)}
          {note.duration > 0 && ` · ${Math.max(1, Math.round(note.duration / 60))} min`}
          {note.speakers > 1 && ` · ${note.speakers} speakers`}
        </p>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 p-1 rounded-full bg-white/[0.05] border border-white/10 mb-4 overflow-x-auto overflow-y-hidden no-scrollbar" role="tablist">
        {/* v2.2.1 — the pill keeps its size; the button around it grows to 44px
            tall and the negative margin keeps the bar the same height. */}
        {subTabs.map(tab => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeSubTab === tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className="tap-target -my-2 flex flex-1 items-center justify-center"
          >
            <span
              className={`block w-full text-center px-3 py-1.5 rounded-full font-mono text-[13px] font-medium whitespace-nowrap transition-all ${
                activeSubTab === tab.id ? 'bg-white/[0.12] text-ink chrome-ring' : 'text-muted hover:text-ink'
              }`}
            >
              {tab.label}
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
              {/* v2.8.2 — a stand-in summary says that it is one. */}
              {note.summarySource === 'local' && (
                <div className="rounded-2xl border border-accent/40 bg-accent/[0.07] p-4">
                  <p className="font-mono font-semibold text-[15px] text-ink mb-1">
                    {note.summaryReason === 'no-key' ? 'Basic summary — made without AI' : 'Basic summary — the AI one failed'}
                  </p>
                  <p className="text-[13px] text-muted leading-relaxed mb-3">
                    {note.summaryReason === 'no-key'
                      ? 'No AI key was saved when this was made, so NeuroNote picked sentences out of the transcript on this device. It is a rough stand-in, not a real summary.'
                      : `The AI summary didn't go through (${note.summaryReason || 'the request failed'}), so NeuroNote picked sentences out of the transcript on this device instead.`}
                  </p>
                  {hasActiveApiKey() ? (
                    <motion.button
                      onClick={redoSummary}
                      disabled={resummarizing}
                      className="btn-primary tap-target inline-flex items-center justify-center gap-2 px-4 rounded-xl font-mono text-[13px] font-semibold disabled:opacity-60"
                      whileTap={{ scale: 0.96 }}
                    >
                      {resummarizing && <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />}
                      {resummarizing ? 'Writing the summary…' : note.summaryReason === 'no-key' ? 'Summarize with AI' : 'Try again'}
                    </motion.button>
                  ) : (
                    <motion.button
                      onClick={onOpenSettings}
                      disabled={!onOpenSettings}
                      className="btn-primary tap-target inline-flex items-center justify-center px-4 rounded-xl font-mono text-[13px] font-semibold"
                      whileTap={{ scale: 0.96 }}
                    >
                      Add an AI key in Settings
                    </motion.button>
                  )}
                </div>
              )}

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
                  <h3 className="section-label mb-3">Key points</h3>
                  <ul className="space-y-2">
                    {note.summary.bullets.map((b, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent mt-1.5 flex-shrink-0" />
                        <CorrectableText className="leading-relaxed" text={b} onCorrection={handleCorrection} />
                      </li>
                    ))}
                  </ul>
                </GlassCard>
              )}

              {actionItems.length > 0 && (
                <GlassCard hoverable={false}>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <h3 className="section-label">Action items</h3>
                    {pendingCount > 0 && !integrationOff && (
                      <motion.button
                        onClick={openReviewAll}
                        className="tap-target -my-2.5 flex items-center"
                        whileTap={{ scale: 0.95 }}
                      >
                        <span
                          className="block px-3 py-1.5 rounded-full text-white font-mono text-xs font-medium whitespace-nowrap"
                          style={{ background: 'var(--grad-accent)' }}
                        >
                          Send all to calendar
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
                            className={`w-[18px] h-[18px] mt-0.5 rounded-md border flex items-center justify-center transition-colors ${
                              a.done ? 'bg-ok border-ok text-black' : 'border-white/30'
                            }`}
                            style={a.done ? { boxShadow: '0 0 10px rgba(45,255,154,0.45)' } : undefined}
                          >
                            {a.done && <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10.5l4 4 8-9"/></svg>}
                          </span>
                        </button>
                        <div className="flex-1 min-w-0">
                          <span className={`leading-relaxed ${a.done ? 'line-through text-muted' : ''}`}>
                            <CorrectableText text={a.text} onCorrection={handleCorrection} />
                            {a.owner && a.owner !== 'Unknown' && (
                              <span className="text-[11px] bg-accent/10 text-accent px-1.5 py-0.5 rounded-full ml-2">
                                <CorrectableText text={a.owner} onCorrection={handleCorrection} />
                              </span>
                            )}
                            {a.dueDate && (
                              <span className="text-[11px] text-muted font-mono ml-2 whitespace-nowrap">
                                {formatDue(a.dueDate, a.dueTime)}
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
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-ok/10 border border-ok/30 font-mono text-xs font-medium text-ok hover:bg-ok/20 transition-colors">
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
                                <span className="block px-2.5 py-1 rounded-full border border-accent/30 bg-white/[0.06] font-mono text-xs font-medium text-accent hover:bg-accent/10 transition-colors">
                                  + Calendar
                                </span>
                              </motion.button>
                              <motion.button
                                onClick={() => openAddDialog(i, 'task')}
                                className="tap-target -my-3 flex items-center"
                                whileTap={{ scale: 0.95 }}
                              >
                                <span className="block px-2.5 py-1 rounded-full border border-accent/30 bg-white/[0.06] font-mono text-xs font-medium text-accent hover:bg-accent/10 transition-colors">
                                  + Task list
                                </span>
                              </motion.button>
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                  {/* v2.8 — with no calendar connected the send buttons used
                      to vanish without a word. Say why, and where to fix it. */}
                  {integrationOff && (
                    <button
                      onClick={onOpenSettings}
                      disabled={!onOpenSettings}
                      className="mt-4 pt-3 border-t border-white/10 w-full text-left text-xs text-muted hover:text-ink transition-colors"
                    >
                      Want these on your calendar or task list?{' '}
                      <span className="text-accent">Connect Google or Microsoft in Settings →</span>
                    </button>
                  )}
                </GlassCard>
              )}

              {note.decisions?.length > 0 && (
                <GlassCard hoverable={false}>
                  <h3 className="section-label mb-3">Decisions</h3>
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
                  <h3 className="section-label mb-3">Follow-ups</h3>
                  <ul className="space-y-2">
                    {note.followups.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <span className="text-accent">→</span>
                        <CorrectableText className="leading-relaxed" text={f} onCorrection={handleCorrection} />
                      </li>
                    ))}
                  </ul>
                </GlassCard>
              )}

              {/* Credit for an AI summary, and a second try if it missed. */}
              {note.summarySource !== 'local' && hasActiveApiKey() && (
                <p className="text-xs text-muted px-1">
                  {note.summaryModel ? `Summarized by ${note.summaryModel}. ` : ''}
                  <button
                    onClick={redoSummary}
                    disabled={resummarizing}
                    className="tap-target -my-3 inline-flex items-center gap-1.5 font-medium text-accent hover:brightness-125 disabled:opacity-60"
                  >
                    {resummarizing && <span className="w-3 h-3 rounded-full border-2 border-accent border-t-transparent animate-spin" />}
                    {resummarizing ? 'Writing the summary…' : 'Redo summary'}
                  </button>
                </p>
              )}
            </div>
          )}

          {activeSubTab === 'transcript' && (
            <GlassCard hoverable={false}>
              <div className="flex justify-between items-center mb-3">
                <h3 className="section-label">Transcript</h3>
                <button onClick={copyTranscript} className="tap-target -my-3 -mr-3 px-3 inline-flex items-center justify-center text-xs font-medium text-accent hover:brightness-125 font-mono">
                  Copy
                </button>
              </div>
              {note.transcriptSource === 'browser' && (
                <button
                  onClick={onOpenSettings}
                  disabled={!onOpenSettings}
                  className="block w-full text-left text-xs text-muted leading-relaxed rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 mb-3 hover:text-ink transition-colors"
                >
                  Transcribed by your browser&apos;s built-in speech recognition, which is rough and can&apos;t tell speakers apart.{' '}
                  <span className="text-accent">Add an AssemblyAI key in Settings for accurate transcripts →</span>
                </button>
              )}
              <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {(note.transcript || '').split('\n').filter(Boolean).map((line, i) => {
                  // AssemblyAI labels speakers "Speaker A", "Speaker B"; older notes and the
                  // browser transcript use "Speaker 1" or a single name such as "You".
                  const speakerMatch = line.match(/^(Speaker [A-Za-z0-9]+|[A-Za-z]+):\s*(.*)/)
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
                              className="font-mono font-bold text-accent bg-accent/5 border-b border-accent outline-none w-24 text-sm"
                            />
                            <span>:</span>
                          </span>
                        ) : (
                          <span
                            className="font-mono font-bold text-accent cursor-pointer hover:bg-accent/5 rounded px-1 -mx-1"
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
              <h3 className="section-label mb-1">Unedited text</h3>
              <p className="text-xs text-muted mb-3">Exactly as it was transcribed, before any corrections.</p>
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
          <h3 className="section-label mb-2">Photos</h3>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {note.photos.map((photo, i) => (
              <img
                key={i}
                src={photo}
                alt={`Capture ${i + 1}`}
                className="w-24 h-24 rounded-xl object-cover flex-shrink-0 cursor-pointer hover:ring-2 ring-accent transition-all"
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
              className="absolute right-4 w-11 h-11 rounded-full bg-white/[0.06] text-white flex items-center justify-center text-lg"
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
