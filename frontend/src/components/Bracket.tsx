import type { EventDay, EventSlot } from '../types'

const PLACEMENT_LABEL: Record<number, string> = { 1: '1st choice', 2: '2nd choice' }

function SlotCard({ slot }: { slot: EventSlot }) {
  return (
    <div className="card p-4 space-y-1">
      <p className="text-xs font-bold text-ink-3 uppercase tracking-widest">
        {slot.category} — {PLACEMENT_LABEL[slot.placement] ?? `#${slot.placement}`}
      </p>
      {slot.status === 'awaiting_votes' && <p className="text-ink-3 text-sm">Awaiting votes</p>}
      {slot.status === 'unresolved' && <p className="text-ink-3 text-sm">Tied — not yet decided</p>}
      {slot.status === 'hidden' && <p className="text-ink-3 text-sm">Hidden until reveal</p>}
      {slot.status === 'resolved' && (
        <p className="text-sm font-semibold text-ink">{slot.movies.map(m => m.title).join(' / ')}</p>
      )}
    </div>
  )
}

export function Bracket({ schedule }: { schedule: EventDay[] }) {
  if (schedule.length === 0) return null
  return (
    <div className="card p-5 space-y-4">
      <p className="text-xs font-bold text-ink-3 uppercase tracking-widest">🎟️ Watch schedule</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {schedule.map(day => (
          <div key={day.day} className="space-y-2">
            <p className="text-sm font-extrabold text-ink">{day.day}</p>
            {day.slots.map(slot => <SlotCard key={slot.slot_order} slot={slot} />)}
          </div>
        ))}
      </div>
    </div>
  )
}
