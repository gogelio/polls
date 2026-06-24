import { useState, useEffect, useCallback, useRef } from 'react'
import type { Poll } from '../types'
import { api } from '../api/client'

export function usePoll(pollId: string) {
  const [poll, setPoll] = useState<Poll | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchPoll = useCallback(async () => {
    try {
      const data = await api.getPoll(pollId)
      setPoll(data)
      setError(null)
      if (data.phase === 'closed' && intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load poll')
    } finally {
      setLoading(false)
    }
  }, [pollId])

  useEffect(() => {
    fetchPoll()
    intervalRef.current = setInterval(fetchPoll, 3000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchPoll])

  return { poll, error, loading, refetch: fetchPoll }
}
