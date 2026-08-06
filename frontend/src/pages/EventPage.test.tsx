// @vitest-environment jsdom
import { useState, useCallback, useEffect } from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { EventPage } from './EventPage'
import type { EventPayload } from '../types'
import { api } from '../api/client'

// EventPage's `needsJoin` gate reads `api.hasToken()` straight from
// localStorage, which flips true the instant `joinEvent()` stores tokens —
// before `refetch()` has actually fetched the participant-token-scoped
// (shuffled) event data. If `handleJoin` sets any other React state before
// `refetch()` resolves, a render slips through with `needsJoin` already
// false but `event` still holding the pre-join, unshuffled data —
// VotingPhase then mounts from that stale snapshot and never re-seeds
// order afterward.
//
// The real localStorage-backed `hasToken`/`getToken`/`setToken` can't be
// exercised directly in this test environment (jsdom's localStorage isn't
// functional under the current Node/Vitest combo, independent of this
// bug). What actually matters for reproducing the race is the *timing*
// property those functions have in production: a token becomes visible to
// `hasToken()` synchronously, the instant `joinEvent()` resolves — fully
// decoupled from whatever React state update sequence follows. A tiny
// in-memory fake store gives `hasToken`/`joinEvent` that exact timing
// without touching the browser localStorage API at all.
const fakeTokenStore = new Set<string>()

vi.mock('../hooks/useEvent', () => ({
  useEvent: (slug: string) => {
    const [event, setEvent] = useState<EventPayload | null>(null)
    const fetchEvent = useCallback(async () => {
      const data = await api.getEvent(slug)
      setEvent(data)
    }, [slug])
    useEffect(() => { fetchEvent() }, [fetchEvent])
    return { event, error: null, loading: event === null, refetch: fetchEvent }
  },
}))

vi.mock('../api/client', () => ({
  api: {
    getEvent: vi.fn(),
    joinEvent: vi.fn(),
    hasToken: (pollId: string) => fakeTokenStore.has(pollId),
  },
}))

afterEach(() => {
  cleanup()
  fakeTokenStore.clear()
})

function buildEvent(nominationOrder: string[], voterCount = 0): EventPayload {
  const byId: Record<string, { id: string; title: string }> = {
    a: { id: 'a', title: 'Movie A' },
    b: { id: 'b', title: 'Movie B' },
    c: { id: 'c', title: 'Movie C' },
  }
  return {
    id: 'glarm26',
    title: 'Test Event',
    is_public: true,
    phase: 'voting',
    schedule: [],
    voter_count: voterCount,
    created_at: 1,
    categories: [
      {
        category: 'Action',
        sort_order: 0,
        poll: {
          id: 'action-poll',
          title: 'Action',
          category: 'movie',
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
          draft_ranking: null,
          own_vote: null,
          participant_count: 1,
          created_at: 1,
        },
      },
    ],
  }
}

describe('EventPage join flow', () => {
  it('refetches the event before unlocking the voting view, so the ballot seeds from the post-join (shuffled) order', async () => {
    // No-token fetch (pre-join): plain created_at order.
    const unshuffled = buildEvent(['a', 'b', 'c'])
    // Token-scoped fetch (post-join): server-shuffled order.
    const shuffled = buildEvent(['c', 'a', 'b'])

    // The second call (the post-join refetch) gets a real, non-zero delay —
    // matching the actual HTTP round-trip a browser would see — so React
    // has time to actually commit the intermediate render where the
    // localStorage-backed `needsJoin` gate has already flipped false but
    // `event` state hasn't caught up yet. Without this delay, both fetches
    // settle within the same microtask flush and React coalesces the two
    // renders into one, masking the bug this test exists to catch.
    let getEventCalls = 0
    vi.mocked(api.getEvent).mockImplementation(async () => {
      getEventCalls += 1
      if (getEventCalls === 1) return unshuffled
      await new Promise(resolve => setTimeout(resolve, 20))
      return shuffled
    })
    vi.mocked(api.joinEvent).mockImplementation(async () => {
      // Mirror the real api.joinEvent's synchronous token-store side effect
      // so hasToken() flips true immediately on resolution, exactly like
      // production — that's the mechanism under test.
      fakeTokenStore.add('action-poll')
      return { name: 'Bob', rejoined: false, participants: [{ poll_id: 'action-poll', participant_id: 'p1', token: 'tok-1' }] }
    })

    render(
      <MemoryRouter initialEntries={['/e/glarm26']}>
        <Routes>
          <Route path="/e/:slug" element={<EventPage />} />
        </Routes>
      </MemoryRouter>
    )

    // Wait for the initial (pre-join, unshuffled) fetch and the join form.
    const nameInput = await screen.findByPlaceholderText('Your name')
    expect(getEventCalls).toBe(1)

    fireEvent.change(nameInput, { target: { value: 'Bob' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Join/ }))
    })

    // The join must have triggered a second, token-scoped fetch...
    await waitFor(() => expect(getEventCalls).toBe(2))

    // ...and VotingPhase must render using that shuffled response, not the
    // stale pre-join order it would otherwise have seeded from at mount.
    await waitFor(() => {
      const titles = screen.getAllByText(/^Movie [ABC]$/).map(el => el.textContent)
      expect(titles).toEqual(['Movie C', 'Movie A', 'Movie B'])
    })

    // The header must also show the name the participant just joined as.
    expect(screen.getByText(/Voting as Bob/)).toBeTruthy()
  })
})

describe('EventPage header voter stats', () => {
  afterEach(() => {
    cleanup()
    fakeTokenStore.clear()
  })

  it.each([
    [0, '0 Vote Submissions', false],
    [1, '1 Vote Submission', true],
    [2, '2 Vote Submissions', false],
  ])('renders "%s" as "%s"', async (count, expectedText, singular) => {
    fakeTokenStore.add('action-poll')
    vi.mocked(api.getEvent).mockResolvedValue(buildEvent(['a', 'b', 'c'], count))

    render(
      <MemoryRouter initialEntries={['/e/glarm26']}>
        <Routes>
          <Route path="/e/:slug" element={<EventPage />} />
        </Routes>
      </MemoryRouter>
    )

    // For the singular case, use a negative lookahead so this fails if the
    // component incorrectly renders "1 Vote Submissions" — a plain
    // exact:false substring match would pass vacuously in that case.
    const expected = singular ? /1 Vote Submission(?!s)/ : expectedText
    expect(await screen.findByText(expected, { exact: false })).toBeTruthy()
  })
})
