// v2.5 — Microsoft Identity Platform sign-in via MSAL.js (@azure/msal-browser).
//
// v2.5.1 — the flow is redirect-based, not popup-based. MSAL refuses to open a
// consent popup from a context it believes is already a popup and throws
// `block_nested_popups`; a full-page navigation to login.microsoftonline.com
// sidesteps that detection entirely. The trade-off is that sign-in now spans a
// page load: signIn() navigates away and never resolves, and the tokens are
// picked up by handleRedirectPromise() on the way back in.
//
// Browser-only, no client secret and no backend: the user registers a
// single-page-application app in Entra ID (Azure AD) and pastes the Application
// (client) ID into the SYSTEM tab. Unlike Google's implicit token flow, MSAL
// caches a refresh token and renews access tokens silently, so the connection
// survives well past the one-hour access-token lifetime.
import { getItem, setItem, removeItem } from '../lib/storage.js'

const CLIENT_ID_KEY = 'microsoft:clientid' // -> "neuronote:microsoft:clientid"
const TENANT_ID_KEY = 'microsoft:tenantid' // -> "neuronote:microsoft:tenantid"
const ACCOUNT_KEY = 'microsoft:account'    // -> "neuronote:microsoft:account"
const LIST_ID_KEY = 'microsoft:default-list-id'
// Survives the round-trip to Microsoft so the user lands back on the tab they
// started the sign-in from.
const RETURN_TAB_KEY = 'microsoft:return-tab'

/** Multi-tenant: any work, school, or personal Microsoft account. */
export const DEFAULT_TENANT_ID = 'common'

// Calendars/Tasks are needed to write; User.Read resolves the address shown in
// the SYSTEM tab; offline_access is what buys the silent refresh.
export const MICROSOFT_SCOPES = [
  'Calendars.ReadWrite',
  'Tasks.ReadWrite',
  'User.Read',
  'offline_access'
]

// Reserved scopes are always granted, so silent renewals ask only for the
// resource scopes.
const SILENT_SCOPES = MICROSOFT_SCOPES.filter(s => s !== 'offline_access')

/** Fired on window whenever Microsoft sign-in state changes. */
export const MS_AUTH_EVENT = 'neuronote:microsoft:auth-changed'

let msalModule = null
let msalInstance = null
let msalKey = null
let initPromise = null
let pendingSignIn = null
// handleRedirectPromise() may only be consumed once per page load; every caller
// shares this one promise.
let redirectPromise = null

// MSAL is ~200 kB of the bundle. Google-only users never pay for it: it is
// pulled in the first time a Microsoft code path actually runs.
async function loadMsal() {
  if (!msalModule) {
    console.log('[NeuroNote:MSAuth] Loading MSAL.js...')
    msalModule = await import('@azure/msal-browser')
    console.log('[NeuroNote:MSAuth] MSAL.js loaded')
  }
  return msalModule
}

function emitChange() {
  const detail = { signedIn: isSignedIn(), email: getUserEmail() }
  console.log('[NeuroNote:MSAuth] Auth state changed:', detail)
  try {
    window.dispatchEvent(new CustomEvent(MS_AUTH_EVENT, { detail }))
  } catch (err) {
    console.error('[NeuroNote:MSAuth] Failed to dispatch auth event:', err)
  }
}

// --- configuration ---------------------------------------------------------

export function getClientId() {
  return getItem(CLIENT_ID_KEY) || ''
}

export function getTenantId() {
  return getItem(TENANT_ID_KEY) || DEFAULT_TENANT_ID
}

/** Drops the cached MSAL instance so the next call rebuilds it. */
function resetInstance() {
  msalInstance = null
  msalKey = null
  initPromise = null
  redirectPromise = null
}

export function saveClientId(clientId) {
  const trimmed = (clientId || '').trim()
  console.log('[NeuroNote:MSAuth] Saving Azure Client ID (length %d)', trimmed.length)
  setItem(CLIENT_ID_KEY, trimmed)
  // A different app registration invalidates every cached token.
  resetInstance()
  removeItem(LIST_ID_KEY)
  clearStoredAccount()
  return trimmed
}

export function saveTenantId(tenantId) {
  const trimmed = (tenantId || '').trim() || DEFAULT_TENANT_ID
  console.log('[NeuroNote:MSAuth] Saving Tenant ID:', trimmed)
  setItem(TENANT_ID_KEY, trimmed)
  resetInstance()
  clearStoredAccount()
  return trimmed
}

export function clearClientId() {
  console.log('[NeuroNote:MSAuth] Clearing Azure Client ID and Tenant ID')
  removeItem(CLIENT_ID_KEY)
  removeItem(TENANT_ID_KEY)
  removeItem(LIST_ID_KEY)
  resetInstance()
  clearStoredAccount()
}

// --- account mirror --------------------------------------------------------
// MSAL owns the token cache, but reading it requires an initialized instance,
// which is async. A small mirror of the signed-in account lets the UI answer
// "is Microsoft connected?" synchronously on first paint.

function storeAccount(account) {
  if (!account) return
  const previous = getStoredAccount()
  setItem(ACCOUNT_KEY, {
    homeAccountId: account.homeAccountId,
    // Graph gives a nicer address than the raw UPN; keep it once resolved.
    username: previous?.username || account.username || '',
    name: account.name || '',
    tenantId: account.tenantId || ''
  })
}

function getStoredAccount() {
  const stored = getItem(ACCOUNT_KEY)
  return stored && typeof stored === 'object' && stored.homeAccountId ? stored : null
}

function clearStoredAccount() {
  const had = !!getStoredAccount()
  removeItem(ACCOUNT_KEY)
  if (had) emitChange()
}

// --- initialization --------------------------------------------------------

/**
 * Create (or reuse) the MSAL PublicClientApplication.
 * @param {string} [clientId] Azure app registration (client) ID.
 * @param {string} [tenantId] Directory (tenant) ID, or "common".
 * @returns {Promise<PublicClientApplication>}
 */
export async function initMicrosoftAuth(clientId, tenantId) {
  const id = (clientId || getClientId() || '').trim()
  const tenant = (tenantId || getTenantId() || DEFAULT_TENANT_ID).trim() || DEFAULT_TENANT_ID
  console.log('[NeuroNote:MSAuth] initMicrosoftAuth called, clientId present:', !!id, 'tenant:', tenant)
  if (!id) throw new Error('No Microsoft Client ID configured. Add one in the SYSTEM tab.')

  const key = `${id}|${tenant}`
  if (msalInstance && msalKey === key) {
    console.log('[NeuroNote:MSAuth] Reusing existing MSAL instance')
    return msalInstance
  }
  if (initPromise && msalKey === key) return initPromise

  msalKey = key
  initPromise = (async () => {
    const { PublicClientApplication } = await loadMsal()
    const authority = `https://login.microsoftonline.com/${tenant}`
    const redirectUri = window.location.origin
    console.log('[NeuroNote:MSAuth] Creating MSAL instance', { authority, redirectUri })

    const instance = new PublicClientApplication({
      auth: {
        clientId: id,
        authority,
        redirectUri,
        // We restore the tab ourselves (see RETURN_TAB_KEY), so there is no
        // need for MSAL to bounce the browser a second time.
        navigateToLoginRequestUrl: false
      },
      cache: { cacheLocation: 'localStorage', storeAuthStateInCookie: false }
    })
    // Required since MSAL v3 — every other API throws until this resolves.
    await instance.initialize()
    console.log('[NeuroNote:MSAuth] MSAL initialized')

    msalInstance = instance
    // Before anything reads the cache: if this page load is the tail end of a
    // loginRedirect, that is where the tokens are.
    await consumeRedirectResponse(instance)
    restoreActiveAccount(instance)
    return instance
  })()

  try {
    return await initPromise
  } catch (err) {
    console.error('[NeuroNote:MSAuth] MSAL initialization failed:', err)
    resetInstance()
    throw err
  }
}

// --- redirect round-trip ---------------------------------------------------

/**
 * Does this page load look like the return leg of a sign-in redirect?
 *
 * MSAL puts the authorization code in the fragment (response_mode=fragment),
 * but an error can come back on the query string. Checking cheaply and
 * synchronously lets the app decide whether it must block first paint on MSAL
 * or can let it load in the background.
 * @returns {boolean}
 */
export function hasRedirectResponse() {
  try {
    const hash = window.location.hash || ''
    const search = window.location.search || ''
    const looksLikeAuth = str =>
      /[#&?](code|error|error_description)=/.test(str) && /[#&?](state|session_state|client_info)=/.test(str)
    return looksLikeAuth(hash) || looksLikeAuth(search)
  } catch {
    return false
  }
}

/**
 * Consume MSAL's redirect response exactly once per page load.
 * Resolves to the AuthenticationResult when this load completed a sign-in,
 * or null on an ordinary load.
 */
function consumeRedirectResponse(instance) {
  if (redirectPromise) return redirectPromise

  redirectPromise = (async () => {
    console.log('[NeuroNote:MSAuth] Calling handleRedirectPromise()...')
    let result = null
    try {
      result = await instance.handleRedirectPromise()
    } catch (err) {
      // A failed/declined consent lands here. Never fatal: the app still
      // boots, just signed out.
      console.error('[NeuroNote:MSAuth] handleRedirectPromise() failed:', err)
      return null
    }

    if (!result) {
      console.log('[NeuroNote:MSAuth] No redirect response on this load (normal page load)')
      return null
    }

    console.log('[NeuroNote:MSAuth] Redirect response received, expires at', result.expiresOn)
    if (result.account) {
      instance.setActiveAccount(result.account)
      storeAccount(result.account)
      console.log('[NeuroNote:MSAuth] Active account set from redirect:', result.account.username)
    }

    const email = (await fetchUserEmail(result.accessToken)) || result.account?.username || ''
    const stored = getStoredAccount()
    if (email && stored) setItem(ACCOUNT_KEY, { ...stored, username: email })
    console.log('[NeuroNote:MSAuth] Redirect sign-in complete for', email || '(unknown address)')
    emitChange()
    return result
  })()

  return redirectPromise
}

/**
 * Finish a sign-in that was started with loginRedirect(), if this page load is
 * the return leg. Safe (and cheap) to call on every boot: with no Client ID
 * configured it returns immediately without pulling MSAL into the bundle.
 *
 * @returns {Promise<{handled: boolean, signedIn: boolean, email: string, returnTo: string|null}>}
 */
export async function handleMicrosoftRedirect() {
  const returnTo = takeReturnTab()

  if (!getClientId()) {
    console.log('[NeuroNote:MSAuth] handleMicrosoftRedirect() — no Client ID configured, skipping MSAL')
    return { handled: false, signedIn: false, email: '', returnTo: null }
  }

  console.log('[NeuroNote:MSAuth] handleMicrosoftRedirect() — booting MSAL to drain any redirect response')
  try {
    // initMicrosoftAuth() awaits consumeRedirectResponse() internally, so by
    // the time it resolves the tokens are already in the cache.
    await initMicrosoftAuth()
  } catch (err) {
    console.error('[NeuroNote:MSAuth] handleMicrosoftRedirect() — MSAL unavailable:', err)
    return { handled: false, signedIn: false, email: '', returnTo: null }
  }

  const result = await redirectPromise
  const handled = !!result
  const signedIn = isSignedIn()
  const email = getUserEmail()
  console.log('[NeuroNote:MSAuth] handleMicrosoftRedirect() done:', { handled, signedIn, email, returnTo })
  return { handled, signedIn, email, returnTo: handled ? returnTo : null }
}

function rememberReturnTab(tab) {
  if (!tab) return
  console.log('[NeuroNote:MSAuth] Remembering return tab:', tab)
  setItem(RETURN_TAB_KEY, tab)
}

function takeReturnTab() {
  const tab = getItem(RETURN_TAB_KEY)
  if (tab) removeItem(RETURN_TAB_KEY)
  return typeof tab === 'string' ? tab : null
}

// Re-attaches the previously signed-in account after a reload, and reconciles
// the mirror when MSAL's own cache has been cleared behind our back.
function restoreActiveAccount(instance) {
  const accounts = instance.getAllAccounts()
  let active = instance.getActiveAccount()

  if (!active) {
    const stored = getStoredAccount()
    if (stored) active = accounts.find(a => a.homeAccountId === stored.homeAccountId) || null
    if (!active && accounts.length === 1) active = accounts[0]
    if (active) instance.setActiveAccount(active)
  }

  if (active) {
    console.log('[NeuroNote:MSAuth] Active account restored:', active.username)
    storeAccount(active)
  } else if (getStoredAccount()) {
    console.warn('[NeuroNote:MSAuth] Stored account is no longer in the MSAL cache — clearing')
    clearStoredAccount()
  }
  return active
}

/**
 * Initialize MSAL when a Client ID is configured, without throwing.
 * Called on mount so the SYSTEM badge reflects the real cache state.
 * @returns {Promise<boolean>} whether an account is now active
 */
export async function ensureInitialized() {
  if (!getClientId()) return false
  try {
    const instance = await initMicrosoftAuth()
    return !!(instance.getActiveAccount() || instance.getAllAccounts()[0])
  } catch (err) {
    console.warn('[NeuroNote:MSAuth] ensureInitialized failed:', err)
    return false
  }
}

// --- sign in / out ---------------------------------------------------------

async function fetchUserEmail(accessToken) {
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (!res.ok) {
      console.warn('[NeuroNote:MSAuth] Graph /me returned', res.status)
      return ''
    }
    const data = await res.json()
    const email = data.mail || data.userPrincipalName || ''
    console.log('[NeuroNote:MSAuth] Connected account:', email)
    return email
  } catch (err) {
    // Non-fatal: the integration works fine without knowing the address.
    console.warn('[NeuroNote:MSAuth] Could not resolve account email:', err)
    return ''
  }
}

/**
 * Start sign-in by navigating the whole page to Microsoft.
 *
 * v2.5.1: this replaces loginPopup(), which MSAL refuses to open when it
 * believes the current window is itself a popup (`block_nested_popups`).
 *
 * The returned promise does **not** resolve on success — the browser leaves
 * this document before loginRedirect() settles. Tokens arrive on the next page
 * load via handleMicrosoftRedirect(). It rejects only when the navigation
 * never happens, so callers should treat "resolved/never settled" as success
 * and a rejection as a real failure.
 *
 * @param {{returnTo?: string}} [options] tab to restore once Microsoft sends
 *   the user back (e.g. 'system').
 * @returns {Promise<never>}
 */
export async function signIn({ returnTo = null } = {}) {
  console.log('[NeuroNote:MSAuth] signIn() requested, returnTo:', returnTo)
  if (pendingSignIn) {
    console.log('[NeuroNote:MSAuth] Sign-in already in flight, reusing pending promise')
    return pendingSignIn
  }

  pendingSignIn = (async () => {
    const instance = await initMicrosoftAuth()
    rememberReturnTab(returnTo)
    console.log('[NeuroNote:MSAuth] Redirecting to Microsoft for scopes:', MICROSOFT_SCOPES.join(' '))
    await instance.loginRedirect({ scopes: MICROSOFT_SCOPES, prompt: 'select_account' })
    // Unreachable in practice: the navigation has already started.
    console.log('[NeuroNote:MSAuth] loginRedirect() returned without navigating')
  })()

  try {
    return await pendingSignIn
  } catch (err) {
    console.error('[NeuroNote:MSAuth] signIn failed:', err)
    takeReturnTab()
    throw new Error(err?.errorMessage || err?.message || 'Microsoft sign-in could not be started.')
  } finally {
    pendingSignIn = null
  }
}

/** Clear MSAL's cached tokens for this app. Does not revoke consent server-side. */
export async function signOut() {
  console.log('[NeuroNote:MSAuth] signOut() requested')
  try {
    if (msalInstance) {
      const account = msalInstance.getActiveAccount()
      await msalInstance.clearCache(account ? { account } : undefined)
      msalInstance.setActiveAccount(null)
    }
  } catch (err) {
    console.warn('[NeuroNote:MSAuth] clearCache failed (continuing):', err)
  }
  removeItem(LIST_ID_KEY)
  removeItem(ACCOUNT_KEY)
  console.log('[NeuroNote:MSAuth] Signed out — local Microsoft tokens cleared')
  emitChange()
}

/**
 * A valid Graph access token, refreshed silently when possible.
 *
 * @param {{allowInteractive?: boolean, returnTo?: string}} [options]
 *   allowInteractive falls back to acquireTokenRedirect() when a fresh login or
 *   extra consent is required. v2.5.1: that fallback is a *full-page
 *   navigation* (it replaced acquireTokenPopup), so it discards anything
 *   unsaved on screen. It defaults to false — only opt in from a context with
 *   nothing to lose.
 * @returns {Promise<string|null>} null when no token could be obtained, and
 *   also when an interactive redirect was just kicked off (the page is leaving).
 */
export async function getAccessToken({ allowInteractive = false, returnTo = null } = {}) {
  if (!getClientId()) {
    console.log('[NeuroNote:MSAuth] getAccessToken() — no Client ID configured')
    return null
  }

  let instance
  try {
    instance = await initMicrosoftAuth()
  } catch (err) {
    console.error('[NeuroNote:MSAuth] getAccessToken() — MSAL unavailable:', err)
    return null
  }

  const account = instance.getActiveAccount() || instance.getAllAccounts()[0] || null
  if (!account) {
    console.log('[NeuroNote:MSAuth] getAccessToken() — no signed-in account')
    clearStoredAccount()
    return null
  }

  try {
    const result = await instance.acquireTokenSilent({ scopes: SILENT_SCOPES, account })
    console.log('[NeuroNote:MSAuth] Silent token acquired, expires at', result.expiresOn)
    storeAccount(result.account || account)
    return result.accessToken
  } catch (err) {
    const InteractionRequired = msalModule?.InteractionRequiredAuthError
    const interactive = !!InteractionRequired && err instanceof InteractionRequired
    console.warn(
      '[NeuroNote:MSAuth] Silent token acquisition failed%s:',
      interactive ? ' (interaction required)' : '',
      err
    )
    if (!allowInteractive) {
      console.log('[NeuroNote:MSAuth] Interactive fallback not allowed here — caller must prompt a reconnect')
      return null
    }
    try {
      rememberReturnTab(returnTo)
      console.log('[NeuroNote:MSAuth] Falling back to acquireTokenRedirect() — leaving the page')
      await instance.acquireTokenRedirect({ scopes: SILENT_SCOPES, account })
      // The navigation is under way; nothing useful left to return.
      return null
    } catch (redirectErr) {
      console.error('[NeuroNote:MSAuth] Interactive token acquisition failed:', redirectErr)
      takeReturnTab()
      return null
    }
  }
}

/** @returns {boolean} whether a Microsoft account is connected. */
export function isSignedIn() {
  if (msalInstance) {
    return !!(msalInstance.getActiveAccount() || msalInstance.getAllAccounts()[0])
  }
  return !!getStoredAccount()
}

/** @returns {string} the connected account address, or '' when signed out. */
export function getUserEmail() {
  const stored = getStoredAccount()
  if (stored) return stored.username || stored.name || ''
  if (msalInstance) {
    const active = msalInstance.getActiveAccount() || msalInstance.getAllAccounts()[0]
    return active?.username || ''
  }
  return ''
}

/** Drop the cached account after a 401 so the UI prompts a reconnect. */
export function handleUnauthorized(source = 'MSAuth') {
  console.warn(`[NeuroNote:${source}] 401 from Microsoft Graph — clearing cached account state`)
  removeItem(LIST_ID_KEY)
  clearStoredAccount()
}
