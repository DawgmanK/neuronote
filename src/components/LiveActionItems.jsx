import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import { detectActionItems } from '../lib/openai'

export default function LiveActionItems({ transcript, isRecording, enabled, hasApiKey }) {
  const [actionItems, setActionItems] = useState([])
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const lastAnalyzedRef = useRef(0)
  const itemIdRef = useRef(0)

  useEffect(() => {
    if (!isRecording || !enabled || !hasApiKey) return

    const interval = setInterval(async () => {
      if (!transcript || transcript.length - lastAnalyzedRef.current < 50) return

      setIsAnalyzing(true)
      try {
        const newItems = await detectActionItems(transcript)
        if (Array.isArray(newItems) && newItems.length > 0) {
          setActionItems(prev => {
            const existing = prev.map(i => i.action.toLowerCase())
            const genuinelyNew = newItems.filter(item =>
              !existing.some(e => e.includes(item.action.toLowerCase().slice(0, 30)))
            )
            return [...prev, ...genuinelyNew.map(item => ({
              ...item,
              id: ++itemIdRef.current
            }))]
          })
        }
        lastAnalyzedRef.current = transcript.length
      } catch (e) {
        console.error('Action item detection failed:', e)
      } finally {
        setIsAnalyzing(false)
      }
    }, 30000)

    return () => clearInterval(interval)
  }, [isRecording, enabled, hasApiKey, transcript])

  useEffect(() => {
    if (!isRecording) {
      setActionItems([])
      lastAnalyzedRef.current = 0
    }
  }, [isRecording])

  return (
    <GlassCard className="h-full" hoverable={false} animate={false}>
      <div className="flex items-center gap-2 mb-3">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round">
          <path d="M10 2v6l4 2" /><circle cx="10" cy="10" r="8" />
        </svg>
        <h3 className="font-mono uppercase text-xs font-bold tracking-wider">Live Action Items</h3>
        {isAnalyzing && (
          <span className="w-2 h-2 bg-red rounded-full dot-pulse-fast" />
        )}
      </div>

      {!enabled && (
        <p className="text-xs text-muted">Enable in System settings</p>
      )}
      {enabled && !hasApiKey && (
        <p className="text-xs text-muted">Requires OpenAI API key</p>
      )}
      {enabled && hasApiKey && !isRecording && (
        <p className="text-xs text-muted">Action items will appear during recording...</p>
      )}

      {enabled && hasApiKey && isRecording && actionItems.length === 0 && (
        <p className="text-xs text-muted">
          {isAnalyzing ? 'Analyzing...' : 'Action items will appear here as they\'re detected...'}
        </p>
      )}

      <div className="space-y-2 mt-2 max-h-60 overflow-y-auto">
        <AnimatePresence>
          {actionItems.map(item => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="flex items-start gap-2 p-2 rounded-lg bg-white/30"
            >
              <div className="mt-0.5 w-4 h-4 rounded border border-red/30 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs leading-relaxed">{item.action}</p>
                <div className="flex gap-2 mt-1">
                  {item.owner && (
                    <span className="text-[10px] bg-red/10 text-red-dark px-1.5 py-0.5 rounded-full">
                      {item.owner}
                    </span>
                  )}
                  {item.due && (
                    <span className="text-[10px] text-muted">{item.due}</span>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </GlassCard>
  )
}
