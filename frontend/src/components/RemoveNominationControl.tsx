import { useState } from 'react'
import { api } from '../api/client'

interface RemoveNominationControlProps {
  pollId: string
  nominationId: string
  adminToken: string
  onRemoved: () => void
}

export function RemoveNominationControl({ pollId, nominationId, adminToken, onRemoved }: RemoveNominationControlProps) {
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleRemove = async () => {
    setRemoving(true)
    setError(null)
    try {
      await api.deleteNomination(pollId, nominationId, adminToken)
      onRemoved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove')
      setRemoving(false)
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.preventDefault(); e.stopPropagation(); setConfirming(true) }}
        className="text-xs text-ink-3 hover:text-danger transition-colors"
      >
        ✕ Remove
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      <span className="text-xs text-ink-3">Remove this nomination?</span>
      <button
        type="button"
        disabled={removing}
        onClick={handleRemove}
        className="text-xs font-semibold text-danger hover:underline disabled:opacity-40"
      >
        {removing ? 'Removing…' : 'Yes, remove'}
      </button>
      <button
        type="button"
        disabled={removing}
        onClick={() => setConfirming(false)}
        className="text-xs text-ink-3 hover:text-ink disabled:opacity-40"
      >
        Cancel
      </button>
      {error && <span className="text-danger text-xs">{error}</span>}
    </div>
  )
}
