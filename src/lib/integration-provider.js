// v2.5 — which external service action items are sent to.
//
// NeuroNote can talk to Google (Calendar + Tasks) and/or Microsoft 365
// (Outlook Calendar + Microsoft To Do). The user picks in the SYSTEM tab; the
// choice lives in localStorage so it survives reloads and is readable by every
// component without prop drilling.

const STORAGE_KEY = 'neuronote:integration:provider'

/** @typedef {'google'|'microsoft'|'both'|'none'} IntegrationProvider */

export const PROVIDERS = ['google', 'microsoft', 'both', 'none']
export const DEFAULT_PROVIDER = 'none'

/** Fired on window whenever the provider preference changes. */
export const PROVIDER_EVENT = 'neuronote:integration:provider-changed'

export const PROVIDER_LABELS = {
  google: 'Google',
  microsoft: 'Microsoft',
  both: 'Both',
  none: 'None'
}

// v2.4 and earlier had no provider preference — Google was the only option.
// An upgrade must not silently disconnect those users, so a stored Google
// Client ID is read as an implicit "google" choice the first time.
function inferLegacyProvider() {
  try {
    return localStorage.getItem('neuronote:google:clientid') ? 'google' : DEFAULT_PROVIDER
  } catch {
    return DEFAULT_PROVIDER
  }
}

/**
 * @returns {IntegrationProvider}
 */
export function getProvider() {
  let raw
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch (err) {
    console.warn('[NeuroNote:Integration] Could not read provider preference:', err)
    return DEFAULT_PROVIDER
  }
  if (!raw) {
    const inferred = inferLegacyProvider()
    if (inferred !== DEFAULT_PROVIDER) {
      console.log('[NeuroNote:Integration] No provider stored — carrying over v2.4 Google setup')
      // Persist only. getProvider() runs during render (state initializers), so
      // firing the change event here could re-render a sibling mid-render.
      writeProvider(inferred)
    }
    return inferred
  }
  // Written raw ("google"), but tolerate a JSON-quoted value from any other writer.
  const value = raw.startsWith('"') ? raw.slice(1, -1) : raw
  return PROVIDERS.includes(value) ? value : DEFAULT_PROVIDER
}

function writeProvider(provider) {
  const value = PROVIDERS.includes(provider) ? provider : DEFAULT_PROVIDER
  console.log('[NeuroNote:Integration] Provider set to:', value)
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch (err) {
    console.error('[NeuroNote:Integration] Could not persist provider preference:', err)
  }
  return value
}

/**
 * @param {IntegrationProvider} provider
 * @returns {IntegrationProvider} the value actually stored
 */
export function setProvider(provider) {
  const value = writeProvider(provider)
  try {
    window.dispatchEvent(new CustomEvent(PROVIDER_EVENT, { detail: { provider: value } }))
  } catch (err) {
    console.error('[NeuroNote:Integration] Failed to dispatch provider event:', err)
  }
  return value
}

/** @returns {boolean} whether the Google section/buttons should be available. */
export function googleEnabled(provider = getProvider()) {
  return provider === 'google' || provider === 'both'
}

/** @returns {boolean} whether the Microsoft section/buttons should be available. */
export function microsoftEnabled(provider = getProvider()) {
  return provider === 'microsoft' || provider === 'both'
}
