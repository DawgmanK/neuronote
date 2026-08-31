import { useState, useRef, useCallback } from 'react'

export default function useLiveTranscript() {
  const [transcript, setTranscript] = useState([])
  const [isListening, setIsListening] = useState(false)
  const recognitionRef = useRef(null)
  const shouldListenRef = useRef(false)

  const startListening = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      console.warn('Web Speech API not supported')
      return
    }

    shouldListenRef.current = true
    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          const text = event.results[i][0].transcript.trim()
          if (text) {
            setTranscript(prev => [...prev, {
              speaker: 'You',
              text,
              timestamp: new Date()
            }])
          }
        }
      }
    }

    recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return
      console.error('Speech recognition error:', event.error)
    }

    recognition.onend = () => {
      if (shouldListenRef.current) {
        try { recognition.start() } catch {}
      }
    }

    try {
      recognition.start()
      recognitionRef.current = recognition
      setIsListening(true)
    } catch (e) {
      console.error('Failed to start speech recognition:', e)
    }
  }, [])

  const stopListening = useCallback(() => {
    shouldListenRef.current = false
    if (recognitionRef.current) {
      recognitionRef.current.onend = null
      try { recognitionRef.current.stop() } catch {}
      recognitionRef.current = null
    }
    setIsListening(false)
  }, [])

  const getFullTranscript = useCallback(() => {
    return transcript.map(t => `${t.speaker}: ${t.text}`).join('\n')
  }, [transcript])

  const clearTranscript = useCallback(() => {
    setTranscript([])
  }, [])

  return { transcript, isListening, startListening, stopListening, getFullTranscript, clearTranscript }
}
