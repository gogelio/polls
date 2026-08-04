import type { Poll, PollResults, PublicPollSummary, SearchResult, EventPayload } from '../types'

const BASE = import.meta.env.VITE_API_URL ?? '/api'

function getToken(pollId: string): string | null {
  return localStorage.getItem(`poll_token_${pollId}`)
}

function setToken(pollId: string, token: string) {
  localStorage.setItem(`poll_token_${pollId}`, token)
}

function participantHeaders(pollId: string): HeadersInit {
  const token = getToken(pollId)
  return token ? { 'Participant-Token': token, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }
}

async function throwIfError(res: Response) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res
}

export const api = {
  listPublicPolls: async (): Promise<PublicPollSummary[]> => {
    const res = await throwIfError(await fetch(`${BASE}/polls`))
    return res.json()
  },

  createPoll: async (data: {
    title: string
    category: string
    voting_method: string
    max_nominations: number
    nominations_visible: boolean
    votes_visible: boolean
    is_public: boolean
    nomination_closes_at: number | null
  }) => {
    const res = await throwIfError(await fetch(`${BASE}/polls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }))
    return res.json() as Promise<{ id: string; admin_token: string; participant_url: string; admin_url: string }>
  },

  getPoll: async (id: string): Promise<Poll> => {
    const token = getToken(id)
    const res = await throwIfError(await fetch(`${BASE}/polls/${id}`, {
      headers: token ? { 'Participant-Token': token } : {},
    }))
    return res.json()
  },

  joinPoll: async (pollId: string, name: string) => {
    const existingToken = getToken(pollId)
    const res = await throwIfError(await fetch(`${BASE}/polls/${pollId}/join`, {
      method: 'POST',
      headers: existingToken
        ? { 'Content-Type': 'application/json', 'Participant-Token': existingToken }
        : { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }))
    const data = await res.json() as { participant_id: string; token: string; name: string; rejoined: boolean }
    setToken(pollId, data.token)
    return data
  },

  nominate: async (pollId: string, title: string, metadata: unknown) => {
    const res = await throwIfError(await fetch(`${BASE}/polls/${pollId}/nominations`, {
      method: 'POST',
      headers: participantHeaders(pollId),
      body: JSON.stringify({ title, metadata }),
    }))
    return res.json() as Promise<{ id: string }>
  },

  deleteNomination: async (pollId: string, nominationId: string, adminToken: string) => {
    await throwIfError(await fetch(`${BASE}/polls/${pollId}/nominations/${nominationId}?admin=${adminToken}`, {
      method: 'DELETE',
    }))
  },

  submitVotes: async (pollId: string, votes: Array<{ nomination_id: string; rank: number | null }>) => {
    await throwIfError(await fetch(`${BASE}/polls/${pollId}/votes`, {
      method: 'POST',
      headers: participantHeaders(pollId),
      body: JSON.stringify(votes),
    }))
  },

  getResults: async (pollId: string): Promise<PollResults> => {
    const res = await throwIfError(await fetch(`${BASE}/polls/${pollId}/results`))
    return res.json()
  },

  transitionPhase: async (pollId: string, adminToken: string, phase: string) => {
    await throwIfError(await fetch(`${BASE}/polls/${pollId}/phase?admin=${adminToken}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase }),
    }))
  },

  togglePause: async (pollId: string, adminToken: string): Promise<{ is_paused: boolean }> => {
    const res = await throwIfError(await fetch(`${BASE}/polls/${pollId}/pause?admin=${adminToken}`, {
      method: 'PATCH',
    }))
    return res.json()
  },

  updatePoll: async (pollId: string, adminToken: string, changes: {
    title?: string
    voting_method?: string
    nomination_closes_at?: number | null
    nominations_visible?: boolean
    votes_visible?: boolean
    is_public?: boolean
  }): Promise<void> => {
    await throwIfError(await fetch(`${BASE}/polls/${pollId}?admin=${adminToken}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    }))
  },

  deletePoll: async (pollId: string, adminToken: string): Promise<void> => {
    await throwIfError(await fetch(`${BASE}/polls/${pollId}?admin=${adminToken}`, {
      method: 'DELETE',
    }))
  },

  searchBooks: async (pollId: string, q: string): Promise<SearchResult[]> => {
    const res = await throwIfError(await fetch(`${BASE}/search/books?q=${encodeURIComponent(q)}`, {
      headers: participantHeaders(pollId),
    }))
    return res.json()
  },

  searchMovies: async (pollId: string, q: string): Promise<SearchResult[]> => {
    const res = await throwIfError(await fetch(`${BASE}/search/movies?q=${encodeURIComponent(q)}`, {
      headers: participantHeaders(pollId),
    }))
    return res.json()
  },

  searchMoviesAsAdmin: async (pollId: string, adminToken: string, q: string): Promise<SearchResult[]> => {
    const res = await throwIfError(await fetch(
      `${BASE}/polls/${pollId}/nominations/search-movies?q=${encodeURIComponent(q)}&admin=${adminToken}`
    ))
    return res.json()
  },

  updateNomination: async (pollId: string, nominationId: string, adminToken: string, changes: {
    title?: string
    metadata?: unknown
  }): Promise<void> => {
    await throwIfError(await fetch(`${BASE}/polls/${pollId}/nominations/${nominationId}?admin=${adminToken}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    }))
  },

  getEvent: async (slug: string, pollIds: string[] = []): Promise<EventPayload> => {
    const knownIds = new Set(pollIds)
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith('poll_token_')) knownIds.add(key.slice('poll_token_'.length))
    }
    const tokenPairs = [...knownIds]
      .map(id => { const t = getToken(id); return t ? `${id}:${t}` : null })
      .filter((v): v is string => v !== null)
    const headers: HeadersInit = tokenPairs.length ? { 'Participant-Tokens': tokenPairs.join(',') } : {}
    const res = await throwIfError(await fetch(`${BASE}/events/${slug}`, { headers }))
    return res.json()
  },

  joinEvent: async (slug: string, name: string) => {
    const res = await throwIfError(await fetch(`${BASE}/events/${slug}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }))
    const data = await res.json() as { name: string; rejoined: boolean; participants: Array<{ poll_id: string; participant_id: string; token: string }> }
    data.participants.forEach(p => setToken(p.poll_id, p.token))
    return data
  },

  closeEvent: async (slug: string, adminToken: string): Promise<void> => {
    await throwIfError(await fetch(`${BASE}/events/${slug}/phase?admin=${adminToken}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase: 'closed' }),
    }))
  },

  toggleEventPause: async (slug: string, adminToken: string): Promise<{ is_paused: boolean }> => {
    const res = await throwIfError(await fetch(`${BASE}/events/${slug}/pause?admin=${adminToken}`, {
      method: 'PATCH',
    }))
    return res.json()
  },

  deleteEvent: async (slug: string, adminToken: string): Promise<void> => {
    await throwIfError(await fetch(`${BASE}/events/${slug}?admin=${adminToken}`, {
      method: 'DELETE',
    }))
  },

  hasToken: (pollId: string) => !!getToken(pollId),
}
