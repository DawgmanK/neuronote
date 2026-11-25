import { useState, useCallback, useEffect } from 'react'
import { getEmbeddings, saveEmbeddings } from '../lib/storage'
import { generateEmbedding } from '../lib/ai-provider'
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

  /**
   * v2.8.3 — drop the index entries of notes that no longer exist. Run once
   * at launch: deleting a note keeps its entries for the rest of the session
   * so Undo restores it complete, and they are cleared here afterwards.
   */
  const pruneEmbeddings = useCallback((liveNoteIds) => {
    const live = new Set(liveNoteIds)
    setEmbeddings(prev => {
      const kept = prev.filter(e => live.has(e.noteId))
      if (kept.length === prev.length) return prev
      console.log(`[NeuroNote] Pruned ${prev.length - kept.length} index entr${prev.length - kept.length === 1 ? 'y' : 'ies'} for deleted notes`)
      saveEmbeddings(kept)
      return kept
    })
  }, [])

  return { embeddings, isIndexing, indexNewNote, search, removeNoteEmbeddings, pruneEmbeddings, searchResults }
}
