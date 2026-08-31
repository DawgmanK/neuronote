import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { addCorrection } from '../lib/corrections'

const POPUP_WIDTH = 260
const MARGIN = 8
// Rough rendered height, used only to decide whether the popup fits below the
// word or must flip above it. Bumped in v2.2.1 with the 44px tap targets.
const POPUP_HEIGHT = 230

/**
 * v2.2 — small glass popup anchored to the word the user long-pressed.
 *
 * Props:
 *   wrong    — the misspelled word (ignored when `manual`)
 *   anchor   — DOMRect-ish { top, bottom, left, width } of the tapped word; centered when null
 *   manual   — true for "+ Add Manually" in the SYSTEM tab: both fields blank and editable
 *   onSave(wrong, right, remember) — fired after the dictionary write
 *   onCancel()
 */
export default function CorrectionPopup({ wrong = '', anchor = null, manual = false, onSave, onCancel }) {
  const [wrongValue, setWrongValue] = useState(manual ? '' : wrong)
  const [rightValue, setRightValue] = useState('')
  const [remember, setRemember] = useState(true)
  const firstInputRef = useRef(null)

  useEffect(() => {
    console.log(`[NeuroNote:Correction] Popup opened${manual ? ' (manual entry)' : ` for "${wrong}"`}`)
    // Autofocus after the popup has been laid out so mobile keyboards behave.
    const id = setTimeout(() => firstInputRef.current?.focus(), 30)
    return () => clearTimeout(id)
  }, [wrong, manual])

  const cancel = useCallback(() => {
    console.log('[NeuroNote:Correction] Cancelled')
    onCancel?.()
  }, [onCancel])

  const save = useCallback(() => {
    const w = (manual ? wrongValue : wrong).trim()
    const r = rightValue.trim()
    if (!w || !r) {
      console.log('[NeuroNote:Correction] Save ignored — both words are required')
      return
    }
    if (w === r) {
      console.log('[NeuroNote:Correction] Save ignored — nothing changed')
      cancel()
      return
    }
    console.log(`[NeuroNote:Correction] Saving "${w}" -> "${r}" (remember: ${remember})`)
    if (remember) addCorrection(w, r)
    onSave?.(w, r, remember)
  }, [manual, wrongValue, wrong, rightValue, remember, onSave, cancel])

  // Escape cancels from anywhere, including the checkbox and buttons.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancel])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      save()
    }
  }

  // Anchor below the word, flipped above when it would run off the bottom.
  const position = (() => {
    if (typeof window === 'undefined' || !anchor) {
      return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
    }
    const maxLeft = window.innerWidth - POPUP_WIDTH - MARGIN
    const left = Math.max(MARGIN, Math.min(anchor.left + anchor.width / 2 - POPUP_WIDTH / 2, maxLeft))
    const belowTop = anchor.bottom + MARGIN
    const fitsBelow = belowTop + POPUP_HEIGHT < window.innerHeight
    return fitsBelow
      ? { left, top: belowTop }
      : { left, top: Math.max(MARGIN, anchor.top - POPUP_HEIGHT - MARGIN) }
  })()

  return createPortal(
    <>
      {/* Tap-outside / click-outside dismiss */}
      <div className="fixed inset-0 z-[70]" onClick={cancel} onContextMenu={e => { e.preventDefault(); cancel() }} />

      <motion.div
        className="glass fixed z-[71] p-3"
        style={{ width: POPUP_WIDTH, ...position }}
        initial={{ opacity: 0, scale: 0.94, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.14 }}
        role="dialog"
        aria-label="Correct word"
        onClick={e => e.stopPropagation()}
        onContextMenu={e => e.preventDefault()}
      >
        <p className="font-mono uppercase text-[10px] font-bold tracking-wider text-muted mb-2">Change:</p>

        {manual ? (
          <input
            ref={firstInputRef}
            value={wrongValue}
            onChange={e => setWrongValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Misheard word"
            className="glass-input w-full px-3 py-2 text-sm outline-none mb-2 line-through"
            aria-label="Word to correct"
          />
        ) : (
          <p className="text-sm line-through text-muted mb-2 break-words">{wrong}</p>
        )}

        <input
          ref={manual ? undefined : firstInputRef}
          value={rightValue}
          onChange={e => setRightValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Correct spelling"
          className="glass-input w-full px-3 py-2 text-sm outline-none font-medium"
          aria-label="Correct spelling"
        />

        {!manual && (
          <label className="flex items-center gap-2 mt-1 py-3 min-h-[44px] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={remember}
              onChange={e => setRemember(e.target.checked)}
              className="w-3.5 h-3.5 accent-red"
            />
            <span className="text-[11px] text-muted">Remember this correction</span>
          </label>
        )}

        <div className="flex gap-2 mt-3">
          {/* v2.2.1 — both at least 44x44 so they are thumb-sized on mobile. */}
          <motion.button
            onClick={save}
            className="tap-target flex-1 flex items-center justify-center py-2 rounded-xl text-white font-mono uppercase text-[10px] tracking-wider"
            style={{ background: 'linear-gradient(to right, #dc2626, #991b1b)' }}
            whileTap={{ scale: 0.95 }}
          >
            Save
          </motion.button>
          <motion.button
            onClick={cancel}
            className="tap-target flex-1 flex items-center justify-center py-2 rounded-xl border border-red/30 text-red font-mono uppercase text-[10px] tracking-wider"
            whileTap={{ scale: 0.95 }}
          >
            Cancel
          </motion.button>
        </div>
      </motion.div>
    </>,
    document.body
  )
}
