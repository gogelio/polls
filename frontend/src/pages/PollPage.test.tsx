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

// api.hasToken() is backed by localStorage in production, which flips true
// the instant joinPoll() stores a token — synchronously, well before
// refetch() resolves. A tiny in-memory fake store gives this mock's
// hasToken/joinPoll that exact timing property (without touching the real
// browser localStorage API, which isn't functional in this test
// environment) so the test can actually catch a regression of needsJoin
// reacting to that live flip instead of only to the post-refetch state.
const fakeTokenStore = new Set<string>()

vi.mock('../api/client', () => ({
  api: {
    getPoll: vi.fn(),
    joinPoll: vi.fn(),
    getResults: vi.fn().mockResolvedValue({ poll_id: 'poll1', voting_method: 'ranked_choice', results: [], total_voters: 0 }),
    hasToken: (pollId: string) => fakeTokenStore.has(pollId),
    saveVoteDraft: vi.fn().mockResolvedValue(undefined),
    submitVotes: vi.fn().mockResolvedValue(undefined),
    searchMoviesAsAdmin: vi.fn().mockResolvedValue([]),
    updateNomination: vi.fn().mockResolvedValue(undefined),
  },
}))

afterEach(() => {
  cleanup()
  fakeTokenStore.clear()
  vi.clearAllMocks()
})

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
    own_vote: null,
    ...overrides,
  }
}

describe('PollPage join flow', () => {
  it('refetches the poll before mounting VotingPhase, so the ballot seeds from the post-join (shuffled) order', async () => {
    // No-token fetch (pre-join): plain created_at order.
    const unshuffled = buildPoll(['a', 'b', 'c'])
    // Token-scoped fetch (post-join): server-shuffled order.
    const shuffled = buildPoll(['c', 'a', 'b'])

    // The second call (the post-join refetch) gets a real, non-zero delay —
    // matching the actual HTTP round-trip a browser would see — so React
    // has time to actually commit the intermediate render where the
    // localStorage-backed hasToken() has already flipped true but the poll
    // data hasn't caught up yet. Without this delay, both fetches settle
    // within the same microtask flush and React coalesces the two renders
    // into one, masking the bug this test exists to catch.
    let getPollCalls = 0
    vi.mocked(api.getPoll).mockImplementation(async () => {
      getPollCalls += 1
      if (getPollCalls === 1) return unshuffled
      await new Promise(resolve => setTimeout(resolve, 20))
      return shuffled
    })
    vi.mocked(api.joinPoll).mockImplementation(async () => {
      // Mirror the real api.joinPoll's synchronous token-store side effect
      // so hasToken() flips true immediately on resolution, exactly like
      // production — that's the mechanism under test.
      fakeTokenStore.add('poll1')
      return { participant_id: 'p1', token: 'tok-1', name: 'Bob', rejoined: false }
    })

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

  it('auto-rejoins a returning user (existing token) exactly once, without a redundant joinPoll call from an unrelated hasToken flip', async () => {
    // Returning user: a token for this poll already exists before mount, so
    // the very first getPoll() fetch is already token-scoped (shuffled).
    fakeTokenStore.add('poll1')
    const shuffled = buildPoll(['c', 'a', 'b'])

    vi.mocked(api.getPoll).mockResolvedValue(shuffled)
    vi.mocked(api.joinPoll).mockResolvedValue({ participant_id: 'p1', token: 'tok-1', name: 'Bob', rejoined: false })

    render(
      <MemoryRouter initialEntries={['/p/poll1']}>
        <Routes>
          <Route path="/p/:id" element={<PollPage />} />
        </Routes>
      </MemoryRouter>
    )

    // No join form — straight to the ballot, already in the shuffled order.
    await waitFor(() => {
      const titles = screen.getAllByText(/^Movie [ABC]$/).map(el => el.textContent)
      expect(titles).toEqual(['Movie C', 'Movie A', 'Movie B'])
    })
    expect(screen.queryByPlaceholderText('Your name')).toBeNull()

    // The auto-rejoin effect must fire exactly once — not once at mount and
    // again from its own hasToken side effect.
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(api.joinPoll).toHaveBeenCalledTimes(1)
    expect(api.joinPoll).toHaveBeenCalledWith('poll1', '')
  })
})
