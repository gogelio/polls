import { useState } from 'react'
import type { Poll } from '../types'
import { api } from '../api/client'

interface AdminControlsProps {
  poll: Poll
  adminToken: string
  onRefetch: () => void
}

export function AdminControls({ poll, adminToken, onRefetch }: AdminControlsProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const transition = async (phase: string) => {
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

  return (
    <div className="fixed bottom-4 right-4 bg-[var(--raised-glass)] backdrop-blur-md border border-line-bright rounded-2xl p-4 shadow-2xl shadow-black/60 space-y-3 w-52">
      <div className="flex items-center gap-2">
        <span className="text-warn text-xs">⚡</span>
        <p className="text-xs font-bold text-ink-2 uppercase tracking-widest">Admin</p>
      </div>
      {error && <p className="text-danger text-xs">{error}</p>}
      {poll.phase === 'nominating' && (
        <button
          disabled={loading}
          onClick={() => transition('voting')}
          className="w-full bg-accent hover:bg-accent-hover text-white text-sm font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-40"
        >
          Start voting →
        </button>
      )}
      {poll.phase === 'voting' && (
        <button
          disabled={loading}
          onClick={() => transition('closed')}
          className="w-full bg-danger text-white text-sm font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-40 hover:opacity-90"
        >
          Close & show results →
        </button>
      )}
      {poll.phase === 'closed' && (
        <p className="text-ink-3 text-xs">Poll is closed.</p>
      )}
    </div>
  )
}
