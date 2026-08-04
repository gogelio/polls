// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { VotingPhase } from './VotingPhase'
import type { Poll } from '../types'

// This project doesn't set `test.globals: true` in vite.config.ts, so
// @testing-library/react's automatic afterEach cleanup (which relies on a
// global `afterEach`) never registers. Wire it up explicitly, scoped to this
// file, so each test starts from an empty DOM.
afterEach(() => cleanup())

// jsdom has no ResizeObserver; @dnd-kit's measuring hooks expect one to exist.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = global.ResizeObserver ?? ResizeObserverStub

function buildPoll(overrides: Partial<Poll> = {}): Poll {
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
    nominations: [
      { id: 'a', title: 'Movie A', metadata: null, participant_name: 'Alice', created_at: 1 },
      { id: 'b', title: 'Movie B', metadata: null, participant_name: 'Alice', created_at: 2 },
      { id: 'c', title: 'Movie C', metadata: null, participant_name: 'Alice', created_at: 3 },
    ],
    has_voted: false,
    participant_count: 1,
    created_at: 1,
    draft_ranking: null,
    ...overrides,
  }
}

describe('VotingPhase draft ordering', () => {
  it('renders the ballot in draft_ranking order instead of nomination order', () => {
    const poll = buildPoll({ draft_ranking: ['c', 'a', 'b'] })
    render(<VotingPhase poll={poll} onRefetch={vi.fn()} />)

    const titles = screen.getAllByText(/^Movie [ABC]$/).map(el => el.textContent)
    expect(titles).toEqual(['Movie C', 'Movie A', 'Movie B'])
  })

  it('falls back to nomination order when there is no draft', () => {
    const poll = buildPoll({ draft_ranking: null })
    render(<VotingPhase poll={poll} onRefetch={vi.fn()} />)

    const titles = screen.getAllByText(/^Movie [ABC]$/).map(el => el.textContent)
    expect(titles).toEqual(['Movie A', 'Movie B', 'Movie C'])
  })
})
