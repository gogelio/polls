import { useState } from 'react'
import type { Poll } from '../types'
import { ResultsView } from './ResultsView'

interface AdminLiveResultsToggleProps {
  poll: Poll
}

// Lets an event admin preview live standings while voting is still open,
// even when votes_visible is off for everyone else — independent of
// whether the admin has cast their own vote in this poll yet.
export function AdminLiveResultsToggle({ poll }: AdminLiveResultsToggleProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="card p-4 space-y-3">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-xs font-semibold text-ink-3 hover:text-accent transition-colors"
      >
        {open ? '📊 Hide live results' : '📊 Admin: view live results'}
      </button>
      {/* Only ever rendered from VotingPhase's eventScoped admin gate. */}
      {open && <ResultsView poll={poll} hideLinks hideNominatedBy />}
    </div>
  )
}
