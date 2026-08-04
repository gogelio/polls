import { useState, useEffect, useRef } from 'react'
import { api } from '../api/client'
import type { SearchResult } from '../types'

interface NominationMatchEditorProps {
  pollId: string
  nominationId: string
  adminToken: string
  onUpdated: () => void
}

export function NominationMatchEditor({ pollId, nominationId, adminToken, onUpdated }: NominationMatchEditorProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim()) { setResults([]); return }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        setResults(await api.searchMoviesAsAdmin(pollId, adminToken, query))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Search failed')
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, pollId, adminToken])

  const handleSelect = async (result: SearchResult) => {
    setSaving(true)
    setError(null)
    try {
      await api.updateNomination(pollId, nominationId, adminToken, {
        title: result.title,
        metadata: {
          external_id: result.external_id,
          poster_url: result.poster_url,
          director: result.director,
          year: result.year,
        },
      })
      setOpen(false)
      setQuery('')
      setResults([])
      onUpdated()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(true) }}
        className="text-xs text-ink-3 hover:text-accent transition-colors"
      >
        ✎ Fix match
      </button>
    )
  }

  return (
    <div className="relative space-y-1" onClick={e => e.stopPropagation()}>
      <input
        className="input text-xs py-1"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search for the correct movie…"
        autoFocus
      />
      {loading && <p className="text-xs text-ink-3">Searching…</p>}
      {error && <p className="text-danger text-xs">{error}</p>}
      {results.length > 0 && (
        <div className="absolute z-50 w-full bg-raised border border-line rounded-xl shadow-2xl shadow-black/60 overflow-hidden">
          {results.map((r, i) => (
            <button
              key={r.external_id}
              type="button"
              disabled={saving}
              onClick={() => handleSelect(r)}
              className={`w-full flex items-center gap-2 px-3 py-2 hover:bg-hover text-left transition-colors disabled:opacity-40 ${i < results.length - 1 ? 'border-b border-line' : ''}`}
            >
              {r.poster_url && (
                <img src={r.poster_url} alt="" className="w-6 h-9 object-cover rounded flex-shrink-0" />
              )}
              <div className="min-w-0">
                <div className="text-xs font-semibold text-ink truncate">{r.title}</div>
                {r.year && <div className="text-xs text-ink-3">{r.year}</div>}
              </div>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => { setOpen(false); setQuery(''); setResults([]) }}
        className="text-xs text-ink-3 hover:text-ink"
      >
        Cancel
      </button>
    </div>
  )
}
