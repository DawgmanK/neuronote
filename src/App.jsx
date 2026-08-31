import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Archive from './components/Archive'
import Capture from './components/Capture'
import Session from './components/Session'
import System from './components/System'
import NoteDetail from './components/NoteDetail'
import BottomNav from './components/BottomNav'
import RecordingBanner from './components/RecordingBanner'
import RecoveryPrompt from './components/RecoveryPrompt'
import ConfirmDialog from './components/ConfirmDialog'
import StatusBadge from './components/ui/StatusBadge'
import { ToastProvider, useToast } from './components/ui/Toast'
import { RecordingProvider, useRecordingContext } from './contexts/RecordingContext'
import { getNotes, saveNotes, getSettings, saveSettings, getApiKey } from './lib/storage'
import { APP_VERSION } from './lib/version'
import { handleMicrosoftRedirect, hasRedirectResponse } from './services/microsoft-auth'
import {
  REAUTH_EVENT as GOOGLE_REAUTH_EVENT,
  SIGNED_IN_MESSAGE as GOOGLE_SIGNED_IN_MESSAGE,
  MIGRATION_MESSAGE as GOOGLE_MIGRATION_MESSAGE,
  bootstrapGoogleAuth,
  ensureBackgroundRefresh,
  stopBackgroundRefresh,
  signIn as googleSignIn
} from './services/google-auth'
import useEmbeddings from './hooks/useEmbeddings'

/**
 * v2.5.1 — drain the Microsoft sign-in redirect before the app paints.
 *
 * Microsoft sends the user back to the app origin with the authorization code
 * in the URL fragment. MSAL only turns that into tokens when
 * handleRedirectPromise() runs, so the SYSTEM tab would otherwise paint
 * "disconnected" for a beat and then flip.
 *
 * The gate is only closed when the URL actually looks like a redirect
 * response: an ordinary cold start must not wait on a ~200 kB lazy chunk, so
 * it renders immediately and lets the drain finish in the background.
 */
function useMicrosoftRedirectBootstrap() {
  const [state, setState] = useState(() => ({
    ready: !hasRedirectResponse(),
    handled: false,
    signedIn: false,
    email: '',
    returnTo: null
  }))

  useEffect(() => {
    let cancelled = false
    console.log('[NeuroNote:MSAuth] App boot — redirect response in URL:', hasRedirectResponse())

    handleMicrosoftRedirect()
      .then(result => {
        if (cancelled) return
        setState({ ready: true, ...result })
        if (result.handled) {
          // Drop the auth fragment so a reload is not mistaken for a
          // second redirect return.
          const clean = window.location.pathname + window.location.search
          window.history.replaceState(null, '', clean)
          console.log('[NeuroNote:MSAuth] Auth fragment cleared from the URL')
        }
      })
      .catch(err => {
        console.error('[NeuroNote:MSAuth] App boot redirect handling failed:', err)
        if (!cancelled) setState(prev => ({ ...prev, ready: true }))
      })

    return () => { cancelled = true }
  }, [])

  return state
}

/** Shown only on the return leg of a Microsoft redirect, for a few hundred ms. */
function AuthReturnSplash() {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center gap-3 noise-bg"
      style={{ background: 'radial-gradient(ellipse at center, #f5f0e8 0%, #ede5d5 100%)' }}>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-mono font-bold shadow-sm"
        style={{ background: 'linear-gradient(135deg, #dc2626, #991b1b)' }}>
        N
      </div>
      <p className="font-mono uppercase text-[10px] tracking-[0.2em] text-muted">
        Finishing Microsoft sign-in...
      </p>
    </div>
  )
}

/**
 * v2.3 — the provider stack.
 *
 * <ToastProvider> is outermost so the recorder can raise toasts; <AppShell>
 * holds the notes so it can hand RecordingProvider a save callback; and
 * <RecordingProvider> wraps the tab switcher, which is the whole point — the
 * recorder outlives every tab below it.
 */
export default function App() {
  const msRedirect = useMicrosoftRedirectBootstrap()

  return (
    <ToastProvider>
      {msRedirect.ready ? <AppShell msRedirect={msRedirect} /> : <AuthReturnSplash />}
    </ToastProvider>
  )
}

function AppShell({ msRedirect }) {
  // Landing back from Microsoft reopens the tab the user signed in from.
  const [activeTab, setActiveTab] = useState(() => msRedirect?.returnTo || 'archive')
  const [notes, setNotes] = useState([])
  const [currentNote, setCurrentNote] = useState(null)
  const [selectedNote, setSelectedNote] = useState(null)
  const [settings, setSettings] = useState({})
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const { indexNewNote } = useEmbeddings()
  const toast = useToast()
  // The toast context value is rebuilt on every toast, so the redirect notice
  // needs its own once-only latch.
  const redirectAnnounced = useRef(false)

  useEffect(() => {
    setNotes(getNotes())
    setSettings(getSettings())
  }, [])

  // Confirm the round-trip, since the toast raised before the redirect died
  // with the old document.
  useEffect(() => {
    if (!msRedirect?.handled || redirectAnnounced.current) return
    redirectAnnounced.current = true
    if (msRedirect.signedIn) {
      toast.show({
        message: `Connected to Microsoft 365${msRedirect.email ? ` as ${msRedirect.email}` : ''}.`,
        type: 'success',
        duration: 6000
      })
    } else {
      toast.show({
        message: 'Microsoft sign-in did not complete. Try again from the SYSTEM tab.',
        type: 'error',
        duration: 8000
      })
    }
  }, [msRedirect, toast])

  // v2.6 — Google keeps itself signed in now. Boot the token machinery once,
  // top up an access token that is about to expire, and arm the ~55 minute
  // background refresh. Any moment the user genuinely has to act on (an old
  // v2.5.1 token, a revoked grant, localStorage wiped by iOS) arrives as a
  // small non-blocking toast with a Sign In button rather than a broken tab.
  const googleBootstrapped = useRef(false)
  // The toast context value is rebuilt on every toast, so it is read through a
  // ref — this effect must run exactly once per mount.
  const toastRef = useRef(toast)
  useEffect(() => { toastRef.current = toast }, [toast])

  useEffect(() => {
    const promptSignIn = (message) => {
      toastRef.current.show({
        message,
        type: 'info',
        duration: 12000,
        actionLabel: 'Sign In',
        onAction: () => {
          googleSignIn()
            .then(() => toastRef.current.show({ message: GOOGLE_SIGNED_IN_MESSAGE, type: 'success', duration: 7000 }))
            .catch(err => {
              console.error('[NeuroNote:GoogleAuth] Sign-in from toast failed:', err)
              toastRef.current.show({ message: `Google sign-in failed: ${err.message}`, type: 'error', duration: 9000 })
            })
        }
      })
    }

    // A remount (StrictMode does one in development) tore the timer down in
    // the cleanup below; put it back without redoing the whole bootstrap.
    ensureBackgroundRefresh()

    if (!googleBootstrapped.current) {
      googleBootstrapped.current = true
      bootstrapGoogleAuth()
        .then(result => {
          if (result.migrated) {
            promptSignIn(GOOGLE_MIGRATION_MESSAGE)
          } else if (result.needsSignIn) {
            promptSignIn('Please sign in to Google again.')
          } else if (result.missingClientId) {
            toastRef.current.show({
              message: 'Your browser cleared the Google settings. Re-enter the OAuth Client ID in the SYSTEM tab.',
              type: 'error',
              duration: 12000,
              actionLabel: 'Open System',
              onAction: () => setActiveTab('system')
            })
          }
        })
        .catch(err => console.error('[NeuroNote:GoogleAuth] Bootstrap failed:', err))
    }

    const onReauth = (e) => promptSignIn(e.detail?.message || 'Please reconnect to Google')
    window.addEventListener(GOOGLE_REAUTH_EVENT, onReauth)
    return () => {
      window.removeEventListener(GOOGLE_REAUTH_EVENT, onReauth)
      stopBackgroundRefresh()
    }
  }, [])

  useEffect(() => {
    const online = () => setIsOnline(true)
    const offline = () => setIsOnline(false)
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offline) }
  }, [])

  const handleSaveNote = useCallback((note) => {
    setNotes(prev => {
      const updated = [note, ...prev]
      saveNotes(updated)
      return updated
    })
    setCurrentNote(note)
    setActiveTab('session')
    if (getApiKey('openai')) {
      indexNewNote(note).catch(console.error)
    }
  }, [indexNewNote])

  const handleUpdateNote = useCallback((updatedNote) => {
    setNotes(prev => {
      const updated = prev.map(n => n.id === updatedNote.id ? updatedNote : n)
      saveNotes(updated)
      return updated
    })
    if (currentNote?.id === updatedNote.id) setCurrentNote(updatedNote)
    if (selectedNote?.id === updatedNote.id) setSelectedNote(updatedNote)
  }, [currentNote, selectedNote])

  const handleDeleteNote = useCallback((noteId) => {
    setNotes(prev => {
      const updated = prev.filter(n => n.id !== noteId)
      saveNotes(updated)
      return updated
    })
    if (currentNote?.id === noteId) setCurrentNote(null)
    if (selectedNote?.id === noteId) setSelectedNote(null)
  }, [currentNote, selectedNote])

  const handleSelectNote = useCallback((note) => {
    setSelectedNote(note)
  }, [])

  const handleUpdateSettings = useCallback((newSettings) => {
    setSettings(newSettings)
    saveSettings(newSettings)
  }, [])

  return (
    <RecordingProvider
      settings={settings}
      onSaveNote={handleSaveNote}
      onNavigate={setActiveTab}
    >
      <AppFrame
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        notes={notes}
        currentNote={currentNote}
        selectedNote={selectedNote}
        settings={settings}
        isOnline={isOnline}
        onSaveNote={handleSaveNote}
        onUpdateNote={handleUpdateNote}
        onDeleteNote={handleDeleteNote}
        onSelectNote={handleSelectNote}
        onCloseNote={() => setSelectedNote(null)}
        onUpdateSettings={handleUpdateSettings}
      />
    </RecordingProvider>
  )
}

function AppFrame({
  activeTab, setActiveTab, notes, currentNote, selectedNote, settings, isOnline,
  onSaveNote, onUpdateNote, onDeleteNote, onSelectNote, onCloseNote, onUpdateSettings
}) {
  // The header badge and the page glow now follow the global recorder rather
  // than a local flag, so they stay correct on every tab.
  const { isRecording } = useRecordingContext()

  const getStatus = () => {
    if (isRecording) return 'recording'
    if (!isOnline) return 'offline'
    return 'online'
  }

  return (
    <div className={`min-h-dvh relative noise-bg ${isRecording ? 'recording-pulse' : ''}`}
      style={{ background: 'radial-gradient(ellipse at center, #f5f0e8 0%, #ede5d5 100%)' }}>

      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-30 glass-nav">
        <div className="flex items-center justify-between px-4 py-2 max-w-4xl mx-auto"
          style={{ paddingTop: 'max(8px, env(safe-area-inset-top))' }}>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-mono font-bold text-sm shadow-sm"
              style={{ background: 'linear-gradient(135deg, #dc2626, #991b1b)' }}>
              N
            </div>
          </div>
          <div className="text-center">
            <h1 className="font-mono uppercase text-xs font-bold tracking-[0.2em] leading-none">NeuroNote</h1>
            <p className="font-mono uppercase text-[8px] text-muted tracking-[0.15em]">Meeting OS v{APP_VERSION}</p>
          </div>
          <StatusBadge status={getStatus()} />
        </div>
      </header>

      {/* v2.3 — recording follows the user across every tab. */}
      <RecordingBanner />

      {/* Content */}
      <main className="pt-16 pb-20 max-w-4xl mx-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'archive' && (
              <Archive notes={notes} onSelectNote={onSelectNote} onDeleteNote={onDeleteNote} />
            )}
            {activeTab === 'capture' && (
              <Capture onSaveNote={onSaveNote} settings={settings} />
            )}
            {activeTab === 'session' && (
              <Session note={currentNote} onUpdateNote={onUpdateNote} />
            )}
            {activeTab === 'system' && (
              <System settings={settings} onUpdateSettings={onUpdateSettings} />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Note Detail Overlay */}
      <AnimatePresence>
        {selectedNote && (
          <NoteDetail
            note={selectedNote}
            onBack={onCloseNote}
            onUpdateNote={onUpdateNote}
          />
        )}
      </AnimatePresence>

      {/* Bottom Nav */}
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Root-level dialogs: crash recovery, and the shared confirm prompt. */}
      <RecoveryPrompt />
      <ConfirmDialog />
    </div>
  )
}
