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

  return (
    <span className={`text-sm font-mono ${remaining < 60000 ? 'text-red-500' : 'text-amber-500'}`}>
      ⏱ {display} left
    </span>
  )
}
