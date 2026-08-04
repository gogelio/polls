// @vitest-environment jsdom
import { useState, useCallback, useEffect } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { PollPage } from './PollPage'
import type { Poll } from '../types'
import { api } from '../api/client'

// PollPage's join flow must refetch the poll (participant-token-scoped, so
// nominations arrive in the shuffled order) before it hands control to
// VotingPhase, which only seeds its ballot order once at mount. This test
// stands in for `usePoll` with a trimmed-down lookalike (real useState/
// useEffect, no polling interval) so we can observe, deterministically,
// which `api.getPoll` response VotingPhase actually mounts with.
vi.mock('../hooks/usePoll', () => ({
  usePoll: (pollId: string) => {
    const [poll, setPoll] = useState<Poll | null>(null)
    const fetchPoll = useCallback(async () => {
      const data = await api.getPoll(pollId)
      setPoll(data)
    }, [pollId])
    useEffect(() => { fetchPoll() }, [fetchPoll])
    return { poll, error: null, loading: poll === null, refetch: fetchPoll }
  },
}))

vi.mock('../api/client', () => ({
  api: {
    getPoll: vi.fn(),
    joinPoll: vi.fn(),
    getResults: vi.fn().mockResolvedValue({ poll_id: 'poll1', voting_method: 'ranked_choice', results: [], total_voters: 0 }),
    hasToken: vi.fn().mockReturnValue(false),
    saveVoteDraft: vi.fn().mockResolvedValue(undefined),
    submitVotes: vi.fn().mockResolvedValue(undefined),
    searchMoviesAsAdmin: vi.fn().mockResolvedValue([]),
    updateNomination: vi.fn().mockResolvedValue(undefined),
  },
}))

afterEach(() => cleanup())

function buildPoll(nominationOrder: string[], overrides: Partial<Poll> = {}): Poll {
  const byId: Record<string, { id: string; title: string }> = {
    a: { id: 'a', title: 'Movie A' },
    b: { id: 'b', title: 'Movie B' },
    c: { id: 'c', title: 'Movie C' },
  }
  return {
    id: 'poll1',
    title: 'Test Poll',
    category: 'general',
    voting_method: 'ranked_choice',
    phase: 'voting',
    max_nominations: 5,
    nominations_visible: true,
    votes_visible: true,
    is_public: true,
    is_paused: false,
    nomination_closes_at: null,
    nominations: nominationOrder.map(id => ({
      ...byId[id]!,
      metadata: null,
      participant_name: 'Alice',
      created_at: 1,
    })),
    has_voted: false,
    participant_count: 1,
    created_at: 1,
    draft_ranking: null,
    ...overrides,
  }
}

describe('PollPage join flow', () => {
  it('refetches the poll before mounting VotingPhase, so the ballot seeds from the post-join (shuffled) order', async () => {
    // No-token fetch (pre-join): plain created_at order.
    const unshuffled = buildPoll(['a', 'b', 'c'])
    // Token-scoped fetch (post-join): server-shuffled order.
    const shuffled = buildPoll(['c', 'a', 'b'])

    let getPollCalls = 0
    vi.mocked(api.getPoll).mockImplementation(async () => {
      getPollCalls += 1
      return getPollCalls === 1 ? unshuffled : shuffled
    })
    vi.mocked(api.joinPoll).mockResolvedValue({
      participant_id: 'p1',
      name: 'Bob',
      rejoined: false,
    } as Awaited<ReturnType<typeof api.joinPoll>>)

    render(
      <MemoryRouter initialEntries={['/p/poll1']}>
        <Routes>
          <Route path="/p/:id" element={<PollPage />} />
        </Routes>
      </MemoryRouter>
    )

    // Wait for the initial (pre-join, unshuffled) fetch and the join form.
    const nameInput = await screen.findByPlaceholderText('Your name')
    expect(getPollCalls).toBe(1)

    fireEvent.change(nameInput, { target: { value: 'Bob' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Join/ }))
    })

    // The join must have triggered a second, token-scoped fetch...
    await waitFor(() => expect(getPollCalls).toBe(2))

    // ...and VotingPhase must render using that shuffled response, not the
    // stale pre-join order it would otherwise have seeded from at mount.
    await waitFor(() => {
      const titles = screen.getAllByText(/^Movie [ABC]$/).map(el => el.textContent)
      expect(titles).toEqual(['Movie C', 'Movie A', 'Movie B'])
    })
  })
})
