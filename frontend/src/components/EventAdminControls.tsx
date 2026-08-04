import { useState, useEffect } from 'react'
import type { EventPayload } from '../types'
import { api } from '../api/client'

interface EventAdminControlsProps {
  event: EventPayload
  adminToken: string
  onRefetch: () => void
  onDeleted: () => void
}

type Mode = 'default' | 'deleting' | 'deleted'

export function EventAdminControls({ event, adminToken, onRefetch, onDeleted }: EventAdminControlsProps) {
  const [mode, setMode] = useState<Mode>('default')
  const [loading, setLoading] = useState(false)
  const [pauseLoading, setPauseLoading] = useState(false)
  const [votesVisibleLoading, setVotesVisibleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(10)
  const isPaused = event.categories.some(cat => cat.poll.is_paused)
  const votesVisible = event.categories.some(cat => cat.poll.votes_visible)

  const handleClose = async () => {
    setLoading(true)
    setError(null)
    try {
      await api.closeEvent(event.id, adminToken)
      await onRefetch()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to close event')
    } finally {
      setLoading(false)
    }
  }

  const handleTogglePause = async () => {
    setPauseLoading(true)
    setError(null)
    try {
      await api.toggleEventPause(event.id, adminToken)
      await onRefetch()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to toggle pause')
    } finally {
      setPauseLoading(false)
    }
  }

  const handleToggleVotesVisible = async () => {
    setVotesVisibleLoading(true)
    setError(null)
    try {
      await api.toggleEventVotesVisible(event.id, adminToken)
      await onRefetch()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to toggle live results')
    } finally {
      setVotesVisibleLoading(false)
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

  const isWide = mode === 'deleting' || mode === 'deleted'

  return (
    <div className={`fixed bottom-4 right-4 bg-[var(--raised-glass)] backdrop-blur-md border border-line-bright rounded-2xl p-4 shadow-2xl shadow-black/60 space-y-3 transition-all duration-200 ${isWide ? 'w-72' : 'w-52'}`}>
      <div className="flex items-center gap-2">
        <span className="text-warn text-xs">⚡</span>
        <p className="text-xs font-bold text-ink-2 uppercase tracking-widest">Event Admin</p>
      </div>

      {error && <p className="text-danger text-xs">{error}</p>}

      {mode === 'default' && (
        <>
          {event.phase === 'voting' && (
            <button
              disabled={loading}
              onClick={handleClose}
              className="w-full bg-danger text-white text-sm font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-40 hover:opacity-90"
            >
              Close event & show results →
            </button>
          )}
          {event.phase === 'closed' && <p className="text-ink-3 text-xs">Event is closed.</p>}
          <button
            disabled={pauseLoading || event.phase === 'closed'}
            onClick={handleTogglePause}
            className="w-full text-xs font-semibold py-2 rounded-xl transition-colors disabled:opacity-40 border border-line hover:border-line-bright text-ink-2 hover:text-ink"
          >
            {pauseLoading ? '…' : isPaused ? '▶ Unpause all' : '⏸ Pause all'}
          </button>
          <button
            disabled={votesVisibleLoading || event.phase === 'closed'}
            onClick={handleToggleVotesVisible}
            className="w-full text-xs font-semibold py-2 rounded-xl transition-colors disabled:opacity-40 border border-line hover:border-line-bright text-ink-2 hover:text-ink"
          >
            {votesVisibleLoading ? '…' : votesVisible ? '🙈 Hide live results' : '👁 Show live results'}
          </button>
          <button
            onClick={() => { setError(null); setMode('deleting') }}
            className="w-full text-xs text-ink-3 hover:text-danger transition-colors text-center py-1"
          >
            Delete event
          </button>
        </>
      )}

      {mode === 'deleting' && (
        <>
          <p className="text-xs font-semibold text-ink">Delete this event?</p>
          <p className="text-xs text-ink-3">This cannot be undone. All 8 category polls, nominations, and votes will be permanently deleted.</p>
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
                  await api.deleteEvent(event.id, adminToken)
                  setMode('deleted')
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Failed to delete event')
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

      {mode === 'deleted' && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-ink">Event deleted.</p>
          <p className="text-xs text-ink-3">Redirecting in {countdown}s…</p>
        </div>
      )}
    </div>
  )
}
