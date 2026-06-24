import { useState, useEffect } from 'react'
import type { Poll, PollResults, NominationMetadata } from '../types'
import { api } from '../api/client'

interface ResultsViewProps { poll: Poll }

export function ResultsView({ poll }: ResultsViewProps) {
  const [results, setResults] = useState<PollResults | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getResults(poll.id)
      .then(setResults)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load results'))
  }, [poll.id])

  if (error) return <p className="text-center text-gray-400 py-8">{error}</p>
  if (!results) return <p className="text-center text-gray-400 py-8">Loading results…</p>

  const winner = results.results[0]
  const winnerMeta = winner?.metadata
    ? (typeof winner.metadata === 'string'
        ? JSON.parse(winner.metadata) as NominationMetadata
        : null)
    : null

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-gray-500 mb-1">Winner · {poll.voting_method.replace(/_/g, ' ')}</p>
        <div className="flex items-center gap-4 p-4 border-2 border-indigo-500 rounded-xl bg-indigo-50">
          {(winnerMeta?.cover_url ?? winnerMeta?.poster_url) && (
            <img src={winnerMeta?.cover_url ?? winnerMeta?.poster_url ?? ''} alt=""
              className="w-14 h-20 object-cover rounded" />
          )}
          <div>
            <div className="text-2xl font-bold">{winner?.title}</div>
            {winnerMeta?.author && <div className="text-gray-500">{winnerMeta.author}</div>}
            {winnerMeta?.director && <div className="text-gray-500">{winnerMeta.director}</div>}
          </div>
        </div>
      </div>

      <div>
        <p className="text-sm font-medium text-gray-500 mb-3">
          Full standings · {results.total_voters} voter{results.total_voters !== 1 ? 's' : ''}
        </p>
        <div className="space-y-3">
          {results.results.map((r, i) => (
            <div key={r.nomination_id} className="flex items-center gap-3">
              <span className="w-5 text-sm font-bold text-gray-400">{i + 1}</span>
              <span className="flex-1 text-sm">{r.title}</span>
              <span className="text-xs text-gray-400 w-8 text-right">{r.percentage}%</span>
              <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${r.percentage}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={() => navigator.clipboard.writeText(window.location.href)}
        className="text-sm text-indigo-600 underline">
        🔗 Copy results link
      </button>
    </div>
  )
}
