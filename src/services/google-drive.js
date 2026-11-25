// v2.9 — Google Drive, used for one thing: a handoff folder.
//
// NeuroNote keeps everything in the browser, so nothing outside the phone can
// read a note. Saving a sales call as a Google Doc in one Drive folder is the
// way out: any assistant with a Google Drive connector (Grok, in the case this
// was built for) can then find the call and log it.
//
// The scope is drive.file, the narrowest Drive scope there is: NeuroNote can
// see and change only the files and folders it created itself, never the rest
// of the user's Drive.
import { getAccessToken, handleUnauthorized } from './google-auth.js'
import { getItem, setItem, removeItem } from '../lib/storage.js'

const LOG = '[NeuroNote:Drive]'
const FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/drive/v3/files'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const DOC_MIME = 'application/vnd.google-apps.document'

export const HANDOFF_FOLDER_NAME = 'NeuroNote Sales Calls'

/** localStorage key (under the neuronote: prefix) caching { id, link }. */
const FOLDER_KEY = 'handoff:folder'

export function getCachedFolder() {
  return getItem(FOLDER_KEY)
}

export function forgetFolder() {
  removeItem(FOLDER_KEY)
}

/** Turns a failed Drive response into something a person can act on. */
function describeFailure(status, data, text) {
  const reason = data?.error?.errors?.[0]?.reason || data?.error?.status || ''
  const message = data?.error?.message || text || `HTTP ${status}`

  if (status === 401) {
    return { error: 'Google sign-in expired. Sign in to Google again in Settings.', needsReauth: true }
  }
  if (status === 403 && /accessNotConfigured|SERVICE_DISABLED/i.test(`${reason} ${message}`)) {
    return {
      error: 'The Google Drive API is not switched on for your Google Cloud project. In Google Cloud Console, open APIs & Services → Library, find "Google Drive API" and press Enable, then try again.',
      needsApiEnabled: true
    }
  }
  if (status === 403 && /insufficient|scope/i.test(`${reason} ${message}`)) {
    return {
      error: 'NeuroNote has not been given permission to save to Google Drive. Press "Allow Google Drive" in Settings.',
      needsDriveScope: true
    }
  }
  if (status === 404) return { error: 'The handoff folder could not be found in Google Drive.', notFound: true }
  return { error: `Google Drive said: ${String(message).slice(0, 200)}` }
}

async function driveFetch(url, token, options = {}) {
  let res
  try {
    res = await fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) }
    })
  } catch (err) {
    console.error(`${LOG} Network error:`, err)
    return { ok: false, status: 0, failure: { error: 'Google Drive could not be reached. Check your connection and try again.' } }
  }
  const text = await res.text()
  let data = null
  try { data = JSON.parse(text) } catch { data = null }
  if (res.ok) return { ok: true, status: res.status, data }

  console.error(`${LOG} ${options.method || 'GET'} failed — HTTP ${res.status}:`, text.slice(0, 400))
  if (res.status === 401) handleUnauthorized('Drive')
  return { ok: false, status: res.status, failure: describeFailure(res.status, data, text) }
}

/**
 * Find the handoff folder, or create it. With the drive.file scope a search
 * only ever returns folders NeuroNote made, so a match is always ours.
 * @returns {Promise<{success: boolean, id?: string, link?: string, error?: string}>}
 */
export async function ensureHandoffFolder(token, { ignoreCache = false } = {}) {
  if (!ignoreCache) {
    const cached = getCachedFolder()
    if (cached?.id) return { success: true, ...cached }
  }

  const query = `name = '${HANDOFF_FOLDER_NAME}' and mimeType = '${FOLDER_MIME}' and trashed = false`
  const search = await driveFetch(
    `${FILES_ENDPOINT}?q=${encodeURIComponent(query)}&spaces=drive&fields=${encodeURIComponent('files(id,name,webViewLink)')}`,
    token
  )
  if (!search.ok) return { success: false, ...search.failure }

  let folder = search.data?.files?.[0]
  if (folder) {
    console.log(`${LOG} Using existing handoff folder ${folder.id}`)
  } else {
    const created = await driveFetch(`${FILES_ENDPOINT}?fields=${encodeURIComponent('id,name,webViewLink')}`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: HANDOFF_FOLDER_NAME, mimeType: FOLDER_MIME })
    })
    if (!created.ok) return { success: false, ...created.failure }
    folder = created.data
    console.log(`${LOG} Created handoff folder ${folder.id}`)
  }

  const record = { id: folder.id, link: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}` }
  setItem(FOLDER_KEY, record)
  return { success: true, ...record }
}

function multipartBody(boundary, metadata, html) {
  return [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    '',
    html,
    `--${boundary}--`,
    ''
  ].join('\r\n')
}

/**
 * Save one document into the handoff folder as a Google Doc.
 * @param {{name: string, html: string}} doc
 * @returns {Promise<{success: boolean, fileId?: string, link?: string, folderLink?: string, error?: string,
 *   needsReauth?: boolean, needsDriveScope?: boolean, needsApiEnabled?: boolean}>}
 */
export async function saveDocumentToHandoffFolder({ name, html }) {
  const token = await getAccessToken()
  if (!token) return { success: false, error: 'Sign in to Google in Settings first.', needsReauth: true }

  const upload = async (folderId) => {
    const boundary = `neuronote-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    return driveFetch(
      `${UPLOAD_ENDPOINT}?uploadType=multipart&fields=${encodeURIComponent('id,name,webViewLink')}`,
      token,
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        // Declaring the Google Docs type converts the uploaded HTML into a
        // real Doc, which every Drive connector can read and search.
        body: multipartBody(boundary, { name, mimeType: DOC_MIME, parents: [folderId] }, html)
      }
    )
  }

  let folder = await ensureHandoffFolder(token)
  if (!folder.success) return folder

  let result = await upload(folder.id)
  // A cached folder that has since been deleted or moved to the bin answers
  // 404. Look it up again (creating a new one if need be) and try once more.
  if (!result.ok && result.status === 404) {
    console.warn(`${LOG} Cached handoff folder is gone — finding or recreating it`)
    forgetFolder()
    folder = await ensureHandoffFolder(token, { ignoreCache: true })
    if (!folder.success) return folder
    result = await upload(folder.id)
  }
  if (!result.ok) return { success: false, ...result.failure }

  console.log(`${LOG} Saved "${name}" as ${result.data.id}`)
  return {
    success: true,
    fileId: result.data.id,
    link: result.data.webViewLink || `https://docs.google.com/document/d/${result.data.id}/edit`,
    folderLink: folder.link
  }
}
