import { useRef, useEffect, useState } from 'react'
import { motion } from 'framer-motion'

export default function PhotoCapture({ onCapture, onClose }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [showFlash, setShowFlash] = useState(false)

  useEffect(() => {
    let active = true
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
    }).then(stream => {
      if (!active) { stream.getTracks().forEach(t => t.stop()); return }
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
      }
    }).catch(err => {
      console.error('Camera access failed:', err)
      onClose()
    })

    return () => {
      active = false
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [onClose])

  const capture = () => {
    const video = videoRef.current
    if (!video) return

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0)
    const base64 = canvas.toDataURL('image/jpeg', 0.8)

    setShowFlash(true)
    setTimeout(() => {
      onCapture(base64)
      onClose()
    }, 300)
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 bg-black"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        playsInline
        muted
        autoPlay
      />

      {showFlash && (
        <motion.div
          className="absolute inset-0 bg-white"
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        />
      )}

      <button
        onClick={onClose}
        aria-label="Close camera" className="absolute right-4 w-11 h-11 rounded-full bg-black/50 text-white flex items-center justify-center text-lg"
        style={{ top: 'max(16px, env(safe-area-inset-top))' }}
      >
        ×
      </button>

      <div className="absolute bottom-8 left-0 right-0 flex justify-center"
        style={{ bottom: 'max(32px, env(safe-area-inset-bottom))' }}>
        <motion.button
          onClick={capture}
          className="w-16 h-16 rounded-full border-4 border-white bg-white/20 backdrop-blur"
          whileTap={{ scale: 0.9 }}
        >
          <div className="w-full h-full rounded-full bg-white/80" />
        </motion.button>
      </div>
    </motion.div>
  )
}
