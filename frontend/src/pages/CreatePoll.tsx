import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api } from '../api/client'
import type { Category, VotingMethod, PublicPollSummary } from '../types'

const CATEGORIES: { value: Category; label: string; emoji: string }[] = [
  { value: 'general', label: 'General', emoji: '💬' },
  { value: 'book', label: 'Books', emoji: '📚' },
  { value: 'movie', label: 'Movies', emoji: '🎬' },
]

const VOTING_METHODS: { value: VotingMethod; label: string; description: string }[] = [
  { value: 'ranked_choice', label: 'Ranked Choice', description: 'Drag to rank, instant runoff' },
  { value: 'ranked_pairs', label: 'Ranked Pairs', description: 'Tideman method, most fair' },
  { value: 'plurality', label: 'Plurality', description: 'Pick one, most votes wins' },
]

const CATEGORY_EMOJI: Record<string, string> = { movie: '🎬', book: '📚', general: '💬' }

const PHASE_LABEL: Record<string, { label: string; classes: string }> = {
  nominating: { label: 'Nominating', classes: 'text-accent bg-accent-muted' },
  voting:     { label: 'Voting',     classes: 'text-warn bg-[oklch(72%_0.17_65_/_0.12)]' },
  closed:     { label: 'Closed',     classes: 'text-success bg-[oklch(68%_0.18_145_/_0.12)]' },
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer group">
      <div
        onClick={() => onChange(!checked)}
        className={`w-10 h-6 rounded-full flex-shrink-0 transition-colors relative cursor-pointer ${checked ? 'bg-accent' : 'bg-surface border border-line'}`}
      >
        <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${checked ? 'left-5' : 'left-1'}`} />
      </div>
      <span className="text-sm text-ink-2 group-hover:text-ink transition-colors">{label}</span>
    </label>
  )
}

export function CreatePoll() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<Category>('general')
  const [votingMethod, setVotingMethod] = useState<VotingMethod>('ranked_choice')
  const [maxNominations, setMaxNominations] = useState(1)
  const [nominationsVisible, setNominationsVisible] = useState(true)
  const [votesVisible, setVotesVisible] = useState(true)
  const [isPublic, setIsPublic] = useState(true)
  const [closesAt, setClosesAt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [recentPolls, setRecentPolls] = useState<PublicPollSummary[]>([])

  useEffect(() => {
    api.listPublicPolls().then(setRecentPolls).catch(() => null)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) { setError('Give your poll a title'); return }
    setSubmitting(true)
    setError(null)
    try {
      const result = await api.createPoll({
        title: title.trim(),
        category,
        voting_method: votingMethod,
        max_nominations: maxNominations,
        nominations_visible: nominationsVisible,
        votes_visible: votesVisible,
        is_public: isPublic,
        nomination_closes_at: closesAt ? new Date(closesAt).getTime() : null,
      })
      sessionStorage.setItem(`poll_admin_${result.id}`, result.admin_token)
      navigate(`/p/${result.id}?admin=${result.admin_token}`, { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create poll')
    } finally {
      setSubmitting(false)
    }
  }

  const form = (
    <div className="card p-7">
      <h1 className="text-3xl font-extrabold text-ink tracking-tight mb-1">New poll</h1>
      <p className="text-ink-3 text-sm mb-7">Share a link, let the group decide.</p>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Title */}
        <div>
          <label className="block text-xs font-semibold text-ink-2 uppercase tracking-widest mb-2">
            Title
          </label>
          <input
            className="input"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="What should we watch next?"
          />
        </div>

        {/* Category */}
        <div>
          <label className="block text-xs font-semibold text-ink-2 uppercase tracking-widest mb-2">
            Category
          </label>
          <div className="flex gap-2">
            {CATEGORIES.map(cat => (
              <button
                key={cat.value}
                type="button"
                onClick={() => setCategory(cat.value)}
                className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-xl border-2 text-sm font-semibold transition-colors ${
                  category === cat.value
                    ? 'border-accent bg-accent-muted text-ink'
                    : 'border-line bg-surface text-ink-3 hover:border-line-bright hover:text-ink-2'
                }`}
              >
                <span className="text-xl">{cat.emoji}</span>
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Voting method */}
        <div>
          <label className="block text-xs font-semibold text-ink-2 uppercase tracking-widest mb-2">
            Voting method
          </label>
          <div className="space-y-2">
            {VOTING_METHODS.map(method => (
              <button
                key={method.value}
                type="button"
                onClick={() => setVotingMethod(method.value)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 text-left transition-colors ${
                  votingMethod === method.value
                    ? 'border-accent bg-accent-muted'
                    : 'border-line bg-surface hover:border-line-bright'
                }`}
              >
                <span className="font-semibold text-sm text-ink">{method.label}</span>
                <span className="text-xs text-ink-3">{method.description}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Nominations + Timer */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-ink-2 uppercase tracking-widest mb-2">
              Nominations per person
            </label>
            <input
              type="number"
              min={1}
              max={10}
              className="input"
              value={maxNominations}
              onChange={e => setMaxNominations(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-2 uppercase tracking-widest mb-2">
              Nominations close
            </label>
            <input
              type="datetime-local"
              className="input"
              value={closesAt}
              min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
              onChange={e => setClosesAt(e.target.value)}
            />
          </div>
        </div>

        {/* Toggles */}
        <div className="space-y-3">
          <Toggle checked={nominationsVisible} onChange={setNominationsVisible} label="Show nominations live during nomination phase" />
          <Toggle checked={votesVisible} onChange={setVotesVisible} label="Show live vote counts during voting" />
          <Toggle checked={isPublic} onChange={setIsPublic} label="List this poll publicly on the home page" />
        </div>

        {error && <p className="text-danger text-sm">{error}</p>}

        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? 'Creating…' : 'Create poll →'}
        </button>
      </form>
    </div>
  )

  const activePolls = recentPolls.filter(p => p.phase !== 'closed')
  const closedPolls = recentPolls.filter(p => p.phase === 'closed')

  const renderPollLink = (poll: PublicPollSummary) => {
    const phase = PHASE_LABEL[poll.phase] ?? { label: poll.phase, classes: 'text-ink-3 bg-surface' }
    return (
      <Link
        key={poll.id}
        to={`/p/${poll.id}`}
        className="flex items-center gap-3 p-3 rounded-xl bg-raised border border-line hover:border-line-bright transition-colors group"
      >
        <span className="text-lg flex-shrink-0">{CATEGORY_EMOJI[poll.category]}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink truncate group-hover:text-accent transition-colors">
            {poll.title}
          </p>
          <p className="text-xs text-ink-3">
            {poll.participant_count} participant{poll.participant_count !== 1 ? 's' : ''}
          </p>
        </div>
        <span className={`badge flex-shrink-0 ${phase.classes}`}>{phase.label}</span>
      </Link>
    )
  }

  if (recentPolls.length === 0) {
    return (
      <div className="max-w-md mx-auto py-10 px-4">
        {form}
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto py-10 px-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        {form}
        <div className="space-y-4">
          {activePolls.length > 0 && (
            <div className="card p-5 space-y-3">
              <p className="text-xs font-bold text-ink-3 uppercase tracking-widest">Active polls</p>
              <div className="space-y-2">{activePolls.map(renderPollLink)}</div>
            </div>
          )}
          {closedPolls.length > 0 && (
            <div className="card p-5 space-y-3">
              <p className="text-xs font-bold text-ink-3 uppercase tracking-widest">Recently closed</p>
              <div className="space-y-2">{closedPolls.map(renderPollLink)}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
