import { useState, useEffect, useRef } from 'react'
import { api } from '../api/client'
import type { SearchResult, Category } from '../types'

interface SearchInputProps {
  pollId: string
  category: Extract<Category, 'book' | 'movie'>
  onSelect: (result: SearchResult) => void
}

export function SearchInput({ pollId, category, onSelect }: SearchInputProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim()) { setResults([]); return }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const data = category === 'book'
          ? await api.searchBooks(pollId, query)
          : await api.searchMovies(pollId, query)
        setResults(data)
      } finally {
        setLoading(false)
      }
    }, 400)
  }, [query, pollId, category])

  const handleSelect = (result: SearchResult) => {
    onSelect(result)
    setQuery('')
    setResults([])
  }

  return (
    <div className="relative">
      <input
        className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        value={query} onChange={e => setQuery(e.target.value)}
        placeholder={category === 'book' ? 'Search for a book…' : 'Search for a movie…'} />
      {loading && <p className="text-xs text-gray-400 mt-1">Searching…</p>}
      {results.length > 0 && (
        <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg overflow-hidden">
          {results.map(r => (
            <button key={r.external_id} type="button"
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-50 text-left"
              onClick={() => handleSelect(r)}>
              {(r.cover_url || r.poster_url) && (
                <img src={r.cover_url ?? r.poster_url ?? ''} alt="" className="w-8 h-11 object-cover rounded" />
              )}
              <div>
                <div className="font-medium text-sm">{r.title}</div>
                <div className="text-xs text-gray-500">
                  {r.author ?? r.director ?? ''}{r.year ? ` · ${r.year}` : ''}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
