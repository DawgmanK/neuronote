import { useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { useRecordingContext } from '../contexts/RecordingContext'

/**
 * v2.4 — Discreet Mode.
 *
 * A full-bleed black overlay that makes an actively recording phone look like a
 * screensaver. There is no timer, no red dot, no text and no buttons — the ball
 * itself is the entire status display:
 *
 *   bouncing  →  recording
 *   frozen    →  paused
 *   absent    →  not recording
 *
 * Everything underneath keeps running untouched: the v2.3 recorder, the
 * five-minute chunk cutting, and the IndexedDB auto-save all live in
 * RecordingContext and neither know nor care that this overlay is up.
 */

const LOG = '[NeuroNote:Discreet]'

const BALL_SIZE = 36
/** Seconds for the ball to travel the full screen diagonal — slow enough to ignore. */
const DIAGONAL_SECONDS = 17.5
const BASE_OPACITY = 0.13
const FLASH_OPACITY = 0.42
const FLASH_MS = 200

/** Two taps in the same zone inside this window count as a double-tap. */
const DOUBLE_TAP_MS = 400
/** Three taps inside this window are the emergency exit, wherever they land. */
const TRIPLE_TAP_MS = 700
/**
 * A double-tap waits this long before acting, so a third tap still on its way
 * can claim the gesture instead. Without the delay, every triple-tap would fire
 * a pause first.
 */
const TRIPLE_RESOLVE_MS = 300
/** Synthetic mouse events follow a touch; ignore them for this long. */
const TOUCH_SETTLE_MS = 700

const KEEP_ALIVE_MS = 30000

function zoneFromX(x) {
  const third = window.innerWidth / 3
  if (x < third) return 'left'
  if (x > third * 2) return 'right'
  // The middle third is deliberately inert, so a stray tap does nothing.
  return 'middle'
}

export default function DiscreetScreensaver() {
  const {
    recordingState,
    pauseRecording,
    resumeRecording,
    stopRecording,
    exitDiscreet
  } = useRecordingContext()

  const ballRef = useRef(null)
  const keepAliveRef = useRef(null)
  // Position and velocity live in a ref, never in state: the ball is moved by
  // writing a transform directly, so a 60fps animation costs zero re-renders.
  const motionRef = useRef(null)
  const rafRef = useRef(null)
  const lastFrameRef = useRef(0)
  const flashTimerRef = useRef(null)
  const tapsRef = useRef([])
  const pendingTapRef = useRef(null)
  const lastTouchRef = useRef(0)

  const bounds = () => ({
    maxX: Math.max(0, window.innerWidth - BALL_SIZE),
    maxY: Math.max(0, window.innerHeight - BALL_SIZE)
  })

  // --- ball motion ----------------------------------------------------------
  const paint = useCallback(() => {
    const ball = ballRef.current
    const m = motionRef.current
    if (ball && m) ball.style.transform = `translate3d(${m.x}px, ${m.y}px, 0)`
  }, [])

  // A layout effect, not render: the start position is random, and randomness
  // during render is impure. This still runs before the browser paints, so the
  // ball is never briefly visible in the corner.
  useLayoutEffect(() => {
    if (motionRef.current === null) {
      const { maxX, maxY } = bounds()
      const diagonal = Math.hypot(window.innerWidth || 400, window.innerHeight || 800)
      const speed = diagonal / DIAGONAL_SECONDS       // px per second
      // A diagonal-ish heading, so it actually traverses rather than drumming
      // between two edges.
      const angle = Math.PI / 8 + (Math.random() * 0.5 + 0.25) * Math.PI / 2
      motionRef.current = {
        x: Math.random() * maxX,
        y: Math.random() * maxY,
        vx: Math.cos(angle) * speed * (Math.random() < 0.5 ? -1 : 1),
        vy: Math.sin(angle) * speed * (Math.random() < 0.5 ? -1 : 1)
      }
      console.log(
        `${LOG} Screensaver mounted — ball starts at ` +
        `${Math.round(motionRef.current.x)},${Math.round(motionRef.current.y)} ` +
        `at ${Math.round(speed)}px/s`
      )
    }
    paint()
  }, [paint])

  // requestAnimationFrame, never setInterval: the browser pauses rAF when the
  // screen is off or the tab is hidden, so the ball costs nothing in a pocket.
  useEffect(() => {
    if (recordingState !== 'recording') {
      // Paused (or processing): the loop simply does not start, which leaves the
      // ball frozen exactly where it was. Resuming picks up from that position.
      console.log(`${LOG} Ball frozen — recordingState is '${recordingState}'`)
      return undefined
    }

    console.log(`${LOG} Ball bouncing — recording is live`)
    lastFrameRef.current = performance.now()

    const tick = (now) => {
      // Clamped so returning from a backgrounded tab does not teleport the ball.
      const dt = Math.min((now - lastFrameRef.current) / 1000, 0.05)
      lastFrameRef.current = now

      const m = motionRef.current
      if (!m) { rafRef.current = requestAnimationFrame(tick); return }
      const { maxX, maxY } = bounds()
      m.x += m.vx * dt
      m.y += m.vy * dt

      if (m.x <= 0) { m.x = 0; m.vx = Math.abs(m.vx) }
      if (m.x >= maxX) { m.x = maxX; m.vx = -Math.abs(m.vx) }
      if (m.y <= 0) { m.y = 0; m.vy = Math.abs(m.vy) }
      if (m.y >= maxY) { m.y = maxY; m.vy = -Math.abs(m.vy) }

      paint()
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [recordingState, paint])

  // Keep the ball on screen through a rotation or a resize.
  useEffect(() => {
    const onResize = () => {
      const { maxX, maxY } = bounds()
      const m = motionRef.current
      m.x = Math.min(m.x, maxX)
      m.y = Math.min(m.y, maxY)
      paint()
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [paint])

  /** The only feedback a gesture gets: a brief brightening, no text. */
  const flash = useCallback(() => {
    const ball = ballRef.current
    if (!ball) return
    ball.style.opacity = String(FLASH_OPACITY)
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => {
      if (ballRef.current) ballRef.current.style.opacity = String(BASE_OPACITY)
      flashTimerRef.current = null
    }, FLASH_MS)
  }, [])

  // --- wake lock ------------------------------------------------------------
  useEffect(() => {
    let sentinel = null
    let released = false

    const request = async () => {
      if (!('wakeLock' in navigator)) {
        console.log(`${LOG} Wake Lock API unavailable — falling back silently`)
        return
      }
      try {
        sentinel = await navigator.wakeLock.request('screen')
        if (released) { sentinel.release().catch(() => {}); return }
        console.log(`${LOG} Wake Lock acquired — screen will stay on`)
        sentinel.addEventListener('release', () => {
          console.log(`${LOG} Wake Lock released by the system`)
          sentinel = null
        })
      } catch (e) {
        // A denied or unsupported wake lock must never break the recording.
        console.log(`${LOG} Wake Lock request failed (${e.message}) — continuing without it`)
      }
    }

    request()

    // iOS drops the lock whenever the page is backgrounded; take it again.
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !sentinel && !released) request()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      released = true
      document.removeEventListener('visibilitychange', onVisibility)
      if (sentinel) {
        sentinel.release().catch(() => {})
        console.log(`${LOG} Wake Lock released — leaving discreet mode`)
      }
    }
  }, [])

  // --- keep-alive -----------------------------------------------------------
  useEffect(() => {
    // A tiny invisible DOM write on a timer. Mobile Safari throttles pages it
    // decides are idle, and a throttled page is a throttled MediaRecorder.
    const id = setInterval(() => {
      if (keepAliveRef.current) keepAliveRef.current.dataset.tick = String(Date.now())
      console.log(`${LOG} Keep-alive tick — page stays active while recording`)
    }, KEEP_ALIVE_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => () => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    if (pendingTapRef.current) clearTimeout(pendingTapRef.current)
  }, [])

  // --- gestures -------------------------------------------------------------
  const togglePause = useCallback(() => {
    if (recordingState === 'recording') {
      console.log(`${LOG} Double-tap LEFT — pausing recording`)
      pauseRecording()
    } else if (recordingState === 'paused') {
      console.log(`${LOG} Double-tap LEFT — resuming recording`)
      resumeRecording()
    } else {
      console.log(`${LOG} Double-tap LEFT ignored — state is '${recordingState}'`)
    }
    flash()
  }, [recordingState, pauseRecording, resumeRecording, flash])

  const handleTap = useCallback((zone) => {
    const now = Date.now()
    tapsRef.current = tapsRef.current.filter(t => now - t.time <= TRIPLE_TAP_MS)
    tapsRef.current.push({ time: now, zone })
    const taps = tapsRef.current

    // Emergency exit wins over everything, from any zone.
    if (taps.length >= 3 && now - taps[taps.length - 3].time <= TRIPLE_TAP_MS) {
      if (pendingTapRef.current) {
        clearTimeout(pendingTapRef.current)
        pendingTapRef.current = null
      }
      tapsRef.current = []
      console.log(`${LOG} Triple-tap — emergency exit: leaving discreet mode and stopping the recording`)
      exitDiscreet()
      stopRecording()
      return
    }

    if (zone === 'middle') return

    const previous = taps[taps.length - 2]
    if (!previous || previous.zone !== zone || now - previous.time > DOUBLE_TAP_MS) return

    if (pendingTapRef.current) clearTimeout(pendingTapRef.current)
    pendingTapRef.current = setTimeout(() => {
      pendingTapRef.current = null
      tapsRef.current = []
      if (zone === 'left') {
        togglePause()
      } else {
        console.log(`${LOG} Double-tap RIGHT — leaving discreet mode, recording continues`)
        flash()
        exitDiscreet()
      }
    }, TRIPLE_RESOLVE_MS)
  }, [togglePause, flash, exitDiscreet, stopRecording])

  // onTouchEnd is the real handler; onMouseUp only exists so the same gestures
  // work with a pointer. dblclick is deliberately unused — it is unreliable on
  // mobile Safari, so the timing is tracked by hand.
  const onTouchEnd = (e) => {
    lastTouchRef.current = Date.now()
    const touch = e.changedTouches?.[0]
    if (touch) handleTap(zoneFromX(touch.clientX))
  }

  const onMouseUp = (e) => {
    if (Date.now() - lastTouchRef.current < TOUCH_SETTLE_MS) return
    handleTap(zoneFromX(e.clientX))
  }

  return (
    <div
      // Above the toasts and the nav: nothing from the normal UI may peek through.
      className="fixed inset-0 z-[75] select-none"
      style={{ background: '#000000', touchAction: 'none', WebkitTapHighlightColor: 'transparent' }}
      onTouchEnd={onTouchEnd}
      onMouseUp={onMouseUp}
      onContextMenu={e => e.preventDefault()}
      role="presentation"
      aria-hidden="true"
      data-testid="discreet-screensaver"
      data-recording-state={recordingState}
    >
      <div
        ref={ballRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: BALL_SIZE,
          height: BALL_SIZE,
          borderRadius: '50%',
          background: '#f5f0e8',
          opacity: BASE_OPACITY,
          willChange: 'transform'
        }}
        data-testid="discreet-ball"
      />
      <div ref={keepAliveRef} style={{ display: 'none' }} data-testid="discreet-keepalive" />
    </div>
  )
}
