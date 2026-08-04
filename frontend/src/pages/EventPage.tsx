import { useState, useEffect } from 'react'
import { useParams, useSearchParams, Navigate, useNavigate } from 'react-router-dom'
import { useEvent } from '../hooks/useEvent'
import { api } from '../api/client'
import { VotingPhase } from '../components/VotingPhase'
import { ResultsView } from '../components/ResultsView'
import { EventAdminControls } from '../components/EventAdminControls'
import { Bracket } from '../components/Bracket'
import type { Poll } from '../types'

function CategorySection({ poll, onRefetch, adminToken }: { poll: Poll; onRefetch: () => void; adminToken: string | null }) {
  return (
    <details className="card p-0 overflow-hidden" open>
      <summary className="cursor-pointer select-none px-5 py-4 font-bold text-ink flex items-center justify-between">
        <span>{poll.title}</span>
        {poll.has_voted && <span className="text-success text-xs font-bold">✓ Voted</span>}
      </summary>
      <div className="px-5 pb-5">
        {poll.phase === 'closed' ? (
          <ResultsView poll={poll} hideLinks />
        ) : (
          <VotingPhase poll={poll} onRefetch={onRefetch} hideResultsLinks adminToken={adminToken} />
        )}
      </div>
    </details>
  )
}

export function EventPage() {
  const { slug } = useParams<{ slug: string }>()
  if (!slug) return <Navigate to="/" />

  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const adminToken = searchParams.get('admin')
  const { event, error, loading, refetch } = useEvent(slug)

  const [joinedName, setJoinedName] = useState<string | null>(null)
  const [participantName, setParticipantName] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [welcomeBack, setWelcomeBack] = useState(false)

  useEffect(() => {
    if (event) document.title = `${event.title} - Polls`
    return () => { document.title = 'Polls' }
  }, [event?.title])

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
  if (error && !event) return (
    <div className="flex items-center justify-center py-24 text-danger text-sm">{error}</div>
  )
  if (!event) return null

  const needsJoin = event.categories.some(cat => !api.hasToken(cat.poll.id))
  const votedCount = event.categories.filter(cat => cat.poll.has_voted).length

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!participantName.trim()) return
    setJoining(true)
    setJoinError(null)
    try {
      const data = await api.joinEvent(slug, participantName.trim())
      setJoinedName(data.name)
      if (data.rejoined) setWelcomeBack(true)
      await refetch()
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : 'Failed to join')
    } finally {
      setJoining(false)
    }
  }

  const header = (
    <div className="card p-6">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="badge text-ink-3 bg-surface border border-line">🎬 Event</span>
        <span className={`badge ${event.phase === 'closed' ? 'text-success bg-[oklch(68%_0.18_145_/_0.12)]' : 'text-warn bg-[oklch(72%_0.17_65_/_0.12)]'}`}>
          {event.phase === 'closed' ? 'Closed' : 'Voting'}
        </span>
      </div>
      <h1 className="text-2xl font-extrabold text-ink tracking-tight text-wrap-balance">{event.title}</h1>
      {!needsJoin && (
        <p className="text-ink-3 text-sm mt-1">{votedCount} of {event.categories.length} categories voted</p>
      )}
    </div>
  )

  if (needsJoin) {
    return (
      <div className="max-w-2xl mx-auto py-8 px-4 space-y-4">
        {header}
        <div className="card p-6">
          <p className="font-bold text-ink mb-4">Join this event (use a memorable nickname)</p>
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
        {adminToken && (
          <EventAdminControls event={event} adminToken={adminToken} onRefetch={refetch} onDeleted={() => navigate('/')} />
        )}
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-4">
      {header}

      {welcomeBack && (
        <div className="card px-5 py-3 text-sm text-success bg-[oklch(68%_0.18_145_/_0.08)] border border-[oklch(68%_0.18_145_/_0.2)]">
          Welcome back, {joinedName}!
        </div>
      )}

      <div className="space-y-3">
        {event.categories.map(cat => (
          <CategorySection key={cat.poll.id} poll={cat.poll} onRefetch={refetch} adminToken={adminToken} />
        ))}
      </div>

      <Bracket schedule={event.schedule} />

      {adminToken && (
        <EventAdminControls event={event} adminToken={adminToken} onRefetch={refetch} onDeleted={() => navigate('/')} />
      )}
    </div>
  )
}
