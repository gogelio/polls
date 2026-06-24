import { useState, useEffect, useCallback } from 'react'
import type { Poll } from '../types'
import { api } from '../api/client'

export function usePoll(pollId: string) {
  const [poll, setPoll] = useState<Poll | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchPoll = useCallback(async () => {
    try {
      const data = await api.getPoll(pollId)
      setPoll(data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load poll')
    } finally {
      setLoading(false)
    }
  }, [pollId])

  useEffect(() => {
    fetchPoll()
    const interval = setInterval(() => {
      // Stop polling once closed
      setPoll(current => {
        if (current?.phase === 'closed') clearInterval(interval)
        return current
      })
      fetchPoll()
    }, 3000)
    return () => clearInterval(interval)
  }, [fetchPoll])

  return { poll, error, loading, refetch: fetchPoll }
}
