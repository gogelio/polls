import type { Category, NominationMetadata, Poll, PollNomination } from '../types'

interface OwnVoteSummaryProps {
  poll: Poll
  ownVote: string[]
}

function OwnVoteRow({ nomination, rank, category }: { nomination: PollNomination; rank: number | null; category: Category }) {
  const meta = nomination.metadata
    ? (typeof nomination.metadata === 'string'
        ? JSON.parse(nomination.metadata) as NominationMetadata
        : nomination.metadata)
    : null
  const imageUrl = meta?.cover_url ?? meta?.poster_url
  const displayTitle = category === 'movie' && meta?.year
    ? `${nomination.title} (${meta.year})`
    : nomination.title

  return (
    <div className="flex items-center gap-3 bg-raised border border-line rounded-xl p-3">
      {rank !== null && (
        <span className="text-accent font-extrabold text-base w-6 text-center flex-shrink-0 tabular-nums">
          {rank}
        </span>
      )}
      {imageUrl && (
        <img src={imageUrl} alt="" className="w-8 h-11 object-cover rounded-lg flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm text-ink truncate">{displayTitle}</div>
        {meta?.author && <div className="text-xs text-ink-3">{meta.author}</div>}
        {meta?.director && <div className="text-xs text-ink-3">{meta.director}</div>}
      </div>
    </div>
  )
}

// Shows a participant their own submitted ballot while the aggregate/live
// results stay hidden (votes_visible off) — that setting only controls the
// aggregate, never a voter's own vote.
export function OwnVoteSummary({ poll, ownVote }: OwnVoteSummaryProps) {
  const byId = new Map((poll.nominations ?? []).map(n => [n.id, n]))
  const items = ownVote.map(id => byId.get(id)).filter((n): n is PollNomination => !!n)
  if (items.length === 0) return null

  const isRanked = poll.voting_method !== 'plurality'

  return (
    <div className="card p-5 space-y-3">
      <p className="text-xs font-bold text-ink-3 uppercase tracking-widest">Your vote</p>
      <div className="space-y-2">
        {items.map((nom, i) => (
          <OwnVoteRow key={nom.id} nomination={nom} rank={isRanked ? i + 1 : null} category={poll.category} />
        ))}
      </div>
    </div>
  )
}
