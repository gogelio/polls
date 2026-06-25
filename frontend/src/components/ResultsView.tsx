import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Poll, PollResults, NominationMetadata } from '../types'
import { api } from '../api/client'

interface ResultsViewProps { poll: Poll }

export function ResultsView({ poll }: ResultsViewProps) {
  const [searchParams] = useSearchParams()
  const adminToken = searchParams.get('admin')
  const publicUrl = `${window.location.origin}${window.location.pathname}`
  const [results, setResults] = useState<PollResults | null>(null)
  const [error, setError] = useState<string | null>(null)

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const fetch = () =>
      api.getResults(poll.id)
        .then(setResults)
        .catch(e => setError(e instanceof Error ? e.message : 'Failed to load results'))

    fetch()

    if (poll.phase !== 'closed') {
      intervalRef.current = setInterval(fetch, 3000)
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [poll.id, poll.phase])

  if (error) return <div className="card p-5 text-center"><p className="text-ink-3 text-sm">{error}</p></div>
  if (!results) return <div className="card p-5 text-center"><p className="text-ink-3 text-sm animate-pulse">Loading results…</p></div>

  const leaders = results.tied
    ? results.results.filter(r => r.score === results.results[0]?.score)
    : results.results.slice(0, 1)

  const leaderLabel = results.tied
    ? 'Tied'
    : poll.phase === 'closed' ? 'Winner' : 'Winning'

  return (
    <div className="space-y-4">
      {/* Winner / Tied */}
      {leaders.length > 0 && (
        <div className="relative overflow-hidden border-2 border-accent rounded-2xl p-5 bg-accent-muted">
          <p className="text-xs font-bold text-accent uppercase tracking-widest mb-3">
            {results.tied ? '⚖️ ' : '🏆 '}{leaderLabel}
          </p>
          <div className="space-y-3">
            {leaders.map(leader => {
              const meta = leader.metadata
                ? (typeof leader.metadata === 'string'
                    ? JSON.parse(leader.metadata) as NominationMetadata
                    : null)
                : null
              const image = meta?.cover_url ?? meta?.poster_url
              return (
                <div key={leader.nomination_id} className="flex items-center gap-3">
                  {image && (
                    <img src={image} alt="" className="w-10 h-14 object-cover rounded-lg flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    {meta?.external_id && (poll.category === 'book' || poll.category === 'movie') ? (
                      <a
                        href={poll.category === 'book'
                          ? `https://books.google.com/books?id=${meta.external_id}`
                          : `https://www.themoviedb.org/movie/${meta.external_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xl font-extrabold text-ink tracking-tight leading-tight text-wrap-balance hover:underline"
                      >
                        {leader.title}
                      </a>
                    ) : (
                      <p className="text-xl font-extrabold text-ink tracking-tight leading-tight text-wrap-balance">
                        {leader.title}
                      </p>
                    )}
                    {meta?.author && <p className="text-ink-2 text-sm mt-0.5">{meta.author}</p>}
                    {meta?.director && <p className="text-ink-2 text-sm mt-0.5">{meta.director}</p>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Standings */}
      <div className="card p-5 space-y-4">
        <p className="text-xs font-bold text-ink-3 uppercase tracking-widest">
          Full standings · {results.total_voters} voter{results.total_voters !== 1 ? 's' : ''} · {poll.voting_method.replace(/_/g, ' ')}
        </p>
        {results.results.map((r, i) => {
          const standingMeta = r.metadata
            ? (JSON.parse(r.metadata) as NominationMetadata)
            : null
          const standingUrl = standingMeta?.external_id && (poll.category === 'book' || poll.category === 'movie')
            ? poll.category === 'book'
              ? `https://books.google.com/books?id=${standingMeta.external_id}`
              : `https://www.themoviedb.org/movie/${standingMeta.external_id}`
            : null
          return (
            <div key={r.nomination_id} className="space-y-1.5">
              <div className="flex items-center gap-3">
                <span className="w-5 text-xs font-bold text-ink-3 tabular-nums text-right flex-shrink-0">{i + 1}</span>
                {standingUrl ? (
                  <a href={standingUrl} target="_blank" rel="noopener noreferrer" className="flex-1 text-sm font-semibold text-ink truncate hover:underline">
                    {r.title}
                  </a>
                ) : (
                  <span className="flex-1 text-sm font-semibold text-ink truncate">{r.title}</span>
                )}
                <span className="text-xs text-ink-3 tabular-nums flex-shrink-0">{r.percentage}%</span>
              </div>
              <div className="ml-8 h-1.5 bg-surface rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-all duration-700"
                  style={{ width: `${r.percentage}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>

      <div className="card p-4 flex gap-4">
        <button
          onClick={() => navigator.clipboard.writeText(publicUrl)}
          className="text-sm text-accent font-semibold hover:underline"
        >
          🔗 Copy public results link
        </button>
        {adminToken && (
          <button
            onClick={() => navigator.clipboard.writeText(`${publicUrl}?admin=${adminToken}`)}
            className="text-sm text-ink-3 font-semibold hover:underline"
          >
            🔒 Copy admin link
          </button>
        )}
      </div>
    </div>
  )
}
