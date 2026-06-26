import { useState, useEffect } from 'react'
import type { Poll, VotingMethod } from '../types'
import { api } from '../api/client'
import { DateTimePicker } from './DateTimePicker'

interface AdminControlsProps {
  poll: Poll
  adminToken: string
  onRefetch: () => void
  onDeleted: () => void
}

type Mode = 'default' | 'editing' | 'confirming' | 'deleting' | 'deleted'

type Changes = {
  title?: string
  voting_method?: string
  nomination_closes_at?: number | null
  nominations_visible?: boolean
  votes_visible?: boolean
  is_public?: boolean
}

const VOTING_METHODS: { value: VotingMethod; label: string; description: string }[] = [
  { value: 'ranked_choice', label: 'Ranked Choice', description: 'Instant runoff' },
  { value: 'ranked_pairs', label: 'Ranked Pairs', description: 'Tideman' },
  { value: 'plurality', label: 'Plurality', description: 'Most votes wins' },
]

const VOTING_METHOD_LABELS: Record<string, string> = {
  ranked_choice: 'Ranked Choice',
  ranked_pairs: 'Ranked Pairs',
  plurality: 'Plurality',
}

const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  voting_method: 'Voting method',
  nomination_closes_at: 'Nominations close',
  nominations_visible: 'Show nominations live',
  votes_visible: 'Show vote counts live',
  is_public: 'Listed publicly',
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer group">
      <div
        onClick={() => onChange(!checked)}
        className={`w-9 h-5 rounded-full flex-shrink-0 transition-colors relative cursor-pointer ${checked ? 'bg-accent' : 'bg-surface border border-line'}`}
      >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${checked ? 'left-4' : 'left-0.5'}`} />
      </div>
      <span className="text-xs text-ink-2 group-hover:text-ink transition-colors">{label}</span>
    </label>
  )
}

function formatDate(d: Date | null): string {
  if (!d) return 'None'
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' at ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  )
}

function formatChangeValue(key: string, value: unknown): string {
  if (key === 'nomination_closes_at') return formatDate(value !== null ? new Date(value as number) : null)
  if (key === 'voting_method') return VOTING_METHOD_LABELS[value as string] ?? String(value)
  if (typeof value === 'boolean') return value ? 'On' : 'Off'
  return String(value)
}

export function AdminControls({ poll, adminToken, onRefetch, onDeleted }: AdminControlsProps) {
  const [mode, setMode] = useState<Mode>('default')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(10)

  // Draft state — seeded from poll when entering editing mode
  const [draftTitle, setDraftTitle] = useState('')
  const [draftVotingMethod, setDraftVotingMethod] = useState<VotingMethod>('plurality')
  const [draftClosesAt, setDraftClosesAt] = useState<Date | null>(null)
  const [draftNominationsVisible, setDraftNominationsVisible] = useState(true)
  const [draftVotesVisible, setDraftVotesVisible] = useState(false)
  const [draftIsPublic, setDraftIsPublic] = useState(true)

  const enterEditing = () => {
    setDraftTitle(poll.title)
    setDraftVotingMethod(poll.voting_method as VotingMethod)
    setDraftClosesAt(poll.nomination_closes_at ? new Date(poll.nomination_closes_at) : null)
    setDraftNominationsVisible(poll.nominations_visible)
    setDraftVotesVisible(poll.votes_visible)
    setDraftIsPublic(poll.is_public)
    setError(null)
    setMode('editing')
  }

  const buildChanges = (): Changes => {
    const c: Changes = {}
    if (draftTitle.trim() !== poll.title) c.title = draftTitle.trim()
    if (draftVotingMethod !== poll.voting_method) c.voting_method = draftVotingMethod
    const draftMs = draftClosesAt ? draftClosesAt.getTime() : null
    if (draftMs !== poll.nomination_closes_at) c.nomination_closes_at = draftMs
    if (draftNominationsVisible !== poll.nominations_visible) c.nominations_visible = draftNominationsVisible
    if (draftVotesVisible !== poll.votes_visible) c.votes_visible = draftVotesVisible
    if (draftIsPublic !== poll.is_public) c.is_public = draftIsPublic
    return c
  }

  const handleSave = () => {
    if (!draftTitle.trim()) { setError('Title cannot be empty'); return }
    const changes = buildChanges()
    if (Object.keys(changes).length === 0) return
    setError(null)
    setMode('confirming')
  }

  const handleConfirm = async () => {
    setLoading(true)
    setError(null)
    try {
      await api.updatePoll(poll.id, adminToken, buildChanges())
      await onRefetch()
      setMode('default')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update poll')
    } finally {
      setLoading(false)
    }
  }

  const transitionPhase = async (phase: string) => {
    setLoading(true)
    setError(null)
    try {
      await api.transitionPhase(poll.id, adminToken, phase)
      await onRefetch()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to transition phase')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (mode !== 'deleted') return
    setCountdown(10)
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(interval)
          onDeleted()
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [mode])

  const isWide = mode === 'editing' || mode === 'confirming' || mode === 'deleting' || mode === 'deleted'
  const changes = mode === 'confirming' ? buildChanges() : {}

  return (
    <div className={`fixed bottom-4 right-4 bg-[var(--raised-glass)] backdrop-blur-md border border-line-bright rounded-2xl p-4 shadow-2xl shadow-black/60 space-y-3 transition-all duration-200 ${isWide ? 'w-72' : 'w-52'}`}>
      <div className="flex items-center gap-2">
        <span className="text-warn text-xs">⚡</span>
        <p className="text-xs font-bold text-ink-2 uppercase tracking-widest">Admin</p>
      </div>

      {error && <p className="text-danger text-xs">{error}</p>}

      {/* Default mode */}
      {mode === 'default' && (
        <>
          {poll.phase === 'nominating' && (
            <button
              disabled={loading}
              onClick={() => transitionPhase('voting')}
              className="w-full bg-accent hover:bg-accent-hover text-white text-sm font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-40"
            >
              Start voting →
            </button>
          )}
          {poll.phase === 'voting' && (
            <button
              disabled={loading}
              onClick={() => transitionPhase('closed')}
              className="w-full bg-danger text-white text-sm font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-40 hover:opacity-90"
            >
              Close & show results →
            </button>
          )}
          {poll.phase === 'closed' && (
            <p className="text-ink-3 text-xs">Poll is closed.</p>
          )}
          <button
            onClick={enterEditing}
            className="w-full text-xs text-ink-3 hover:text-ink transition-colors text-center py-1"
          >
            Edit poll
          </button>
          <button
            onClick={() => { setError(null); setMode('deleting') }}
            className="w-full text-xs text-ink-3 hover:text-danger transition-colors text-center py-1"
          >
            Delete poll
          </button>
        </>
      )}

      {/* Editing mode */}
      {mode === 'editing' && (
        <>
          <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
            <div>
              <label className="block text-xs font-semibold text-ink-2 uppercase tracking-widest mb-1">Title</label>
              <input
                className="input text-sm"
                value={draftTitle}
                onChange={e => setDraftTitle(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink-2 uppercase tracking-widest mb-1">Voting method</label>
              <div className={`space-y-1 ${poll.phase !== 'nominating' ? 'opacity-40 pointer-events-none' : ''}`}>
                {VOTING_METHODS.map(m => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setDraftVotingMethod(m.value)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border-2 text-left transition-colors ${
                      draftVotingMethod === m.value
                        ? 'border-accent bg-accent-muted'
                        : 'border-line bg-surface hover:border-line-bright'
                    }`}
                  >
                    <span className="font-semibold text-xs text-ink">{m.label}</span>
                    <span className="text-xs text-ink-3">{m.description}</span>
                  </button>
                ))}
              </div>
              {poll.phase !== 'nominating' && (
                <p className="text-xs text-ink-3 mt-1">Locked after voting starts</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink-2 uppercase tracking-widest mb-1">Nominations close</label>
              <DateTimePicker value={draftClosesAt} onChange={setDraftClosesAt} />
            </div>

            <div className="space-y-2 pt-1">
              <Toggle checked={draftNominationsVisible} onChange={setDraftNominationsVisible} label="Show nominations live" />
              <Toggle checked={draftVotesVisible} onChange={setDraftVotesVisible} label="Show vote counts live" />
              <Toggle checked={draftIsPublic} onChange={setDraftIsPublic} label="Listed publicly" />
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => { setError(null); setMode('default') }}
              className="flex-1 text-xs text-ink-3 hover:text-ink border border-line rounded-xl py-2 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="flex-1 bg-accent hover:bg-accent-hover text-white text-xs font-semibold py-2 rounded-xl transition-colors"
            >
              Save
            </button>
          </div>
        </>
      )}

      {/* Deleting mode */}
      {mode === 'deleting' && (
        <>
          <p className="text-xs font-semibold text-ink">Delete this poll?</p>
          <p className="text-xs text-ink-3">This cannot be undone. All nominations and votes will be permanently deleted.</p>
          <div className="flex gap-2 pt-1">
            <button
              disabled={loading}
              onClick={() => { setError(null); setMode('default') }}
              className="flex-1 text-xs text-ink-3 hover:text-ink border border-line rounded-xl py-2 transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              disabled={loading}
              onClick={async () => {
                setLoading(true)
                setError(null)
                try {
                  await api.deletePoll(poll.id, adminToken)
                  setMode('deleted')
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Failed to delete poll')
                } finally {
                  setLoading(false)
                }
              }}
              className="flex-1 bg-danger text-white text-xs font-semibold py-2 rounded-xl transition-colors disabled:opacity-40 hover:opacity-90"
            >
              Delete
            </button>
          </div>
        </>
      )}

      {/* Confirming mode */}
      {mode === 'confirming' && (
        <>
          <p className="text-xs font-semibold text-ink-2">Apply these changes?</p>
          <div className="space-y-2">
            {(Object.entries(changes) as [string, unknown][]).map(([key, value]) => (
              <div key={key}>
                <p className="text-xs text-ink-3">{FIELD_LABELS[key]}</p>
                <p className="text-sm font-semibold text-ink break-words">{formatChangeValue(key, value)}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-1">
            <button
              disabled={loading}
              onClick={() => { setError(null); setMode('editing') }}
              className="flex-1 text-xs text-ink-3 hover:text-ink border border-line rounded-xl py-2 transition-colors disabled:opacity-40"
            >
              Go back
            </button>
            <button
              disabled={loading}
              onClick={handleConfirm}
              className="flex-1 bg-accent hover:bg-accent-hover text-white text-xs font-semibold py-2 rounded-xl transition-colors disabled:opacity-40"
            >
              Confirm
            </button>
          </div>
        </>
      )}

      {/* Deleted mode */}
      {mode === 'deleted' && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-ink">Poll deleted.</p>
          <p className="text-xs text-ink-3">Redirecting in {countdown}s…</p>
        </div>
      )}
    </div>
  )
}
