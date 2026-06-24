import { useState, useEffect } from 'react'
import { useParams, useSearchParams, Navigate } from 'react-router-dom'
import { usePoll } from '../hooks/usePoll'
import { api } from '../api/client'
import { NominationPhase } from '../components/NominationPhase'
import { VotingPhase } from '../components/VotingPhase'
import { ResultsView } from '../components/ResultsView'
import { AdminControls } from '../components/AdminControls'
import type { Phase } from '../types'

const CATEGORY_LABEL: Record<string, string> = {
  movie: '🎬 Movies',
  book: '📚 Books',
  general: '💬 General',
}

const PHASE_BADGE: Record<Phase, { label: string; classes: string }> = {
  nominating: { label: 'Nominating', classes: 'text-accent bg-accent-muted' },
  voting:     { label: 'Voting',     classes: 'text-warn bg-[oklch(72%_0.17_65_/_0.12)]' },
  closed:     { label: 'Closed',     classes: 'text-success bg-[oklch(68%_0.18_145_/_0.12)]' },
}

export function PollPage() {
  const { id } = useParams<{ id: string }>()
  if (!id) return <Navigate to="/" />

  const [searchParams] = useSearchParams()
  const adminToken = searchParams.get('admin')
  const { poll, error, loading, refetch } = usePoll(id)

  const [participantId, setParticipantId] = useState<string | null>(null)
  const [joinedName, setJoinedName] = useState<string | null>(null)
  const [participantName, setParticipantName] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)
  const hasToken = api.hasToken(id)

  useEffect(() => {
    if (hasToken && id) {
      api.joinPoll(id, '').then(data => {
        setParticipantId(data.participant_id)
        setJoinedName(data.name)
      }).catch(() => null)
    }
  }, [hasToken, id])

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!participantName.trim() || !id) return
    setJoining(true)
    setJoinError(null)
    try {
      const data = await api.joinPoll(id, participantName.trim())
      setParticipantId(data.participant_id)
      setJoinedName(data.name)
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : 'Failed to join')
    } finally {
      setJoining(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-24 text-ink-3 animate-pulse text-sm">
      Loading…
    </div>
  )
  if (error) return (
    <div className="flex items-center justify-center py-24 text-danger text-sm">{error}</div>
  )
  if (!poll) return null

  const needsJoin = !participantId && !hasToken
  const phase = PHASE_BADGE[poll.phase]

  return (
    <div className="max-w-lg mx-auto py-8 px-4 space-y-4">
      {/* Poll header */}
      <div className="card p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="badge text-ink-3 bg-surface border border-line">
                {CATEGORY_LABEL[poll.category]}
              </span>
              <span className={`badge ${phase.classes}`}>
                {phase.label}
              </span>
            </div>
            <h1 className="text-2xl font-extrabold text-ink tracking-tight text-wrap-balance">
              {poll.title}
            </h1>
            <p className="text-ink-3 text-sm mt-1">
              {poll.participant_count} participant{poll.participant_count !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Join form */}
      {needsJoin && (
        <div className="card p-6">
          <p className="font-bold text-ink mb-4">Join this poll</p>
          <form onSubmit={handleJoin} className="space-y-3">
            <input
              className="input"
              value={participantName}
              onChange={e => setParticipantName(e.target.value)}
              placeholder="Your name"
              autoFocus
            />
            {joinError && <p className="text-danger text-sm">{joinError}</p>}
            <button type="submit" disabled={joining} className="btn-primary">
              {joining ? 'Joining…' : 'Join →'}
            </button>
          </form>
        </div>
      )}

      {/* Phase content */}
      {poll.phase === 'nominating' && (
        <NominationPhase
          poll={poll}
          participantId={participantId}
          joinedName={joinedName}
          adminToken={adminToken}
          onRefetch={refetch}
        />
      )}

      {poll.phase === 'voting' && participantId && (
        <VotingPhase poll={poll} onRefetch={refetch} />
      )}

      {poll.phase === 'voting' && !participantId && !needsJoin && (
        <p className="text-ink-3 text-sm text-center py-8">Loading your session…</p>
      )}

      {poll.phase === 'voting' && needsJoin && (
        <p className="text-ink-3 text-sm text-center py-8">Join above to vote.</p>
      )}

      {poll.phase === 'closed' && <ResultsView poll={poll} />}

      {adminToken && poll.phase !== 'closed' && (
        <AdminControls poll={poll} adminToken={adminToken} onRefetch={refetch} />
      )}
    </div>
  )
}
