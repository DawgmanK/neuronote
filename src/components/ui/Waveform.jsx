import { useRef, useEffect, useCallback } from 'react'

export default function Waveform({ stream, isRecording, color = '#dc2626' }) {
  const canvasRef = useRef(null)
  const animRef = useRef(null)
  const analyserRef = useRef(null)
  const audioCtxRef = useRef(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)

    if (analyserRef.current && isRecording) {
      const analyser = analyserRef.current
      const bufferLength = analyser.frequencyBinCount
      const dataArray = new Uint8Array(bufferLength)
      analyser.getByteFrequencyData(dataArray)

      const barCount = 40
      const barWidth = w / barCount - 2
      const step = Math.floor(bufferLength / barCount)

      for (let i = 0; i < barCount; i++) {
        const value = dataArray[i * step] / 255
        const barHeight = Math.max(4, value * h * 0.85)
        const x = i * (barWidth + 2) + 1
        const y = (h - barHeight) / 2

        ctx.beginPath()
        ctx.roundRect(x, y, barWidth, barHeight, 2)
        ctx.fillStyle = `rgba(220, 38, 38, ${0.3 + value * 0.7})`
        ctx.fill()
      }
    } else {
      const barCount = 40
      const barWidth = w / barCount - 2
      const time = Date.now() / 1000
      for (let i = 0; i < barCount; i++) {
        const value = 0.15 + 0.1 * Math.sin(time * 1.5 + i * 0.3)
        const barHeight = Math.max(4, value * h)
        const x = i * (barWidth + 2) + 1
        const y = (h - barHeight) / 2
        ctx.beginPath()
        ctx.roundRect(x, y, barWidth, barHeight, 2)
        ctx.fillStyle = `rgba(220, 38, 38, 0.2)`
        ctx.fill()
      }
    }

    animRef.current = requestAnimationFrame(draw)
  }, [isRecording])

  useEffect(() => {
    if (stream && isRecording) {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      const source = audioCtx.createMediaStreamSource(stream)
      source.connect(analyser)
      analyserRef.current = analyser
      audioCtxRef.current = audioCtx
    }

    return () => {
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {})
        audioCtxRef.current = null
        analyserRef.current = null
      }
    }
  }, [stream, isRecording])

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas) {
      const rect = canvas.parentElement.getBoundingClientRect()
      canvas.width = rect.width * window.devicePixelRatio
      canvas.height = 80 * window.devicePixelRatio
      canvas.style.width = '100%'
      canvas.style.height = '80px'
      const ctx = canvas.getContext('2d')
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
    }
    animRef.current = requestAnimationFrame(draw)
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current)
    }
  }, [draw])

  return (
    <div className="w-full">
      <canvas ref={canvasRef} className="w-full" style={{ height: 80 }} />
    </div>
  )
}
