import { useState } from 'react'
import type { Poll, SearchResult } from '../types'
import { api } from '../api/client'
import { Timer } from './Timer'
import { SearchInput } from './SearchInput'
import { NominationCard } from './NominationCard'

interface NominationPhaseProps {
  poll: Poll
  participantId: string | null
  joinedName: string | null
  adminToken: string | null
  onRefetch: () => void
}

export function NominationPhase({ poll, participantId, joinedName, adminToken, onRefetch }: NominationPhaseProps) {
  const [freeText, setFreeText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submitNomination = async (title: string, metadata: unknown) => {
    setSubmitting(true)
    setError(null)
    try {
      await api.nominate(poll.id, title, metadata)
      await onRefetch()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to nominate')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSearchSelect = (result: SearchResult) => {
    submitNomination(result.title, {
      external_id: result.external_id,
      cover_url: result.cover_url,
      poster_url: result.poster_url,
      author: result.author,
      director: result.director,
      year: result.year,
    })
  }

  const handleFreeTextSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!freeText.trim()) return
    submitNomination(freeText.trim(), null)
    setFreeText('')
  }

  const myNominations = joinedName
    ? (poll.nominations ?? []).filter(n => n.participant_name === joinedName)
    : []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Nominations</h2>
        {poll.nomination_closes_at && <Timer closesAt={poll.nomination_closes_at} />}
      </div>

      {participantId && (
        <div>
          <p className="text-sm text-gray-500 mb-2">
            {myNominations.length} of {poll.max_nominations} nominations used
          </p>
          {poll.category === 'general' ? (
            <form onSubmit={handleFreeTextSubmit} className="flex gap-2">
              <input className="flex-1 border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={freeText} onChange={e => setFreeText(e.target.value)} placeholder="Nominate something…" />
              <button type="submit" disabled={submitting}
                className="bg-indigo-600 text-white px-4 py-2 rounded-lg disabled:opacity-50">
                Add
              </button>
            </form>
          ) : (
            <SearchInput pollId={poll.id} category={poll.category} onSelect={handleSearchSelect} />
          )}
          {error && <p className="text-red-600 text-sm mt-1">{error}</p>}
        </div>
      )}

      {poll.nominations !== null && (
        <div className="space-y-2">
          {poll.nominations.length === 0 && (
            <p className="text-gray-400 text-sm">No nominations yet.</p>
          )}
          {poll.nominations.map(nom => (
            <NominationCard key={nom.id} nomination={nom}
              onDelete={adminToken ? () => api.deleteNomination(poll.id, nom.id, adminToken).then(onRefetch) : undefined} />
          ))}
        </div>
      )}

      {poll.nominations === null && (
        <p className="text-gray-400 text-sm">Nominations are hidden until voting begins.</p>
      )}
    </div>
  )
}
