import type { EventVoterStat } from '../types'

interface EventVoterStatsProps {
  luckiest: EventVoterStat[]
  unluckiest: EventVoterStat[]
}

export function EventVoterStats({ luckiest, unluckiest }: EventVoterStatsProps) {
  if (luckiest.length === 0 && unluckiest.length === 0) return null

  return (
    <div className="card p-5 grid grid-cols-2 gap-4">
      <div>
        <p className="text-xs font-bold text-ink-3 uppercase tracking-widest mb-2">🍀 Luckiest Overall</p>
        <ol className="space-y-1 text-sm">
          {luckiest.map(l => (
            <li key={l.name} className="text-ink-2">
              <span className="font-semibold text-ink">{l.name}</span>{' '}
              <span className="text-ink-3">({Math.round(l.average_score * 100)}%)</span>
            </li>
          ))}
        </ol>
      </div>
      <div>
        <p className="text-xs font-bold text-ink-3 uppercase tracking-widest mb-2">💔 Unluckiest Overall</p>
        <ol className="space-y-1 text-sm">
          {unluckiest.map(l => (
            <li key={l.name} className="text-ink-2">
              <span className="font-semibold text-ink">{l.name}</span>{' '}
              <span className="text-ink-3">({Math.round(l.average_score * 100)}%)</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
