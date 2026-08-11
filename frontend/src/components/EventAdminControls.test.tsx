// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { EventAdminControls } from './EventAdminControls'
import type { EventPayload } from '../types'
import { api } from '../api/client'

vi.mock('../api/client', () => ({
  api: {
    getEventVoters: vi.fn(),
  },
}))

afterEach(() => cleanup())

function buildEvent(overrides: Partial<EventPayload> = {}): EventPayload {
  return {
    id: 'glarm26',
    title: 'Test Event',
    is_public: true,
    phase: 'voting',
    schedule: [],
    voter_count: 2,
    created_at: 1,
    categories: [
      {
        category: 'Action',
        sort_order: 0,
        poll: {
          id: 'action-poll',
          title: 'Action',
          category: 'movie',
          voting_method: 'plurality',
          phase: 'voting',
          max_nominations: 5,
          nominations_visible: true,
          votes_visible: true,
          is_public: true,
          is_paused: false,
          nomination_closes_at: null,
          nominations: null,
          has_voted: false,
          draft_ranking: null,
          own_vote: null,
          participant_count: 2,
          created_at: 1,
        },
      },
    ],
    ...overrides,
  }
}

describe('EventAdminControls voter roster', () => {
  it('fetches and renders the voter roster when "View voters" is clicked', async () => {
    vi.mocked(api.getEventVoters).mockResolvedValue({
      voters: [
        { name: 'Alice', submitted_count: 2 },
        { name: 'Bob', submitted_count: 0 },
      ],
      total_categories: 2,
    })

    render(
      <EventAdminControls
        event={buildEvent()}
        adminToken="tok-1"
        onRefetch={() => {}}
        onDeleted={() => {}}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /View voters/ }))

    await waitFor(() => expect(api.getEventVoters).toHaveBeenCalledWith('glarm26', 'tok-1'))
    expect(await screen.findByText('Alice')).toBeTruthy()
    expect(screen.getByText('2/2')).toBeTruthy()
    expect(screen.getByText('Bob')).toBeTruthy()
    expect(screen.getByText('0/2')).toBeTruthy()
  })

  it('returns to the default panel when "Back" is clicked', async () => {
    vi.mocked(api.getEventVoters).mockResolvedValue({
      voters: [{ name: 'Alice', submitted_count: 1 }],
      total_categories: 1,
    })

    render(
      <EventAdminControls
        event={buildEvent()}
        adminToken="tok-1"
        onRefetch={() => {}}
        onDeleted={() => {}}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /View voters/ }))
    await screen.findByText('Alice')

    fireEvent.click(screen.getByRole('button', { name: /Back/ }))

    expect(screen.queryByText('Alice')).toBeNull()
    expect(screen.getByRole('button', { name: /View voters/ })).toBeTruthy()
  })
})
