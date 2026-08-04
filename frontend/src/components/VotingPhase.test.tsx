// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VotingPhase } from './VotingPhase'
import type { Poll } from '../types'
import { api } from '../api/client'

vi.mock('../api/client', () => ({
  api: {
    saveVoteDraft: vi.fn().mockResolvedValue(undefined),
    submitVotes: vi.fn().mockResolvedValue(undefined),
    searchMoviesAsAdmin: vi.fn().mockResolvedValue([]),
    updateNomination: vi.fn().mockResolvedValue(undefined),
  },
}))

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

// jsdom returns an all-zero rect from getBoundingClientRect, which makes
// @dnd-kit's collision detection and keyboard coordinateGetter unable to
// tell sortable rows apart (every row measures as the same 0x0 box at the
// origin). Give each row a distinct rect based on its position among its
// siblings so a real up/down keyboard "drag" resolves to a real reorder.
Element.prototype.getBoundingClientRect = function (this: Element) {
  const parent = this.parentElement
  const index = parent ? Array.prototype.indexOf.call(parent.children, this) : 0
  const top = index * 60
  return {
    top, bottom: top + 56, left: 0, right: 300, width: 300, height: 56,
    x: 0, y: top, toJSON() { return this },
  } as DOMRect
}

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

// Simulates a keyboard-driven @dnd-kit reorder: focus the first sortable
// row, pick it up with Space, move it down one slot with ArrowDown, then
// drop with Space. This exercises the same handleDragEnd path a mouse drag
// would, without needing pointer-event support in jsdom.
async function dragFirstItemDown() {
  const handles = screen.getAllByText(/^Movie [ABC]$/).map(el =>
    el.closest('.bg-raised')?.querySelector('button[aria-label="Drag to reorder"]')
  ) as HTMLElement[]
  const first = handles[0]
  if (!first) throw new Error('expected a sortable row to drag')
  first.focus()
  fireEvent.keyDown(first, { code: 'Space' })
  // @dnd-kit's KeyboardSensor registers its post-activation keydown listener
  // inside a setTimeout(0), so a real macrotask tick has to elapse (a
  // microtask flush isn't enough) before the ArrowDown below is picked up.
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  fireEvent.keyDown(first, { code: 'ArrowDown' })
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  fireEvent.keyDown(first, { code: 'Space' })
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
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

  it('seeds the ballot from a draft_ranking that arrives after mount (join on a new device)', () => {
    // Simulates: component mounts with the pre-join poll fetch (no token yet,
    // so draft_ranking is null), then the next 3s poll tick delivers the
    // participant's real draft from another device.
    const initialPoll = buildPoll({ draft_ranking: null })
    const { rerender } = render(<VotingPhase poll={initialPoll} onRefetch={vi.fn()} />)
    expect(screen.getAllByText(/^Movie [ABC]$/).map(el => el.textContent)).toEqual(['Movie A', 'Movie B', 'Movie C'])

    const updatedPoll = buildPoll({ draft_ranking: ['c', 'a', 'b'] })
    rerender(<VotingPhase poll={updatedPoll} onRefetch={vi.fn()} />)

    expect(screen.getAllByText(/^Movie [ABC]$/).map(el => el.textContent)).toEqual(['Movie C', 'Movie A', 'Movie B'])
  })

  it('does not clobber an in-progress reorder when a later draft_ranking arrives', async () => {
    const initialPoll = buildPoll({ draft_ranking: null })
    const { rerender } = render(<VotingPhase poll={initialPoll} onRefetch={vi.fn()} />)

    // Participant drags item A down one slot: A, B, C -> B, A, C.
    await dragFirstItemDown()
    expect(screen.getAllByText(/^Movie [ABC]$/).map(el => el.textContent)).toEqual(['Movie B', 'Movie A', 'Movie C'])

    // A stale/unrelated draft_ranking now arrives from a poll tick. It must
    // not overwrite the order the participant already produced by dragging.
    const updatedPoll = buildPoll({ draft_ranking: ['c', 'a', 'b'] })
    rerender(<VotingPhase poll={updatedPoll} onRefetch={vi.fn()} />)

    expect(screen.getAllByText(/^Movie [ABC]$/).map(el => el.textContent)).toEqual(['Movie B', 'Movie A', 'Movie C'])
  })
})

describe('NominationMatchEditor inside a sortable row', () => {
  it('lets an admin type a space in the search box without it being swallowed by the row drag handler', async () => {
    // Regression test: {...listeners} used to be spread across the entire
    // sortable row (including the nested search input), so dnd-kit's
    // KeyboardSensor treated a Space keydown bubbling up from the input as
    // "pick up this row for dragging" and called preventDefault on it —
    // which stops the space character from ever reaching the input.
    const poll = buildPoll({ category: 'movie' })
    render(<VotingPhase poll={poll} onRefetch={vi.fn()} adminToken="admin-token" />)

    fireEvent.click(screen.getAllByRole('button', { name: '✎ Fix match' })[0]!)
    const input = screen.getByPlaceholderText(/search for the correct movie/i) as HTMLInputElement
    const user = userEvent.setup()
    await user.type(input, 'Blade II')

    expect(input.value).toBe('Blade II')
  })
})

// dnd-kit's KeyboardSensor schedules its own follow-up listener via a real
// setTimeout(0), so these tests use real timers throughout rather than
// vi.useFakeTimers() — swapping in fake timers mid-test wouldn't fire a
// setTimeout that was already scheduled against the real clock.
function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('VotingPhase draft autosave debounce', () => {
  beforeEach(() => {
    vi.mocked(api.saveVoteDraft).mockClear()
    vi.mocked(api.saveVoteDraft).mockResolvedValue(undefined)
    vi.mocked(api.submitVotes).mockClear()
    vi.mocked(api.submitVotes).mockResolvedValue(undefined)
  })

  it('saves once, with the new order, after the debounce window elapses', async () => {
    const poll = buildPoll({ draft_ranking: null })
    render(<VotingPhase poll={poll} onRefetch={vi.fn()} />)

    await dragFirstItemDown()
    expect(api.saveVoteDraft).not.toHaveBeenCalled()

    await act(async () => { await sleep(1300) })

    expect(api.saveVoteDraft).toHaveBeenCalledTimes(1)
    expect(api.saveVoteDraft).toHaveBeenCalledWith('poll1', ['b', 'a', 'c'])
  }, 10000)

  it('collapses two reorders within the debounce window into a single save of the final order', async () => {
    const poll = buildPoll({ draft_ranking: null })
    render(<VotingPhase poll={poll} onRefetch={vi.fn()} />)

    await dragFirstItemDown()
    await act(async () => { await sleep(600) })
    expect(api.saveVoteDraft).not.toHaveBeenCalled()
    await dragFirstItemDown()
    await act(async () => { await sleep(1300) })

    expect(api.saveVoteDraft).toHaveBeenCalledTimes(1)
  }, 10000)

  it('never saves if the component unmounts before the debounce fires', async () => {
    const poll = buildPoll({ draft_ranking: null })
    const { unmount } = render(<VotingPhase poll={poll} onRefetch={vi.fn()} />)

    await dragFirstItemDown()
    unmount()
    await sleep(1300)

    expect(api.saveVoteDraft).not.toHaveBeenCalled()
  }, 10000)

  it('never saves if the vote is submitted before the debounce fires', async () => {
    const poll = buildPoll({ draft_ranking: null, votes_visible: false })
    render(<VotingPhase poll={poll} onRefetch={vi.fn()} />)

    await dragFirstItemDown()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /submit vote/i }))
      await sleep(0)
    })
    expect(screen.queryByText(/vote submitted/i)).not.toBeNull()

    await act(async () => { await sleep(1300) })

    expect(api.saveVoteDraft).not.toHaveBeenCalled()
  }, 10000)
})
