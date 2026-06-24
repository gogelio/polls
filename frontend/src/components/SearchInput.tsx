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
  const [showResults, setShowResults] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim()) { setResults([]); setShowResults(false); return }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const data = category === 'book'
          ? await api.searchBooks(pollId, query)
          : await api.searchMovies(pollId, query)
        setResults(data)
        setShowResults(data.length > 0)
      } finally {
        setLoading(false)
      }
    }, 400)
  }, [query, pollId, category])

  const handleSelect = (result: SearchResult) => {
    onSelect(result)
    setQuery('')
    setResults([])
    setShowResults(false)
  }

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <input
          className="input pr-8"
          value={query}
          onChange={e => { setQuery(e.target.value); setShowResults(true) }}
          placeholder={category === 'book' ? 'Search for a book…' : 'Search for a movie…'}
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 text-xs animate-pulse">
            ···
          </span>
        )}
      </div>

      {showResults && results.length > 0 && (
        <div className="absolute z-50 w-full mt-1.5 bg-raised border border-line rounded-xl shadow-2xl shadow-black/60 overflow-hidden">
          {results.map((r, i) => (
            <button
              key={r.external_id}
              type="button"
              onClick={() => handleSelect(r)}
              className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-hover text-left transition-colors ${i < results.length - 1 ? 'border-b border-line' : ''}`}
            >
              {(r.cover_url || r.poster_url) && (
                <img
                  src={r.cover_url ?? r.poster_url ?? ''}
                  alt=""
                  className="w-8 h-11 object-cover rounded-md flex-shrink-0"
                />
              )}
              <div className="min-w-0">
                <div className="font-semibold text-sm text-ink truncate">{r.title}</div>
                <div className="text-xs text-ink-3">
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
