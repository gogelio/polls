// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Bracket } from './Bracket'
import type { EventDay } from '../types'

afterEach(() => cleanup())

function buildSchedule(status: EventDay['slots'][number]['status'], movies: EventDay['slots'][number]['movies'] = []): EventDay[] {
  return [
    {
      day: 'Thursday',
      slots: [{ slot_order: 1, category: 'Action', placement: 1, status, movies }],
    },
  ]
}

describe('Bracket', () => {
  it('shows the resolved movie title when a slot is resolved', () => {
    render(<Bracket schedule={buildSchedule('resolved', [{ nomination_id: 'n1', title: 'Mad Max' }])} />)
    expect(screen.getByText('Mad Max')).toBeTruthy()
  })

  it('shows a hidden placeholder without leaking the movie title when a slot is hidden', () => {
    // Regression test: GET /events/:slug used to compute and expose the
    // resolved winner for every schedule slot regardless of that category's
    // votes_visible setting — this is the frontend half of fixing that, so
    // a "hidden" slot must never render its (unset, but future-proofing)
    // movies array.
    render(<Bracket schedule={buildSchedule('hidden')} />)
    expect(screen.getByText('Hidden until reveal')).toBeTruthy()
    expect(screen.queryByText('Mad Max')).toBeNull()
  })

  it('shows an awaiting-votes placeholder when no votes have been cast yet', () => {
    render(<Bracket schedule={buildSchedule('awaiting_votes')} />)
    expect(screen.getByText('Awaiting votes')).toBeTruthy()
  })

  it('shows a tied placeholder when a slot is unresolved', () => {
    render(<Bracket schedule={buildSchedule('unresolved')} />)
    expect(screen.getByText('Tied — not yet decided')).toBeTruthy()
  })

  it('renders nothing for an empty schedule', () => {
    const { container } = render(<Bracket schedule={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
