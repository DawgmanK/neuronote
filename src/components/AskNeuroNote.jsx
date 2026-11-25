import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getEmbeddings } from '../lib/storage'
import { generateEmbedding, generateAnswer, hasActiveApiKey } from '../lib/ai-provider'
import { searchNotes } from '../lib/vectorSearch'

/**
 * Conversational Q&A over the whole archive.
 *
 * v2.8 — opened from HOME's search bar rather than a separate button. Whatever
 * the user typed arrives as `initialQuestion` and is asked immediately, and the
 * meetings an answer drew on are tappable: `onOpenNote` jumps straight to one.
 */
export default function AskNeuroNote({ onClose, notes, initialQuestion = '', onOpenNote }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const chatRef = useRef(null)
  const messagesRef = useRef(messages)
  const busyRef = useRef(false)
  const autoAsked = useRef(false)

  useEffect(() => { messagesRef.current = messages }, [messages])

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [messages, isLoading])

  const askQuestion = useCallback(async (raw) => {
    const question = (raw || '').trim()
    if (!question || busyRef.current) return
    busyRef.current = true

    const priorMessages = messagesRef.current
    setMessages(prev => [...prev, { role: 'user', content: question }])
    setIsLoading(true)

    try {
      if (!hasActiveApiKey()) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: 'Ask needs an AI key. Add one in Settings and your meetings become searchable by meaning.'
        }])
        return
      }

      // Only meetings that still exist. Deleting a note leaves its index
      // behind until the next launch (so Undo can bring it back whole), and
      // those passages must not be retrieved or quoted in the meantime.
      const liveIds = new Set(notes.map(n => n.id))
      const embeddings = getEmbeddings().filter(entry => liveIds.has(entry.noteId))
      if (embeddings.length === 0) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: 'None of your meetings are indexed yet. Record or upload one with an AI key saved, and it becomes searchable here.'
        }])
        return
      }

      const results = await searchNotes(question, embeddings, generateEmbedding, 5)
      const contextChunks = results.map(r => {
        const note = notes.find(n => n.id === r.noteId)
        return { text: r.text, noteTitle: note?.title || 'Untitled', noteId: r.noteId }
      })

      const history = priorMessages.some(m => m.role === 'assistant')
        ? priorMessages.slice(-6).map(m => ({ role: m.role, content: m.content }))
        : []

      const answer = await generateAnswer(question, contextChunks, history)

      // One chip per meeting, however many passages it contributed.
      const seen = new Set()
      const sources = contextChunks.filter(c => {
        if (seen.has(c.noteId)) return false
        seen.add(c.noteId)
        return true
      }).slice(0, 3)

      setMessages(prev => [...prev, { role: 'assistant', content: answer, sources }])
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `That didn't go through: ${err.message}`,
        failed: true
      }])
    } finally {
      busyRef.current = false
      setIsLoading(false)
    }
  }, [notes])

  // Ask whatever the user typed on HOME, once. The latch survives StrictMode's
  // double-mounted effect, which would otherwise send the question twice.
  useEffect(() => {
    if (autoAsked.current || !initialQuestion.trim()) return
    autoAsked.current = true
    askQuestion(initialQuestion)
  }, [initialQuestion, askQuestion])

  const handleSubmit = (e) => {
    e?.preventDefault()
    if (!input.trim() || isLoading) return
    const question = input
    setInput('')
    askQuestion(question)
  }

  const openSource = (noteId) => {
    const note = notes.find(n => n.id === noteId)
    if (note && onOpenNote) onOpenNote(note)
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        className="sheet relative w-full max-w-2xl h-[88dvh] sm:h-[80vh] rounded-t-3xl sm:rounded-3xl flex flex-col overflow-hidden"
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 260 }}
        role="dialog"
        aria-modal="true"
        aria-label="Ask NeuroNote"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-xl flex items-center justify-center text-accent bg-accent/10 border border-accent/30"
              style={{ boxShadow: '0 0 16px rgba(42,168,255,0.25)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>
              </svg>
            </span>
            <div>
              <h2 className="font-mono font-semibold text-[15px] leading-tight">Ask NeuroNote</h2>
              <p className="text-xs text-muted">Answers from your own meetings</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="tap-target -mr-2 flex items-center justify-center text-muted hover:text-ink">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M5 5l10 10M15 5 5 15"/></svg>
          </button>
        </div>

        {/* Chat */}
        <div ref={chatRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && !isLoading && (
            <div className="text-center py-12">
              <p className="font-mono font-semibold text-base mb-1">Ask anything about your meetings</p>
              <p className="text-sm text-muted">Try “What did we decide about the budget?”</p>
            </div>
          )}

          <AnimatePresence>
            {messages.map((msg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-[85%] px-4 py-2.5 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'btn-primary rounded-2xl rounded-br-md'
                    : `rounded-2xl rounded-bl-md bg-white/[0.05] border ${msg.failed ? 'border-rec/40' : 'border-white/10'}`
                }`}>
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  {msg.sources?.length > 0 && (
                    <div className="mt-3 pt-2.5 border-t border-white/10">
                      <p className="section-label !text-[10px] mb-1.5">From</p>
                      <div className="flex flex-wrap gap-1.5">
                        {msg.sources.map(source => (
                          <button
                            key={source.noteId}
                            onClick={() => openSource(source.noteId)}
                            className="pill pill-accent hover:brightness-125 transition max-w-full"
                          >
                            <span className="truncate">{source.noteTitle}</span>
                            <span aria-hidden="true">→</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {isLoading && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md px-4 py-3.5 flex items-center gap-1.5 bg-white/[0.05] border border-white/10">
                {[0, 150, 300].map(delay => (
                  <span key={delay} className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce"
                    style={{ animationDelay: `${delay}ms`, boxShadow: '0 0 8px rgba(42,168,255,0.9)' }} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="p-3 border-t border-white/10"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          <div className="glass-input flex items-center gap-2 pl-4 pr-1.5 py-1.5">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ask a follow-up"
              aria-label="Ask a question"
              className="flex-1 min-w-0 bg-transparent outline-none text-[15px] py-2"
              disabled={isLoading}
            />
            <motion.button
              type="submit"
              disabled={isLoading || !input.trim()}
              aria-label="Send"
              className="btn-primary w-9 h-9 flex-shrink-0 rounded-[10px] flex items-center justify-center disabled:opacity-35 disabled:shadow-none"
              whileTap={{ scale: 0.94 }}
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 16V4M5 9l5-5 5 5" />
              </svg>
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
