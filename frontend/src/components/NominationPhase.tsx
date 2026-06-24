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

  const slotsUsed = myNominations.length
  const slotsTotal = poll.max_nominations
  const canNominate = participantId && slotsUsed < slotsTotal

  return (
    <div className="space-y-3">
      {/* Input card */}
      {participantId && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-ink">Your nominations</span>
            {poll.nomination_closes_at && <Timer closesAt={poll.nomination_closes_at} />}
          </div>

          {/* Slot dots */}
          <div className="flex items-center gap-1.5">
            {Array.from({ length: slotsTotal }).map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full flex-1 transition-all duration-300 ${i < slotsUsed ? 'bg-accent' : 'bg-line'}`}
              />
            ))}
            <span className="text-xs text-ink-3 ml-2 tabular-nums flex-shrink-0">
              {slotsUsed}/{slotsTotal}
            </span>
          </div>

          {canNominate && (
            poll.category === 'general' ? (
              <form onSubmit={handleFreeTextSubmit} className="flex gap-2">
                <input
                  className="input flex-1"
                  value={freeText}
                  onChange={e => setFreeText(e.target.value)}
                  placeholder="Nominate something…"
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-accent hover:bg-accent-hover text-white text-sm font-semibold px-4 rounded-xl transition-colors disabled:opacity-40 flex-shrink-0"
                >
                  Add
                </button>
              </form>
            ) : (
              <SearchInput pollId={poll.id} category={poll.category} onSelect={handleSearchSelect} />
            )
          )}

          {!canNominate && slotsUsed >= slotsTotal && (
            <p className="text-xs text-ink-3 text-center py-1">All {slotsTotal} nominations used.</p>
          )}

          {error && <p className="text-danger text-xs">{error}</p>}
        </div>
      )}

      {/* Timer for non-participants */}
      {!participantId && poll.nomination_closes_at && (
        <div className="flex justify-end">
          <Timer closesAt={poll.nomination_closes_at} />
        </div>
      )}

      {/* Nominations list */}
      {poll.nominations !== null ? (
        <div className="space-y-2">
          {poll.nominations.length === 0 ? (
            <p className="text-ink-3 text-sm text-center py-8">No nominations yet — be the first!</p>
          ) : (
            <>
              <p className="text-xs text-ink-3 font-semibold uppercase tracking-widest px-1">
                {poll.nominations.length} nomination{poll.nominations.length !== 1 ? 's' : ''}
              </p>
              {poll.nominations.map(nom => (
                <NominationCard
                  key={nom.id}
                  nomination={nom}
                  onDelete={adminToken
                    ? () => api.deleteNomination(poll.id, nom.id, adminToken).then(onRefetch)
                    : undefined}
                />
              ))}
            </>
          )}
        </div>
      ) : (
        <p className="text-ink-3 text-sm text-center py-8">Nominations are hidden until voting begins.</p>
      )}
    </div>
  )
}
