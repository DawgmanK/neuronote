import { getApiKey, addUsage } from './storage.js'
import { EMBEDDING_MODEL, MODEL_COSTS } from './models.js'
import { todayISO } from './actionItems.js'
import { WRITING_STYLE_RULES, ACTION_ITEM_STYLE_RULES, STUDY_MATERIAL_STYLE_RULES } from './prompt-style.js'

// v2.8 — GPT-6 family (was GPT-5.6 in v2.7.1). This is the single place to change a tier's model id.
export const OPENAI_MODELS = {
  terra: 'gpt-6.1-terra',
  luna: 'gpt-6-luna',
  sol: 'gpt-6.2-sol'
}

const OPENAI_BASE = 'https://api.openai.com/v1'

function getKey() {
  const key = getApiKey('openai')
  if (!key) throw new Error('OpenAI API key not configured. Add it in Settings.')
  return key
}

async function chatCompletion(model, messages, maxTokens = 4096) {
  // v2.7.2 — the GPT-5.6 family (and GPT-6 after it) rejects the old token-limit parameter name
  // with a 400 (it wants `max_completion_tokens` instead) and, like OpenAI's
  // earlier reasoning-tier models (o1/o3), does not accept a custom sampling
  // temperature either — only the default is supported, so it's omitted
  // rather than sent as 0.3.
  const requestBody = { model, messages, max_completion_tokens: maxTokens }
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
    console.warn('[NeuroNote] WARNING: Response was truncated (finish_reason=length). Increase max_completion_tokens.')
  }
  // v2.8.2 — a reasoning model can use its whole output budget thinking and
  // return nothing. Say so, instead of handing an empty string to the parser.
  if (!content || !content.trim()) {
    throw new Error(finishReason === 'length'
      ? 'The AI reply was empty: the model ran out of output budget before answering'
      : 'The AI reply was empty')
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
  const today = `${todayISO()} (${new Date().toLocaleDateString('en-US', { weekday: 'long' })})`
  const content = await chatCompletion(model, [
    {
      role: 'system',
      content: `You are a meeting analyst. Given a transcript, produce a structured JSON summary.

Today's date is: ${today}

Return a JSON object with exactly this shape:
{
  "title": "A specific 3-8 word title naming what the meeting was about, e.g. 'Acme renewal pricing review'. No quotation marks, no date, no trailing period.",
  "summary": {
    "paragraph": "An overview in complete, polished prose: what the meeting was about, what was concluded, and what happens next. 2-4 sentences for a short meeting, up to 8 for a long one.",
    "bullets": ["Complete sentence stating key point 1, with the specifics.", "Complete sentence stating key point 2, with the specifics.", "...up to 10 bullet points; more for a longer meeting, none when there is nothing to add beyond the action items"],
    "actions": [{
      "text": "Complete sentence describing the action",
      "owner": "Name of the person responsible, 'Me' for the speaker's own tasks, or 'Unknown'",
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
- Write for someone who missed the meeting. They should finish reading knowing what actually happened, not merely which topics came up.
- Be specific. Keep the names, numbers, amounts, dates and reasons that matter. "Acme asked for a 10% discount on a two-year term" is useful; "Pricing was discussed" is not.
- Say each thing once. An item listed under "actions" must not be repeated under "bullets" or "followups". When a recording is mostly a list of things to do, put them in "actions" and keep "bullets" for context that is not a task, even if that leaves "bullets" empty.
- Scale the detail to the length of the transcript. A long meeting deserves a fuller overview and more key points; a one-minute recording needs only a sentence or two and may have a single bullet. Never pad.
- The transcript comes from speech recognition and may contain misheard words, missing punctuation, or wrongly split speakers. Work out the intended meaning from context and do not repeat obvious recognition errors.
- Speakers may be labelled "Speaker A", "Speaker 1" or "You". When someone's real name is clear from the conversation, use the name instead of the label.
- If the transcript is too short or too garbled to summarize, say so plainly in "paragraph" and return empty arrays rather than inventing content.
- Every string except "title" must be a complete, well-formed sentence — never a fragment or truncated text.
- "bullets" should be high-level SYNTHESIZED takeaways, NOT raw transcript excerpts. Rephrase in your own words.
- "actions" are ONLY concrete commitments, assignments, or tasks that someone explicitly agreed to do (e.g., "I will send the report by Friday"). Do NOT include rhetorical statements, opinions, wishes, or general commentary. If no real action items exist, return an empty array [].
- "decisions" are only explicit choices that were made. If none, return [].
- "followups" are only open questions and unresolved points that nobody has taken on. Anything with an owner belongs in "actions" instead. If none, return [].
- Write in professional, clear language. SYNTHESIZE the content — do not copy/paste transcript text.
- Return ONLY the JSON object. No markdown fences, no explanation, no commentary outside the JSON.

Action item field rules:
- "text": a complete, well-formed sentence describing the action.
- "owner": the name of the person responsible. When the speaker takes something on themselves ("I'll send it", "I need to call her"), use "Me", or their name if it is clear from the conversation. Use "Unknown" only when a task is assigned to nobody identifiable.
- "dueDate": resolve relative dates against today's date (${today}). "tomorrow" is the next calendar day, "Friday" is the next upcoming Friday, "end of month" is the last day of the current month, "next week" is 7 days from today. If no date is mentioned at all, use null.
- "dueTime": a 24-hour "HH:MM" time when a specific time is stated, otherwise null.
- "suggestedType": use "event" when the item mentions a meeting, call, sync, demo, or a scheduled time. Use "task" when the item is to send, email, follow up, prepare, review, or check with someone. When neither clearly applies, default to "task".
- "duration": event length in minutes. Default to 30, but use 60 when the word "meeting" appears in the item.

${WRITING_STYLE_RULES}

${ACTION_ITEM_STYLE_RULES}`
    },
    { role: 'user', content: `Summarize this meeting transcript:\n\n${transcript}` }
  ], 16000)
  const parsed = parseJSON(content)
  console.log('[NeuroNote] Parsed summary:', JSON.stringify(parsed, null, 2).slice(0, 1000))
  return parsed
}

export async function generateFlashcards(transcript) {
  const content = await chatCompletion(OPENAI_MODELS.luna, [
    {
      role: 'system',
      content: `Given a meeting transcript, return a JSON object with two keys: flashcards (array of {question, answer} pairs covering key concepts), quiz (array of {question, answer, explanation} for self-testing). Return ONLY valid JSON, no markdown fences.

${STUDY_MATERIAL_STYLE_RULES}

${WRITING_STYLE_RULES}`
    },
    { role: 'user', content: transcript }
  ])
  return parseJSON(content)
}

export async function detectActionItems(partialTranscript) {
  const content = await chatCompletion(OPENAI_MODELS.luna, [
    {
      role: 'system',
      content: `Analyze this partial meeting transcript. Return ONLY a JSON array of NEW action items detected (commitments, promises, decisions with owners and due dates if mentioned). Format: [{action, owner, due}]. Return empty array if nothing new. Return ONLY valid JSON.

${WRITING_STYLE_RULES}

${ACTION_ITEM_STYLE_RULES}`
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
      content: `You are NeuroNote, an AI assistant with access to the user's meeting notes. Answer questions based on the provided context from their notes. Cite which notes your answer comes from using [Note X] references. Be concise and helpful.

${WRITING_STYLE_RULES}`
    },
    { role: 'user', content: `Context from meeting notes:\n\n${context}` },
    ...conversationHistory,
    { role: 'user', content: question }
  ]
  return await chatCompletion(OPENAI_MODELS.terra, messages)
}

export async function gradeAnswer(question, correctAnswer, userAnswer) {
  const content = await chatCompletion(OPENAI_MODELS.luna, [
    {
      role: 'system',
      content: `Grade this answer. Reply with JSON: {correct: boolean, feedback: string}

${WRITING_STYLE_RULES}`
    },
    {
      role: 'user',
      content: `Question: ${question}\nCorrect answer: ${correctAnswer}\nStudent answer: ${userAnswer}`
    }
  ], 256)
  return parseJSON(content)
}
