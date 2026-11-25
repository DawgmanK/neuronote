// v2.9 — handing a note to an outside assistant.
//
// "Send to Grok" does not talk to Grok. It saves the note as a Google Doc in
// one Drive folder (see services/google-drive.js); Grok, or any assistant with
// a Google Drive connector, reads the folder from its own side. That keeps
// NeuroNote server-less and needs no key beyond the Google sign-in it has.
import { saveDocumentToHandoffFolder } from '../services/google-drive.js'
import { normalizeActionItem } from './actionItems.js'

export const SALES_CALL = 'sales-call'

export function isSalesCall(note) {
  return note?.kind === SALES_CALL
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function list(items) {
  return items?.length ? `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>` : ''
}

function section(heading, body) {
  return body ? `<h2>${esc(heading)}</h2>${body}` : ''
}

/** "2026-11-25" in the device's own time zone, for a file name that sorts. */
function localDate(iso) {
  const d = iso ? new Date(iso) : new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * The document that lands in the handoff folder. Written to be read by a
 * person and parsed by an assistant alike: fixed headings, one fact per line,
 * and a short machine-readable header at the top.
 * @returns {{name: string, html: string}}
 */
export function buildCallDocument(note) {
  const sales = note.sales || {}
  const accounts = Array.isArray(sales.accounts) ? sales.accounts.filter(a => a && (a.customer || a.notes)) : []
  const customers = accounts.map(a => a.customer).filter(Boolean)
  const when = note.date ? new Date(note.date) : new Date()
  const kindLabel = isSalesCall(note) ? 'Sales call report' : 'Meeting notes'

  const name = `${localDate(note.date)} ${isSalesCall(note) ? 'Sales call' : 'Meeting'} — ${
    (customers.join(', ') || note.title || 'Untitled').slice(0, 90)
  }`

  const header = [
    ['Type', kindLabel],
    ['Date', when.toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })],
    ['Date (ISO)', when.toISOString()],
    customers.length ? ['Customers', customers.join(', ')] : null,
    note.duration ? ['Recording length', `${Math.max(1, Math.round(note.duration / 60))} min`] : null,
    ['Source', `NeuroNote (note ${note.id})`]
  ].filter(Boolean)

  const accountBlocks = accounts.map(a => {
    const lines = [
      a.contact ? `<b>Contact:</b> ${esc(a.contact)}` : '',
      a.relationship && a.relationship !== 'unknown' ? `<b>Relationship:</b> ${esc(a.relationship)}` : '',
      a.notes ? `<b>What happened:</b> ${esc(a.notes)}` : '',
      a.nextStep ? `<b>Next step:</b> ${esc(a.nextStep)}${a.nextStepDate ? ` (by ${esc(a.nextStepDate)})` : ''}` : ''
    ].filter(Boolean)
    return `<h3>${esc(a.customer || 'Unnamed account')}</h3>${list(lines)}`
  }).join('')

  const actions = (note.summary?.actions || []).map(normalizeActionItem).map(a => {
    const owner = a.owner && a.owner !== 'Unknown' ? ` — owner: ${esc(a.owner)}` : ''
    const due = a.dueDate ? ` — due: ${esc(a.dueDate)}${a.dueTime ? ` ${esc(a.dueTime)}` : ''}` : ''
    return `${a.done ? '[done] ' : ''}${esc(a.text)}${owner}${due}`
  })

  const transcript = (note.transcript || '')
    .split('\n')
    .filter(line => line.trim())
    .map(line => `<p>${esc(line)}</p>`)
    .join('')

  const html = [
    '<html><head><meta charset="utf-8"></head><body>',
    `<h1>${esc(note.title || 'Untitled')}</h1>`,
    `<p>${header.map(([k, v]) => `<b>${esc(k)}:</b> ${esc(v)}`).join('<br>')}</p>`,
    section('Summary', note.summary?.paragraph ? `<p>${esc(note.summary.paragraph)}</p>` : ''),
    section('Outcome', sales.outcome ? `<p>${esc(sales.outcome)}</p>` : ''),
    section('Accounts', accountBlocks),
    section('Key points', list((note.summary?.bullets || []).map(esc))),
    section('Action items', list(actions)),
    section('Decisions', list((note.decisions || []).map(esc))),
    section('Open questions', list((note.followups || []).map(esc))),
    section('Transcript', transcript),
    '</body></html>'
  ].join('')

  return { name, html }
}

// --- email ------------------------------------------------------------------
// v2.9 — the no-setup route. NeuroNote has no server and cannot send mail, so
// "Email to Grok" is a mailto: link: it opens the device's own mail app with
// the address, subject and report filled in, and the user presses Send.

const EMAIL_PATTERN = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/

export function isValidEmail(value) {
  return EMAIL_PATTERN.test((value || '').trim())
}

// Mail apps take the whole message through the link, and how long a link they
// accept varies. The report is kept under this many characters by shortening
// the transcript, which comes last; everything above it always goes in whole.
const EMAIL_BODY_LIMIT = 6000

/**
 * The same report as buildCallDocument(), as plain text for an email.
 * @returns {{subject: string, body: string, transcriptShortened: boolean}}
 */
export function buildCallEmail(note) {
  const sales = note.sales || {}
  const accounts = Array.isArray(sales.accounts) ? sales.accounts.filter(a => a && (a.customer || a.notes)) : []
  const customers = accounts.map(a => a.customer).filter(Boolean)
  const when = note.date ? new Date(note.date) : new Date()
  const kindLabel = isSalesCall(note) ? 'Sales call' : 'Meeting'

  const subject = `${kindLabel}: ${(customers.join(', ') || note.title || 'Untitled').slice(0, 80)} — ${localDate(note.date)}`

  const lines = [
    `${isSalesCall(note) ? 'SALES CALL REPORT' : 'MEETING NOTES'}: ${note.title || 'Untitled'}`,
    `Date: ${when.toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
  ]
  if (customers.length) lines.push(`Customers: ${customers.join(', ')}`)

  const block = (heading, items) => {
    const kept = (items || []).filter(Boolean)
    if (kept.length) lines.push('', heading, ...kept)
  }

  block('SUMMARY', [note.summary?.paragraph])
  block('OUTCOME', [sales.outcome])
  block('ACCOUNTS', accounts.flatMap((a, i) => [
    `${i + 1}. ${a.customer || 'Unnamed account'}${a.relationship && a.relationship !== 'unknown' ? ` (${a.relationship})` : ''}`,
    a.contact ? `   Contact: ${a.contact}` : '',
    a.notes ? `   What happened: ${a.notes}` : '',
    a.nextStep ? `   Next step: ${a.nextStep}${a.nextStepDate ? ` (by ${a.nextStepDate})` : ''}` : ''
  ]))
  block('KEY POINTS', (note.summary?.bullets || []).map(b => `- ${b}`))
  block('ACTION ITEMS', (note.summary?.actions || []).map(normalizeActionItem).map(a => {
    const owner = a.owner && a.owner !== 'Unknown' ? ` | owner: ${a.owner}` : ''
    const due = a.dueDate ? ` | due: ${a.dueDate}${a.dueTime ? ` ${a.dueTime}` : ''}` : ''
    return `- [${a.done ? 'x' : ' '}] ${a.text}${owner}${due}`
  }))
  block('DECISIONS', (note.decisions || []).map(d => `- ${d}`))
  block('OPEN QUESTIONS', (note.followups || []).map(f => `- ${f}`))

  const head = lines.join('\n')
  const footer = '\n\nSent from NeuroNote'
  const transcript = (note.transcript || '').trim()
  let transcriptShortened = false
  let transcriptPart = ''
  if (transcript) {
    const room = EMAIL_BODY_LIMIT - head.length - footer.length - 40
    if (transcript.length <= room) {
      transcriptPart = `\n\nTRANSCRIPT\n${transcript}`
    } else if (room > 300) {
      transcriptShortened = true
      transcriptPart = `\n\nTRANSCRIPT (first part; the full text is in NeuroNote)\n${transcript.slice(0, room).trimEnd()}…`
    } else {
      transcriptShortened = true
    }
  }

  return { subject, body: head + transcriptPart + footer, transcriptShortened }
}

/** A mailto: link that opens the mail app with the report ready to send. */
export function buildMailtoLink(address, note) {
  const to = (address || '').trim()
  if (!isValidEmail(to)) return null
  const { subject, body } = buildCallEmail(note)
  // Mail apps expect CRLF line endings inside a mailto body.
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\r?\n/g, '\r\n'))}`
}

/**
 * Save a note into the handoff folder.
 * @returns {Promise<{ok: boolean, handoff?: {sentAt: string, fileId: string, link: string, folderLink: string},
 *   error?: string, needsReauth?: boolean, needsDriveScope?: boolean, needsApiEnabled?: boolean}>}
 */
export async function sendNoteToHandoff(note) {
  if (!note) return { ok: false, error: 'There is no note to send.' }
  const result = await saveDocumentToHandoffFolder(buildCallDocument(note))
  if (!result.success) {
    return {
      ok: false,
      error: result.error,
      needsReauth: result.needsReauth,
      needsDriveScope: result.needsDriveScope,
      needsApiEnabled: result.needsApiEnabled
    }
  }
  return {
    ok: true,
    handoff: {
      sentAt: new Date().toISOString(),
      fileId: result.fileId,
      link: result.link,
      folderLink: result.folderLink
    }
  }
}
