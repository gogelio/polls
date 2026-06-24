import { useState, useEffect } from 'react'

interface TimerProps { closesAt: number }

export function Timer({ closesAt }: TimerProps) {
  const [remaining, setRemaining] = useState(Math.max(0, closesAt - Date.now()))

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(Math.max(0, closesAt - Date.now()))
    }, 1000)
    return () => clearInterval(interval)
  }, [closesAt])

  const mins = Math.floor(remaining / 60000)
  const secs = Math.floor((remaining % 60000) / 1000)
  const display = `${mins}:${String(secs).padStart(2, '0')}`
  const urgent = remaining < 60000

  return (
    <span className={`text-xs font-mono font-semibold tabular-nums px-2.5 py-1 rounded-full ${
      urgent ? 'text-danger bg-[oklch(62%_0.22_25_/_0.15)]' : 'text-warn bg-[oklch(72%_0.17_65_/_0.12)]'
    }`}>
      ⏱ {display}
    </span>
  )
}
