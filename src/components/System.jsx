import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import Toggle from './ui/Toggle'
import CorrectionPopup from './CorrectionPopup'
import { getApiKey, saveApiKey, clearApiKey, getMonthlyUsage, getRecentDailyUsage, clearUsage } from '../lib/storage'
import { getDisplayName } from '../lib/models'
import { APP_VERSION } from '../lib/version'
import { saveClientId, clearClientId, saveClientSecret, SIGNED_IN_MESSAGE } from '../services/google-auth'
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

// v2.5 — one line of copy per provider choice, shown under the selector.
const PROVIDER_HINTS = {
  google: 'Action items go to Google Calendar and Google Tasks.',
  microsoft: 'Action items go to Outlook Calendar and Microsoft To Do.',
  both: 'Connect both, then pick a destination on each action item.',
  none: 'Action items stay in NeuroNote — no calendar or task buttons are shown.'
}

const EYE_PATHS = {
  open: <><circle cx="10" cy="10" r="3"/><path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z"/></>,
  closed: <><path d="M2 2l16 16M5.5 5.5A7.5 7.5 0 002 10s3 6 8 6c1.5 0 2.9-.4 4-1M10 7a3 3 0 013 3"/></>
}

/** The "--------- GOOGLE ---------" rule between provider sub-sections. */
function SectionDivider({ label }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="h-px flex-1 bg-red/20" />
      <span className="font-mono uppercase text-[10px] font-bold tracking-widest text-muted">{label}</span>
      <span className="h-px flex-1 bg-red/20" />
    </div>
  )
}

/** Connected / not-connected line with the pulsing dot, one per service. */
function StatusLine({ label, connected }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 dot-pulse' : 'bg-red dot-pulse-fast'}`} />
      <span className="font-mono text-xs tracking-wider">
        {label} // {connected ? (
          <span className="text-green-600 font-bold">CONNECTED ✓</span>
        ) : (
          <span className="text-red font-bold">NOT CONNECTED</span>
        )}
      </span>
    </div>
  )
}

export default function System({ settings, onUpdateSettings }) {
  const [openaiKey, setOpenaiKey] = useState('')
  const [assemblyKey, setAssemblyKey] = useState('')
  const [showOpenai, setShowOpenai] = useState(false)
  const [showAssembly, setShowAssembly] = useState(false)
  const [hasOpenai, setHasOpenai] = useState(false)
  const [hasAssembly, setHasAssembly] = useState(false)
  const [monthlyUsage, setMonthlyUsage] = useState(0)
  const [dailyUsage, setDailyUsage] = useState([])
  const [googleClientId, setGoogleClientId] = useState('')
  const [showClientId, setShowClientId] = useState(false)
  // v2.6 — only needed when Google's token endpoint rejects the PKCE exchange
  // for this OAuth client type. Left empty for public clients.
  const [googleClientSecret, setGoogleClientSecret] = useState('')
  const [showClientSecret, setShowClientSecret] = useState(false)
  const [msClientId, setMsClientId] = useState('')
  const [showMsClientId, setShowMsClientId] = useState(false)
  // Seeded from storage so the field is filled on the very first paint.
  const [msTenantId, setMsTenantId] = useState(() => getMicrosoftTenantId())
  const [corrections, setCorrections] = useState([])
  const [addingCorrection, setAddingCorrection] = useState(false)
  const { provider, setProvider, google, microsoft, showGoogle, showMicrosoft } = useIntegration()
  const toast = useToast()

  // v2.5 — keep the field in step when the saved tenant changes (save/clear).
  useEffect(() => { setMsTenantId(microsoft.tenantId || DEFAULT_TENANT_ID) }, [microsoft.tenantId])

  useEffect(() => {
    setHasOpenai(!!getApiKey('openai'))
    setHasAssembly(!!getApiKey('assemblyai'))
    setMonthlyUsage(getMonthlyUsage())
    setDailyUsage(getRecentDailyUsage())
    setCorrections(loadCorrections())
  }, [])

  const deleteCorrection = (wrong) => {
    setCorrections(removeCorrection(wrong))
    toast.show({ message: `Forgot the correction for "${wrong}".`, type: 'info' })
  }

  const clearAllCorrections = () => {
    if (corrections.length === 0) return
    if (!window.confirm(`Delete all ${corrections.length} learned corrections?`)) return
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
    const id = googleClientId.trim()
    const secret = googleClientSecret.trim()
    if (!id && !secret) return
    // Saving a new Client ID invalidates the stored tokens, so do it first.
    if (id) saveClientId(id)
    if (secret) saveClientSecret(secret)
    setGoogleClientId('')
    setGoogleClientSecret('')
    google.refresh()
    toast.show({
      message: id ? 'Google Client ID saved. Sign in to connect.' : 'Google client secret saved. Sign in to connect.',
      type: 'success'
    })
  }

  const clearGoogleCredentials = () => {
    clearClientId()
    setGoogleClientId('')
    setGoogleClientSecret('')
    google.refresh()
    toast.show({ message: 'Google Client ID cleared.', type: 'info' })
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

  const handleGoogleSignOut = () => {
    google.signOut()
    toast.show({ message: 'Signed out of Google.', type: 'info' })
  }

  // --- Microsoft 365 (v2.5) ------------------------------------------------
  const saveMicrosoftIds = () => {
    const tenant = msTenantId.trim() || DEFAULT_TENANT_ID
    if (!msClientId.trim() && !microsoft.clientId) return
    if (msClientId.trim()) saveMicrosoftClientId(msClientId.trim())
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

  const saveOpenaiKey = () => {
    if (openaiKey.trim()) {
      saveApiKey('openai', openaiKey.trim())
      setHasOpenai(true)
      setOpenaiKey('')
    }
  }

  const clearOpenaiKey = () => {
    clearApiKey('openai')
    setHasOpenai(false)
  }

  const saveAssemblyKey = () => {
    if (assemblyKey.trim()) {
      saveApiKey('assemblyai', assemblyKey.trim())
      setHasAssembly(true)
      setAssemblyKey('')
    }
  }

  const clearAssemblyKey = () => {
    clearApiKey('assemblyai')
    setHasAssembly(false)
    onUpdateSettings({ ...settings, useAssemblyAI: false })
  }

  const maxDaily = Math.max(...dailyUsage.map(d => d.total), 0.01)

  return (
    <div className="px-4 pb-4 space-y-4">
      <h1 className="font-mono uppercase text-lg font-bold tracking-wider typewriter-shadow">System</h1>

      {/* AI ENGINE */}
      <GlassCard hoverable={false}>
        <h3 className="font-mono uppercase text-xs font-bold tracking-wider text-muted mb-3">AI Engine</h3>
        <div className="relative mb-3">
          <input
            type={showOpenai ? 'text' : 'password'}
            value={openaiKey}
            onChange={e => setOpenaiKey(e.target.value)}
            placeholder={hasOpenai ? '••••••••••••••' : 'sk-...'}
            className="glass-input w-full px-4 py-3 font-mono text-sm pr-10 outline-none"
          />
          <button
            onClick={() => setShowOpenai(!showOpenai)}
            className="tap-target absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center text-muted hover:text-ink"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
              {showOpenai ? (
                <><circle cx="10" cy="10" r="3"/><path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z"/></>
              ) : (
                <><path d="M2 2l16 16M5.5 5.5A7.5 7.5 0 002 10s3 6 8 6c1.5 0 2.9-.4 4-1M10 7a3 3 0 013 3"/></>
              )}
            </svg>
          </button>
        </div>
        <div className="flex gap-2 mb-3">
          <motion.button
            onClick={saveOpenaiKey}
            className="tap-target inline-flex items-center justify-center px-4 py-2 rounded-xl text-white font-mono uppercase text-[10px] tracking-wider"
            style={{ background: 'linear-gradient(to right, #dc2626, #991b1b)' }}
            whileTap={{ scale: 0.95 }}
          >
            Save Key
          </motion.button>
          <motion.button
            onClick={clearOpenaiKey}
            className="tap-target inline-flex items-center justify-center px-4 py-2 rounded-xl border border-red/30 text-red font-mono uppercase text-[10px] tracking-wider"
            whileTap={{ scale: 0.95 }}
          >
            Clear
          </motion.button>
        </div>
        <p className="text-[11px] text-muted leading-relaxed">
          Without a key, transcription uses your device&apos;s free Web Speech API and summary/cards/quiz use a local extractive engine. With a key, the app upgrades to AssemblyAI + GPT-4o.
        </p>
      </GlassCard>

      {/* TRANSCRIPTION */}
      <GlassCard hoverable={false}>
        <h3 className="font-mono uppercase text-xs font-bold tracking-wider text-muted mb-3">Transcription</h3>
        <div className="relative mb-3">
          <input
            type={showAssembly ? 'text' : 'password'}
            value={assemblyKey}
            onChange={e => setAssemblyKey(e.target.value)}
            placeholder={hasAssembly ? '••••••••••••••' : 'Your AssemblyAI key...'}
            className="glass-input w-full px-4 py-3 font-mono text-sm pr-10 outline-none"
          />
          <button
            onClick={() => setShowAssembly(!showAssembly)}
            className="tap-target absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center text-muted hover:text-ink"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
              {showAssembly ? (
                <><circle cx="10" cy="10" r="3"/><path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z"/></>
              ) : (
                <><path d="M2 2l16 16M5.5 5.5A7.5 7.5 0 002 10s3 6 8 6c1.5 0 2.9-.4 4-1M10 7a3 3 0 013 3"/></>
              )}
            </svg>
          </button>
        </div>
        <div className="flex gap-2 mb-4">
          <motion.button onClick={saveAssemblyKey}
            className="tap-target inline-flex items-center justify-center px-4 py-2 rounded-xl text-white font-mono uppercase text-[10px] tracking-wider"
            style={{ background: 'linear-gradient(to right, #dc2626, #991b1b)' }}
            whileTap={{ scale: 0.95 }}>
            Save Key
          </motion.button>
          <motion.button onClick={clearAssemblyKey}
            className="tap-target inline-flex items-center justify-center px-4 py-2 rounded-xl border border-red/30 text-red font-mono uppercase text-[10px] tracking-wider"
            whileTap={{ scale: 0.95 }}>
            Clear
          </motion.button>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Use AssemblyAI</p>
            <p className="text-[11px] text-muted">Speaker diarization, higher accuracy, handles noise</p>
          </div>
          <Toggle
            enabled={settings?.useAssemblyAI}
            onChange={v => onUpdateSettings({ ...settings, useAssemblyAI: v })}
            disabled={!hasAssembly}
          />
        </div>
      </GlassCard>

      {/* FLAGSHIP MODE */}
      <GlassCard hoverable={false}>
        <h3 className="font-mono uppercase text-xs font-bold tracking-wider text-muted mb-3">Flagship Mode</h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Use Flagship Model (o3) for This Session</p>
            <p className="text-[11px] text-muted">Best-in-class quality for high-stakes meetings (~$0.27/session vs $0.20)</p>
          </div>
          <Toggle
            enabled={settings?.flagshipMode}
            onChange={v => onUpdateSettings({ ...settings, flagshipMode: v })}
            disabled={!hasOpenai}
          />
        </div>
        <p className="text-[10px] text-muted italic mt-2">Session-scoped, resets when you close the app</p>
      </GlassCard>

      {/* LIVE ACTION ITEMS */}
      <GlassCard hoverable={false}>
        <h3 className="font-mono uppercase text-xs font-bold tracking-wider text-muted mb-3">Live Action Items</h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Detect Action Items While Recording</p>
            <p className="text-[11px] text-muted">Adds ~$0.02/min during recording</p>
          </div>
          <Toggle
            enabled={settings?.liveActionItems}
            onChange={v => onUpdateSettings({ ...settings, liveActionItems: v })}
            disabled={!hasOpenai}
          />
        </div>
      </GlassCard>

      {/* CALENDAR & TASKS INTEGRATION (v2.5) */}
      <GlassCard hoverable={false}>
        <h3 className="font-mono uppercase text-xs font-bold tracking-wider text-muted mb-3">Calendar &amp; Tasks Integration</h3>

        <p className="text-sm font-medium mb-2">Which service do you use?</p>
        <div className="flex gap-1 p-1 rounded-full bg-white/50 border border-red/15 mb-2">
          {PROVIDERS.map(p => (
            <button
              key={p}
              onClick={() => handleProviderChange(p)}
              aria-pressed={provider === p}
              className="tap-target -my-2 flex-1 flex items-center"
            >
              <span
                className={`block w-full px-2 py-1.5 rounded-full font-mono uppercase text-[10px] tracking-wider text-center transition-all ${
                  provider === p ? 'text-white' : 'text-muted hover:text-ink'
                }`}
                style={provider === p ? { background: 'linear-gradient(to right, #dc2626, #991b1b)' } : undefined}
              >
                {PROVIDER_LABELS[p]}
              </span>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted leading-relaxed mb-4">{PROVIDER_HINTS[provider]}</p>

        {showGoogle && (
          <div className="mb-2">
            <SectionDivider label="Google" />

            {/* v2.6 — iOS Safari can evict a PWA's localStorage wholesale. If the
                Client ID went with it, say so loudly: nothing else here works
                until it is back. */}
            {!google.clientId && (
              <div className="rounded-xl border border-red/40 bg-red/5 px-3 py-2.5 mb-3">
                <p className="font-mono uppercase text-[10px] font-bold tracking-wider text-red mb-1">
                  Google Client ID missing
                </p>
                <p className="text-[11px] text-muted leading-relaxed">
                  Paste your OAuth Client ID below to reconnect Calendar and Tasks. Browsers occasionally
                  clear a web app&apos;s storage — nothing else was lost, and your notes are untouched.
                </p>
              </div>
            )}

            <label className="font-mono uppercase text-[10px] tracking-wider text-muted block mb-1" htmlFor="google-client-id">
              OAuth Client ID
            </label>
            <div className="relative mb-3">
              <input
                id="google-client-id"
                type={showClientId ? 'text' : 'password'}
                value={googleClientId}
                onChange={e => setGoogleClientId(e.target.value)}
                placeholder={google.clientId ? '••••••••••••••' : '123456789-abc.apps.googleusercontent.com'}
                className="glass-input w-full px-4 py-3 font-mono text-sm pr-10 outline-none"
              />
              <button
                onClick={() => setShowClientId(!showClientId)}
                className="tap-target absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center text-muted hover:text-ink"
                aria-label={showClientId ? 'Hide Client ID' : 'Show Client ID'}
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                  {showClientId ? EYE_PATHS.open : EYE_PATHS.closed}
                </svg>
              </button>
            </div>

            <label className="font-mono uppercase text-[10px] tracking-wider text-muted block mb-1" htmlFor="google-client-secret">
              Client Secret <span className="normal-case tracking-normal">(only if Google asks for one)</span>
            </label>
            <div className="relative mb-3">
              <input
                id="google-client-secret"
                type={showClientSecret ? 'text' : 'password'}
                value={googleClientSecret}
                onChange={e => setGoogleClientSecret(e.target.value)}
                placeholder={google.hasClientSecret ? '••••••••••••••' : 'Leave empty unless sign-in reports it is required'}
                className="glass-input w-full px-4 py-3 font-mono text-sm pr-10 outline-none"
              />
              <button
                onClick={() => setShowClientSecret(!showClientSecret)}
                className="tap-target absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center text-muted hover:text-ink"
                aria-label={showClientSecret ? 'Hide client secret' : 'Show client secret'}
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                  {showClientSecret ? EYE_PATHS.open : EYE_PATHS.closed}
                </svg>
              </button>
            </div>

            <div className="flex gap-2 mb-4">
              <motion.button
                onClick={saveGoogleCredentials}
                className="tap-target inline-flex items-center justify-center px-4 py-2 rounded-xl text-white font-mono uppercase text-[10px] tracking-wider"
                style={{ background: 'linear-gradient(to right, #dc2626, #991b1b)' }}
                whileTap={{ scale: 0.95 }}
              >
                Save
              </motion.button>
              <motion.button
                onClick={clearGoogleCredentials}
                className="tap-target inline-flex items-center justify-center px-4 py-2 rounded-xl border border-red/30 text-red font-mono uppercase text-[10px] tracking-wider"
                whileTap={{ scale: 0.95 }}
              >
                Clear
              </motion.button>
            </div>

            {google.signedIn ? (
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{google.email || 'Google account connected'}</p>
                  <p className="text-[11px] text-muted">Calendar events and tasks will be created here</p>
                  {google.autoRefresh ? (
                    <p className="font-mono uppercase text-[10px] tracking-wider text-green-600 mt-0.5 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 dot-pulse" />
                      Auto-refreshes silently
                    </p>
                  ) : (
                    <p className="font-mono uppercase text-[10px] tracking-wider text-red mt-0.5">
                      Session expires in an hour — sign in again to enable auto-refresh
                    </p>
                  )}
                </div>
                <motion.button
                  onClick={handleGoogleSignOut}
                  className="tap-target inline-flex items-center justify-center px-4 py-2 rounded-xl border border-red/30 text-red font-mono uppercase text-[10px] tracking-wider whitespace-nowrap"
                  whileTap={{ scale: 0.95 }}
                >
                  Sign Out
                </motion.button>
              </div>
            ) : (
              <motion.button
                onClick={handleGoogleSignIn}
                disabled={!google.clientId || google.signingIn}
                className="tap-target inline-flex items-center justify-center px-4 py-2.5 rounded-xl text-white font-mono uppercase text-[10px] tracking-wider mb-3 disabled:opacity-40"
                style={{ background: 'linear-gradient(to right, #dc2626, #991b1b)' }}
                whileTap={{ scale: 0.95 }}
              >
                {google.signingIn ? 'Connecting...' : 'Sign In with Google'}
              </motion.button>
            )}

            <div className="space-y-2 mb-3">
              <StatusLine label="GOOGLE CALENDAR" connected={google.signedIn} />
              <StatusLine label="GOOGLE TASKS" connected={google.signedIn} />
            </div>

            <p className="text-[11px] text-muted leading-relaxed">
              Get your Client ID from Google Cloud Console &rarr; APIs &amp; Services &rarr; Credentials. Create an
              OAuth 2.0 Client ID of type &quot;Web application&quot; and add this app&apos;s origin to the
              authorized JavaScript origins. The consent screen needs the calendar.events, tasks,
              userinfo.email and openid scopes.
            </p>
            <p className="text-[11px] text-muted leading-relaxed mt-2">
              v2.6 signs in with the authorization code flow and PKCE, so the session renews itself instead of
              expiring every hour. Leave the client secret blank unless sign-in explicitly reports that Google
              requires one for this OAuth client. If a sign-in ever completes without enabling auto-refresh,
              revoke NeuroNote at{' '}
              <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer"
                className="text-red hover:underline">myaccount.google.com/permissions</a>{' '}
              and sign in once more — Google only issues a refresh token on a fresh consent.
            </p>
          </div>
        )}

        {showMicrosoft && (
          <div className={showGoogle ? 'mt-6' : ''}>
            <SectionDivider label="Microsoft" />

            <label className="font-mono uppercase text-[10px] tracking-wider text-muted block mb-1" htmlFor="ms-client-id">
              Azure Client ID
            </label>
            <div className="relative mb-3">
              <input
                id="ms-client-id"
                type={showMsClientId ? 'text' : 'password'}
                value={msClientId}
                onChange={e => setMsClientId(e.target.value)}
                placeholder={microsoft.clientId ? '••••••••••••••' : '00000000-0000-0000-0000-000000000000'}
                className="glass-input w-full px-4 py-3 font-mono text-sm pr-10 outline-none"
              />
              <button
                onClick={() => setShowMsClientId(!showMsClientId)}
                className="tap-target absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center text-muted hover:text-ink"
                aria-label={showMsClientId ? 'Hide Azure Client ID' : 'Show Azure Client ID'}
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                  {showMsClientId ? EYE_PATHS.open : EYE_PATHS.closed}
                </svg>
              </button>
            </div>

            <label className="font-mono uppercase text-[10px] tracking-wider text-muted block mb-1" htmlFor="ms-tenant-id">
              Tenant ID
            </label>
            <input
              id="ms-tenant-id"
              type="text"
              value={msTenantId}
              onChange={e => setMsTenantId(e.target.value)}
              placeholder={DEFAULT_TENANT_ID}
              className="glass-input w-full px-4 py-3 font-mono text-sm outline-none mb-3"
            />

            <div className="flex gap-2 mb-4">
              <motion.button
                onClick={saveMicrosoftIds}
                className="tap-target inline-flex items-center justify-center px-4 py-2 rounded-xl text-white font-mono uppercase text-[10px] tracking-wider"
                style={{ background: 'linear-gradient(to right, #dc2626, #991b1b)' }}
                whileTap={{ scale: 0.95 }}
              >
                Save
              </motion.button>
              <motion.button
                onClick={clearMicrosoftIds}
                className="tap-target inline-flex items-center justify-center px-4 py-2 rounded-xl border border-red/30 text-red font-mono uppercase text-[10px] tracking-wider"
                whileTap={{ scale: 0.95 }}
              >
                Clear
              </motion.button>
            </div>

            {microsoft.signedIn ? (
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{microsoft.email || 'Microsoft account connected'}</p>
                  <p className="text-[11px] text-muted">Outlook events and To Do tasks will be created here</p>
                </div>
                <motion.button
                  onClick={handleMicrosoftSignOut}
                  className="tap-target inline-flex items-center justify-center px-4 py-2 rounded-xl border border-red/30 text-red font-mono uppercase text-[10px] tracking-wider whitespace-nowrap"
                  whileTap={{ scale: 0.95 }}
                >
                  Sign Out
                </motion.button>
              </div>
            ) : (
              <motion.button
                onClick={handleMicrosoftSignIn}
                disabled={!microsoft.clientId || microsoft.signingIn}
                className="tap-target inline-flex items-center justify-center px-4 py-2.5 rounded-xl text-white font-mono uppercase text-[10px] tracking-wider mb-3 disabled:opacity-40"
                style={{ background: 'linear-gradient(to right, #dc2626, #991b1b)' }}
                whileTap={{ scale: 0.95 }}
              >
                {microsoft.signingIn ? 'Connecting...' : 'Sign In with Microsoft'}
              </motion.button>
            )}

            <div className="space-y-2 mb-3">
              <StatusLine label="OUTLOOK CALENDAR" connected={microsoft.signedIn} />
              <StatusLine label="MICROSOFT TO DO" connected={microsoft.signedIn} />
            </div>

            <p className="text-[11px] text-muted leading-relaxed">
              Register a Single-page application in the Azure portal &rarr; Microsoft Entra ID &rarr; App registrations,
              add this app&apos;s origin as the redirect URI, and paste the Application (client) ID above. Leave the
              Tenant ID as &quot;{DEFAULT_TENANT_ID}&quot; unless your organization requires a specific directory.
              No client secret is ever needed.
            </p>
          </div>
        )}

        {provider === 'none' && (
          <p className="text-[11px] text-muted leading-relaxed">
            Pick Google, Microsoft, or Both above to send action items straight to a calendar or task list.
          </p>
        )}
      </GlassCard>

      {/* LEARNED CORRECTIONS (v2.2) */}
      <GlassCard hoverable={false}>
        <h3 className="font-mono uppercase text-xs font-bold tracking-wider text-muted mb-1">
          Learned Corrections // <span className="text-red">{corrections.length}</span>
        </h3>
        <p className="text-[11px] text-muted leading-relaxed mb-3">
          Words NeuroNote will always correct. Long-press any word in a transcript to add more.
        </p>

        {corrections.length === 0 ? (
          <p className="text-sm text-muted italic mb-3">No corrections learned yet.</p>
        ) : (
          <ul className="max-h-56 overflow-y-auto space-y-2 mb-3 pr-1">
            {corrections.map((c) => (
              <li key={c.wrong} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm break-words">
                    <span className="line-through text-muted">{c.wrong}</span>
                    <span className="text-muted mx-1.5">&rarr;</span>
                    <span className="font-bold text-red">{c.right}</span>
                  </p>
                  <p className="text-[10px] text-muted font-mono">
                    Used: {c.useCount} time{c.useCount === 1 ? '' : 's'}
                  </p>
                </div>
                <button
                  onClick={() => deleteCorrection(c.wrong)}
                  className="tap-target -m-3 text-muted hover:text-red text-sm leading-none flex-shrink-0 flex items-center justify-center"
                  aria-label={`Delete correction ${c.wrong}`}
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2">
          <motion.button
            onClick={() => setAddingCorrection(true)}
            className="tap-target inline-flex items-center justify-center px-4 py-2 rounded-xl text-white font-mono uppercase text-[10px] tracking-wider"
            style={{ background: 'linear-gradient(to right, #dc2626, #991b1b)' }}
            whileTap={{ scale: 0.95 }}
          >
            + Add Manually
          </motion.button>
          <motion.button
            onClick={clearAllCorrections}
            disabled={corrections.length === 0}
            className="tap-target inline-flex items-center justify-center px-4 py-2 rounded-xl border border-red/30 text-red font-mono uppercase text-[10px] tracking-wider disabled:opacity-40"
            whileTap={{ scale: 0.95 }}
          >
            Clear All
          </motion.button>
        </div>
      </GlassCard>

      {addingCorrection && (
        <CorrectionPopup
          manual
          onSave={handleManualCorrectionSaved}
          onCancel={() => setAddingCorrection(false)}
        />
      )}

      {/* STATUS */}
      <GlassCard hoverable={false}>
        <h3 className="font-mono uppercase text-xs font-bold tracking-wider text-muted mb-3">Status</h3>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${hasOpenai ? 'bg-green-500 dot-pulse' : 'bg-red dot-pulse-fast'}`} />
            <span className="font-mono text-xs tracking-wider">
              API STATUS // {hasOpenai ? (
                <span className="text-green-600 font-bold">OK</span>
              ) : (
                <span className="text-red font-bold">LOCAL FALLBACK</span>
              )}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red" />
            <span className="font-mono text-xs tracking-wider">
              MODEL // <span className="text-red font-bold">{getDisplayName(settings)}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red" />
            <span className="font-mono text-xs tracking-wider">
              VERSION // <span className="text-red font-bold">v{APP_VERSION}</span>
            </span>
          </div>
        </div>
      </GlassCard>

      {/* USAGE */}
      <GlassCard hoverable={false}>
        <h3 className="font-mono uppercase text-xs font-bold tracking-wider text-muted mb-3">Usage</h3>
        <p className="text-[11px] text-muted mb-1">Estimated spend this month</p>
        <p className="font-mono text-2xl font-bold">${monthlyUsage.toFixed(2)}</p>

        <div className="flex items-end gap-1 h-12 mt-4 mb-2">
          {dailyUsage.map((d, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div
                className="w-full rounded-t"
                style={{
                  height: `${Math.max(2, (d.total / maxDaily) * 40)}px`,
                  background: 'linear-gradient(to top, #dc2626, #991b1b)',
                  opacity: d.total > 0 ? 1 : 0.2
                }}
              />
              <span className="text-[8px] text-muted font-mono">{d.date}</span>
            </div>
          ))}
        </div>

        <button
          onClick={() => { clearUsage(); setMonthlyUsage(0); setDailyUsage(getRecentDailyUsage()) }}
          className="text-[10px] text-muted hover:text-red font-mono uppercase tracking-wider mt-2"
        >
          Reset
        </button>
      </GlassCard>
    </div>
  )
}
