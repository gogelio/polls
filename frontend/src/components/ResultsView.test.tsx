// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ResultsView } from './ResultsView'
import type { Poll, PollResults } from '../types'
import { api } from '../api/client'

vi.mock('../api/client', () => ({
  api: {
    getResults: vi.fn(),
  },
}))

afterEach(() => cleanup())

function buildPoll(overrides: Partial<Poll> = {}): Poll {
  return {
    id: 'poll1',
    title: 'Test Poll',
    category: 'movie',
    voting_method: 'ranked_choice',
    phase: 'closed',
    max_nominations: 5,
    nominations_visible: true,
    votes_visible: true,
    is_public: true,
    is_paused: false,
    nomination_closes_at: null,
    nominations: null,
    has_voted: true,
    draft_ranking: null,
    own_vote: null,
    participant_count: 2,
    created_at: 1,
    ...overrides,
  }
}

function buildResults(): PollResults {
  return {
    poll_id: 'poll1',
    voting_method: 'ranked_choice',
    total_voters: 2,
    tied: false,
    results: [
      { nomination_id: 'a', title: 'Movie A', metadata: null, nominated_by: 'Alice', score: 10, percentage: 60 },
      { nomination_id: 'b', title: 'Movie B', metadata: null, nominated_by: 'Bob', score: 6, percentage: 40 },
    ],
  }
}

async function renderResults(poll: Poll, props: { hideNominatedBy?: boolean } = {}) {
  vi.mocked(api.getResults).mockResolvedValue(buildResults())
  render(
    <MemoryRouter>
      <ResultsView poll={poll} {...props} />
    </MemoryRouter>
  )
  await waitFor(() => expect(screen.getAllByText('Movie A').length).toBeGreaterThan(0))
}

describe('ResultsView own-pick marker', () => {
  it('marks the participant\'s own top pick wherever it appears, and nowhere else', async () => {
    const poll = buildPoll({ own_vote: ['b', 'a'] })
    await renderResults(poll)

    // "b" is own_vote[0] (the voter's top pick) — should be marked both as
    // the runner-up in "Full standings" and it is not the leader here, so
    // only one "Your pick" badge should render (next to Movie B).
    expect(screen.getAllByText('🎯 Your pick')).toHaveLength(1)
    const badge = screen.getByText('🎯 Your pick')
    expect(badge.closest('div')?.textContent).toContain('Movie B')
  })

  it('marks the leader when own_vote[0] is the winner', async () => {
    const poll = buildPoll({ own_vote: ['a'] })
    await renderResults(poll)

    // Leader card + standings row both show Movie A, so both get marked.
    expect(screen.getAllByText('🎯 Your pick')).toHaveLength(2)
  })

  it('shows no marker at all when own_vote is null', async () => {
    const poll = buildPoll({ own_vote: null })
    await renderResults(poll)

    expect(screen.queryByText('🎯 Your pick')).toBeNull()
  })
})

describe('ResultsView hideNominatedBy', () => {
  it('shows "nominated by" by default', async () => {
    const poll = buildPoll()
    await renderResults(poll)

    expect(screen.getAllByText(/nominated by/).length).toBeGreaterThan(0)
  })

  it('hides "nominated by" when hideNominatedBy is set (event usage)', async () => {
    const poll = buildPoll()
    await renderResults(poll, { hideNominatedBy: true })

    expect(screen.queryByText(/nominated by/)).toBeNull()
  })
})
