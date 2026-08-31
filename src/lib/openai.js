import { getApiKey, addUsage } from './storage.js'
import { MODEL_TERRA, MODEL_LUNA, EMBEDDING_MODEL, MODEL_COSTS } from './models.js'

const OPENAI_BASE = 'https://api.openai.com/v1'

function getKey() {
  const key = getApiKey('openai')
  if (!key) throw new Error('OpenAI API key not configured. Add it in System settings.')
  return key
}

async function chatCompletion(model, messages, maxTokens = 4096) {
  const requestBody = { model, messages, max_tokens: maxTokens, temperature: 0.3 }
  console.log('[NeuroNote] API request:', { model, maxTokens, messageCount: messages.length, systemPrompt: messages[0]?.content?.slice(0, 100) })
  console.log('[NeuroNote] User content length:', messages[messages.length - 1]?.content?.length || 0, 'chars')

  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getKey()}`
    },
    body: JSON.stringify(requestBody)
  })
  if (!res.ok) {
    const err = await res.text()
    console.error('[NeuroNote] API error:', res.status, err)
    throw new Error(`OpenAI API error (${res.status}): ${err}`)
  }
  const data = await res.json()
  const content = data.choices[0].message.content
  const finishReason = data.choices[0].finish_reason
  console.log('[NeuroNote] API response:', { model, finishReason, tokens: data.usage, responseLength: content?.length })
  console.log('[NeuroNote] Raw response (first 500 chars):', content?.slice(0, 500))

  if (finishReason === 'length') {
    console.warn('[NeuroNote] WARNING: Response was truncated (finish_reason=length). Increase max_tokens.')
  }

  const cost = (MODEL_COSTS[model] || 0.003) * ((data.usage?.total_tokens || 1000) / 1000)
  addUsage(cost, model)
  return content
}

function parseJSON(text) {
  // Strip markdown code fences if present
  let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
  // Try to extract JSON object or array if surrounded by other text
  const jsonMatch = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
  if (jsonMatch) {
    cleaned = jsonMatch[1]
  }
  try {
    return JSON.parse(cleaned)
  } catch (e) {
    console.error('[NeuroNote] JSON parse failed. Raw text:', text)
    console.error('[NeuroNote] Cleaned text:', cleaned)
    throw new Error(`Failed to parse AI response as JSON: ${e.message}`)
  }
}

export async function generateSummary(transcript, model) {
  const today = new Date().toISOString().split('T')[0]
  const content = await chatCompletion(model, [
    {
      role: 'system',
      content: `You are a meeting analyst. Given a transcript, produce a structured JSON summary.

Today's date is: ${today}

Return a JSON object with exactly this shape:
{
  "summary": {
    "paragraph": "A 2-4 sentence overview of the entire meeting in complete, polished prose.",
    "bullets": ["Complete sentence summarizing key point 1.", "Complete sentence summarizing key point 2.", "...3-7 bullet points total"],
    "actions": [{
      "text": "Complete sentence describing the action",
      "owner": "Name of person responsible, or 'Unknown'",
      "dueDate": "YYYY-MM-DD or null",
      "dueTime": "HH:MM in 24hr, or null",
      "suggestedType": "event or task",
      "duration": 30
    }]
  },
  "decisions": ["Complete sentence describing decision 1."],
  "followups": ["Complete sentence describing open question or next step."]
}

Rules:
- Every string must be a complete, well-formed sentence — never a fragment or truncated text.
- "bullets" should be high-level SYNTHESIZED takeaways, NOT raw transcript excerpts. Rephrase in your own words.
- "actions" are ONLY concrete commitments, assignments, or tasks that someone explicitly agreed to do (e.g., "I will send the report by Friday"). Do NOT include rhetorical statements, opinions, wishes, or general commentary. If no real action items exist, return an empty array [].
- "decisions" are only explicit choices that were made. If none, return [].
- "followups" are only open questions or clearly stated next steps. If none, return [].
- Write in professional, clear language. SYNTHESIZE the content — do not copy/paste transcript text.
- Return ONLY the JSON object. No markdown fences, no explanation, no commentary outside the JSON.

Action item field rules:
- "text": a complete, well-formed sentence describing the action.
- "owner": the name of the person responsible. Use "Unknown" when nobody is clearly named.
- "dueDate": resolve relative dates against today's date (${today}). "tomorrow" is the next calendar day, "Friday" is the next upcoming Friday, "end of month" is the last day of the current month, "next week" is 7 days from today. If no date is mentioned at all, use null.
- "dueTime": a 24-hour "HH:MM" time when a specific time is stated, otherwise null.
- "suggestedType": use "event" when the item mentions a meeting, call, sync, demo, or a scheduled time. Use "task" when the item is to send, email, follow up, prepare, review, or check with someone. When neither clearly applies, default to "task".
- "duration": event length in minutes. Default to 30, but use 60 when the word "meeting" appears in the item.`
    },
    { role: 'user', content: `Summarize this meeting transcript:\n\n${transcript}` }
  ], 4096)
  const parsed = parseJSON(content)
  console.log('[NeuroNote] Parsed summary:', JSON.stringify(parsed, null, 2).slice(0, 1000))
  return parsed
}

export async function generateFlashcards(transcript) {
  const content = await chatCompletion(MODEL_LUNA, [
    {
      role: 'system',
      content: 'Given a meeting transcript, return a JSON object with two keys: flashcards (array of {question, answer} pairs covering key concepts), quiz (array of {question, answer, explanation} for self-testing). Return ONLY valid JSON, no markdown fences.'
    },
    { role: 'user', content: transcript }
  ])
  return parseJSON(content)
}

export async function detectActionItems(partialTranscript) {
  const content = await chatCompletion(MODEL_LUNA, [
    {
      role: 'system',
      content: 'Analyze this partial meeting transcript. Return ONLY a JSON array of NEW action items detected (commitments, promises, decisions with owners and due dates if mentioned). Format: [{action, owner, due}]. Return empty array if nothing new. Return ONLY valid JSON.'
    },
    { role: 'user', content: partialTranscript }
  ], 1024)
  return parseJSON(content)
}

export async function extractImageText(base64Image, model) {
  const content = await chatCompletion(model, [
    {
      role: 'system',
      content: 'Extract all text visible in this image. If it\'s a whiteboard, slide, or document, transcribe the content faithfully. If diagrams are present, describe them briefly. Return plain text, no markdown.'
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Extract text from this image:' },
        { type: 'image_url', image_url: { url: base64Image.startsWith('data:') ? base64Image : `data:image/jpeg;base64,${base64Image}` } }
      ]
    }
  ])
  return content
}

export async function generateEmbedding(text) {
  const res = await fetch(`${OPENAI_BASE}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getKey()}`
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text })
  })
  if (!res.ok) throw new Error(`Embedding API error: ${res.status}`)
  const data = await res.json()
  addUsage(0.00002, EMBEDDING_MODEL)
  return data.data[0].embedding
}

export async function generateAnswer(question, contextChunks, conversationHistory = []) {
  const context = contextChunks.map((c, i) => `[Note ${i + 1}: ${c.noteTitle || 'Untitled'}]\n${c.text}`).join('\n\n---\n\n')
  const messages = [
    {
      role: 'system',
      content: 'You are NeuroNote, an AI assistant with access to the user\'s meeting notes. Answer questions based on the provided context from their notes. Cite which notes your answer comes from using [Note X] references. Be concise and helpful.'
    },
    { role: 'user', content: `Context from meeting notes:\n\n${context}` },
    ...conversationHistory,
    { role: 'user', content: question }
  ]
  return await chatCompletion(MODEL_TERRA, messages)
}

export async function gradeAnswer(question, correctAnswer, userAnswer) {
  const content = await chatCompletion(MODEL_LUNA, [
    {
      role: 'system',
      content: 'Grade this answer. Reply with JSON: {correct: boolean, feedback: string}'
    },
    {
      role: 'user',
      content: `Question: ${question}\nCorrect answer: ${correctAnswer}\nStudent answer: ${userAnswer}`
    }
  ], 256)
  return parseJSON(content)
}
