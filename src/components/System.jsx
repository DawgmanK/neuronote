import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import Toggle from './ui/Toggle'
import CorrectionPopup from './CorrectionPopup'
import { getApiKey, saveApiKey, clearApiKey, getMonthlyUsage, getRecentDailyUsage, clearUsage } from '../lib/storage'
import {
  getAIProvider, saveAIProvider, getGeminiApiKey, saveGeminiApiKey, clearGeminiApiKey,
  getAIStatus, clearAIStatus
} from '../lib/ai-provider'
import { getProviderDisplayName, MODEL_DISPLAY, MODEL_TERRA, MODEL_LUNA, MODEL_SOL, GEMINI_MODEL_FLASH } from '../lib/models'
import { testOpenAIKey, testGeminiKey, testAssemblyKey } from '../lib/key-test'
import { useRecordingContext } from '../contexts/RecordingContext'
import { APP_VERSION } from '../lib/version'
import { saveClientId, clearClientId, saveClientSecret, SIGNED_IN_MESSAGE, setDriveWanted, hasDriveScope } from '../services/google-auth'
import { saveDocumentToHandoffFolder, getCachedFolder, HANDOFF_FOLDER_NAME } from '../services/google-drive'
import { isValidEmail } from '../lib/grok-handoff'
import {
  saveClientId as saveMicrosoftClientId,
  saveTenantId as saveMicrosoftTenantId,
  clearClientId as clearMicrosoftCredentials,
  getTenantId as getMicrosoftTenantId,
  DEFAULT_TENANT_ID
} from '../services/microsoft-auth'
import { loadCorrections, removeCorrection, clearCorrections } from '../lib/corrections'
import useIntegration from '../hooks/useIntegration'
import { PROVIDERS, PROVIDER_LABELS } from '../lib/integration-provider'
import { useToast } from './ui/Toast'

// v2.7 — AI provider selector (OpenAI vs Gemini), same segmented-control
// pattern as the Calendar & Tasks provider selector below.
const AI_PROVIDERS = ['openai', 'gemini']
const AI_PROVIDER_LABELS = { openai: 'OpenAI', gemini: 'Gemini' }

// v2.5 — one line of copy per provider choice, shown under the selector.
const PROVIDER_HINTS = {
  google: 'Action items go to Google Calendar and Google Tasks.',
  microsoft: 'Action items go to Outlook Calendar and Microsoft To Do.',
  both: 'Connect both, then pick a destination on each action item.',
  none: 'Off. Action items stay inside NeuroNote. Pick a service to send them out.'
}

const EYE_PATHS = {
  open: <><circle cx="10" cy="10" r="3"/><path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z"/></>,
  closed: <><path d="M2 2l16 16M5.5 5.5A7.5 7.5 0 002 10s3 6 8 6c1.5 0 2.9-.4 4-1M10 7a3 3 0 013 3"/></>
}

// What a Google OAuth Client ID, a Google client secret and an Azure
// application ID look like. The Client ID is searched for inside whatever was
// pasted, so "Client ID: 123-abc.apps.googleusercontent.com" still works.
// A complete ID is the project number, a dash, a run of letters and digits, and
// the Google suffix. The middle run is required when the dash is there: a
// paste such as "1234-.apps.googleusercontent.com" has lost it and is not an ID.
const GOOGLE_CLIENT_ID_IN_TEXT = /\d+(?:-[a-z0-9_]{8,})?\.apps\.googleusercontent\.com/i
const GOOGLE_CLIENT_SECRET_PATTERN = /^GOCSPX-/i

/** Whitespace, zero-width characters and wrapping quotes, all removed. */
function cleanPaste(value) {
  return (value || '')
    .replace(/[\s\u200B-\u200D\u2060\uFEFF]+/g, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
}
const AZURE_CLIENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SECTIONS = [
  { id: 'ai', label: 'AI' },
  { id: 'transcription', label: 'Transcripts' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'about', label: 'About' }
]

/** Remembered for the tab's lifetime, so a Microsoft sign-in redirect lands
 *  back on the section it started from. */
const SECTION_KEY = 'neuronote:settings-section'

const TONE_COLOR = { ok: '#2dff9a', bad: '#ff2d55', warn: '#ff2d55', idle: '#6c727d', checking: '#2aa8ff' }
const TONE_TEXT = { ok: 'text-ok', bad: 'text-rec', warn: 'text-rec', idle: 'text-muted', checking: 'text-accent' }

/** One status sentence with its coloured light. */
function StatusRow({ tone = 'idle', children }) {
  return (
    <p className="flex items-start gap-2 text-[13px] leading-snug" role="status">
      <span
        className={`w-2 h-2 rounded-full mt-[5px] flex-shrink-0 ${tone === 'checking' ? 'dot-pulse-fast' : ''}`}
        style={{ background: TONE_COLOR[tone], boxShadow: tone === 'idle' ? 'none' : `0 0 8px ${TONE_COLOR[tone]}` }}
      />
      <span className={TONE_TEXT[tone]}>{children}</span>
    </p>
  )
}

/**
 * v2.7.2 — turns (hasKey, lastKnownStatus) into the line that describes how
 * the provider's most recent real request went. v2.8 says it in plain words
 * rather than "LOCAL FALLBACK" / "ERROR // 400".
 */
function apiStatusInfo(hasKey, status) {
  if (!hasKey) return { tone: 'idle', label: 'No key saved' }
  if (!status) return { tone: 'idle', label: 'Key saved — not used yet' }
  if (status.ok) return { tone: 'ok', label: 'Working' }
  if (status.fallback) return { tone: 'warn', label: `Last request failed (${status.reason}), so the on-device summary was used` }
  return { tone: 'bad', label: `Last request failed: ${status.reason}` }
}

/** The result of a "test key" check, or nothing if none has run. */
function KeyCheck({ check }) {
  if (!check) return null
  if (check.state === 'checking') return <StatusRow tone="checking">Checking the key…</StatusRow>
  return <StatusRow tone={!check.ok ? 'bad' : check.warning ? 'warn' : 'ok'}>{check.message}</StatusRow>
}

function Segmented({ options, value, onChange, label }) {
  return (
    <div className="flex gap-1 p-1 rounded-full bg-white/[0.05] border border-white/10" role="tablist" aria-label={label}>
      {options.map(option => (
        <button
          key={option.id}
          role="tab"
          aria-selected={value === option.id}
          onClick={() => onChange(option.id)}
          className="tap-target -my-2 flex-1 flex items-center"
        >
          <span
            className={`block w-full px-1 py-1.5 rounded-full font-mono text-[13px] font-medium text-center whitespace-nowrap transition-all ${
              value === option.id ? 'bg-white/[0.12] text-ink chrome-ring' : 'text-muted hover:text-ink'
            }`}
          >
            {option.label}
          </span>
        </button>
      ))}
    </div>
  )
}

/** A labelled secret field with a show/hide eye. */
function SecretField({ id, label, hint, value, onChange, placeholder, shown, onToggleShown, savedValue }) {
  return (
    <div className="mb-3">
      <label className="block text-[13px] font-medium text-ink mb-1.5" htmlFor={id}>
        {label}{hint && <span className="text-muted font-normal"> {hint}</span>}
      </label>
      <div className="relative">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className="glass-input w-full px-4 py-3 text-sm pr-11 outline-none"
        />
        <button
          type="button"
          onClick={onToggleShown}
          className="tap-target absolute right-0.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center text-muted hover:text-ink"
          aria-label={shown ? `Hide ${label}` : `Show ${label}`}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            {shown ? EYE_PATHS.open : EYE_PATHS.closed}
          </svg>
        </button>
      </div>
      {/* Only passed for client IDs, which are identifiers rather than
          secrets: seeing what is saved is how a wrong paste gets noticed. */}
      {savedValue && (
        <p className="text-xs text-muted mt-1.5 break-all">Saved: <span className="text-ink/80">{savedValue}</span></p>
      )}
    </div>
  )
}

function PrimaryButton({ children, className = '', ...props }) {
  return (
    <motion.button
      className={`btn-primary tap-target inline-flex items-center justify-center px-4 rounded-xl font-mono text-[13px] font-semibold disabled:opacity-35 disabled:shadow-none ${className}`}
      whileTap={{ scale: 0.96 }}
      {...props}
    >
      {children}
    </motion.button>
  )
}

function GhostButton({ children, danger = false, className = '', ...props }) {
  return (
    <motion.button
      className={`tap-target inline-flex items-center justify-center px-4 rounded-xl font-mono text-[13px] font-medium disabled:opacity-35 ${
        danger ? 'text-muted hover:text-rec border border-white/10 hover:border-rec/40 transition-colors' : 'btn-ghost'
      } ${className}`}
      whileTap={{ scale: 0.96 }}
      {...props}
    >
      {children}
    </motion.button>
  )
}

/** A switch with its label and one line of explanation. */
function ToggleRow({ title, description, enabled, onChange, disabled, disabledReason }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted leading-snug mt-0.5">{disabled && disabledReason ? disabledReason : description}</p>
      </div>
      <Toggle enabled={!!enabled} onChange={onChange} disabled={disabled} label={title} />
    </div>
  )
}

/** Connected / not-connected line, one per service. */
function StatusLine({ label, connected }) {
  return (
    <StatusRow tone={connected ? 'ok' : 'idle'}>
      {label} — {connected ? 'connected' : 'not connected'}
    </StatusRow>
  )
}

/** Setup instructions, folded away until someone needs them. */
function HowTo({ title, children }) {
  return (
    <details className="group mt-3">
      <summary className="tap-target -my-2 inline-flex items-center gap-1.5 text-xs font-medium text-accent cursor-pointer list-none">
        <svg className="transition-transform group-open:rotate-90" width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 5l5 5-5 5"/></svg>
        {title}
      </summary>
      <div className="text-xs text-muted leading-relaxed mt-2 space-y-2">{children}</div>
    </details>
  )
}

export default function System({ settings, onUpdateSettings }) {
  const [openaiKey, setOpenaiKey] = useState('')
  const [assemblyKey, setAssemblyKey] = useState('')
  const [showOpenai, setShowOpenai] = useState(false)
  const [showAssembly, setShowAssembly] = useState(false)
  const [hasOpenai, setHasOpenai] = useState(false)
  const [hasAssembly, setHasAssembly] = useState(false)
  // v2.7 — AI provider selection (OpenAI vs Gemini) and the Gemini key.
  const [aiProvider, setAiProvider] = useState(() => getAIProvider())
  const [geminiKey, setGeminiKey] = useState('')
  const [showGemini, setShowGemini] = useState(false)
  const [hasGemini, setHasGemini] = useState(false)
  // v2.7.2 — last-known outcome of an actual AI call per provider, so API
  // STATUS can tell OK apart from "key present but every call 400s".
  const [openaiStatus, setOpenaiStatus] = useState(null)
  const [geminiStatus, setGeminiStatus] = useState(null)
  const [monthlyUsage, setMonthlyUsage] = useState(0)
  const [dailyUsage, setDailyUsage] = useState([])
  const [googleClientId, setGoogleClientId] = useState('')
  // Client IDs are identifiers, not secrets, so their fields start visible:
  // a wrong paste should be seen before Save, not hidden behind dots.
  const [showClientId, setShowClientId] = useState(true)
  // v2.6 — only needed when Google's token endpoint rejects the PKCE exchange
  // for this OAuth client type. Left empty for public clients.
  const [googleClientSecret, setGoogleClientSecret] = useState('')
  const [showClientSecret, setShowClientSecret] = useState(false)
  const [msClientId, setMsClientId] = useState('')
  const [showMsClientId, setShowMsClientId] = useState(true)
  // Seeded from storage so the field is filled on the very first paint.
  const [msTenantId, setMsTenantId] = useState(() => getMicrosoftTenantId())
  const [corrections, setCorrections] = useState([])
  const [addingCorrection, setAddingCorrection] = useState(false)
  const { provider, setProvider, google, microsoft, showGoogle, showMicrosoft } = useIntegration()
  const toast = useToast()
  const { ask } = useRecordingContext()

  // v2.8 — SETTINGS is four short sections instead of one long scroll.
  const [section, setSection] = useState(() => {
    try {
      const saved = sessionStorage.getItem(SECTION_KEY)
      return SECTIONS.some(s => s.id === saved) ? saved : 'ai'
    } catch { return 'ai' }
  })
  const changeSection = (next) => {
    setSection(next)
    try { sessionStorage.setItem(SECTION_KEY, next) } catch { /* private mode */ }
  }

  // v2.8 — the outcome of the last "test key" run per service:
  // { state: 'checking' } while it runs, then the result from key-test.js.
  const [keyCheck, setKeyCheck] = useState({})
  const runKeyCheck = async (service, tester, key) => {
    setKeyCheck(prev => ({ ...prev, [service]: { state: 'checking' } }))
    const result = await tester(key)
    setKeyCheck(prev => ({ ...prev, [service]: { state: 'done', ...result } }))
    return result
  }
  const forgetKeyCheck = (service) => setKeyCheck(prev => ({ ...prev, [service]: undefined }))

  // v2.5 — keep the field in step when the saved tenant changes (save/clear).
  useEffect(() => { setMsTenantId(microsoft.tenantId || DEFAULT_TENANT_ID) }, [microsoft.tenantId])

  useEffect(() => {
    setHasOpenai(!!getApiKey('openai'))
    setHasAssembly(!!getApiKey('assemblyai'))
    setHasGemini(!!getGeminiApiKey())
    setOpenaiStatus(getAIStatus('openai'))
    setGeminiStatus(getAIStatus('gemini'))
    setMonthlyUsage(getMonthlyUsage())
    setDailyUsage(getRecentDailyUsage())
    setCorrections(loadCorrections())
  }, [])

  // v2.7 — the key that actually gates AI features right now: whichever
  // provider is selected, not always OpenAI.
  const hasCurrentProviderKey = aiProvider === 'gemini' ? hasGemini : hasOpenai

  // v2.7.2 — computed once per render so every STATUS line (per-provider and
  // the main card) agrees on the same OK/ERROR/LOCAL FALLBACK/NOT CONFIGURED read.
  const openaiStatusInfo = apiStatusInfo(hasOpenai, openaiStatus)
  const geminiStatusInfo = apiStatusInfo(hasGemini, geminiStatus)
  const currentStatusInfo = aiProvider === 'gemini' ? geminiStatusInfo : openaiStatusInfo

  const handleAIProviderChange = (next) => {
    if (next === aiProvider) return
    setAiProvider(next)
    saveAIProvider(next)
    toast.show({ message: `AI provider set to ${AI_PROVIDER_LABELS[next]}.`, type: 'info' })
  }

  const deleteCorrection = (wrong) => {
    setCorrections(removeCorrection(wrong))
    toast.show({ message: `Forgot the correction for "${wrong}".`, type: 'info' })
  }

  const clearAllCorrections = async () => {
    if (corrections.length === 0) return
    const choice = await ask({
      title: 'Remove every correction?',
      message: `NeuroNote will forget all ${corrections.length} of the words it has learned to fix. This can't be undone.`,
      options: [
        { label: 'Keep them', value: 'keep', primary: true },
        { label: 'Remove all', value: 'remove', tone: 'danger' }
      ],
      dismissValue: 'keep'
    })
    if (choice !== 'remove') return
    setCorrections(clearCorrections())
    toast.show({ message: 'All learned corrections deleted.', type: 'info' })
  }

  const handleManualCorrectionSaved = (wrong, right) => {
    setAddingCorrection(false)
    setCorrections(loadCorrections())
    toast.show({ message: `Learned "${wrong}" → "${right}".`, type: 'success' })
  }

  const handleProviderChange = (next) => {
    if (next === provider) return
    setProvider(next)
    toast.show({ message: `Calendar & tasks provider set to ${PROVIDER_LABELS[next]}.`, type: 'info' })
  }

  const saveGoogleCredentials = () => {
    // v2.8.6 — be forgiving about what was pasted. cleanPaste() drops
    // whitespace, invisible characters and wrapping quotes, all of which ride
    // along when a value is copied on a phone from a web page or a message.
    let id = cleanPaste(googleClientId)
    let secret = cleanPaste(googleClientSecret)
    if (!id && !secret) return

    // The two values are easy to put in each other's fields, above all on a
    // phone. Sort them out instead of refusing: a Client ID is found wherever
    // it sits in the paste, and a client secret pasted into the Client ID
    // field is saved as the secret.
    let movedSecret = false
    if (id) {
      const found = id.match(GOOGLE_CLIENT_ID_IN_TEXT)
      if (found) {
        id = found[0]
      } else if (GOOGLE_CLIENT_SECRET_PATTERN.test(id) && !secret) {
        secret = id
        id = ''
        movedSecret = true
      } else if (/googleusercontent\.com/i.test(id)) {
        // The right kind of value, but incomplete: the part between the dash
        // and ".apps.googleusercontent.com" did not come along with the copy.
        toast.show({
          message: 'That Client ID is cut off: the letters and digits between the dash and ".apps.googleusercontent.com" are missing. In Google Cloud Console, use the copy button next to Client ID so the whole value comes across.',
          type: 'error',
          duration: 12000
        })
        return
      } else {
        // v2.8.5 — anything else used to be saved as-is and only failed
        // later, on Google's own page, as "Error 401: invalid_client".
        toast.show({
          message: 'That isn\'t a Google Client ID. The Client ID is the long value ending in ".apps.googleusercontent.com", from Google Cloud Console → Credentials → your OAuth client.',
          type: 'error',
          duration: 10000
        })
        return
      }
    }
    // The same mix-up the other way round.
    if (secret && GOOGLE_CLIENT_ID_IN_TEXT.test(secret) && !id) {
      id = secret.match(GOOGLE_CLIENT_ID_IN_TEXT)[0]
      secret = ''
    }

    // Saving a new Client ID invalidates the stored tokens, so do it first.
    if (id) saveClientId(id)
    if (secret) saveClientSecret(secret)
    setGoogleClientId('')
    setGoogleClientSecret('')
    google.refresh()

    const haveId = !!(id || google.clientId)
    const haveSecret = !!(secret || google.hasClientSecret)
    if (movedSecret) {
      toast.show({
        message: haveId
          ? 'That was the client secret, so it is saved as the secret. Sign in to connect.'
          : 'That was the client secret (it starts with GOCSPX-), so it is saved as the secret. Now paste the Client ID: the long value ending in ".apps.googleusercontent.com".',
        type: 'info',
        duration: 12000
      })
      return
    }
    toast.show({
      message: haveId && haveSecret
        ? 'Google credentials saved. Sign in to connect.'
        : haveId
          ? 'Google Client ID saved. Add the client secret too, then sign in.'
          : 'Client secret saved. Now paste the Client ID: the long value ending in ".apps.googleusercontent.com".',
      type: 'success',
      duration: 8000
    })
  }

  const clearGoogleCredentials = async () => {
    // clearClientId() removes the client secret as well and signs out. That
    // used to happen without a word, so re-pasting only the Client ID left a
    // sign-in that opened Google and then failed.
    const choice = await ask({
      title: 'Remove Google credentials?',
      message: 'This removes the Client ID and the client secret, and signs you out of Google. You will need to paste both again to reconnect.',
      options: [
        { label: 'Keep them', value: 'keep', primary: true },
        { label: 'Remove both', value: 'remove', tone: 'danger' }
      ],
      dismissValue: 'keep'
    })
    if (choice !== 'remove') return
    clearClientId()
    setGoogleClientId('')
    setGoogleClientSecret('')
    google.refresh()
    toast.show({ message: 'Google Client ID and client secret removed.', type: 'info' })
  }

  const handleGoogleSignIn = async () => {
    try {
      await google.signIn()
      toast.show({ message: SIGNED_IN_MESSAGE, type: 'success', duration: 7000 })
    } catch (err) {
      console.error('[NeuroNote:GoogleAuth] Sign-in from SYSTEM tab failed:', err)
      toast.show({ message: `Google sign-in failed: ${err.message}`, type: 'error', duration: 9000 })
    }
  }

  // --- Grok handoff folder (v2.9) -----------------------------------------
  const [handoffFolder, setHandoffFolder] = useState(() => getCachedFolder())
  const [sendingTest, setSendingTest] = useState(false)
  const [handoffEmailDraft, setHandoffEmailDraft] = useState('')

  // The address lives in settings, in this browser only. It is never written
  // into the code: the repository is public.
  const saveHandoffEmail = () => {
    const address = handoffEmailDraft.trim()
    if (!address) return
    if (!isValidEmail(address)) {
      toast.show({ message: 'That doesn\'t look like an email address. Check it and try again.', type: 'error', duration: 7000 })
      return
    }
    onUpdateSettings({ ...settings, handoffEmail: address })
    setHandoffEmailDraft('')
    toast.show({ message: `Call reports can now be emailed to ${address}.`, type: 'success', duration: 6000 })
  }

  const removeHandoffEmail = () => {
    const next = { ...settings }
    delete next.handoffEmail
    onUpdateSettings(next)
    toast.show({ message: 'Email address removed.', type: 'info' })
  }

  const toggleGrokHandoff = (on) => {
    // Turning it on is what makes the next Google sign-in ask for Drive.
    if (on) setDriveWanted(true)
    onUpdateSettings({ ...settings, grokHandoff: on })
  }

  // Nothing is awaited before google.signIn(): the consent popup has to open
  // inside the tap, or the browser blocks it.
  const handleAllowDrive = async () => {
    setDriveWanted(true)
    try {
      await google.signIn()
      if (hasDriveScope()) {
        toast.show({ message: 'Google Drive is connected. Sales calls can now go to your Grok folder.', type: 'success', duration: 7000 })
      } else {
        toast.show({
          message: 'Signed in, but Google Drive access was not granted. Try again and leave the Google Drive box ticked on Google\'s screen.',
          type: 'error',
          duration: 10000
        })
      }
    } catch (err) {
      console.error('[NeuroNote:Handoff] Drive consent failed:', err)
      toast.show({ message: `Google sign-in failed: ${err.message}`, type: 'error', duration: 9000 })
    }
  }

  const sendTestDocument = async () => {
    if (sendingTest) return
    setSendingTest(true)
    try {
      const now = new Date()
      const result = await saveDocumentToHandoffFolder({
        name: `Test from NeuroNote — ${now.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`,
        html: '<html><body><h1>Test from NeuroNote</h1><p>If your assistant can read this, the handoff folder is working. '
          + 'Sales call reports recorded on the Sales call tab will be saved here as documents like this one.</p>'
          + `<p><b>Created:</b> ${now.toISOString()}</p></body></html>`
      })
      setHandoffFolder(getCachedFolder())
      if (result.success) {
        toast.show({ message: 'Test document saved to your Grok folder.', type: 'success', duration: 7000, link: result.link, linkLabel: 'Open' })
      } else {
        toast.show({ message: result.error, type: 'error', duration: 14000 })
      }
    } finally {
      setSendingTest(false)
    }
  }

  const handleGoogleSignOut = () => {
    google.signOut()
    toast.show({ message: 'Signed out of Google.', type: 'info' })
  }

  // --- Microsoft 365 (v2.5) ------------------------------------------------
  const saveMicrosoftIds = () => {
    const tenant = msTenantId.trim() || DEFAULT_TENANT_ID
    const typedId = cleanPaste(msClientId)
    if (!typedId && !microsoft.clientId) return
    if (typedId && !AZURE_CLIENT_ID_PATTERN.test(typedId)) {
      toast.show({
        message: 'That doesn\'t look like an Azure Client ID. It is the "Application (client) ID" from your app registration: 32 letters and digits in five groups, like 00000000-0000-0000-0000-000000000000.',
        type: 'error',
        duration: 10000
      })
      return
    }
    if (typedId) saveMicrosoftClientId(typedId)
    saveMicrosoftTenantId(tenant)
    setMsClientId('')
    microsoft.refresh()
    toast.show({ message: 'Microsoft credentials saved. Sign in to connect.', type: 'success' })
  }

  const clearMicrosoftIds = () => {
    clearMicrosoftCredentials()
    setMsClientId('')
    setMsTenantId(DEFAULT_TENANT_ID)
    microsoft.refresh()
    toast.show({ message: 'Microsoft Client ID cleared.', type: 'info' })
  }

  // v2.5.1 — this navigates the whole page to Microsoft, so the await below
  // only settles when the redirect could not be started. The success toast is
  // raised by App on the way back in.
  const handleMicrosoftSignIn = async () => {
    try {
      toast.show({ message: 'Redirecting to Microsoft sign-in...', type: 'info', duration: 4000 })
      await microsoft.signIn({ returnTo: 'system' })
    } catch (err) {
      console.error('[NeuroNote:MSAuth] Sign-in from SYSTEM tab failed:', err)
      toast.show({ message: `Microsoft sign-in failed: ${err.message}`, type: 'error', duration: 8000 })
    }
  }

  const handleMicrosoftSignOut = async () => {
    await microsoft.signOut()
    toast.show({ message: 'Signed out of Microsoft.', type: 'info' })
  }

  // v2.8 — "Save and test": store the key, then make one free read-only call
  // to confirm the vendor accepts it. With the field empty the same button
  // re-tests the key that is already saved.
  const saveOpenaiKey = () => {
    const typed = openaiKey.trim()
    if (typed) {
      saveApiKey('openai', typed)
      setHasOpenai(true)
      setOpenaiKey('')
      // v2.7.2 — a new key deserves a clean slate, not yesterday's ERROR.
      clearAIStatus('openai')
      setOpenaiStatus(null)
    }
    const key = typed || getApiKey('openai')
    if (key) runKeyCheck('openai', testOpenAIKey, key)
  }

  const clearOpenaiKey = () => {
    clearApiKey('openai')
    setHasOpenai(false)
    clearAIStatus('openai')
    setOpenaiStatus(null)
    forgetKeyCheck('openai')
  }

  const saveGeminiKey = () => {
    const typed = geminiKey.trim()
    if (typed) {
      saveGeminiApiKey(typed)
      setHasGemini(true)
      setGeminiKey('')
      clearAIStatus('gemini')
      setGeminiStatus(null)
    }
    const key = typed || getGeminiApiKey()
    if (key) runKeyCheck('gemini', testGeminiKey, key)
  }

  const clearGeminiKey = () => {
    clearGeminiApiKey()
    setHasGemini(false)
    clearAIStatus('gemini')
    setGeminiStatus(null)
    forgetKeyCheck('gemini')
  }

  const saveAssemblyKey = async () => {
    const typed = assemblyKey.trim()
    if (typed) {
      saveApiKey('assemblyai', typed)
      setHasAssembly(true)
      setAssemblyKey('')
    }
    const key = typed || getApiKey('assemblyai')
    if (!key) return
    const result = await runKeyCheck('assemblyai', testAssemblyKey, key)
    // v2.8 — a freshly saved key that works is switched on straight away.
    // It used to sit unused until a separate toggle was found and flipped.
    if (typed && result.ok && !settings?.useAssemblyAI) {
      onUpdateSettings({ ...settings, useAssemblyAI: true })
    }
  }

  const clearAssemblyKey = () => {
    clearApiKey('assemblyai')
    setHasAssembly(false)
    forgetKeyCheck('assemblyai')
    onUpdateSettings({ ...settings, useAssemblyAI: false })
  }

  const maxDaily = Math.max(...dailyUsage.map(d => d.total), 0.01)
  const activeModelName = getProviderDisplayName(aiProvider, settings)

  return (
    <div className="px-4 pb-4">
      <h1 className="chrome-text font-mono font-bold text-[28px] leading-tight tracking-tight mb-4">Settings</h1>

      <div className="mb-5">
        <Segmented options={SECTIONS} value={section} onChange={changeSection} label="Settings sections" />
      </div>

      <div className="space-y-4">
        {/* ------------------------------------------------------------ AI */}
        {section === 'ai' && (
          <>
            <GlassCard hoverable={false}>
              <h2 className="section-label mb-1">AI provider</h2>
              <p className="text-xs text-muted leading-relaxed mb-3">
                Writes your summaries, action items and study cards, and answers questions about your meetings.
              </p>
              <div className="mb-4">
                <Segmented
                  options={AI_PROVIDERS.map(p => ({ id: p, label: AI_PROVIDER_LABELS[p] }))}
                  value={aiProvider}
                  onChange={handleAIProviderChange}
                  label="AI provider"
                />
              </div>

              {aiProvider === 'openai' && (
                <div>
                  <SecretField
                    id="openai-key"
                    label="OpenAI API key"
                    value={openaiKey}
                    onChange={setOpenaiKey}
                    placeholder={hasOpenai ? 'Saved — paste a new key to replace it' : 'sk-…'}
                    shown={showOpenai}
                    onToggleShown={() => setShowOpenai(!showOpenai)}
                  />
                  <div className="flex flex-wrap gap-2 mb-3">
                    <PrimaryButton onClick={saveOpenaiKey} disabled={!openaiKey.trim() && !hasOpenai}>
                      {openaiKey.trim() || !hasOpenai ? 'Save and test' : 'Test key'}
                    </PrimaryButton>
                    {hasOpenai && <GhostButton danger onClick={clearOpenaiKey}>Remove key</GhostButton>}
                  </div>
                  <div className="space-y-1.5">
                    <KeyCheck check={keyCheck.openai} />
                    {!keyCheck.openai && <StatusRow tone={openaiStatusInfo.tone}>{openaiStatusInfo.label}</StatusRow>}
                  </div>
                  <p className="text-xs text-muted leading-relaxed mt-3">
                    Uses {MODEL_DISPLAY[MODEL_TERRA]} for summaries and {MODEL_DISPLAY[MODEL_LUNA]} for quick jobs. Pay-as-you-go, billed by OpenAI to your own account.
                  </p>
                </div>
              )}

              {aiProvider === 'gemini' && (
                <div>
                  <SecretField
                    id="gemini-key"
                    label="Gemini API key"
                    value={geminiKey}
                    onChange={setGeminiKey}
                    placeholder={hasGemini ? 'Saved — paste a new key to replace it' : 'AIza…'}
                    shown={showGemini}
                    onToggleShown={() => setShowGemini(!showGemini)}
                  />
                  <div className="flex flex-wrap gap-2 mb-3">
                    <PrimaryButton onClick={saveGeminiKey} disabled={!geminiKey.trim() && !hasGemini}>
                      {geminiKey.trim() || !hasGemini ? 'Save and test' : 'Test key'}
                    </PrimaryButton>
                    {hasGemini && <GhostButton danger onClick={clearGeminiKey}>Remove key</GhostButton>}
                  </div>
                  <div className="space-y-1.5">
                    <KeyCheck check={keyCheck.gemini} />
                    {!keyCheck.gemini && <StatusRow tone={geminiStatusInfo.tone}>{geminiStatusInfo.label}</StatusRow>}
                  </div>
                  <p className="text-xs text-muted leading-relaxed mt-3">
                    Uses {MODEL_DISPLAY[GEMINI_MODEL_FLASH]}, which Google offers on its free tier. No credit card needed.
                  </p>
                  <HowTo title="How to get a free Gemini key">
                    <ol className="list-decimal pl-4 space-y-0.5">
                      <li>
                        Open{' '}
                        <a href="https://aistudio.google.com" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">aistudio.google.com</a>{' '}
                        and sign in with your Google account.
                      </li>
                      <li>Choose “Get API key”.</li>
                      <li>Create a key and paste it above.</li>
                    </ol>
                  </HowTo>
                </div>
              )}
            </GlassCard>

            <GlassCard hoverable={false}>
              <h2 className="section-label mb-3">Extras</h2>
              <div className="space-y-4">
                <ToggleRow
                  title="Catch action items while recording"
                  description="Spots commitments as they are said. Adds a small AI cost per minute of recording."
                  enabled={settings?.liveActionItems}
                  onChange={v => onUpdateSettings({ ...settings, liveActionItems: v })}
                  disabled={!hasCurrentProviderKey}
                  disabledReason="Add an AI key above to turn this on."
                />
                <div className="border-t border-white/10" />
                <ToggleRow
                  title={`Best-quality summaries (${MODEL_DISPLAY[MODEL_SOL]})`}
                  description="For high-stakes meetings. About twice the AI cost per summary. Turns itself off when you close the app."
                  enabled={settings?.flagshipMode}
                  onChange={v => onUpdateSettings({ ...settings, flagshipMode: v })}
                  disabled={!hasOpenai || aiProvider !== 'openai'}
                  disabledReason={aiProvider !== 'openai' ? 'Available with OpenAI as the provider.' : 'Add an OpenAI key above to turn this on.'}
                />
              </div>
            </GlassCard>

            {!hasCurrentProviderKey && (
              <p className="text-xs text-muted leading-relaxed px-1">
                No key yet? NeuroNote still records and transcribes with your browser&apos;s built-in speech recognition, and
                builds a basic summary on this device. A key swaps both for much better results.
              </p>
            )}
          </>
        )}

        {/* -------------------------------------------------- TRANSCRIPTION */}
        {section === 'transcription' && (
          <>
            <GlassCard hoverable={false}>
              <h2 className="section-label mb-1">Transcription</h2>
              <p className="text-xs text-muted leading-relaxed mb-3">
                AssemblyAI turns your recordings into accurate text, copes with background noise, and can label who said what.
              </p>
              <SecretField
                id="assembly-key"
                label="AssemblyAI API key"
                value={assemblyKey}
                onChange={setAssemblyKey}
                placeholder={hasAssembly ? 'Saved — paste a new key to replace it' : 'Paste your AssemblyAI key'}
                shown={showAssembly}
                onToggleShown={() => setShowAssembly(!showAssembly)}
              />
              <div className="flex flex-wrap gap-2 mb-3">
                <PrimaryButton onClick={saveAssemblyKey} disabled={!assemblyKey.trim() && !hasAssembly}>
                  {assemblyKey.trim() || !hasAssembly ? 'Save and test' : 'Test key'}
                </PrimaryButton>
                {hasAssembly && <GhostButton danger onClick={clearAssemblyKey}>Remove key</GhostButton>}
              </div>
              <div className="mb-4">
                <KeyCheck check={keyCheck.assemblyai} />
                {!keyCheck.assemblyai && (
                  <StatusRow tone={hasAssembly && settings?.useAssemblyAI ? 'ok' : 'idle'}>
                    {!hasAssembly ? 'No key saved' : settings?.useAssemblyAI ? 'In use for every recording' : 'Key saved, but switched off below'}
                  </StatusRow>
                )}
              </div>
              <div className="border-t border-white/10 pt-4">
                <ToggleRow
                  title="Use AssemblyAI for transcripts"
                  description="Off falls back to your browser's built-in speech recognition."
                  enabled={settings?.useAssemblyAI}
                  onChange={v => onUpdateSettings({ ...settings, useAssemblyAI: v })}
                  disabled={!hasAssembly}
                  disabledReason="Add a key above to turn this on."
                />
              </div>
              <HowTo title="How to get an AssemblyAI key">
                <p>
                  Create an account at{' '}
                  <a href="https://www.assemblyai.com" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">assemblyai.com</a>,
                  open the dashboard, and copy the API key shown there. New accounts start with free credit.
                </p>
              </HowTo>
            </GlassCard>

            {/* LEARNED CORRECTIONS (v2.2) */}
            <GlassCard hoverable={false}>
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <h2 className="section-label">Words to always fix</h2>
                <span className="pill">{corrections.length}</span>
              </div>
              <p className="text-xs text-muted leading-relaxed mb-3">
                Names and terms NeuroNote keeps getting wrong. Press and hold any word in a transcript to teach it one.
              </p>

              {corrections.length === 0 ? (
                <p className="text-sm text-muted mb-3">Nothing here yet.</p>
              ) : (
                <ul className="max-h-56 overflow-y-auto space-y-2.5 mb-3 pr-1">
                  {corrections.map((c) => (
                    <li key={c.wrong} className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm break-words">
                          <span className="line-through text-muted">{c.wrong}</span>
                          <span className="text-muted mx-1.5">&rarr;</span>
                          <span className="font-semibold text-ok">{c.right}</span>
                        </p>
                        <p className="text-xs text-muted">
                          Used {c.useCount} time{c.useCount === 1 ? '' : 's'}
                        </p>
                      </div>
                      <button
                        onClick={() => deleteCorrection(c.wrong)}
                        className="tap-target -m-3 text-muted hover:text-rec flex-shrink-0 flex items-center justify-center transition-colors"
                        aria-label={`Delete correction ${c.wrong}`}
                      >
                        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M5 5l10 10M15 5 5 15"/></svg>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap gap-2">
                <PrimaryButton onClick={() => setAddingCorrection(true)}>Add a word</PrimaryButton>
                {corrections.length > 0 && <GhostButton danger onClick={clearAllCorrections}>Remove all</GhostButton>}
              </div>
            </GlassCard>
          </>
        )}

        {/* ------------------------------------------------------ CALENDAR */}
        {section === 'calendar' && (
          <>
          <GlassCard hoverable={false}>
            <h2 className="section-label mb-1">Calendar and tasks</h2>
            <p className="text-xs text-muted leading-relaxed mb-3">
              Send action items straight from a meeting to your calendar or task list.
            </p>
            <div className="mb-2">
              <Segmented
                options={PROVIDERS.map(p => ({ id: p, label: PROVIDER_LABELS[p] }))}
                value={provider}
                onChange={handleProviderChange}
                label="Calendar and tasks service"
              />
            </div>
            <p className="text-xs text-muted leading-relaxed mb-4">{PROVIDER_HINTS[provider]}</p>

            {showGoogle && (
              <div className="border-t border-white/10 pt-4">
                <h3 className="font-mono font-semibold text-[15px] mb-3">Google</h3>

                {/* v2.6 — iOS Safari can evict a PWA's localStorage wholesale. If the
                    Client ID went with it, say so loudly: nothing else here works
                    until it is back. */}
                {!google.clientId && (
                  <div className="rounded-xl border border-accent/40 bg-accent/[0.07] px-3 py-2.5 mb-3">
                    <p className="text-[13px] font-semibold text-accent mb-0.5">Google Client ID needed</p>
                    <p className="text-xs text-muted leading-relaxed">
                      Paste your OAuth Client ID below to connect Calendar and Tasks. If it was here before, your
                      browser cleared it — your notes are untouched.
                    </p>
                  </div>
                )}

                <SecretField
                  id="google-client-id"
                  label="OAuth Client ID"
                  value={googleClientId}
                  onChange={setGoogleClientId}
                  placeholder={google.clientId ? 'Saved — paste a new one to replace it' : '123456789-abc.apps.googleusercontent.com'}
                  shown={showClientId}
                  onToggleShown={() => setShowClientId(!showClientId)}
                  savedValue={google.clientId}
                />
                <SecretField
                  id="google-client-secret"
                  label="Client secret"
                  hint="(Google asks for it with most clients)"
                  value={googleClientSecret}
                  onChange={setGoogleClientSecret}
                  placeholder={google.hasClientSecret ? 'Saved — paste a new one to replace it' : 'GOCSPX-…'}
                  shown={showClientSecret}
                  onToggleShown={() => setShowClientSecret(!showClientSecret)}
                />

                <div className="flex flex-wrap gap-2 mb-4">
                  <GhostButton onClick={saveGoogleCredentials} disabled={!googleClientId.trim() && !googleClientSecret.trim()}>Save</GhostButton>
                  {google.clientId && <GhostButton danger onClick={clearGoogleCredentials}>Remove</GhostButton>}
                </div>

                {/* v2.8.6 — without the secret the Google window opens and
                    closes normally and the sign-in then fails. Warn before
                    that, not after. */}
                {google.clientId && !google.hasClientSecret && !google.signedIn && (
                  <div className="rounded-xl border border-rec/40 bg-rec/[0.07] px-3 py-2.5 mb-4">
                    <p className="text-[13px] font-semibold text-rec mb-0.5">No client secret saved</p>
                    <p className="text-xs text-muted leading-relaxed">
                      Google asks for the client secret with a &quot;Web application&quot; OAuth client. Without it,
                      sign-in fails just after the Google window closes. Copy it from Google Cloud Console &rarr;
                      Credentials &rarr; your OAuth client, paste it above, and press Save.
                    </p>
                  </div>
                )}

                {google.signedIn ? (
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{google.email || 'Google account connected'}</p>
                      {google.autoRefresh ? (
                        <p className="text-xs text-ok mt-0.5">Stays signed in automatically</p>
                      ) : (
                        <p className="text-xs text-rec mt-0.5">
                          Expires in an hour — sign in again to stay connected
                        </p>
                      )}
                    </div>
                    <GhostButton onClick={handleGoogleSignOut} className="whitespace-nowrap">Sign out</GhostButton>
                  </div>
                ) : (
                  <PrimaryButton onClick={handleGoogleSignIn} disabled={!google.clientId || google.signingIn} className="mb-3">
                    {google.signingIn ? 'Connecting…' : 'Sign in with Google'}
                  </PrimaryButton>
                )}

                <div className="space-y-1.5">
                  <StatusLine label="Google Calendar" connected={google.signedIn} />
                  <StatusLine label="Google Tasks" connected={google.signedIn} />
                </div>

                <HowTo title="How to get a Google Client ID">
                  <p>
                    In Google Cloud Console, go to APIs &amp; Services &rarr; Credentials. Create an OAuth 2.0 Client ID of
                    type &quot;Web application&quot; and add this app&apos;s address to the authorized JavaScript origins. The
                    consent screen needs the calendar.events, tasks, userinfo.email and openid scopes.
                  </p>
                  <p>
                    Copy the client secret from the same page too: Google asks for it with a &quot;Web application&quot;
                    client. If a sign-in completes without staying connected, remove NeuroNote at{' '}
                    <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer"
                      className="text-accent hover:underline">myaccount.google.com/permissions</a>{' '}
                    and sign in once more — Google only grants long-lived access on a fresh consent.
                  </p>
                </HowTo>
              </div>
            )}

            {showMicrosoft && (
              <div className={`border-t border-white/10 pt-4 ${showGoogle ? 'mt-5' : ''}`}>
                <h3 className="font-mono font-semibold text-[15px] mb-3">Microsoft 365</h3>

                <SecretField
                  id="ms-client-id"
                  label="Azure Client ID"
                  value={msClientId}
                  onChange={setMsClientId}
                  placeholder={microsoft.clientId ? 'Saved — paste a new one to replace it' : '00000000-0000-0000-0000-000000000000'}
                  shown={showMsClientId}
                  onToggleShown={() => setShowMsClientId(!showMsClientId)}
                  savedValue={microsoft.clientId}
                />

                <label className="block text-[13px] font-medium text-ink mb-1.5" htmlFor="ms-tenant-id">
                  Tenant ID
                </label>
                <input
                  id="ms-tenant-id"
                  type="text"
                  value={msTenantId}
                  onChange={e => setMsTenantId(e.target.value)}
                  placeholder={DEFAULT_TENANT_ID}
                  autoComplete="off"
                  spellCheck={false}
                  className="glass-input w-full px-4 py-3 text-sm outline-none mb-3"
                />

                <div className="flex flex-wrap gap-2 mb-4">
                  <GhostButton onClick={saveMicrosoftIds} disabled={!msClientId.trim() && !microsoft.clientId}>Save</GhostButton>
                  {microsoft.clientId && <GhostButton danger onClick={clearMicrosoftIds}>Remove</GhostButton>}
                </div>

                {microsoft.signedIn ? (
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{microsoft.email || 'Microsoft account connected'}</p>
                      <p className="text-xs text-muted mt-0.5">Outlook events and To Do tasks go here</p>
                    </div>
                    <GhostButton onClick={handleMicrosoftSignOut} className="whitespace-nowrap">Sign out</GhostButton>
                  </div>
                ) : (
                  <PrimaryButton onClick={handleMicrosoftSignIn} disabled={!microsoft.clientId || microsoft.signingIn} className="mb-3">
                    {microsoft.signingIn ? 'Connecting…' : 'Sign in with Microsoft'}
                  </PrimaryButton>
                )}

                <div className="space-y-1.5">
                  <StatusLine label="Outlook Calendar" connected={microsoft.signedIn} />
                  <StatusLine label="Microsoft To Do" connected={microsoft.signedIn} />
                </div>

                <HowTo title="How to get an Azure Client ID">
                  <p>
                    In the Azure portal, go to Microsoft Entra ID &rarr; App registrations and register a Single-page
                    application. Add this app&apos;s address as the redirect URI, then paste the Application (client) ID above.
                    Leave the Tenant ID as &quot;{DEFAULT_TENANT_ID}&quot; unless your organization requires a specific
                    directory. No client secret is needed.
                  </p>
                </HowTo>
              </div>
            )}
          </GlassCard>

          {/* GROK HANDOFF (v2.9) */}
          <GlassCard hoverable={false}>
            <h2 className="section-label mb-1">Grok handoff</h2>
            <p className="text-xs text-muted leading-relaxed mb-4">
              Saves each sales call report as a Google Doc in a Drive folder named &quot;{HANDOFF_FOLDER_NAME}&quot;.
              Grok, or any assistant connected to your Google Drive, can read it from there. NeuroNote can only
              see the files it puts in that folder, never the rest of your Drive.
            </p>

            <ToggleRow
              title="Send sales calls to the folder"
              description="Applies to anything recorded on the Sales call tab. Other notes have a Send to Grok button."
              enabled={settings?.grokHandoff}
              onChange={toggleGrokHandoff}
            />

            {settings?.grokHandoff && (
              <div className="border-t border-white/10 mt-4 pt-4 space-y-3">
                {!google.clientId || !google.signedIn ? (
                  <StatusRow tone="warn">
                    This uses your Google sign-in. Choose Google (or Both) above, save your Client ID and secret, and sign in first.
                  </StatusRow>
                ) : !google.hasDrive ? (
                  <>
                    <StatusRow tone="warn">
                      You are signed in to Google, but NeuroNote has not been given permission to save to Google Drive yet.
                    </StatusRow>
                    <PrimaryButton onClick={handleAllowDrive} disabled={google.signingIn}>
                      {google.signingIn ? 'Connecting…' : 'Allow Google Drive'}
                    </PrimaryButton>
                  </>
                ) : (
                  <>
                    <StatusRow tone="ok">Google Drive is connected{google.email ? ` as ${google.email}` : ''}.</StatusRow>
                    <div className="flex flex-wrap items-center gap-2">
                      <GhostButton onClick={sendTestDocument} disabled={sendingTest}>
                        {sendingTest ? 'Sending…' : 'Send a test document'}
                      </GhostButton>
                      {handoffFolder?.link && (
                        <a href={handoffFolder.link} target="_blank" rel="noopener noreferrer"
                          className="tap-target inline-flex items-center px-2 text-[13px] font-medium text-accent hover:underline">
                          Open the folder ↗
                        </a>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* v2.9 — the no-setup route: a mail draft instead of a Drive upload. */}
            <div className="border-t border-white/10 mt-4 pt-4">
              <label className="block text-[13px] font-medium text-ink mb-1.5" htmlFor="handoff-email">
                Or email call reports to
              </label>
              <div className="flex gap-2">
                <input
                  id="handoff-email"
                  type="email"
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  value={handoffEmailDraft}
                  onChange={e => setHandoffEmailDraft(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveHandoffEmail()}
                  placeholder={settings?.handoffEmail ? 'Type a new address to replace it' : 'name@example.com'}
                  className="glass-input flex-1 min-w-0 px-4 py-3 text-sm outline-none"
                />
                <GhostButton onClick={saveHandoffEmail} disabled={!handoffEmailDraft.trim()}>Save</GhostButton>
              </div>
              {settings?.handoffEmail && (
                <p className="text-xs text-muted mt-1.5 break-all">
                  Saved: <span className="text-ink/80">{settings.handoffEmail}</span>{' '}
                  <button onClick={removeHandoffEmail} className="text-muted hover:text-rec underline underline-offset-2 transition-colors">
                    Remove
                  </button>
                </p>
              )}
              <p className="text-xs text-muted leading-relaxed mt-2">
                NeuroNote can&apos;t send email by itself. Each note gets an &quot;Email to Grok&quot; button that opens
                your mail app with the report filled in, and you press Send. It needs no Google setup.
              </p>
            </div>

            <HowTo title="How to set up the Drive folder">
              <ol className="list-decimal pl-4 space-y-1">
                <li>
                  In Google Cloud Console, in the same project as your sign-in client, open APIs &amp; Services &rarr;
                  Library, find &quot;Google Drive API&quot; and press Enable.
                </li>
                <li>Switch this on, press &quot;Allow Google Drive&quot;, and approve it on Google&apos;s screen.</li>
                <li>Press &quot;Send a test document&quot; and check it appears in the folder.</li>
                <li>
                  In Grok, connect Google Drive, then ask it (or schedule it) to check the
                  &quot;{HANDOFF_FOLDER_NAME}&quot; folder and log each new document.
                </li>
              </ol>
            </HowTo>
          </GlassCard>
          </>
        )}

        {/* --------------------------------------------------------- ABOUT */}
        {section === 'about' && (
          <>
            <GlassCard hoverable={false}>
              <h2 className="section-label mb-3">Right now</h2>
              <dl className="space-y-2.5 text-sm">
                {[
                  ['AI provider', AI_PROVIDER_LABELS[aiProvider]],
                  ['Model', activeModelName],
                  ['Transcription', hasAssembly && settings?.useAssemblyAI ? 'AssemblyAI' : 'Browser speech recognition'],
                  ['Calendar and tasks', PROVIDER_LABELS[provider]],
                  ['Version', APP_VERSION]
                ].map(([term, value]) => (
                  <div key={term} className="flex items-baseline justify-between gap-4">
                    <dt className="text-muted">{term}</dt>
                    <dd className="font-medium text-right">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="border-t border-white/10 mt-3 pt-3">
                <StatusRow tone={currentStatusInfo.tone}>AI: {currentStatusInfo.label}</StatusRow>
              </div>
            </GlassCard>

            {/* USAGE */}
            <GlassCard hoverable={false}>
              <h2 className="section-label mb-2">Estimated spend this month</h2>
              <p className="chrome-text font-mono text-4xl font-bold tracking-tight">${monthlyUsage.toFixed(2)}</p>

              <div className="flex items-end gap-1.5 h-14 mt-4 mb-1">
                {dailyUsage.map((d, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 h-full">
                    <div
                      className="w-full rounded-t"
                      style={{
                        height: `${Math.max(2, (d.total / maxDaily) * 36)}px`,
                        background: d.total > 0 ? 'var(--grad-accent)' : 'rgba(255,255,255,0.12)'
                      }}
                    />
                    <span className="text-[11px] text-muted">{d.date}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted leading-relaxed mt-3">
                An estimate from the requests this browser has made. Your OpenAI and AssemblyAI dashboards have the real bill.
              </p>
              <button
                onClick={() => { clearUsage(); setMonthlyUsage(0); setDailyUsage(getRecentDailyUsage()) }}
                className="tap-target -mb-2 inline-flex items-center text-xs font-medium text-muted hover:text-ink transition-colors"
              >
                Reset this estimate
              </button>
            </GlassCard>

            <GlassCard hoverable={false}>
              <h2 className="section-label mb-2">Your data</h2>
              <p className="text-sm text-muted leading-relaxed">
                Keys, recordings and notes are stored in this browser on this device. Audio and text are sent only to the
                AI and transcription services whose keys you add here.
              </p>
            </GlassCard>
          </>
        )}
      </div>

      {addingCorrection && (
        <CorrectionPopup
          manual
          onSave={handleManualCorrectionSaved}
          onCancel={() => setAddingCorrection(false)}
        />
      )}
    </div>
  )
}
