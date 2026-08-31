import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import AskNeuroNote from './AskNeuroNote'

export default function Archive({ notes, onSelectNote, onDeleteNote }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [showAsk, setShowAsk] = useState(false)

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return notes
    const q = searchQuery.toLowerCase()
    return notes.filter(n =>
      (n.title || '').toLowerCase().includes(q) ||
      (n.transcript || '').toLowerCase().includes(q) ||
      (n.tags || []).some(t => t.toLowerCase().includes(q))
    )
  }, [notes, searchQuery])

  const formatDate = (iso) => {
    if (!iso) return ''
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const formatDur = (seconds) => {
    if (!seconds) return ''
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const typeIcon = (type) => {
    if (type === 'photo') return (
      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="4" width="16" height="12" rx="2"/><circle cx="10" cy="10" r="3"/></svg>
    )
    if (type === 'upload') return (
      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 17h12M10 3v10m-4-4 4-4 4 4"/></svg>
    )
    return (
      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10 2a4 4 0 014 4v3a4 4 0 01-8 0V6a4 4 0 014-4z"/><path d="M4 9a6 6 0 0012 0"/><path d="M10 15v3"/></svg>
    )
  }

  return (
    <div className="px-4 pb-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-mono uppercase text-lg font-bold tracking-wider typewriter-shadow">Archive</h1>
        <motion.button
          onClick={() => setShowAsk(true)}
          className="tap-target flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-white text-sm font-mono uppercase tracking-wider"
          style={{ background: 'linear-gradient(to right, #dc2626, #991b1b)' }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a8 8 0 100 16 8 8 0 000-16zm1 11H9v-2h2v2zm0-4H9V5h2v4z"/></svg>
          Ask
        </motion.button>
      </div>

      <div className="relative mb-4">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="9" cy="9" r="6"/><path d="M14 14l4 4"/>
        </svg>
        <input
          type="text"
          placeholder="Search notes..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="glass-input w-full pl-10 pr-4 py-3 font-mono text-sm text-ink placeholder-muted outline-none focus:border-red/50"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted">
          <svg width="48" height="48" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1" className="mb-4 opacity-30">
            <path d="M10 2a4 4 0 014 4v3a4 4 0 01-8 0V6a4 4 0 014-4z"/><path d="M4 9a6 6 0 0012 0"/><path d="M10 15v3"/>
          </svg>
          <p className="font-mono uppercase text-sm tracking-wider">
            {searchQuery ? 'No matching notes' : 'No notes yet'}
          </p>
          <p className="text-xs mt-1">{searchQuery ? 'Try a different search' : 'Start recording to create your first note!'}</p>
        </div>
      ) : (
        <motion.div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3" layout>
          <AnimatePresence>
            {filtered.map((note, i) => (
              <GlassCard
                key={note.id}
                onClick={() => onSelectNote(note)}
                className="relative cursor-pointer"
                transition={{ delay: i * 0.05 }}
              >
                {/* v2.2.1 — 44x44 hit box, 24px circle: the card looks the same. */}
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteNote(note.id) }}
                  aria-label={`Delete ${note.title || 'note'}`}
                  className="tap-target absolute top-2 right-2 -m-2.5 flex items-center justify-center"
                >
                  <span className="w-6 h-6 rounded-full bg-white/50 flex items-center justify-center text-muted hover:text-red hover:bg-red/10 transition-colors text-xs">
                    ×
                  </span>
                </button>

                <div className="flex items-center gap-1.5 mb-1.5 text-muted">
                  {typeIcon(note.type)}
                  <span className="text-[10px] font-mono uppercase">{formatDate(note.date)}</span>
                </div>

                <h3 className="font-mono uppercase text-xs font-bold truncate mb-1">{note.title || 'Untitled'}</h3>

                <div className="flex items-center gap-2 mb-2">
                  {note.duration > 0 && (
                    <span className="text-[10px] text-muted font-mono">{formatDur(note.duration)}</span>
                  )}
                  {note.speakers > 1 && (
                    <span className="text-[10px] bg-red/10 text-red-dark px-1.5 py-0.5 rounded-full font-mono">
                      {note.speakers} speakers
                    </span>
                  )}
                </div>

                <p className="text-[11px] text-muted line-clamp-3 leading-relaxed mb-2">
                  {(note.transcript || note.summary?.paragraph || '').slice(0, 120)}
                </p>

                {note.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {note.tags.map(tag => (
                      <span key={tag} className="text-[10px] bg-red/10 text-red-dark px-2 py-0.5 rounded-full">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </GlassCard>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <AnimatePresence>
        {showAsk && <AskNeuroNote onClose={() => setShowAsk(false)} notes={notes} />}
      </AnimatePresence>
    </div>
  )
}
