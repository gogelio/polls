import { useState, useEffect } from 'react'

interface TimerProps { closesAt: number }

function formatRemaining(ms: number): string {
  if (ms <= 0) return '0:00'
  const totalSecs = Math.floor(ms / 1000)
  const days = Math.floor(totalSecs / 86400)
  const hours = Math.floor((totalSecs % 86400) / 3600)
  const mins = Math.floor((totalSecs % 3600) / 60)
  const secs = totalSecs % 60

  if (ms >= 3600000) {
    // 1 hour or more: show Xd Xh or Xh Xm
    if (days > 0) return `${days}d ${hours}h`
    return `${hours}h ${mins}m`
  }
  if (ms >= 60000) {
    // 1 min to 1 hr: show Xm Xs
    return `${mins}m ${secs}s`
  }
  // Under 1 min: MM:SS
  return `${mins}:${String(secs).padStart(2, '0')}`
}

export function Timer({ closesAt }: TimerProps) {
  const [remaining, setRemaining] = useState(Math.max(0, closesAt - Date.now()))

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(Math.max(0, closesAt - Date.now()))
    }, 1000)
    return () => clearInterval(interval)
  }, [closesAt])

  const urgent = remaining < 60000

  return (
    <span className={`text-xs font-mono font-semibold tabular-nums px-2.5 py-1 rounded-full ${
      urgent ? 'text-danger bg-[oklch(62%_0.22_25_/_0.15)]' : 'text-warn bg-[oklch(72%_0.17_65_/_0.12)]'
    }`}>
      ⏱ {formatRemaining(remaining)}
    </span>
  )
}
