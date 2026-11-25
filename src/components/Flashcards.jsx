import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import CorrectableText from './CorrectableText'
import { gradeAnswer, hasActiveApiKey } from '../lib/ai-provider'

export default function Flashcards({ flashcards = [], quiz = [], onCorrection }) {
  const [mode, setMode] = useState('study')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)
  const [userAnswer, setUserAnswer] = useState('')
  const [gradeResult, setGradeResult] = useState(null)
  const [score, setScore] = useState({ correct: 0, total: 0 })

  const items = mode === 'study' ? flashcards : quiz

  if (!items.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted">
        <svg width="40" height="40" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1" className="mb-3 opacity-30">
          <rect x="3" y="2" width="14" height="16" rx="2"/><path d="M7 6h6M7 10h6M7 14h3"/>
        </svg>
        <p className="font-mono text-[13px] font-medium">No flashcards yet</p>
        <p className="text-xs mt-1">Record or upload content to generate cards</p>
      </div>
    )
  }

  const current = items[currentIndex]

  const handleGrade = async () => {
    if (!userAnswer.trim()) return
    setGradeResult({ loading: true })
    try {
      if (hasActiveApiKey()) {
        const result = await gradeAnswer(current.question, current.answer, userAnswer)
        setGradeResult(result)
      } else {
        const correct = current.answer.toLowerCase().includes(userAnswer.toLowerCase().trim())
        setGradeResult({ correct, feedback: correct ? 'Looks right!' : `The answer is: ${current.answer}` })
      }
      setScore(s => ({ correct: s.correct + (gradeResult?.correct ? 1 : 0), total: s.total + 1 }))
    } catch {
      const correct = current.answer.toLowerCase().includes(userAnswer.toLowerCase().trim())
      setGradeResult({ correct, feedback: correct ? 'Looks right!' : `The answer is: ${current.answer}` })
    }
  }

  const nextCard = () => {
    setCurrentIndex(i => Math.min(i + 1, items.length - 1))
    setIsFlipped(false)
    setUserAnswer('')
    setGradeResult(null)
  }

  const prevCard = () => {
    setCurrentIndex(i => Math.max(i - 1, 0))
    setIsFlipped(false)
    setUserAnswer('')
    setGradeResult(null)
  }

  return (
    <div>
      {/* Mode toggle */}
      <div className="flex justify-center mb-6">
        <div className="flex gap-1 p-1 rounded-full bg-white/[0.06] backdrop-blur">
          {['study', 'quiz'].map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); setCurrentIndex(0); setIsFlipped(false); setUserAnswer(''); setGradeResult(null); setScore({ correct: 0, total: 0 }) }}
              className="tap-target -my-2 flex items-center"
            >
              <span
                className={`block px-5 py-1.5 rounded-full font-mono text-[13px] font-medium transition-all ${
                  mode === m ? 'text-white' : 'text-muted hover:text-ink'
                }`}
                style={mode === m ? { background: 'var(--grad-accent)' } : undefined}
              >
                {m}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Progress */}
      <div className="flex items-center justify-between mb-4">
        <div className="w-full h-1 bg-white/[0.06] rounded-full mr-4">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${((currentIndex + 1) / items.length) * 100}%`,
              background: 'var(--grad-accent)'
            }}
          />
        </div>
        {mode === 'quiz' && (
          <span className="font-mono text-xs text-muted whitespace-nowrap">
            {score.correct}/{score.total}
          </span>
        )}
      </div>

      {mode === 'study' ? (
        /* STUDY MODE - 3D flip card */
        <div className="perspective mb-6">
          <motion.div
            className="relative w-full min-h-[200px] cursor-pointer preserve-3d"
            animate={{ rotateY: isFlipped ? 180 : 0 }}
            transition={{ duration: 0.6, ease: 'easeInOut' }}
            onClick={() => setIsFlipped(!isFlipped)}
          >
            {/* Front */}
            <div className="absolute inset-0 backface-hidden">
              <GlassCard className="h-full min-h-[200px] flex flex-col items-center justify-center text-center" hoverable={false} animate={false}>
                <p className="text-[11px] font-mono uppercase text-muted mb-2 tracking-wider">Question</p>
                <CorrectableText as="p" className="text-sm leading-relaxed" text={current?.question} onCorrection={onCorrection} />
                <p className="text-[11px] text-muted mt-4">Tap to reveal</p>
              </GlassCard>
            </div>
            {/* Back */}
            <div className="absolute inset-0 backface-hidden rotate-y-180">
              <GlassCard className="h-full min-h-[200px] flex flex-col items-center justify-center text-center" hoverable={false} animate={false}
                style={{ background: 'rgba(42, 168, 255, 0.07)' }}>
                <p className="text-[11px] font-mono uppercase text-accent mb-2 tracking-wider">Answer</p>
                <CorrectableText as="p" className="text-sm leading-relaxed" text={current?.answer} onCorrection={onCorrection} />
              </GlassCard>
            </div>
          </motion.div>
        </div>
      ) : (
        /* QUIZ MODE */
        <div className="space-y-4 mb-6">
          <GlassCard hoverable={false} animate={false}>
            <p className="text-[11px] font-mono uppercase text-muted mb-2 tracking-wider">Question {currentIndex + 1}</p>
            <CorrectableText as="p" className="text-sm leading-relaxed" text={current?.question} onCorrection={onCorrection} />

            {current?.options?.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {current.options.map((opt, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="font-mono text-[11px] text-accent mt-0.5">{String.fromCharCode(65 + i)}.</span>
                    <CorrectableText className="leading-relaxed" text={opt} onCorrection={onCorrection} />
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>

          {!gradeResult && (
            <div className="space-y-3">
              <input
                type="text"
                value={userAnswer}
                onChange={e => setUserAnswer(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleGrade()}
                placeholder="Type your answer..."
                className="glass-input w-full px-4 py-3 text-sm outline-none"
              />
              <motion.button
                onClick={handleGrade}
                disabled={!userAnswer.trim()}
                className="w-full py-3 rounded-xl text-white font-mono text-[13px] font-medium disabled:opacity-40"
                style={{ background: 'var(--grad-accent)' }}
                whileTap={{ scale: 0.98 }}
              >
                Check Answer
              </motion.button>
            </div>
          )}

          <AnimatePresence>
            {gradeResult && !gradeResult.loading && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <GlassCard hoverable={false} animate={false}
                  style={{ background: gradeResult.correct ? 'rgba(45, 255, 154, 0.1)' : 'rgba(255, 45, 85, 0.12)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    {gradeResult.correct ? (
                      <span className="text-ok font-mono text-sm font-bold">✓ Correct!</span>
                    ) : (
                      <span className="text-accent font-mono text-sm font-bold">✗ Not quite</span>
                    )}
                  </div>
                  <p className="text-xs text-muted">{gradeResult.feedback}</p>
                  {current?.explanation && (
                    <CorrectableText as="p" className="text-xs text-muted mt-1" text={current.explanation} onCorrection={onCorrection} />
                  )}
                </GlassCard>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-center gap-6">
        <motion.button
          onClick={prevCard}
          disabled={currentIndex === 0}
          className="w-11 h-11 rounded-full bg-white/[0.06] flex items-center justify-center disabled:opacity-30"
          whileTap={{ scale: 0.9 }}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M12 15l-5-5 5-5"/></svg>
        </motion.button>

        <span className="font-mono text-sm text-muted">
          {currentIndex + 1} / {items.length}
        </span>

        <motion.button
          onClick={nextCard}
          disabled={currentIndex === items.length - 1}
          className="w-11 h-11 rounded-full bg-white/[0.06] flex items-center justify-center disabled:opacity-30"
          whileTap={{ scale: 0.9 }}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M8 5l5 5-5 5"/></svg>
        </motion.button>
      </div>
    </div>
  )
}
