import { useState, useEffect, useCallback, useRef } from 'react'
import type { EventPayload } from '../types'
import { api } from '../api/client'

export function useEvent(slug: string) {
  const [event, setEvent] = useState<EventPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollIdsRef = useRef<string[]>([])

  const fetchEvent = useCallback(async () => {
    try {
      const data = await api.getEvent(slug, pollIdsRef.current)
      pollIdsRef.current = data.categories.map(cat => cat.poll.id)
      setEvent(data)
      setError(null)
      if (data.phase === 'closed' && intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load event')
    } finally {
      setLoading(false)
    }
  }, [slug])

  useEffect(() => {
    fetchEvent()
    intervalRef.current = setInterval(fetchEvent, 3000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchEvent])

  return { event, error, loading, refetch: fetchEvent }
}
