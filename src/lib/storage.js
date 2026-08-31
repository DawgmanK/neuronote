const PREFIX = 'neuronote:'

export function getItem(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function setItem(key, value) {
  localStorage.setItem(PREFIX + key, JSON.stringify(value))
}

export function removeItem(key) {
  localStorage.removeItem(PREFIX + key)
}

export function getNotes() {
  return getItem('notes') || []
}

export function saveNotes(notes) {
  setItem('notes', notes)
}

export function getSettings() {
  return getItem('settings') || {
    useAssemblyAI: false,
    flagshipMode: false,
    liveActionItems: true
  }
}

export function saveSettings(settings) {
  setItem('settings', settings)
}

export function getApiKey(provider) {
  return getItem(`apikey:${provider}`) || ''
}

export function saveApiKey(provider, key) {
  setItem(`apikey:${provider}`, key)
}

export function clearApiKey(provider) {
  removeItem(`apikey:${provider}`)
}

export function getEmbeddings() {
  return getItem('embeddings') || []
}

export function saveEmbeddings(embeddings) {
  setItem('embeddings', embeddings)
}

export function getUsage() {
  return getItem('usage') || []
}

export function addUsage(amount, model) {
  const usage = getUsage()
  usage.push({ amount, model, timestamp: Date.now() })
  setItem('usage', usage)
}

export function getMonthlyUsage() {
  const usage = getUsage()
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  return usage
    .filter(u => u.timestamp >= startOfMonth)
    .reduce((sum, u) => sum + u.amount, 0)
}

export function clearUsage() {
  setItem('usage', [])
}

export function getRecentDailyUsage(days = 7) {
  const usage = getUsage()
  const now = new Date()
  const result = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const dayEnd = dayStart + 86400000
    const total = usage
      .filter(u => u.timestamp >= dayStart && u.timestamp < dayEnd)
      .reduce((sum, u) => sum + u.amount, 0)
    result.push({ date: d.toLocaleDateString('en-US', { weekday: 'short' }), total })
  }
  return result
}
