// Shared shape + defaults for action items so the calendar/tasks integration
// can consume both new AI-extracted items and legacy v2.0 notes
// ({action, assignee}).

export const DEFAULT_TIME = '09:00'
export const DEFAULT_DURATION = 30

export function todayISO() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function isValidDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isValidTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

/**
 * Normalize one stored/extracted action item to the v2.1 shape.
 * Accepts a plain string, a v2.0 {action, assignee} object, or a v2.1 object.
 */
export function normalizeActionItem(item) {
  if (typeof item === 'string') {
    return {
      text: item,
      owner: 'Unknown',
      dueDate: null,
      dueTime: null,
      suggestedType: 'task',
      duration: DEFAULT_DURATION,
      done: false,
      sync: null
    }
  }
  const raw = item || {}
  const owner = raw.owner || raw.assignee || 'Unknown'
  const suggestedType = raw.suggestedType === 'event' ? 'event' : 'task'
  return {
    ...raw,
    text: raw.text || raw.action || '',
    owner,
    dueDate: isValidDate(raw.dueDate) ? raw.dueDate : null,
    dueTime: isValidTime(raw.dueTime) ? raw.dueTime : null,
    suggestedType,
    duration: Number(raw.duration) > 0 ? Number(raw.duration) : DEFAULT_DURATION,
    done: !!raw.done,
    // v2.5 renamed the "added to Google" record to a provider-agnostic one;
    // notes written by v2.1-v2.4 still carry it under `google`.
    sync: raw.sync || raw.google || null
  }
}

export function normalizeActionItems(items) {
  if (!Array.isArray(items)) return []
  return items.map(normalizeActionItem)
}

/** Dialog/modal defaults: AI values when present, otherwise today at 9:00 AM. */
export function draftFromActionItem(item) {
  const normalized = normalizeActionItem(item)
  return {
    title: normalized.text,
    date: normalized.dueDate || todayISO(),
    time: normalized.dueTime || DEFAULT_TIME,
    duration: normalized.duration || DEFAULT_DURATION,
    type: normalized.suggestedType
  }
}

/** "2026-08-18" + "09:00" -> "2026-08-18T09:00:00" (naive local, no offset). */
export function toLocalDateTime(date, time) {
  const d = isValidDate(date) ? date : todayISO()
  const t = isValidTime(time) ? time : DEFAULT_TIME
  return `${d}T${t}:00`
}

/** Description/notes body attached to every created event or task. */
export function buildDetailBody(item, noteTitle) {
  const normalized = normalizeActionItem(item)
  const lines = []
  if (normalized.owner && normalized.owner !== 'Unknown') lines.push(`Owner: ${normalized.owner}`)
  if (noteTitle) lines.push(`From NeuroNote session: ${noteTitle}`)
  lines.push('Created by NeuroNote v2.5')
  return lines.join('\n')
}
