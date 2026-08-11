# Event Admin Voter Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an event admin a view listing every joined participant's name and how many of the event's category polls they've submitted a vote in (0 to the event's category count).

**Architecture:** A new admin-gated route `GET /events/:slug/voters` computes the roster from two batched queries (participants + distinct poll/participant vote pairs), merging same-named joiners case-insensitively — mirroring the existing `voter_count` dedup pattern already in this file. The frontend adds a new mode to the existing `EventAdminControls` state machine that fetches and displays the roster on demand.

**Tech Stack:** Hono 4 + D1 (`@cloudflare/vitest-pool-workers`) on the worker side; React 18 + Vitest/@testing-library/react on the frontend. No new dependencies.

## Global Constraints

- "Voter" = anyone with a `participants` row in any of the event's linked polls (joining creates one in every linked poll immediately, regardless of voting) — includes people with 0 submissions.
- Matching key across polls: lowercase name, same as the existing `voterNames`/`voter_count` pattern already in `worker/src/routes/events.ts`.
- "Submission count" = number of DISTINCT category polls in which that person has at least one `votes` row (a ranked ballot's multiple vote rows in one poll still count as 1).
- Sort order: alphabetical by name, case-insensitive (`localeCompare` with `sensitivity: 'base'`).
- Response shape: `{ voters: Array<{ name: string; submitted_count: number }>, total_categories: number }`.
- Route gated by the existing `eventAdminAuth` middleware (401 for missing/invalid admin token) — same pattern as `/pause`, `/votes-visible`, `DELETE /:slug`.
- No new DB queries beyond 2 batched ones (no N+1) — this codebase has a documented history of timeout bugs from N+1 patterns in `events.ts`.

---

### Task 1: Backend `GET /events/:slug/voters`

**Files:**
- Modify: `worker/src/routes/events.ts`
- Test: `worker/test/events.test.ts`

**Interfaces:**
- Consumes: existing `eventAdminAuth` middleware (`worker/src/middleware/auth.ts`, already imported in `events.ts`).
- Produces: `GET /events/:slug/voters` → `{ voters: Array<{ name: string; submitted_count: number }>, total_categories: number }` on success; `404` for an unknown slug; `401` via `eventAdminAuth` for a missing/invalid admin token. No new exported functions — this is route-local logic, not reused elsewhere.

- [ ] **Step 1: Write the failing tests**

Add this new `describe` block to `worker/test/events.test.ts` (place it after the existing `describe('DELETE /events/:slug', ...)` block, at the end of the file):

```ts
describe('GET /events/:slug/voters', () => {
  beforeEach(applySchema)

  it('rejects an invalid admin token', async () => {
    const { id: pollA } = await seedPoll()
    await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)

    const res = await SELF.fetch('http://example.com/events/glarm26/voters?admin=wrong')
    expect(res.status).toBe(401)
  })

  it('returns 404 for an unknown slug', async () => {
    const res = await SELF.fetch('http://example.com/events/nope/voters?admin=whatever')
    expect(res.status).toBe(404)
  })

  it('reports submitted_count per voter, including a 0-submission joiner', async () => {
    const { id: pollA } = await seedPoll({ voting_method: 'plurality' })
    const { id: pollB } = await seedPoll({ voting_method: 'plurality' })
    const { id: alice } = await seedParticipant(pollA, 'Alice')
    await seedParticipant(pollB, 'Alice')
    const { id: bob } = await seedParticipant(pollA, 'Bob')
    await seedParticipant(pollB, 'Carol')
    const { id: nomA } = await seedNomination(pollA, alice, 'Movie A')
    const { id: nomB } = await seedNomination(pollB, alice, 'Movie B')

    // Alice votes in both polls, Bob votes in one, Carol never votes.
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v1', pollA, alice, nomA, null, Date.now()).run()
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v2', pollB, alice, nomB, null, Date.now()).run()
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v3', pollA, bob, nomA, null, Date.now()).run()

    const { adminToken } = await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)
    await seedEventPoll('glarm26', pollB, 'Comedy', 1)

    const res = await SELF.fetch(`http://example.com/events/glarm26/voters?admin=${adminToken}`)
    expect(res.status).toBe(200)
    const body = await res.json() as { voters: Array<{ name: string; submitted_count: number }>; total_categories: number }
    expect(body.total_categories).toBe(2)
    expect(body.voters).toHaveLength(3)
    const byName = Object.fromEntries(body.voters.map(v => [v.name, v.submitted_count]))
    expect(byName['Alice']).toBe(2)
    expect(byName['Bob']).toBe(1)
    expect(byName['Carol']).toBe(0)
  })

  it('merges the same person across polls case-insensitively into one row', async () => {
    const { id: pollA } = await seedPoll({ voting_method: 'plurality' })
    const { id: pollB } = await seedPoll({ voting_method: 'plurality' })
    const { id: aliceA } = await seedParticipant(pollA, 'Alice')
    await seedParticipant(pollB, 'alice')
    const { id: nomA } = await seedNomination(pollA, aliceA, 'Movie A')
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v1', pollA, aliceA, nomA, null, Date.now()).run()

    const { adminToken } = await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)
    await seedEventPoll('glarm26', pollB, 'Comedy', 1)

    const res = await SELF.fetch(`http://example.com/events/glarm26/voters?admin=${adminToken}`)
    const body = await res.json() as { voters: Array<{ name: string; submitted_count: number }> }
    expect(body.voters).toHaveLength(1)
    expect(body.voters[0]!.submitted_count).toBe(1)
  })

  it('sorts voters alphabetically, case-insensitively', async () => {
    const { id: pollA } = await seedPoll()
    await seedParticipant(pollA, 'carol')
    await seedParticipant(pollA, 'Alice')
    await seedParticipant(pollA, 'Bob')

    const { adminToken } = await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)

    const res = await SELF.fetch(`http://example.com/events/glarm26/voters?admin=${adminToken}`)
    const body = await res.json() as { voters: Array<{ name: string }> }
    expect(body.voters.map(v => v.name)).toEqual(['Alice', 'Bob', 'carol'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run test/events.test.ts`
Expected: FAIL — `404`/connection errors, since the route doesn't exist yet (Hono returns 404 for any unmatched route by default).

- [ ] **Step 3: Implement the route**

Add this new route to `worker/src/routes/events.ts`, after the existing `eventsRouter.delete('/:slug', eventAdminAuth, ...)` block (at the end of the file, before the final closing of the file):

```ts
eventsRouter.get('/:slug/voters', eventAdminAuth, async (c) => {
  const slug = c.req.param('slug')
  const { results: links } = await c.env.DB.prepare(
    'SELECT poll_id FROM event_polls WHERE event_id = ?'
  ).bind(slug).all<{ poll_id: string }>()
  if (links.length === 0) return c.json({ error: 'Event not found' }, 404)

  const pollIds = links.map(l => l.poll_id)
  const placeholders = pollIds.map(() => '?').join(',')

  const [{ results: participants }, { results: votes }] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, poll_id, name FROM participants WHERE poll_id IN (${placeholders})`
    ).bind(...pollIds).all<{ id: string; poll_id: string; name: string }>(),
    c.env.DB.prepare(
      `SELECT DISTINCT poll_id, participant_id FROM votes WHERE poll_id IN (${placeholders})`
    ).bind(...pollIds).all<{ poll_id: string; participant_id: string }>(),
  ])

  const votedPollsByParticipant = new Map<string, Set<string>>()
  for (const v of votes) {
    if (!votedPollsByParticipant.has(v.participant_id)) votedPollsByParticipant.set(v.participant_id, new Set())
    votedPollsByParticipant.get(v.participant_id)!.add(v.poll_id)
  }

  const byName = new Map<string, { displayName: string; votedPolls: Set<string> }>()
  for (const p of participants) {
    const key = p.name.toLowerCase()
    if (!byName.has(key)) byName.set(key, { displayName: p.name, votedPolls: new Set() })
    const votedPolls = votedPollsByParticipant.get(p.id)
    if (votedPolls) for (const pollId of votedPolls) byName.get(key)!.votedPolls.add(pollId)
  }

  const voters = [...byName.values()]
    .map(({ displayName, votedPolls }) => ({ name: displayName, submitted_count: votedPolls.size }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

  return c.json({ voters, total_categories: pollIds.length })
})
```

No new imports are needed — `eventAdminAuth` is already imported at the top of `events.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run test/events.test.ts`
Expected: PASS — all 4 new cases plus every pre-existing test in the file.

- [ ] **Step 5: Run the full worker suite**

Run: `cd worker && npm test`
Expected: PASS (no regressions in other route files).

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/events.ts worker/test/events.test.ts
git commit -m "feat: add admin-only GET /events/:slug/voters roster endpoint"
```

---

### Task 2: Frontend voter roster view in `EventAdminControls`

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/components/EventAdminControls.tsx`
- Test: `frontend/src/components/EventAdminControls.test.tsx` (new file)

**Interfaces:**
- Consumes: `GET /events/:slug/voters` from Task 1, response shape `{ voters: Array<{ name: string; submitted_count: number }>, total_categories: number }`.
- Produces: `EventVoter` type, `api.getEventVoters(slug, adminToken)`, and a new `'voters'` mode in `EventAdminControls`. No other component depends on these.

- [ ] **Step 1: Add the type**

In `frontend/src/types.ts`, add (anywhere near the other small response-shaped interfaces, e.g. after `EventPayload`):

```ts
export interface EventVoter {
  name: string
  submitted_count: number
}
```

- [ ] **Step 2: Add the API client method**

In `frontend/src/api/client.ts`, add `EventVoter` to the existing type-only import at the top of the file (`import type { Poll, PollResults, PublicPollSummary, SearchResult, EventPayload } from '../types'` → add `EventVoter` to that list), then add this method to the `api` object, near the other event admin methods (`closeEvent`/`toggleEventPause`/`toggleEventVotesVisible`/`deleteEvent`):

```ts
  getEventVoters: async (slug: string, adminToken: string): Promise<{ voters: EventVoter[]; total_categories: number }> => {
    const res = await throwIfError(await fetch(`${BASE}/events/${slug}/voters?admin=${adminToken}`))
    return res.json()
  },
```

- [ ] **Step 3: Write the failing component test**

Create `frontend/src/components/EventAdminControls.test.tsx`:

```tsx
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
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/EventAdminControls.test.tsx`
Expected: FAIL — no "View voters" button exists yet.

- [ ] **Step 5: Implement the component changes**

In `frontend/src/components/EventAdminControls.tsx`:

Add `EventVoter` to the type-only import at the top (`import type { EventPayload } from '../types'` → `import type { EventPayload, EventVoter } from '../types'`).

Change the `Mode` type:
```ts
type Mode = 'default' | 'deleting' | 'deleted' | 'voters'
```

Add new state, alongside the existing `useState` calls:
```ts
  const [voters, setVoters] = useState<EventVoter[] | null>(null)
  const [totalCategories, setTotalCategories] = useState(0)
  const [votersLoading, setVotersLoading] = useState(false)
```

Add a handler, alongside the existing `handleClose`/`handleTogglePause`/`handleToggleVotesVisible`:
```ts
  const handleViewVoters = async () => {
    setMode('voters')
    setVotersLoading(true)
    setError(null)
    try {
      const data = await api.getEventVoters(event.id, adminToken)
      setVoters(data.voters)
      setTotalCategories(data.total_categories)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load voters')
    } finally {
      setVotersLoading(false)
    }
  }
```

Update the `isWide` line to include the new mode:
```ts
  const isWide = mode === 'deleting' || mode === 'deleted' || mode === 'voters'
```

In the `mode === 'default'` block, add a new button after the existing "Show live results"/"Hide live results" button and before the "Delete event" button:
```tsx
          <button
            onClick={handleViewVoters}
            className="w-full text-xs font-semibold py-2 rounded-xl transition-colors border border-line hover:border-line-bright text-ink-2 hover:text-ink"
          >
            👥 View voters
          </button>
```

Add a new `mode === 'voters'` block, after the existing `mode === 'deleting'` block and before the `mode === 'deleted'` block:
```tsx
      {mode === 'voters' && (
        <>
          <p className="text-xs font-semibold text-ink">Voters ({voters?.length ?? 0})</p>
          {votersLoading && <p className="text-ink-3 text-xs animate-pulse">Loading…</p>}
          {!votersLoading && voters && (
            <div className="max-h-64 overflow-y-auto space-y-1.5">
              {voters.map(v => (
                <div key={v.name} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-ink truncate">{v.name}</span>
                  <span className="text-ink-3 tabular-nums flex-shrink-0">{v.submitted_count}/{totalCategories}</span>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => { setError(null); setVoters(null); setMode('default') }}
            className="w-full text-xs text-ink-3 hover:text-ink border border-line rounded-xl py-2 transition-colors"
          >
            ← Back
          </button>
        </>
      )}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/EventAdminControls.test.tsx`
Expected: PASS — both new cases.

- [ ] **Step 7: Type-check, build, and run the full frontend suite**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: no type errors, build succeeds.

Run: `cd frontend && npx vitest run`
Expected: full frontend suite passes (no regressions in `EventPage.test.tsx` or elsewhere, since `EventAdminControls` is rendered from there).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/types.ts frontend/src/api/client.ts frontend/src/components/EventAdminControls.tsx frontend/src/components/EventAdminControls.test.tsx
git commit -m "feat: add voter roster view to event admin panel"
```

## Final Verification

- [ ] Run the full worker suite: `cd worker && npm test` — expect all green.
- [ ] Run the full frontend suite: `cd frontend && npx vitest run` — expect all green.
- [ ] Run `cd frontend && npm run build` — expect success.
