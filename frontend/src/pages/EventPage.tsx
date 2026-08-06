import { useState, useEffect, useRef } from 'react'
import { useParams, useSearchParams, Navigate, useNavigate } from 'react-router-dom'
import { useEvent } from '../hooks/useEvent'
import { api } from '../api/client'
import { VotingPhase } from '../components/VotingPhase'
import { ResultsView } from '../components/ResultsView'
import { EventAdminControls } from '../components/EventAdminControls'
import { Bracket } from '../components/Bracket'
import type { Poll } from '../types'

// Reading localStorage directly (rather than through api/client.ts, which
// tests mock out wholesale) means this call is exercised for real in jsdom.
// jsdom's localStorage isn't functional under this project's current
// Node/Vitest combo (see the comment atop EventPage.test.tsx), so guard the
// read the same way a real browser in private-browsing mode would need to be
// guarded anyway.
function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function CategorySection({ poll, onRefetch, adminToken }: { poll: Poll; onRefetch: () => void; adminToken: string | null }) {
  return (
    <details className="card p-0 overflow-hidden group" open>
      <summary className="cursor-pointer select-none px-5 py-4 font-bold text-ink flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 min-w-0">
          <svg
            viewBox="0 0 20 20"
            fill="none"
            className="w-3.5 h-3.5 text-ink-3 flex-shrink-0 transition-transform duration-200 group-open:rotate-90"
            aria-hidden="true"
          >
            <path d="M6 4l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="truncate">{poll.title}</span>
        </span>
        {poll.has_voted && <span className="text-success text-xs font-bold flex-shrink-0">✓ Voted</span>}
      </summary>
      <div className="px-5 pb-5">
        {poll.phase === 'closed' ? (
          <ResultsView poll={poll} hideLinks hideNominatedBy />
        ) : (
          <VotingPhase poll={poll} onRefetch={onRefetch} hideResultsLinks adminToken={adminToken} eventScoped />
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
  const { event, error, loading, refetch } = useEvent(slug, adminToken)

  const [joinedName, setJoinedName] = useState<string | null>(null)
  const [participantName, setParticipantName] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [welcomeBack, setWelcomeBack] = useState(false)
  const [justJoined, setJustJoined] = useState(false)
  // api.hasToken() reads localStorage live, so it flips true the instant
  // joinEvent() stores tokens — before refetch() has actually fetched the
  // token-scoped (shuffled) event data. needsJoin must not react to that
  // live flip; it snapshots hasToken (per category) exactly once, the first
  // time `event` loads, so a fresh join can only unblock the voting view via
  // justJoined (set only after refetch resolves), never via hasToken alone.
  const hadAllTokensAtLoadRef = useRef<boolean | null>(null)

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

  if (hadAllTokensAtLoadRef.current === null) {
    hadAllTokensAtLoadRef.current = event.categories.every(cat => api.hasToken(cat.poll.id))
  }
  const needsJoin = !justJoined && !hadAllTokensAtLoadRef.current
  const votedCount = event.categories.filter(cat => cat.poll.has_voted).length
  const voterName = joinedName ?? safeGetItem(`event_name_${slug}`)

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!participantName.trim()) return
    setJoining(true)
    setJoinError(null)
    try {
      const data = await api.joinEvent(slug, participantName.trim())
      await refetch()
      setJoinedName(data.name)
      if (data.rejoined) setWelcomeBack(true)
      setJustJoined(true)
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : 'Failed to join')
    } finally {
      setJoining(false)
    }
  }

  const votedFraction = event.categories.length > 0 ? votedCount / event.categories.length : 0

  const header = (
    <div className="card p-6">
      <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="badge text-ink-3 bg-surface border border-line">🎬 Event</span>
          <span className={`badge ${event.phase === 'closed' ? 'text-success bg-[oklch(68%_0.18_145_/_0.12)]' : 'text-warn bg-[oklch(72%_0.17_65_/_0.12)]'}`}>
            {event.phase === 'closed' ? 'Closed' : 'Voting'}
          </span>
        </div>
        {voterName && (
          <span className="badge text-ink-2 bg-surface border border-line">👤 {voterName}</span>
        )}
      </div>
      <h1 className="text-2xl font-extrabold text-ink tracking-tight text-wrap-balance">{event.title}</h1>
      {!needsJoin && (
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center gap-2.5">
            <div className="flex-1 h-1.5 rounded-full bg-line overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-[width] duration-300 ease-out"
                style={{ width: `${Math.round(votedFraction * 100)}%` }}
              />
            </div>
            <span className="text-xs text-ink-2 font-semibold tabular-nums flex-shrink-0">
              {votedCount}/{event.categories.length} voted
            </span>
          </div>
          <p className="text-ink-3 text-xs">
            {event.voter_count} Vote Submission{event.voter_count === 1 ? '' : 's'}
          </p>
        </div>
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
