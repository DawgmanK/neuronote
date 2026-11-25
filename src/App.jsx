import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Home from './components/Home'
import Capture from './components/Capture'
import System from './components/System'
import NoteDetail from './components/NoteDetail'
import BottomNav from './components/BottomNav'
import RecordingBanner from './components/RecordingBanner'
import RecoveryPrompt from './components/RecoveryPrompt'
import ConfirmDialog from './components/ConfirmDialog'
import StatusBadge from './components/ui/StatusBadge'
import { ToastProvider, useToast } from './components/ui/Toast'
import { RecordingProvider, useRecordingContext } from './contexts/RecordingContext'
import { getNotes, saveNotes, getSettings, saveSettings } from './lib/storage'
import { hasActiveApiKey } from './lib/ai-provider'
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
import { sendNoteToHandoff, isSalesCall, buildMailtoLink } from './lib/grok-handoff'

/**
 * v2.5.1 — drain the Microsoft sign-in redirect before the app paints.
 *
 * Microsoft sends the user back to the app origin with the authorization code
 * in the URL fragment. MSAL only turns that into tokens when
 * handleRedirectPromise() runs, so Settings would otherwise paint
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

/** v2.8 — the chrome "N" tile: black face, chrome rim, chrome letter. */
function LogoMark({ size = 32 }) {
  return (
    <div
      className="chrome-ring rounded-xl flex items-center justify-center bg-panel-2 flex-shrink-0"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span className="chrome-text font-mono font-bold" style={{ fontSize: size * 0.5 }}>N</span>
    </div>
  )
}

/** Set for the life of a browser tab; its absence means the app was just opened. */
const SESSION_MARK = 'neuronote:session-started'

/** Tabs that existed before v2.8 and may still arrive from a saved redirect. */
function normalizeTab(tab) {
  if (tab === 'capture' || tab === 'system') return tab
  return 'archive'
}

/** Shown only on the return leg of a Microsoft redirect, for a few hundred ms. */
function AuthReturnSplash() {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center gap-3 noise-bg app-bg">
      <LogoMark size={40} />
      <p className="section-label">
        Finishing Microsoft sign-in…
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
  const [activeTab, setActiveTab] = useState(() => normalizeTab(msRedirect?.returnTo))
  const [notes, setNotes] = useState([])
  const [selectedNote, setSelectedNote] = useState(null)
  const [settings, setSettings] = useState({})
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const { indexNewNote, pruneEmbeddings } = useEmbeddings()
  const toast = useToast()
  // The toast context value is rebuilt on every toast, so the redirect notice
  // needs its own once-only latch.
  const redirectAnnounced = useRef(false)

  useEffect(() => {
    const storedNotes = getNotes()
    setNotes(storedNotes)
    pruneEmbeddings(storedNotes.map(n => n.id))

    // v2.8.3 — best-quality mode is meant to last one sitting. It was saved
    // with the other settings and nothing ever cleared it, so it quietly
    // stayed on (at about twice the AI cost) for every later meeting. A
    // sessionStorage marker tells a fresh launch from a reload or a sign-in
    // redirect, which must not reset it mid-sitting.
    let stored = getSettings()
    let freshLaunch = true
    try {
      freshLaunch = !sessionStorage.getItem(SESSION_MARK)
      sessionStorage.setItem(SESSION_MARK, '1')
    } catch { /* storage unavailable: treat as a fresh launch */ }
    if (freshLaunch && stored.flagshipMode) {
      stored = { ...stored, flagshipMode: false }
      saveSettings(stored)
    }
    setSettings(stored)
  }, [pruneEmbeddings])

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
        message: 'Microsoft sign-in did not complete. Try again from Settings.',
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
              message: 'Your browser cleared the Google settings. Re-enter the OAuth Client ID in Settings.',
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

  /**
   * v2.8 — the SESSION tab is gone. A finished recording opens straight into
   * the note it produced, over HOME, so "where did my meeting go?" always has
   * the same answer.
   */
  const handleSaveNote = useCallback((note) => {
    setNotes(prev => {
      const updated = [note, ...prev]
      saveNotes(updated)
      return updated
    })
    setActiveTab('archive')
    setSelectedNote(note)
    if (hasActiveApiKey()) {
      indexNewNote(note).catch(console.error)
    }

    // v2.9 — a sales call report goes straight to the Google Drive handoff
    // folder when that is switched on. The note is already saved and open, so
    // a failure here costs nothing: it says why, and the note keeps a
    // "Send to Grok" button.
    // The email route cannot fire by itself: a browser only opens the mail
    // app from a tap. So the finished report offers one, in a toast that
    // stays up long enough to reach for.
    const emailTo = getSettings().handoffEmail
    if (isSalesCall(note) && emailTo) {
      const mailto = buildMailtoLink(emailTo, note)
      if (mailto) {
        toastRef.current.show({
          message: 'Call report ready. Email it to Grok?',
          type: 'info',
          duration: 20000,
          actionLabel: 'Email to Grok',
          onAction: () => {
            const stamp = (n) => (n && n.id === note.id
              ? { ...n, handoffEmail: { openedAt: new Date().toISOString(), to: emailTo } }
              : n)
            setNotes(prev => {
              const updated = prev.map(stamp)
              saveNotes(updated)
              return updated
            })
            setSelectedNote(stamp)
            window.location.href = mailto
          }
        })
      }
    }

    if (isSalesCall(note) && getSettings().grokHandoff) {
      sendNoteToHandoff(note).then(result => {
        if (!result.ok) {
          toastRef.current.show({
            message: `The call report is saved here, but it didn't reach your Grok folder: ${result.error}`,
            type: 'error',
            duration: 14000,
            actionLabel: 'Open Settings',
            onAction: () => { setSelectedNote(null); setActiveTab('system') }
          })
          return
        }
        const attach = (n) => (n && n.id === note.id ? { ...n, handoff: result.handoff } : n)
        setNotes(prev => {
          const updated = prev.map(attach)
          saveNotes(updated)
          return updated
        })
        setSelectedNote(attach)
        toastRef.current.show({
          message: 'Call report saved to your Grok folder in Google Drive.',
          type: 'success',
          duration: 7000,
          link: result.handoff.link,
          linkLabel: 'Open'
        })
      }).catch(err => console.error('[NeuroNote:Handoff] Auto-send threw:', err))
    }
  }, [indexNewNote])

  const handleUpdateNote = useCallback((updatedNote) => {
    setNotes(prev => {
      const updated = prev.map(n => n.id === updatedNote.id ? updatedNote : n)
      saveNotes(updated)
      return updated
    })
    if (selectedNote?.id === updatedNote.id) setSelectedNote(updatedNote)
  }, [selectedNote])

  /**
   * v2.8 — deleting is instant but never final: the toast carries an Undo that
   * puts the note back where it was. A mis-tap on a phone used to cost a
   * meeting.
   */
  const handleDeleteNote = useCallback((noteId) => {
    const index = notes.findIndex(n => n.id === noteId)
    if (index === -1) return
    const removed = notes[index]
    const updated = notes.filter(n => n.id !== noteId)
    setNotes(updated)
    saveNotes(updated)
    if (selectedNote?.id === noteId) setSelectedNote(null)

    toastRef.current.show({
      message: `Deleted “${removed.title || 'Untitled'}”.`,
      type: 'info',
      duration: 8000,
      actionLabel: 'Undo',
      onAction: () => {
        setNotes(prev => {
          if (prev.some(n => n.id === removed.id)) return prev
          const restored = [...prev]
          restored.splice(Math.min(index, restored.length), 0, removed)
          saveNotes(restored)
          return restored
        })
      }
    })
  }, [notes, selectedNote])

  // A note whose text changed (a redone summary) is indexed again so Ask
  // searches what the note says now.
  const handleReindexNote = useCallback((note) => {
    if (hasActiveApiKey()) indexNewNote(note).catch(console.error)
  }, [indexNewNote])

  const handleSelectNote = useCallback((note) => {
    setSelectedNote(note)
  }, [])

  const handleUpdateSettings = useCallback((newSettings) => {
    setSettings(newSettings)
    saveSettings(newSettings)
  }, [])

  // The recorder still asks for tabs by their pre-v2.8 names.
  const navigate = useCallback((tab) => setActiveTab(normalizeTab(tab)), [])

  return (
    <RecordingProvider
      settings={settings}
      onSaveNote={handleSaveNote}
      onNavigate={navigate}
    >
      <AppFrame
        activeTab={activeTab}
        setActiveTab={navigate}
        notes={notes}
        selectedNote={selectedNote}
        settings={settings}
        isOnline={isOnline}
        onSaveNote={handleSaveNote}
        onUpdateNote={handleUpdateNote}
        onDeleteNote={handleDeleteNote}
        onReindexNote={handleReindexNote}
        onSelectNote={handleSelectNote}
        onCloseNote={() => setSelectedNote(null)}
        onUpdateSettings={handleUpdateSettings}
      />
    </RecordingProvider>
  )
}

function AppFrame({
  activeTab, setActiveTab, notes, selectedNote, settings, isOnline,
  onSaveNote, onUpdateNote, onDeleteNote, onReindexNote, onSelectNote, onCloseNote, onUpdateSettings
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
    <div className={`min-h-dvh relative noise-bg app-bg ${isRecording ? 'recording-pulse' : ''}`}>

      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-30 glass-nav">
        <div className="flex items-center justify-between px-4 pb-2 max-w-4xl mx-auto"
          style={{ paddingTop: 'max(10px, env(safe-area-inset-top))' }}>
          <div className="flex items-center gap-2.5">
            <LogoMark size={32} />
            <span className="chrome-text font-mono font-bold text-[17px] tracking-tight leading-none">NeuroNote</span>
          </div>
          <StatusBadge status={getStatus()} />
        </div>
      </header>

      {/* v2.3 — recording follows the user across every tab. */}
      <RecordingBanner />

      {/* Content */}
      <main className="pt-[72px] pb-32 max-w-4xl mx-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'archive' && (
              <Home
                notes={notes}
                onSelectNote={onSelectNote}
                onDeleteNote={onDeleteNote}
                onNavigate={setActiveTab}
              />
            )}
            {activeTab === 'capture' && (
              <Capture onSaveNote={onSaveNote} settings={settings} />
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
            onDeleteNote={onDeleteNote}
            onReindexNote={onReindexNote}
            onOpenSettings={() => { onCloseNote(); setActiveTab('system') }}
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
