import type { Poll, PollResults, SearchResult } from '../types'

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
  createPoll: async (data: {
    title: string
    category: string
    voting_method: string
    max_nominations: number
    nominations_visible: boolean
    votes_visible: boolean
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
    const res = await throwIfError(await fetch(`${BASE}/polls/${id}`))
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
    const data = await res.json() as { participant_id: string; token: string; name: string }
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

  hasToken: (pollId: string) => !!getToken(pollId),
}
