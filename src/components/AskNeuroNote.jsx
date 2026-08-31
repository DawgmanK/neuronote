import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getEmbeddings } from '../lib/storage'
import { generateEmbedding, generateAnswer } from '../lib/openai'
import { searchNotes } from '../lib/vectorSearch'

export default function AskNeuroNote({ onClose, notes }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const chatRef = useRef(null)

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [messages])

  const handleSubmit = async (e) => {
    e?.preventDefault()
    if (!input.trim() || isLoading) return

    const question = input.trim()
    setInput('')
    setError(null)
    setMessages(prev => [...prev, { role: 'user', content: question }])
    setIsLoading(true)

    try {
      const embeddings = getEmbeddings()
      if (embeddings.length === 0) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: 'I don\'t have any indexed notes yet. Record or upload some content first, and make sure you have an OpenAI API key configured for embeddings.'
        }])
        setIsLoading(false)
        return
      }

      const results = await searchNotes(question, embeddings, generateEmbedding, 5)
      const contextChunks = results.map(r => {
        const note = notes.find(n => n.id === r.noteId)
        return { text: r.text, noteTitle: note?.title || 'Untitled', noteId: r.noteId }
      })

      const history = messages.filter(m => m.role === 'assistant').length > 0
        ? messages.slice(-6).map(m => ({ role: m.role, content: m.content }))
        : []

      const answer = await generateAnswer(question, contextChunks, history)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: answer,
        sources: contextChunks.slice(0, 3)
      }])
    } catch (err) {
      setError(err.message)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Sorry, I couldn't process that: ${err.message}`
      }])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        className="relative w-full max-w-2xl h-[80vh] rounded-2xl flex flex-col overflow-hidden glass"
        style={{ background: 'rgba(245, 240, 232, 0.95)' }}
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 50, opacity: 0 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-red/10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-mono font-bold text-sm"
              style={{ background: 'linear-gradient(to right, #dc2626, #991b1b)' }}>
              ?
            </div>
            <h2 className="font-mono uppercase text-sm font-bold tracking-wider">Ask NeuroNote</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="tap-target -m-1.5 flex items-center justify-center">
            <span className="w-8 h-8 rounded-full bg-white/50 flex items-center justify-center text-muted hover:text-ink transition-colors">
              ×
            </span>
          </button>
        </div>

        {/* Chat */}
        <div ref={chatRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-muted py-12">
              <p className="font-mono uppercase text-sm mb-2">Ask anything about your notes</p>
              <p className="text-xs">e.g., "What did we discuss about the budget last week?"</p>
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
                <div className={`max-w-[80%] px-4 py-2.5 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'rounded-2xl rounded-br-sm text-white'
                    : 'glass rounded-2xl rounded-bl-sm'
                }`} style={msg.role === 'user' ? { background: 'linear-gradient(to right, #dc2626, #991b1b)' } : undefined}>
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  {msg.sources?.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-white/20 flex flex-wrap gap-1">
                      {msg.sources.map((s, j) => (
                        <span key={j} className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full">
                          📄 {s.noteTitle}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {isLoading && (
            <div className="flex justify-start">
              <div className="glass rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1">
                <span className="w-2 h-2 bg-red rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-red rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-red rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="p-4 border-t border-red/10">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ask a question..."
              className="glass-input flex-1 px-4 py-3 text-sm outline-none"
              disabled={isLoading}
            />
            <motion.button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="w-11 h-11 flex-shrink-0 rounded-full flex items-center justify-center text-white disabled:opacity-40"
              style={{ background: 'linear-gradient(to right, #dc2626, #991b1b)' }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 3l-1.4 1.4L13.2 9H3v2h10.2l-4.6 4.6L10 17l7-7z" />
              </svg>
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
