// v2.2 — Persistent learned-corrections dictionary.
//
// Every correction the user makes with long-press → Save ("Remember this
// correction" checked) lands here. The dictionary is used twice on every future
// recording: the right-hand spellings are sent to AssemblyAI as `word_boost`,
// and the returned transcript is run through applyCorrections() as a cleanup
// pass before summarization.
//
// Stored at localStorage key `neuronote:corrections` as:
//   [{ wrong: string, right: string, addedAt: ISO string, useCount: number }]

import { getItem, setItem } from './storage.js'

const KEY = 'corrections'
const LOG = '[NeuroNote:Corrections]'

function normalizeEntry(raw) {
  const wrong = typeof raw?.wrong === 'string' ? raw.wrong.trim() : ''
  const right = typeof raw?.right === 'string' ? raw.right.trim() : ''
  if (!wrong || !right) return null
  return {
    wrong,
    right,
    addedAt: typeof raw.addedAt === 'string' ? raw.addedAt : new Date().toISOString(),
    useCount: Number.isFinite(Number(raw.useCount)) ? Math.max(0, Number(raw.useCount)) : 0
  }
}

/** All learned corrections, newest-first is NOT enforced — insertion order is kept. */
export function loadCorrections() {
  const raw = getItem(KEY)
  const list = Array.isArray(raw) ? raw.map(normalizeEntry).filter(Boolean) : []
  console.log(`${LOG} loadCorrections -> ${list.length} entr${list.length === 1 ? 'y' : 'ies'}`)
  return list
}

function persist(list) {
  setItem(KEY, list)
  return list
}

/**
 * Add a correction, or update the "right" spelling of an existing one.
 * Matching on `wrong` is case-insensitive so "smyth" and "Smyth" stay one entry.
 */
export function addCorrection(wrong, right) {
  const cleanWrong = String(wrong ?? '').trim()
  const cleanRight = String(right ?? '').trim()
  if (!cleanWrong || !cleanRight) {
    console.log(`${LOG} addCorrection ignored — needs both a wrong and a right spelling`)
    return loadCorrections()
  }
  if (cleanWrong.toLowerCase() === cleanRight.toLowerCase()) {
    console.log(`${LOG} addCorrection ignored — "${cleanWrong}" and "${cleanRight}" are the same word`)
    return loadCorrections()
  }

  const list = loadCorrections()
  const idx = list.findIndex(c => c.wrong.toLowerCase() === cleanWrong.toLowerCase())
  if (idx >= 0) {
    list[idx] = { ...list[idx], wrong: cleanWrong, right: cleanRight, addedAt: new Date().toISOString() }
    console.log(`${LOG} addCorrection updated "${cleanWrong}" -> "${cleanRight}"`)
  } else {
    list.push({ wrong: cleanWrong, right: cleanRight, addedAt: new Date().toISOString(), useCount: 0 })
    console.log(`${LOG} addCorrection added "${cleanWrong}" -> "${cleanRight}" (${list.length} total)`)
  }
  return persist(list)
}

/** Delete the entry whose `wrong` spelling matches (case-insensitive). */
export function removeCorrection(wrong) {
  const cleanWrong = String(wrong ?? '').trim().toLowerCase()
  const list = loadCorrections()
  const next = list.filter(c => c.wrong.toLowerCase() !== cleanWrong)
  console.log(`${LOG} removeCorrection "${wrong}" -> ${list.length - next.length} removed, ${next.length} remain`)
  return persist(next)
}

/** Wipe the dictionary. */
export function clearCorrections() {
  const count = loadCorrections().length
  console.log(`${LOG} clearCorrections -> removed all ${count}`)
  return persist([])
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Whole-word, case-insensitive matcher for one term.
 * \b fails when a term starts/ends with a non-word char (e.g. "C++"), so the
 * boundary is only asserted on the sides where it can actually apply.
 */
function buildWordRegex(term) {
  const escaped = escapeRegExp(term)
  const left = /^\w/.test(term) ? '\\b' : ''
  const right = /\w$/.test(term) ? '\\b' : ''
  return new RegExp(`${left}${escaped}${right}`, 'gi')
}

/**
 * Rewrite `right` so it wears the capitalization the matched text was wearing.
 *   smyth -> smith   |   Smyth -> Smith   |   SMYTH -> SMITH
 * Anything mixed or unusual (e.g. "sMyTh", "iPhone") keeps `right` verbatim.
 */
export function matchCase(matched, right) {
  if (!matched) return right
  // A right-hand spelling with internal capitals is deliberate ("AssemblyAI",
  // "iPhone", "McDonald") — never reshape it.
  if (/[A-Z]/.test(right.slice(1))) return right
  if (matched === matched.toLowerCase()) return right.toLowerCase()
  const upperLetters = (matched.match(/[A-Z]/g) || []).length
  if (upperLetters > 1 && matched === matched.toUpperCase()) return right.toUpperCase()
  const isTitleCase =
    matched[0] === matched[0].toUpperCase() &&
    matched.slice(1) === matched.slice(1).toLowerCase()
  if (isTitleCase) return right.charAt(0).toUpperCase() + right.slice(1)
  return right
}

/**
 * Replace every whole-word occurrence of `wrong` with `right`, preserving the
 * capitalization pattern of each match. Returns { text, count } — no dictionary
 * side effects, so the session-level find-and-replace can reuse it.
 */
export function replacePreservingCase(text, wrong, right) {
  if (typeof text !== 'string' || !text || !wrong || !right) {
    return { text: typeof text === 'string' ? text : '', count: 0 }
  }
  let count = 0
  const next = text.replace(buildWordRegex(wrong), (matched) => {
    count++
    return matchCase(matched, right)
  })
  return { text: next, count }
}

/**
 * Run the whole dictionary over a string. Bumps useCount for each entry that
 * actually matched (by number of occurrences replaced).
 * Returns { text, replacements, entriesMatched, dictionarySize }.
 */
export function applyCorrectionsWithStats(text) {
  const empty = { text: typeof text === 'string' ? text : '', replacements: 0, entriesMatched: 0, dictionarySize: 0 }
  if (typeof text !== 'string' || !text) {
    console.log(`${LOG} applyCorrections skipped — no text`)
    return empty
  }
  const list = loadCorrections()
  if (list.length === 0) {
    console.log(`${LOG} applyCorrections skipped — dictionary is empty`)
    return { ...empty, text }
  }

  let result = text
  let replacements = 0
  let entriesMatched = 0
  const next = list.map(entry => {
    const { text: replaced, count } = replacePreservingCase(result, entry.wrong, entry.right)
    if (count === 0) return entry
    result = replaced
    replacements += count
    entriesMatched++
    return { ...entry, useCount: entry.useCount + count }
  })

  if (replacements > 0) persist(next)
  console.log(`${LOG} applyCorrections -> ${replacements} replacement(s) from ${entriesMatched}/${list.length} entries`)
  return { text: result, replacements, entriesMatched, dictionarySize: list.length }
}

/**
 * Run the whole dictionary over a string and return the corrected string.
 * Bumps useCount for each entry that matched.
 */
export function applyCorrections(text) {
  return applyCorrectionsWithStats(text).text
}

/** Deduplicated list of correct spellings, for the AssemblyAI `word_boost` field. */
export function getBoostList() {
  const seen = new Set()
  const boost = []
  for (const { right } of loadCorrections()) {
    const key = right.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    boost.push(right)
  }
  console.log(`${LOG} getBoostList -> ${boost.length} term(s) to boost`)
  return boost
}
