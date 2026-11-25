import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import AskNeuroNote from './AskNeuroNote'
import { getApiKey, getItem, setItem } from '../lib/storage'
import { hasActiveApiKey } from '../lib/ai-provider'

/** Set when the user closes the first-run checklist. */
const SETUP_DISMISSED_KEY = 'setup-checklist-dismissed'

const SUGGESTED_QUESTIONS = [
  'What are my open action items?',
  'What decisions were made this week?',
  'Summarize my last meeting'
]

function greeting() {
  const hour = new Date().getHours()
  if (hour < 5) return 'Working late'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Which heading a note sits under on HOME. */
function groupLabel(iso) {
  if (!iso) return 'Earlier'
  const days = Math.round((startOfDay(Date.now()) - startOfDay(iso)) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return 'This week'
  if (days < 31) return 'This month'
  return 'Earlier'
}

function formatWhen(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  const days = Math.round((startOfDay(Date.now()) - startOfDay(iso)) / 86400000)
  if (days <= 1) return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

function formatLength(seconds) {
  if (!seconds) return ''
  const mins = Math.round(seconds / 60)
  if (mins < 1) return `${seconds}s`
  if (mins < 60) return `${mins} min`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function openActionCount(note) {
  return (note.summary?.actions || []).filter(a => !(a && typeof a === 'object' && a.done)).length
}

function TypeIcon({ type }) {
  if (type === 'photo') return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="4" width="16" height="12" rx="2"/><circle cx="10" cy="10" r="3"/></svg>
  )
  if (type === 'upload') return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 16h12M10 3v9m-3.5-5.5L10 3l3.5 3.5"/></svg>
  )
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M10 2.5a3 3 0 0 1 3 3v4a3 3 0 0 1-6 0v-4a3 3 0 0 1 3-3z"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5"/></svg>
  )
}

/**
 * v2.8 — the first-run checklist. A new user used to land on an empty list
 * with no hint that keys were needed; now the three steps that make the app
 * work are the first thing on screen, and each one ticks green when done.
 */
function SetupChecklist({ steps, onDismiss }) {
  const done = steps.filter(s => s.done).length
  return (
    <motion.div
      className="glass p-4 mb-5"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0, padding: 0 }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="font-mono font-semibold text-[15px]">Finish setting up</h2>
          <p className="text-xs text-muted mt-0.5">{done} of {steps.length} done</p>
        </div>
        <button onClick={onDismiss} aria-label="Hide setup checklist"
          className="tap-target -m-2.5 flex items-center justify-center text-muted hover:text-ink">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M5 5l10 10M15 5 5 15"/></svg>
        </button>
      </div>
      <ul className="space-y-1">
        {steps.map(step => (
          <li key={step.label}>
            <button
              onClick={step.done ? undefined : step.onTap}
              disabled={step.done}
              className={`tap-target w-full flex items-center gap-3 px-2 -mx-2 rounded-xl text-left transition-colors ${
                step.done ? '' : 'hover:bg-white/[0.05]'
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 border ${
                  step.done ? 'border-ok text-ok' : 'border-white/25 text-transparent'
                }`}
                style={step.done ? { boxShadow: '0 0 10px rgba(45,255,154,0.35)' } : undefined}
              >
                <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10.5l4 4 8-9"/></svg>
              </span>
              <span className="flex-1 min-w-0">
                <span className={`block text-sm ${step.done ? 'text-muted line-through' : 'text-ink'}`}>{step.label}</span>
                {!step.done && <span className="block text-xs text-muted">{step.hint}</span>}
              </span>
              {!step.done && (
                <svg className="text-accent flex-shrink-0" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 5l5 5-5 5"/></svg>
              )}
            </button>
          </li>
        ))}
      </ul>
    </motion.div>
  )
}

export default function Home({ notes, onSelectNote, onDeleteNote, onNavigate }) {
  const [query, setQuery] = useState('')
  const [ask, setAsk] = useState(null)            // { question } while the Ask sheet is open
  const [setupDismissed, setSetupDismissed] = useState(() => !!getItem(SETUP_DISMISSED_KEY))

  const hasAiKey = hasActiveApiKey()
  const hasTranscriptionKey = !!getApiKey('assemblyai')

  const setupSteps = [
    {
      label: 'Add an AI key',
      hint: 'Unlocks summaries, action items and Ask.',
      done: hasAiKey,
      onTap: () => onNavigate('system')
    },
    {
      label: 'Add a transcription key',
      hint: 'Accurate transcripts that know who said what.',
      done: hasTranscriptionKey,
      onTap: () => onNavigate('system')
    },
    {
      label: 'Record your first meeting',
      hint: 'Tap the red button whenever you are ready.',
      done: notes.length > 0,
      onTap: () => onNavigate('capture')
    }
  ]
  const showSetup = !setupDismissed && setupSteps.some(s => !s.done)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return notes
    return notes.filter(n =>
      (n.title || '').toLowerCase().includes(q) ||
      (n.transcript || '').toLowerCase().includes(q) ||
      (n.summary?.paragraph || '').toLowerCase().includes(q) ||
      (n.tags || []).some(t => t.toLowerCase().includes(q))
    )
  }, [notes, query])

  // Notes arrive newest-first, so walking them in order keeps each group sorted.
  const groups = useMemo(() => {
    const out = []
    for (const note of filtered) {
      const label = groupLabel(note.date)
      const last = out[out.length - 1]
      if (last && last.label === label) last.notes.push(note)
      else out.push({ label, notes: [note] })
    }
    return out
  }, [filtered])

  const totalOpen = useMemo(() => notes.reduce((sum, n) => sum + openActionCount(n), 0), [notes])

  const openAsk = (question) => setAsk({ question: (question || '').trim() })

  const handleSubmit = (e) => {
    e.preventDefault()
    if (query.trim()) openAsk(query)
  }

  const dismissSetup = () => {
    setItem(SETUP_DISMISSED_KEY, true)
    setSetupDismissed(true)
  }

  return (
    <div className="px-4 pb-4">
      <div className="mb-5">
        <h1 className="chrome-text font-mono font-bold text-[28px] leading-tight tracking-tight">{greeting()}</h1>
        <p className="text-sm text-muted mt-1">
          {notes.length === 0
            ? 'Your meetings will show up here.'
            : `${notes.length} ${notes.length === 1 ? 'meeting' : 'meetings'} · ${
                totalOpen === 0 ? 'no open action items' : `${totalOpen} open action ${totalOpen === 1 ? 'item' : 'items'}`
              }`}
        </p>
      </div>

      <AnimatePresence>
        {showSetup && <SetupChecklist steps={setupSteps} onDismiss={dismissSetup} />}
      </AnimatePresence>

      {/* One field for both jobs: typing filters the list underneath, Enter
          hands the same words to Ask. */}
      <form onSubmit={handleSubmit} className="mb-3">
        <div className="glass-input flex items-center gap-2.5 pl-3.5 pr-1.5 py-1.5">
          <svg className="text-accent flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
            style={{ filter: 'drop-shadow(0 0 6px rgba(42,168,255,0.7))' }}>
            <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7z"/>
          </svg>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search or ask your meetings"
            aria-label="Search or ask your meetings"
            enterKeyHint="search"
            className="flex-1 min-w-0 bg-transparent outline-none text-[15px] text-ink placeholder:text-[#6c727d] py-2"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search"
              className="w-9 h-9 flex items-center justify-center text-muted hover:text-ink flex-shrink-0">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M5 5l10 10M15 5 5 15"/></svg>
            </button>
          )}
          <motion.button
            type="submit"
            disabled={!query.trim()}
            className="btn-primary h-9 px-3.5 rounded-[10px] font-mono text-xs font-semibold flex-shrink-0 disabled:opacity-35 disabled:shadow-none"
            whileTap={{ scale: 0.95 }}
          >
            Ask AI
          </motion.button>
        </div>
      </form>

      {!query && notes.length > 0 && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 mb-5">
          {SUGGESTED_QUESTIONS.map(q => (
            <button key={q} onClick={() => openAsk(q)}
              className="pill pill-accent !text-xs !py-1.5 !px-3 flex-shrink-0 hover:brightness-125 transition">
              {q}
            </button>
          ))}
        </div>
      )}

      {query && filtered.length > 0 && (
        <p className="text-xs text-muted mb-3">
          {filtered.length} {filtered.length === 1 ? 'match' : 'matches'} — or press <span className="text-accent">Ask AI</span> for an answer drawn from every meeting.
        </p>
      )}

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-14">
          <div className="chrome-ring w-16 h-16 rounded-full flex items-center justify-center bg-panel-2 text-muted mb-4">
            <svg width="26" height="26" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M10 2.5a3 3 0 0 1 3 3v4a3 3 0 0 1-6 0v-4a3 3 0 0 1 3-3z"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5"/></svg>
          </div>
          {query ? (
            <>
              <p className="font-mono font-semibold text-base">No matching meetings</p>
              <p className="text-sm text-muted mt-1 mb-4">Nothing contains “{query.trim()}”. Ask AI can still search by meaning.</p>
              <motion.button onClick={() => openAsk(query)} whileTap={{ scale: 0.96 }}
                className="btn-primary tap-target px-5 rounded-xl font-mono text-sm font-semibold">
                Ask AI instead
              </motion.button>
            </>
          ) : (
            <>
              <p className="font-mono font-semibold text-base">No meetings yet</p>
              <p className="text-sm text-muted mt-1 mb-4">Record one and the summary, action items and transcript land here.</p>
              <motion.button onClick={() => onNavigate('capture')} whileTap={{ scale: 0.96 }}
                className="tap-target px-5 rounded-xl font-mono text-sm font-semibold text-white"
                style={{ background: 'var(--grad-rec)', boxShadow: 'var(--glow-rec)' }}>
                Start recording
              </motion.button>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group, groupIndex) => (
            // Label plus position: the same label can come round twice when
            // stored notes are not strictly newest-first.
            <section key={`${group.label}-${groupIndex}`}>
              <h2 className="section-label mb-2.5">{group.label}</h2>
              <motion.div className="grid md:grid-cols-2 gap-3" layout>
                <AnimatePresence>
                  {group.notes.map(note => {
                    const open = openActionCount(note)
                    const total = (note.summary?.actions || []).length
                    const preview = note.summary?.paragraph || note.transcript || ''
                    return (
                      <motion.article
                        key={note.id}
                        layout
                        initial={{ opacity: 0, y: 14 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.97 }}
                        whileHover={{ y: -2 }}
                        className="glass relative group"
                      >
                        <button
                          onClick={() => onSelectNote(note)}
                          className="block w-full text-left p-4 pr-12 rounded-[18px] outline-none focus-visible:shadow-[var(--glow-accent)]"
                        >
                          <div className="flex items-center gap-2 text-muted text-xs mb-1.5">
                            <TypeIcon type={note.type} />
                            <span>{formatWhen(note.date)}</span>
                            {note.duration > 0 && <><span aria-hidden="true">·</span><span>{formatLength(note.duration)}</span></>}
                            {note.speakers > 1 && <><span aria-hidden="true">·</span><span>{note.speakers} speakers</span></>}
                          </div>
                          <h3 className="font-mono font-semibold text-base leading-snug text-ink mb-1 truncate">
                            {note.title || 'Untitled'}
                          </h3>
                          {preview && (
                            <p className="text-[13px] text-muted leading-relaxed line-clamp-2">
                              {preview.slice(0, 220)}
                            </p>
                          )}
                          {(total > 0 || note.tags?.length > 0) && (
                            <div className="flex flex-wrap gap-1.5 mt-3">
                              {total > 0 && (
                                open > 0
                                  ? <span className="pill pill-accent">{open} open {open === 1 ? 'action' : 'actions'}</span>
                                  : <span className="pill pill-ok">All actions done</span>
                              )}
                              {(note.tags || []).map(tag => (
                                <span key={tag} className="pill">{tag}</span>
                              ))}
                            </div>
                          )}
                        </button>

                        {/* 44x44 hit box around a small icon. Deleting shows an
                            Undo toast, so there is no confirm step in the way. */}
                        <button
                          onClick={() => onDeleteNote(note.id)}
                          aria-label={`Delete ${note.title || 'note'}`}
                          className="tap-target absolute top-1 right-1 flex items-center justify-center text-muted/60 hover:text-rec transition-colors"
                        >
                          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 6h12M8 6V4h4v2M6 6l.7 10h6.6L14 6M8.5 9v4.5M11.5 9v4.5"/>
                          </svg>
                        </button>
                      </motion.article>
                    )
                  })}
                </AnimatePresence>
              </motion.div>
            </section>
          ))}
        </div>
      )}

      <AnimatePresence>
        {ask && (
          <AskNeuroNote
            notes={notes}
            initialQuestion={ask.question}
            onClose={() => setAsk(null)}
            onOpenNote={(note) => { setAsk(null); onSelectNote(note) }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
