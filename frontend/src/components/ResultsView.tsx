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

  if (error) return <p className="text-ink-3 text-sm text-center py-10">{error}</p>
  if (!results) return <p className="text-ink-3 text-sm text-center py-10 animate-pulse">Loading results…</p>

  const winner = results.results[0]
  const winnerMeta = winner?.metadata
    ? (typeof winner.metadata === 'string'
        ? JSON.parse(winner.metadata) as NominationMetadata
        : null)
    : null
  const winnerImage = winnerMeta?.cover_url ?? winnerMeta?.poster_url

  return (
    <div className="space-y-4">
      {/* Winner */}
      {winner && (
        <div className="relative overflow-hidden border-2 border-accent rounded-2xl p-5 bg-accent-muted">
          <div className="flex items-center gap-4">
            <span className="text-4xl flex-shrink-0">🏆</span>
            {winnerImage && (
              <img src={winnerImage} alt="" className="w-14 h-20 object-cover rounded-xl flex-shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-xs font-bold text-accent uppercase tracking-widest mb-1">{poll.phase === 'closed' ? 'Winner' : 'Winning'}</p>
              <p className="text-2xl font-extrabold text-ink tracking-tight leading-tight text-wrap-balance">
                {winner.title}
              </p>
              {winnerMeta?.author && <p className="text-ink-2 text-sm mt-0.5">{winnerMeta.author}</p>}
              {winnerMeta?.director && <p className="text-ink-2 text-sm mt-0.5">{winnerMeta.director}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Standings */}
      <div className="card p-5 space-y-4">
        <p className="text-xs font-bold text-ink-3 uppercase tracking-widest">
          Full standings · {results.total_voters} voter{results.total_voters !== 1 ? 's' : ''} · {poll.voting_method.replace(/_/g, ' ')}
        </p>
        {results.results.map((r, i) => (
          <div key={r.nomination_id} className="space-y-1.5">
            <div className="flex items-center gap-3">
              <span className="w-5 text-xs font-bold text-ink-3 tabular-nums text-right flex-shrink-0">{i + 1}</span>
              <span className="flex-1 text-sm font-semibold text-ink truncate">{r.title}</span>
              <span className="text-xs text-ink-3 tabular-nums flex-shrink-0">{r.percentage}%</span>
            </div>
            <div className="ml-8 h-1.5 bg-surface rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-700"
                style={{ width: `${r.percentage}%` }}
              />
            </div>
          </div>
        ))}
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
