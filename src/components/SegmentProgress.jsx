import { motion, AnimatePresence } from 'framer-motion'
import { formatDuration } from '../contexts/RecordingContext'
import { SEGMENT_STATUS } from '../lib/segmented-transcription'

const ICONS = {
  [SEGMENT_STATUS.PENDING]: '◯',
  [SEGMENT_STATUS.UPLOADING]: '⟳',
  [SEGMENT_STATUS.TRANSCRIBING]: '⟳',
  [SEGMENT_STATUS.COMPLETE]: '✓',
  [SEGMENT_STATUS.FAILED]: '✕'
}

const TONE = {
  [SEGMENT_STATUS.PENDING]: { color: '#8a8178', border: 'rgba(0,0,0,0.08)' },
  [SEGMENT_STATUS.UPLOADING]: { color: '#991b1b', border: 'rgba(220,38,38,0.30)' },
  [SEGMENT_STATUS.TRANSCRIBING]: { color: '#991b1b', border: 'rgba(220,38,38,0.30)' },
  [SEGMENT_STATUS.COMPLETE]: { color: '#16a34a', border: 'rgba(22,163,74,0.35)' },
  [SEGMENT_STATUS.FAILED]: { color: '#dc2626', border: 'rgba(220,38,38,0.45)' }
}

function rangeLabel(segment) {
  const from = Math.floor((segment.startTimeOffset || 0) / 60)
  const to = Math.max(Math.round((segment.endTimeOffset || 0) / 60), from + 1)
  return `${from}-${to}min`
}

/**
 * v2.3 — the transcription-is-already-happening strip.
 *
 * A 70-minute meeting used to end with a ten-minute wait and no sign anything
 * was working. Each five-minute segment shows up here the moment it is cut and
 * ticks over to ✓ as AssemblyAI returns it, so by the time the user taps Stop
 * they can see that only the last chunk is left to do.
 */
export default function SegmentProgress({ segments, elapsedSeconds, isRecording, enabled }) {
  if (!enabled) return null

  const spinning = segments.some(
    s => s.status === SEGMENT_STATUS.UPLOADING || s.status === SEGMENT_STATUS.TRANSCRIBING
  )

  return (
    <div className="w-full overflow-x-auto -mx-1 px-1">
      <div className="flex items-center gap-1.5 py-1 min-w-min">
        <AnimatePresence initial={false}>
          {segments.map(segment => {
            const tone = TONE[segment.status] || TONE[SEGMENT_STATUS.PENDING]
            return (
              <motion.span
                key={segment.segmentId}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/50 backdrop-blur font-mono text-[10px] tracking-wider whitespace-nowrap flex-shrink-0"
                style={{ color: tone.color, border: `1px solid ${tone.border}` }}
                title={segment.error ? `Segment ${segment.index}: ${segment.error}` : `Segment ${segment.index}: ${segment.status}`}
              >
                <span className={spinning && ICONS[segment.status] === '⟳' ? 'inline-block animate-spin' : ''}>
                  {ICONS[segment.status] || '◯'}
                </span>
                {rangeLabel(segment)}
              </motion.span>
            )
          })}
        </AnimatePresence>

        {isRecording && (
          <span
            className="flex items-center gap-1 px-2 py-1 rounded-lg font-mono text-[10px] tracking-wider whitespace-nowrap flex-shrink-0"
            style={{ color: '#dc2626', border: '1px solid rgba(220,38,38,0.45)', background: 'rgba(220,38,38,0.08)' }}
          >
            <span className="w-1.5 h-1.5 rounded-full dot-pulse-fast" style={{ background: '#dc2626' }} />
            recording {formatDuration(elapsedSeconds)}
          </span>
        )}
      </div>
    </div>
  )
}
