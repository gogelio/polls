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

  const transition = async (phase: string) => {
    setLoading(true)
    try {
      await api.transitionPhase(poll.id, adminToken, phase)
      await onRefetch()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed bottom-4 right-4 bg-amber-50 border border-amber-300 rounded-xl p-4 shadow-lg text-sm space-y-2 w-56">
      <p className="font-semibold text-amber-800">Admin Controls</p>
      {poll.phase === 'nominating' && (
        <button disabled={loading} onClick={() => transition('voting')}
          className="w-full bg-amber-500 text-white py-2 rounded-lg disabled:opacity-50">
          Close Nominations → Start Voting
        </button>
      )}
      {poll.phase === 'voting' && (
        <button disabled={loading} onClick={() => transition('closed')}
          className="w-full bg-red-500 text-white py-2 rounded-lg disabled:opacity-50">
          Close Voting → Show Results
        </button>
      )}
      {poll.phase === 'closed' && (
        <p className="text-amber-700">Poll is closed.</p>
      )}
    </div>
  )
}
