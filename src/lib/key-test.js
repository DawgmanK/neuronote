// v2.8 — "does this key actually work?" checks for the SETTINGS screen.
//
// Until now a key was saved blind: a typo, a revoked key, or an account without
// access to the configured model only surfaced as a failed summary after a
// meeting. Each check below makes one free, read-only request to the vendor's
// own API (listing models or transcripts — nothing is generated or billed) and
// reports back in plain language.
//
// Every function resolves, never rejects:
//   { ok: true,  message }                    key works and the models are there
//   { ok: true,  warning: true, message }     key works, but a model is missing
//   { ok: false, message }                    key rejected, or the vendor is unreachable
import { MODEL_DISPLAY, MODEL_TERRA, MODEL_LUNA, MODEL_SOL, GEMINI_MODEL_FLASH, GEMINI_EMBEDDING_MODEL } from './models.js'

const LOG = '[NeuroNote:KeyTest]'

function unreachable(vendor) {
  return { ok: false, message: `Couldn't reach ${vendor}. Check your connection and try again.` }
}

function rejected(vendor, status) {
  if (status === 401 || status === 403) return { ok: false, message: `${vendor} rejected this key. Check it was copied in full.` }
  if (status === 429) return { ok: false, message: `${vendor} is rate-limiting this key right now. Try again in a minute.` }
  return { ok: false, message: `${vendor} returned an error (${status}). Try again shortly.` }
}

function listNames(names) {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export async function testOpenAIKey(key) {
  let res
  try {
    res = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${key}` }
    })
  } catch (err) {
    console.error(`${LOG} OpenAI unreachable:`, err)
    return unreachable('OpenAI')
  }
  // 403 is not a bad key: a restricted key that may write completions but not
  // list models lands here, as does an account without access to this
  // endpoint. Say it could not be checked rather than that it was rejected.
  if (res.status === 403) {
    return {
      ok: true,
      warning: true,
      message: 'Couldn\'t confirm this key: OpenAI wouldn\'t let it list models (403). If it is a restricted key, summaries may still work. Record a short test to find out.'
    }
  }
  if (!res.ok) return rejected('OpenAI', res.status)

  let available = []
  try {
    const data = await res.json()
    available = (data.data || []).map(m => m.id)
  } catch {
    return { ok: true, message: 'Key works.' }
  }

  const needed = [MODEL_TERRA, MODEL_LUNA, MODEL_SOL]
  const missing = needed.filter(id => !available.includes(id))
  console.log(`${LOG} OpenAI key accepted — ${available.length} models visible, missing:`, missing)
  if (missing.length === 0) {
    return { ok: true, message: `Key works. ${listNames(needed.map(id => MODEL_DISPLAY[id]))} are available.` }
  }
  return {
    ok: true,
    warning: true,
    message: `Key works, but this account can't see ${listNames(missing.map(id => MODEL_DISPLAY[id] || id))}. Features that use ${missing.length === 1 ? 'it' : 'them'} will fail until OpenAI enables access.`
  }
}

export async function testGeminiKey(key) {
  let res
  try {
    // The key travels in a header rather than the query string.
    res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
      headers: { 'x-goog-api-key': key }
    })
  } catch (err) {
    console.error(`${LOG} Gemini unreachable:`, err)
    return unreachable('Google')
  }
  // Google answers a malformed or unknown key with 400, not 401.
  if (res.status === 400) return rejected('Google', 401)
  if (!res.ok) return rejected('Google', res.status)

  let available = []
  try {
    const data = await res.json()
    available = (data.models || []).map(m => (m.name || '').replace(/^models\//, ''))
  } catch {
    return { ok: true, message: 'Key works.' }
  }

  const missing = [GEMINI_MODEL_FLASH, GEMINI_EMBEDDING_MODEL].filter(id => !available.includes(id))
  console.log(`${LOG} Gemini key accepted — ${available.length} models visible, missing:`, missing)
  if (missing.length === 0) {
    return { ok: true, message: `Key works. ${MODEL_DISPLAY[GEMINI_MODEL_FLASH]} is available.` }
  }
  return {
    ok: true,
    warning: true,
    message: `Key works, but this account can't see ${listNames(missing.map(id => MODEL_DISPLAY[id] || id))}. Features that use ${missing.length === 1 ? 'it' : 'them'} will fail.`
  }
}

export async function testAssemblyKey(key) {
  let res
  try {
    res = await fetch('https://api.assemblyai.com/v2/transcript?limit=1', {
      headers: { 'Authorization': key }
    })
  } catch (err) {
    console.error(`${LOG} AssemblyAI unreachable:`, err)
    return unreachable('AssemblyAI')
  }
  if (!res.ok) return rejected('AssemblyAI', res.status)
  console.log(`${LOG} AssemblyAI key accepted`)
  return { ok: true, message: 'Key works. Transcripts will use AssemblyAI.' }
}
