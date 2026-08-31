export function extractSummary(text) {
  if (!text || text.length < 20) {
    return {
      summary: { paragraph: text || 'No content to summarize.', bullets: [], actions: [] },
      decisions: [],
      followups: []
    }
  }

  // Split into sentences properly — handle speaker labels and avoid mid-word splits
  // First, join lines that don't end with sentence-ending punctuation
  const normalized = text
    .split('\n')
    .filter(l => l.trim())
    .map(l => l.replace(/^(Speaker \d+|You|[A-Z][a-z]+):\s*/, '').trim())
    .filter(l => l.length > 5)
    .join('. ')

  // Split on sentence boundaries (period/question/exclamation followed by space or end)
  const sentences = normalized.match(/[^.!?]*[.!?]+(?:\s|$)/g) || [normalized]
  const cleanSentences = sentences
    .map(s => s.trim())
    .filter(s => s.length > 15) // Only keep substantial sentences

  // Score by word frequency (TF-based extractive summarization)
  const allWords = normalized.toLowerCase().split(/\s+/)
  const freq = {}
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'it', 'this', 'that', 'and', 'or', 'but', 'not', 'so', 'if', 'then', 'than', 'we', 'i', 'you', 'he', 'she', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their', 'just', 'like', 'yeah', 'okay', 'right', 'well', 'think', 'know', 'going', 'want', 'really', 'actually', 'um', 'uh'])

  allWords.forEach(w => {
    const clean = w.replace(/[^a-z]/g, '')
    if (clean.length > 2 && !stopWords.has(clean)) {
      freq[clean] = (freq[clean] || 0) + 1
    }
  })

  const scored = cleanSentences.map(s => {
    const words = s.toLowerCase().split(/\s+/)
    const score = words.reduce((sum, w) => sum + (freq[w.replace(/[^a-z]/g, '')] || 0), 0) / Math.max(words.length, 1)
    return { text: s, score }
  })

  scored.sort((a, b) => b.score - a.score)
  const topSentences = scored.slice(0, Math.min(6, scored.length))
  const bullets = topSentences.map(s => ensureCompleteSentence(s.text))
  const paragraph = bullets.slice(0, 3).join(' ')

  const actions = extractActions(text)
  const decisions = extractDecisions(text)
  const followups = extractFollowups(text)

  return {
    summary: { paragraph, bullets, actions },
    decisions,
    followups
  }
}

// Ensure text ends at a word boundary and has proper punctuation
function ensureCompleteSentence(text) {
  let s = text.trim()
  // If it doesn't end with punctuation, add a period
  if (!/[.!?]$/.test(s)) {
    // Trim to last complete word
    s = s.replace(/\s+\S{0,3}$/, '')
    s += '.'
  }
  // Capitalize first letter
  s = s.charAt(0).toUpperCase() + s.slice(1)
  return s
}

// Mirrors the suggestedType rules used in the AI prompt.
function guessType(action) {
  if (/\b(meeting|call|sync|demo)\b/i.test(action)) return 'event'
  return 'task'
}

export function extractActions(text) {
  const patterns = [
    /(?:will|shall|going to|need to|needs to|must|should)\s+([^.!?\n]+[.!?]?)/gi,
    /action item[:\s]+([^.!?\n]+[.!?]?)/gi,
    /TODO[:\s]+([^.!?\n]+[.!?]?)/gi,
    /follow up[:\s]+([^.!?\n]+[.!?]?)/gi,
    /(?:assigned to|task for)\s+(\w+)[:\s]+([^.!?\n]+[.!?]?)/gi
  ]

  const actions = []
  const seen = new Set()

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      let action = (match[2] || match[1]).trim()
      // Trim to last complete word if very long
      if (action.length > 100) {
        action = action.slice(0, 100).replace(/\s+\S*$/, '')
      }
      action = ensureCompleteSentence(action)
      const key = action.toLowerCase().slice(0, 40)
      if (!seen.has(key) && action.length > 15) {
        seen.add(key)
        // v2.1 shape — the local engine cannot resolve dates, so they stay null.
        actions.push({
          text: action,
          action, // kept for v2.0 compatibility
          owner: 'Unknown',
          assignee: null,
          dueDate: null,
          dueTime: null,
          suggestedType: guessType(action),
          duration: /\bmeeting\b/i.test(action) ? 60 : 30
        })
      }
    }
  }

  return actions.slice(0, 10)
}

function extractDecisions(text) {
  const patterns = [
    /(?:decided|agreed|decision)[:\s]+([^.!?\n]+[.!?]?)/gi,
    /(?:we'll go with|let's go with|going with)\s+([^.!?\n]+[.!?]?)/gi
  ]
  const decisions = []
  for (const p of patterns) {
    let m
    while ((m = p.exec(text)) !== null) {
      decisions.push(ensureCompleteSentence(m[1].trim()))
    }
  }
  return decisions.slice(0, 5)
}

function extractFollowups(text) {
  const patterns = [
    /(?:follow up|circle back|revisit|check on|look into)\s+([^.!?\n]+[.!?]?)/gi
  ]
  const followups = []
  for (const p of patterns) {
    let m
    while ((m = p.exec(text)) !== null) {
      if (m[1] && m[1].trim().length > 10) {
        followups.push(ensureCompleteSentence(m[1].trim()))
      }
    }
  }
  return followups.slice(0, 5)
}
