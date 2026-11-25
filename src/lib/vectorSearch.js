export function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

export function chunkText(text, maxTokens = 500) {
  const sentences = text.match(/[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g) || [text]
  const chunks = []
  let current = ''
  let currentTokens = 0

  for (const sentence of sentences) {
    const sentenceTokens = Math.ceil(sentence.length / 4)
    if (currentTokens + sentenceTokens > maxTokens && current) {
      chunks.push(current.trim())
      current = ''
      currentTokens = 0
    }
    current += sentence
    currentTokens += sentenceTokens
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks.length ? chunks : [text]
}

export async function indexNote(note, generateEmbeddingFn) {
  const content = [
    note.title || '',
    note.transcript || '',
    note.summary?.paragraph || '',
    (note.summary?.bullets || []).join('. ')
  ].filter(Boolean).join('\n\n')

  const chunks = chunkText(content)
  const results = []

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await generateEmbeddingFn(chunks[i])
    results.push({
      noteId: note.id,
      noteTitle: note.title,
      chunkIndex: i,
      text: chunks[i],
      embedding,
      timestamp: Date.now()
    })
  }
  return results
}

export async function searchNotes(query, embeddings, generateEmbeddingFn, topK = 5) {
  if (!embeddings.length) return []
  const queryEmbedding = await generateEmbeddingFn(query)

  // v2.7 — OpenAI and Gemini embeddings have different dimensions (1536 vs
  // 768). If notes were indexed under one provider and the user switches to
  // the other, skip the now-incompatible vectors instead of scoring garbage.
  const usable = embeddings.filter(entry => Array.isArray(entry.embedding) && entry.embedding.length === queryEmbedding.length)
  if (usable.length < embeddings.length) {
    console.log(`[NeuroNote] Skipping ${embeddings.length - usable.length} embedding(s) with a mismatched dimension (indexed under a different AI provider)`)
  }

  const scored = usable.map(entry => ({
    ...entry,
    similarity: cosineSimilarity(queryEmbedding, entry.embedding)
  }))
  scored.sort((a, b) => b.similarity - a.similarity)
  return scored.slice(0, topK)
}

export async function rebuildIndex(notes, generateEmbeddingFn) {
  const allEmbeddings = []
  for (const note of notes) {
    const noteEmbeddings = await indexNote(note, generateEmbeddingFn)
    allEmbeddings.push(...noteEmbeddings)
  }
  return allEmbeddings
}
