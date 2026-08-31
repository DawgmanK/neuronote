import { useState, useRef, useCallback, useEffect, Fragment } from 'react'
import CorrectionPopup from './CorrectionPopup'

const LONG_PRESS_MS = 500
const MOVE_TOLERANCE = 10   // px of drag allowed before we assume the user is selecting text

// Leading punctuation / the word itself / trailing punctuation.
// Only the middle group becomes the tappable, correctable word.
const CHUNK = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u

/**
 * v2.2 — renders text with every word individually targetable.
 *   • mobile: long-press (~500ms) a word
 *   • desktop: right-click a word
 *   • keyboard: Tab to a word, press Enter
 * Each opens <CorrectionPopup>; on save the parent gets onCorrection(wrong, right).
 *
 * Text selection is untouched: nothing is preventDefault-ed on touchstart, and a
 * drag past MOVE_TOLERANCE cancels the pending long-press.
 */
export default function CorrectableText({ text, onCorrection, className = '', as: Tag = 'span' }) {
  const [active, setActive] = useState(null)   // { key, word, anchor }
  const timerRef = useRef(null)
  const startRef = useRef(null)
  const firedRef = useRef(false)

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    startRef.current = null
  }, [])

  useEffect(() => clearTimer, [clearTimer])

  const openPopup = useCallback((key, word, el) => {
    if (!word) return
    const rect = el?.getBoundingClientRect?.()
    console.log(`[NeuroNote:Correction] Long-press / context target: "${word}"`)
    setActive({
      key,
      word,
      anchor: rect ? { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width } : null
    })
  }, [])

  const close = useCallback(() => setActive(null), [])

  const handleSave = useCallback((wrong, right) => {
    setActive(null)
    onCorrection?.(wrong, right)
  }, [onCorrection])

  const value = typeof text === 'string' ? text : (text == null ? '' : String(text))
  if (!value) return null

  const segments = value.split(/(\s+)/)
  const preserveWhitespace = value.includes('\n')

  const wordProps = (key, word) => ({
    role: 'button',
    tabIndex: 0,
    'aria-label': `Correct the word ${word}`,
    className: `rounded cursor-text transition-colors ${
      active?.key === key ? 'bg-red/15' : 'hover:bg-red/5'
    }`,
    onContextMenu: (e) => {
      e.preventDefault()
      e.stopPropagation()
      openPopup(key, word, e.currentTarget)
    },
    onKeyDown: (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        openPopup(key, word, e.currentTarget)
      }
    },
    onTouchStart: (e) => {
      firedRef.current = false
      const touch = e.touches[0]
      const el = e.currentTarget
      startRef.current = { x: touch.clientX, y: touch.clientY }
      clearTimer()
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        firedRef.current = true
        if (navigator.vibrate) navigator.vibrate(15)
        openPopup(key, word, el)
      }, LONG_PRESS_MS)
    },
    onTouchMove: (e) => {
      if (!startRef.current) return
      const touch = e.touches[0]
      const moved =
        Math.abs(touch.clientX - startRef.current.x) > MOVE_TOLERANCE ||
        Math.abs(touch.clientY - startRef.current.y) > MOVE_TOLERANCE
      if (moved) clearTimer()
    },
    onTouchEnd: clearTimer,
    onTouchCancel: clearTimer,
    onClick: (e) => {
      // Swallow the synthetic click that follows a long-press so we don't also
      // trigger whatever the surrounding element does (speaker rename, flip, ...).
      if (firedRef.current) {
        e.preventDefault()
        e.stopPropagation()
        firedRef.current = false
      }
    }
  })

  return (
    <Tag className={className} style={preserveWhitespace ? { whiteSpace: 'pre-wrap' } : undefined}>
      {segments.map((segment, i) => {
        if (!segment) return null
        if (/^\s+$/.test(segment)) return <Fragment key={i}>{segment}</Fragment>

        const match = segment.match(CHUNK)
        const lead = match?.[1] || ''
        const word = match?.[2] || ''
        const trail = match?.[3] || ''

        if (!word) return <Fragment key={i}>{segment}</Fragment>

        return (
          <Fragment key={i}>
            {lead}
            <span {...wordProps(i, word)}>{word}</span>
            {trail}
          </Fragment>
        )
      })}

      {active && (
        <CorrectionPopup
          wrong={active.word}
          anchor={active.anchor}
          onSave={handleSave}
          onCancel={close}
        />
      )}
    </Tag>
  )
}
