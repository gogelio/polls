# Event Header Voter Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the event page header to show "{votedCount} of {N} categories voted | {voter_count} Vote Submission(s) | Voting as {name}".

**Architecture:** Backend adds a `voter_count` field to `GET /events/:slug` — a count of distinct participant names with at least one vote across any linked poll (each event participant is a separate per-poll row with a shared name, so this requires de-duplicating by name across polls). Frontend renders the count plus a persisted display name (stored in `localStorage` alongside the existing per-poll tokens) in the event header.

**Tech Stack:** Hono + D1 (worker), React + Vitest/Testing Library (frontend). Follows patterns already established in `worker/src/routes/events.ts` and `frontend/src/pages/EventPage.tsx`.

## Global Constraints

- `voter_count` is always included in the response regardless of any poll's `votes_visible` setting — it's a headcount, not vote content, matching how `Poll.participant_count` is already always shown (see spec: `docs/superpowers/specs/2026-08-06-event-header-voter-stats-design.md`).
- Pluralize "Vote Submission" / "Vote Submissions" correctly (singular only at exactly 1).
- All three header sections stay gated behind the existing `!needsJoin` check in `EventPage.tsx` — no new gating logic.

---

### Task 1: Backend — `voter_count` on `GET /events/:slug`

**Files:**
- Modify: `worker/src/routes/events.ts:62-84` (the `categories`/loop setup and the `for (const link of links)` loop), `worker/src/routes/events.ts:102-110` (the response body)
- Test: `worker/test/events.test.ts`

**Interfaces:**
- Produces: `GET /events/:slug` response gains a top-level `voter_count: number` field (distinct participant names with ≥1 vote, across all linked polls in the event).

- [ ] **Step 1: Write the failing tests**

Add these two tests inside the existing `describe('GET /events/:slug', ...)` block in `worker/test/events.test.ts` (after the last test in that block, before the closing `})` at line 223):

```ts
  it('counts each distinct voter once across categories, not once per vote row', async () => {
    const { id: pollA } = await seedPoll({ title: 'Action', voting_method: 'plurality' })
    const { id: pollB } = await seedPoll({ title: 'Comedy', voting_method: 'plurality' })
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id IN (?, ?)").bind(pollA, pollB).run()

    // Alice joins (and votes in) both categories; her name appears as two
    // separate participant rows, one per poll — the same as a real event.
    const { id: aliceInA } = await seedParticipant(pollA, 'Alice')
    const { id: aliceInB } = await seedParticipant(pollB, 'Alice')
    const { id: bobInA } = await seedParticipant(pollA, 'Bob')

    const { id: nomA } = await seedNomination(pollA, aliceInA, 'Movie A')
    const { id: nomB } = await seedNomination(pollB, aliceInB, 'Movie B')

    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v1', pollA, aliceInA, nomA, null, Date.now()).run()
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v2', pollB, aliceInB, nomB, null, Date.now()).run()
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v3', pollA, bobInA, nomA, null, Date.now()).run()

    await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)
    await seedEventPoll('glarm26', pollB, 'Comedy', 1)

    const res = await SELF.fetch('http://example.com/events/glarm26')
    expect(res.status).toBe(200)
    const body = await res.json() as { voter_count: number }
    // Alice voted in both categories but counts once; Bob counts once. Not 3.
    expect(body.voter_count).toBe(2)
  })

  it('reports voter_count of 0 when no votes have been cast', async () => {
    const { id: pollA } = await seedPoll({ title: 'Action' })
    await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)

    const res = await SELF.fetch('http://example.com/events/glarm26')
    expect(res.status).toBe(200)
    const body = await res.json() as { voter_count: number }
    expect(body.voter_count).toBe(0)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run test/events.test.ts`
Expected: FAIL — `body.voter_count` is `undefined`, not `2` / `0`.

- [ ] **Step 3: Implement `voter_count`**

In `worker/src/routes/events.ts`, add a `voterNames` set before the loop (near `resultsByCategory`/`visibleCategories`), populate it inside the loop, and include it in the response.

Change this block (currently lines 62-67):

```ts
  const categories: Array<{ category: string; sort_order: number; poll: NonNullable<Awaited<ReturnType<typeof buildPollResponse>>> }> = []
  const resultsByCategory = new Map<string, RankedResult[]>()
  // Mirrors GET /polls/:id/results: hidden while voting is in progress and
  // votes_visible is off, unless the requester is the event admin — a
  // closed poll's results are always public, same as everywhere else.
  const visibleCategories = new Set<string>()
```

to:

```ts
  const categories: Array<{ category: string; sort_order: number; poll: NonNullable<Awaited<ReturnType<typeof buildPollResponse>>> }> = []
  const resultsByCategory = new Map<string, RankedResult[]>()
  // Mirrors GET /polls/:id/results: hidden while voting is in progress and
  // votes_visible is off, unless the requester is the event admin — a
  // closed poll's results are always public, same as everywhere else.
  const visibleCategories = new Set<string>()
  // Each event participant is a separate row per poll (same name, distinct
  // token) — de-dupe by name to get a single event-wide voter headcount.
  const voterNames = new Set<string>()
```

Change the loop body (currently lines 77-83):

```ts
    const { results: nominations } = await c.env.DB.prepare(
      'SELECT id, title, metadata FROM nominations WHERE poll_id = ?'
    ).bind(link.poll_id).all<NominationRow>()
    const { results: votes } = await c.env.DB.prepare(
      'SELECT participant_id, nomination_id, rank FROM votes WHERE poll_id = ?'
    ).bind(link.poll_id).all<VoteRow>()
    resultsByCategory.set(link.category, rankedChoice(votes, nominations))
```

to:

```ts
    const { results: nominations } = await c.env.DB.prepare(
      'SELECT id, title, metadata FROM nominations WHERE poll_id = ?'
    ).bind(link.poll_id).all<NominationRow>()
    const { results: votes } = await c.env.DB.prepare(
      'SELECT participant_id, nomination_id, rank FROM votes WHERE poll_id = ?'
    ).bind(link.poll_id).all<VoteRow>()
    resultsByCategory.set(link.category, rankedChoice(votes, nominations))

    const { results: voters } = await c.env.DB.prepare(
      `SELECT DISTINCT p.name FROM participants p JOIN votes v ON v.participant_id = p.id WHERE v.poll_id = ?`
    ).bind(link.poll_id).all<{ name: string }>()
    for (const voter of voters) voterNames.add(voter.name)
```

Change the response body (currently lines 102-110):

```ts
  return c.json({
    id: event.id,
    title: event.title,
    is_public: event.is_public === 1,
    phase,
    categories,
    schedule,
    created_at: event.created_at,
  })
```

to:

```ts
  return c.json({
    id: event.id,
    title: event.title,
    is_public: event.is_public === 1,
    phase,
    categories,
    schedule,
    voter_count: voterNames.size,
    created_at: event.created_at,
  })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run test/events.test.ts`
Expected: PASS (all tests in the file, including the two new ones).

- [ ] **Step 5: Run the full worker test suite**

Run: `cd worker && npm test`
Expected: PASS (126+ tests, no regressions).

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/events.ts worker/test/events.test.ts
git commit -m "feat: add voter_count to GET /events/:slug"
```

---

### Task 2: Frontend — render "Vote Submissions" count in the header

**Files:**
- Modify: `frontend/src/types.ts:103-111` (`EventPayload` interface)
- Modify: `frontend/src/pages/EventPage.tsx:97-110` (header block)
- Test: `frontend/src/pages/EventPage.test.tsx`

**Interfaces:**
- Consumes: `EventPayload.voter_count: number` (from Task 1's backend response).
- Produces: header renders `"{voter_count} Vote Submission" + (voter_count === 1 ? "" : "s")`.

- [ ] **Step 1: Add `voter_count` to the `EventPayload` type**

In `frontend/src/types.ts`, change:

```ts
export interface EventPayload {
  id: string
  title: string
  is_public: boolean
  phase: Phase
  categories: EventCategory[]
  schedule: EventDay[]
  created_at: number
}
```

to:

```ts
export interface EventPayload {
  id: string
  title: string
  is_public: boolean
  phase: Phase
  categories: EventCategory[]
  schedule: EventDay[]
  voter_count: number
  created_at: number
}
```

- [ ] **Step 2: Write the failing test**

In `frontend/src/pages/EventPage.test.tsx`, the `buildEvent` helper (lines 55-99) constructs an `EventPayload` and will now fail to type-check without `voter_count`. Update it to accept a count and default to `0`:

Change the function signature (line 55) from:

```ts
function buildEvent(nominationOrder: string[]): EventPayload {
```

to:

```ts
function buildEvent(nominationOrder: string[], voterCount = 0): EventPayload {
```

And add `voter_count: voterCount,` to the returned object, alongside the existing `created_at: 1,` (line 67):

```ts
  return {
    id: 'glarm26',
    title: 'Test Event',
    is_public: true,
    phase: 'voting',
    schedule: [],
    voter_count: voterCount,
    created_at: 1,
```

Then add a new `describe` block at the end of the file (after the closing `})` of `describe('EventPage join flow', ...)`):

```ts
describe('EventPage header voter stats', () => {
  afterEach(() => {
    cleanup()
    fakeTokenStore.clear()
  })

  it.each([
    [0, '0 Vote Submissions'],
    [1, '1 Vote Submission'],
    [2, '2 Vote Submissions'],
  ])('renders "%s" as "%s"', async (count, expectedText) => {
    fakeTokenStore.add('action-poll')
    vi.mocked(api.getEvent).mockResolvedValue(buildEvent(['a', 'b', 'c'], count))

    render(
      <MemoryRouter initialEntries={['/e/glarm26']}>
        <Routes>
          <Route path="/e/:slug" element={<EventPage />} />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByText(expectedText, { exact: false })).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/EventPage.test.tsx`
Expected: FAIL — "0 Vote Submissions" / "1 Vote Submission" / "2 Vote Submissions" not found in the rendered output.

- [ ] **Step 4: Render the count in the header**

In `frontend/src/pages/EventPage.tsx`, change the header paragraph (lines 106-108):

```tsx
      {!needsJoin && (
        <p className="text-ink-3 text-sm mt-1">{votedCount} of {event.categories.length} categories voted</p>
      )}
```

to:

```tsx
      {!needsJoin && (
        <p className="text-ink-3 text-sm mt-1">
          {votedCount} of {event.categories.length} categories voted
          {' | '}{event.voter_count} Vote Submission{event.voter_count === 1 ? '' : 's'}
        </p>
      )}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/EventPage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the full frontend test suite and type check**

Run: `cd frontend && npx vitest run && npm run build`
Expected: All tests pass; `tsc` + `vite build` succeed with no type errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/types.ts frontend/src/pages/EventPage.tsx frontend/src/pages/EventPage.test.tsx
git commit -m "feat: show event-wide vote submission count in header"
```

---

### Task 3: Frontend — persist and render "Voting as {name}"

**Files:**
- Modify: `frontend/src/api/client.ts:194-203` (`joinEvent`)
- Modify: `frontend/src/pages/EventPage.tsx` (header block, following Task 2's edit)
- Test: `frontend/src/pages/EventPage.test.tsx`

**Interfaces:**
- Consumes: `joinedName` (existing state, set in `handleJoin` from `api.joinEvent`'s return value).
- Produces: header renders `"Voting as {name}"` whenever a name is known (via `joinedName`, or — in a real browser, not exercised by this project's jsdom test setup — via `localStorage.getItem(`event_name_${slug}`)` on a page reload after a previous join).

- [ ] **Step 1: Persist the name on join in the API client**

In `frontend/src/api/client.ts`, change `joinEvent` (lines 194-203) from:

```ts
  joinEvent: async (slug: string, name: string) => {
    const res = await throwIfError(await fetch(`${BASE}/events/${slug}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }))
    const data = await res.json() as { name: string; rejoined: boolean; participants: Array<{ poll_id: string; participant_id: string; token: string }> }
    data.participants.forEach(p => setToken(p.poll_id, p.token))
    return data
  },
```

to:

```ts
  joinEvent: async (slug: string, name: string) => {
    const res = await throwIfError(await fetch(`${BASE}/events/${slug}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }))
    const data = await res.json() as { name: string; rejoined: boolean; participants: Array<{ poll_id: string; participant_id: string; token: string }> }
    data.participants.forEach(p => setToken(p.poll_id, p.token))
    localStorage.setItem(`event_name_${slug}`, data.name)
    return data
  },
```

This project's jsdom test environment can't exercise real `localStorage` (see the comment at the top of `frontend/src/pages/EventPage.test.tsx:19-27` — the existing per-poll token storage has the same limitation and isn't unit-tested directly either). There's no `client.test.ts` in this codebase for `api/client.ts`; this step has no dedicated test for that reason, consistent with existing coverage of `setToken` inside `joinPoll`/`joinEvent`.

- [ ] **Step 2: Write the failing test for the join-flow display name**

In `frontend/src/pages/EventPage.test.tsx`, extend the existing test in `describe('EventPage join flow', ...)` (the one starting at line 102, `'refetches the event before unlocking the voting view...'`). After the final `await waitFor(...)` block (lines 152-155), add:

```ts
    // The header must also show the name the participant just joined as.
    expect(screen.getByText(/Voting as Bob/)).toBeTruthy()
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/EventPage.test.tsx`
Expected: FAIL — "Voting as Bob" not found.

- [ ] **Step 4: Render "Voting as {name}" in the header**

In `frontend/src/pages/EventPage.tsx`, first add a resolved display name just after the `votedCount` calculation (currently line 77, `const votedCount = event.categories.filter(cat => cat.poll.has_voted).length`):

```ts
  const votedCount = event.categories.filter(cat => cat.poll.has_voted).length
  const voterName = joinedName ?? localStorage.getItem(`event_name_${slug}`)
```

Then update the header paragraph from Task 2's result:

```tsx
      {!needsJoin && (
        <p className="text-ink-3 text-sm mt-1">
          {votedCount} of {event.categories.length} categories voted
          {' | '}{event.voter_count} Vote Submission{event.voter_count === 1 ? '' : 's'}
        </p>
      )}
```

to:

```tsx
      {!needsJoin && (
        <p className="text-ink-3 text-sm mt-1">
          {votedCount} of {event.categories.length} categories voted
          {' | '}{event.voter_count} Vote Submission{event.voter_count === 1 ? '' : 's'}
          {voterName && <>{' | '}Voting as {voterName}</>}
        </p>
      )}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/EventPage.test.tsx`
Expected: PASS (all tests in the file).

- [ ] **Step 6: Run the full frontend test suite and type check**

Run: `cd frontend && npx vitest run && npm run build`
Expected: All tests pass; `tsc` + `vite build` succeed with no type errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/pages/EventPage.tsx frontend/src/pages/EventPage.test.tsx
git commit -m "feat: persist and show \"Voting as {name}\" in event header"
```

---

### Task 4: Deploy

**Files:** none (operational task)

- [ ] **Step 1: Run full test suites one more time on the final state**

Run: `cd worker && npm test && cd ../frontend && npx vitest run && npm run build`
Expected: All green.

- [ ] **Step 2: Push `main`**

```bash
git push origin main
```

- [ ] **Step 3: Deploy the worker**

```bash
cd worker && npx wrangler deploy
```

Expected output: no config-diff warning (no drift from the last production deploy), `env.ALLOWED_ORIGINS ("https://polls.gogel.io")` listed under bindings.

- [ ] **Step 4: Confirm the Pages production deployment**

The Pages project is git-connected, so pushing `main` auto-triggers a deploy. Verify with:

```bash
npx wrangler pages deployment list --project-name polls
```

Expected: a new "Production" row on branch `main` at the just-pushed commit, status "Active" (may take a minute to build).

- [ ] **Step 5: Smoke test**

```bash
curl -s https://polls-worker.polls.workers.dev/events/glarm26 -H "Origin: https://polls.gogel.io" | python3 -c "import json,sys; d=json.load(sys.stdin); print('voter_count:', d.get('voter_count'))"
```

Expected: prints `voter_count: <some number>` (not an error, not `None`).

Then open `https://polls.gogel.io/e/glarm26` in a browser and confirm the header reads "{X} of {N} categories voted | {Y} Vote Submission(s)" (the "Voting as {name}" segment only appears for a joined participant).
