import { useState, useEffect } from 'react'
import { useParams, useSearchParams, Navigate } from 'react-router-dom'
import { usePoll } from '../hooks/usePoll'
import { api } from '../api/client'
import { NominationPhase } from '../components/NominationPhase'
import { VotingPhase } from '../components/VotingPhase'
import { ResultsView } from '../components/ResultsView'
import { AdminControls } from '../components/AdminControls'

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

  if (loading) return <div className="text-center py-20 text-gray-400">Loading…</div>
  if (error) return <div className="text-center py-20 text-red-500">{error}</div>
  if (!poll) return null

  const needsJoin = !participantId && !hasToken

  return (
    <div className="max-w-lg mx-auto py-8 px-4">
      <div className="mb-6">
        <div className="text-xs font-medium text-indigo-500 uppercase tracking-wide mb-1">
          {poll.category === 'book' ? '📚 Book Club' : poll.category === 'movie' ? '🎬 Movies' : '💬 General'}
        </div>
        <h1 className="text-2xl font-bold">{poll.title}</h1>
        <p className="text-sm text-gray-400 mt-1">{poll.participant_count} participant{poll.participant_count !== 1 ? 's' : ''}</p>
      </div>

      {needsJoin && (
        <form onSubmit={handleJoin} className="mb-6 p-4 bg-gray-50 rounded-xl space-y-3">
          <p className="font-medium text-sm">Enter your name to participate</p>
          <input className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={participantName} onChange={e => setParticipantName(e.target.value)} placeholder="Your name" />
          {joinError && <p className="text-red-600 text-sm">{joinError}</p>}
          <button type="submit" disabled={joining}
            className="w-full bg-indigo-600 text-white py-2 rounded-lg disabled:opacity-50">
            {joining ? 'Joining…' : 'Join Poll'}
          </button>
        </form>
      )}

      {poll.phase === 'nominating' && (
        <NominationPhase poll={poll} participantId={participantId} joinedName={joinedName} adminToken={adminToken} onRefetch={refetch} />
      )}
      {poll.phase === 'voting' && participantId && <VotingPhase poll={poll} onRefetch={refetch} />}
      {poll.phase === 'voting' && !participantId && !needsJoin && (
        <p className="text-gray-400 text-center py-8">Loading your session…</p>
      )}
      {poll.phase === 'voting' && needsJoin && (
        <p className="text-gray-400 text-center py-8">Join to vote.</p>
      )}
      {poll.phase === 'closed' && <ResultsView poll={poll} />}

      {adminToken && poll.phase !== 'closed' && (
        <AdminControls poll={poll} adminToken={adminToken} onRefetch={refetch} />
      )}
    </div>
  )
}
