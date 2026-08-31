import { useState, useCallback, useEffect } from 'react'
import { getEmbeddings, saveEmbeddings } from '../lib/storage'
import { generateEmbedding } from '../lib/openai'
import { indexNote, searchNotes } from '../lib/vectorSearch'

export default function useEmbeddings() {
  const [embeddings, setEmbeddings] = useState([])
  const [isIndexing, setIsIndexing] = useState(false)
  const [searchResults, setSearchResults] = useState([])

  useEffect(() => {
    setEmbeddings(getEmbeddings())
  }, [])

  const indexNewNote = useCallback(async (note) => {
    setIsIndexing(true)
    try {
      const noteEmbeddings = await indexNote(note, generateEmbedding)
      setEmbeddings(prev => {
        const filtered = prev.filter(e => e.noteId !== note.id)
        const updated = [...filtered, ...noteEmbeddings]
        saveEmbeddings(updated)
        return updated
      })
    } catch (e) {
      console.error('Failed to index note:', e)
    } finally {
      setIsIndexing(false)
    }
  }, [])

  const search = useCallback(async (query) => {
    try {
      const results = await searchNotes(query, embeddings, generateEmbedding)
      setSearchResults(results)
      return results
    } catch (e) {
      console.error('Search failed:', e)
      return []
    }
  }, [embeddings])

  const removeNoteEmbeddings = useCallback((noteId) => {
    setEmbeddings(prev => {
      const updated = prev.filter(e => e.noteId !== noteId)
      saveEmbeddings(updated)
      return updated
    })
  }, [])

  return { embeddings, isIndexing, indexNewNote, search, removeNoteEmbeddings, searchResults }
}
