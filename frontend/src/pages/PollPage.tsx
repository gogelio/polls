import { useState, useEffect } from 'react'
import { useParams, useSearchParams, Navigate, useNavigate } from 'react-router-dom'
import { usePoll } from '../hooks/usePoll'
import { api } from '../api/client'
import { NominationPhase } from '../components/NominationPhase'
import { VotingPhase } from '../components/VotingPhase'
import { ResultsView } from '../components/ResultsView'
import { AdminControls } from '../components/AdminControls'
import { NominationCard } from '../components/NominationCard'
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
  const navigate = useNavigate()
  const adminToken = searchParams.get('admin')
  const { poll, error, loading, refetch } = usePoll(id)

  const [participantId, setParticipantId] = useState<string | null>(null)
  const [joinedName, setJoinedName] = useState<string | null>(null)
  const [participantName, setParticipantName] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [welcomeBack, setWelcomeBack] = useState(false)
  // api.hasToken() reads localStorage live, so it flips true the instant
  // handleJoin's api.joinPoll() stores a token — before refetch() has
  // actually fetched the token-scoped (shuffled) poll data. Both needsJoin
  // and the returning-user auto-rejoin effect below must not react to that
  // live flip (the effect reacting to it would fire a second, uncoordinated
  // joinPoll() call the moment our OWN fresh join stores a token, racing
  // ahead of handleJoin's own refetch-then-setParticipantId ordering). Both
  // read this snapshot, taken once at mount, instead of the live value.
  const [hasTokenAtLoad] = useState(() => api.hasToken(id))

  useEffect(() => {
    if (hasTokenAtLoad && id) {
      api.joinPoll(id, '').then(data => {
        setParticipantId(data.participant_id)
        setJoinedName(data.name)
      }).catch(() => null)
    }
  }, [hasTokenAtLoad, id])

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!participantName.trim() || !id) return
    setJoining(true)
    setJoinError(null)
    try {
      const data = await api.joinPoll(id, participantName.trim())
      if (data.rejoined) setWelcomeBack(true)
      await refetch()
      setParticipantId(data.participant_id)
      setJoinedName(data.name)
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : 'Failed to join')
    } finally {
      setJoining(false)
    }
  }

  useEffect(() => {
    if (poll) document.title = `${poll.title} - Polls`
    return () => { document.title = 'Polls' }
  }, [poll?.title])

  useEffect(() => {
    if (!welcomeBack) return
    const t = setTimeout(() => setWelcomeBack(false), 4000)
    return () => clearTimeout(t)
  }, [welcomeBack])

  if (loading) return (
    <div className="flex items-center justify-center py-24 text-ink-3 animate-pulse text-sm">
      Loading…
    </div>
  )
  if (error && !poll) return (
    <div className="flex items-center justify-center py-24 text-danger text-sm">{error}</div>
  )
  if (!poll) return null

  const needsJoin = !participantId && !hasTokenAtLoad
  const phase = PHASE_BADGE[poll.phase]

  const pollHeader = (
    <div className="card p-6">
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
  )

  const rightPanel = poll.phase === 'voting' && poll.votes_visible ? (
    <ResultsView poll={poll} />
  ) : (
    <div className="card p-5 space-y-3">
      <p className="text-xs font-bold text-ink-3 uppercase tracking-widest">
        {poll.phase === 'voting' ? 'What you\'re voting on' : 'Nominations so far'}
      </p>
      {poll.nominations === null ? (
        <p className="text-ink-3 text-sm">Nominations are hidden until voting begins.</p>
      ) : poll.nominations.length === 0 ? (
        <p className="text-ink-3 text-sm">No nominations yet.</p>
      ) : (
        <div className="space-y-2">
          {poll.nominations.map(nom => (
            <NominationCard key={nom.id} nomination={nom} category={poll.category} />
          ))}
        </div>
      )}
    </div>
  )

  if (poll.phase === 'closed') {
    return (
      <div className="max-w-lg mx-auto py-8 px-4 space-y-4">
        {pollHeader}
        <ResultsView poll={poll} />
        {adminToken && <AdminControls poll={poll} adminToken={adminToken} onRefetch={refetch} onDeleted={() => navigate('/')} />}
      </div>
    )
  }

  if (needsJoin) {
    return (
      <div className="max-w-3xl mx-auto py-8 px-4 space-y-4">
        {pollHeader}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
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
          {rightPanel}
        </div>
        {adminToken && <AdminControls poll={poll} adminToken={adminToken} onRefetch={refetch} onDeleted={() => navigate('/')} />}
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto py-8 px-4 space-y-4">
      {pollHeader}

      {welcomeBack && (
        <div className="card px-5 py-3 text-sm text-success bg-[oklch(68%_0.18_145_/_0.08)] border border-[oklch(68%_0.18_145_/_0.2)]">
          Welcome back, {joinedName}!
        </div>
      )}

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
        <VotingPhase poll={poll} onRefetch={refetch} adminToken={adminToken} />
      )}

      {poll.phase === 'voting' && !participantId && (
        <p className="text-ink-3 text-sm text-center py-8">Loading your session…</p>
      )}

      {adminToken && (
        <AdminControls poll={poll} adminToken={adminToken} onRefetch={refetch} onDeleted={() => navigate('/')} />
      )}
    </div>
  )
}
