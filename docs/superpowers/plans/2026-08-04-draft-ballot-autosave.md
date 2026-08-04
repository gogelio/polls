# Draft Ballot Autosave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a voter's in-progress ranked-choice/ranked-pairs ballot order server-side, keyed to their existing participant identity, so it survives an abandoned session and follows them across devices — without ever influencing live results.

**Architecture:** Add a `draft_ranking` column directly to the existing `participants` table (a participant already belongs to exactly one poll, so no new table is needed). A new `PATCH /polls/:id/vote-draft` endpoint upserts it; `GET /polls/:id` returns it to the owning participant only; the final `POST /polls/:id/votes` clears it in the same atomic batch that writes the real vote. The frontend seeds the ballot from it on load and autosaves (debounced) on every reorder.

**Tech Stack:** Hono + D1 (worker), React + `@dnd-kit` (frontend), Vitest (`@cloudflare/vitest-pool-workers` for worker, jsdom for frontend component tests).

## Global Constraints

- Draft autosave applies only to `ranked_choice` and `ranked_pairs` polls — never `plurality`.
- `draft_ranking` must never be read by `GET /polls/:id/results` or any results computation — only the `votes` table feeds results. This is a structural invariant, verified by a test.
- Debounce autosave by ~1.2s after the last reorder; no retry loop on failure (the next reorder retries naturally).
- No draft expiry/cleanup job — out of scope.
- No merge logic for concurrent multi-device edits — last write wins.

---

### Task 1: `PATCH /polls/:id/vote-draft` endpoint

**Files:**
- Create: `worker/migrations/0005_draft_ranking.sql`
- Modify: `worker/test/helpers.ts` (schema copy used by tests)
- Modify: `worker/src/routes/votes.ts`
- Test: `worker/test/votes.test.ts`

**Interfaces:**
- Produces: `PATCH /polls/:id/vote-draft` — participant-authed. Body `{ ranking: string[] }`. Returns `200 { success: true }` on success; `404` poll not found; `400` wrong phase / plurality poll / bad ranking / unknown nomination id.
- Produces (DB): `participants.draft_ranking TEXT` column — JSON-encoded array of nomination IDs, or `NULL`.

- [ ] **Step 1: Write the failing tests**

Add to `worker/test/votes.test.ts` (new `describe` block, after the existing `GET /polls/:id/results` block):

```ts
describe('PATCH /polls/:id/vote-draft', () => {
  beforeEach(applySchema)

  it('saves a draft ranking', async () => {
    const { id } = await seedPoll({ voting_method: 'ranked_choice' })
    const { id: pid, token } = await seedParticipant(id)
    const { id: nid1 } = await seedNomination(id, pid, 'A')
    const { id: nid2 } = await seedNomination(id, pid, 'B')
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()

    const res = await SELF.fetch(`http://example.com/polls/${id}/vote-draft`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': token },
      body: JSON.stringify({ ranking: [nid2, nid1] }),
    })
    expect(res.status).toBe(200)

    const row = await env.DB.prepare('SELECT draft_ranking FROM participants WHERE id = ?').bind(pid).first<{ draft_ranking: string }>()
    expect(JSON.parse(row!.draft_ranking)).toEqual([nid2, nid1])
  })

  it('requires participant auth', async () => {
    const { id } = await seedPoll({ voting_method: 'ranked_choice' })
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    const res = await SELF.fetch(`http://example.com/polls/${id}/vote-draft`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ranking: ['x'] }),
    })
    expect(res.status).toBe(401)
  })

  it('rejects when poll is not in voting phase', async () => {
    const { id } = await seedPoll({ voting_method: 'ranked_choice' })
    const { id: pid, token } = await seedParticipant(id)
    const { id: nid } = await seedNomination(id, pid)
    const res = await SELF.fetch(`http://example.com/polls/${id}/vote-draft`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': token },
      body: JSON.stringify({ ranking: [nid] }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects plurality polls', async () => {
    const { id } = await seedPoll({ voting_method: 'plurality' })
    const { id: pid, token } = await seedParticipant(id)
    const { id: nid } = await seedNomination(id, pid)
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    const res = await SELF.fetch(`http://example.com/polls/${id}/vote-draft`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': token },
      body: JSON.stringify({ ranking: [nid] }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects a ranking containing a nomination from another poll', async () => {
    const { id } = await seedPoll({ voting_method: 'ranked_choice' })
    const { id: otherId } = await seedPoll({ voting_method: 'ranked_choice' })
    const { id: pid, token } = await seedParticipant(id)
    const { id: otherPid } = await seedParticipant(otherId)
    const { id: foreignNid } = await seedNomination(otherId, otherPid, 'Foreign')
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    const res = await SELF.fetch(`http://example.com/polls/${id}/vote-draft`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': token },
      body: JSON.stringify({ ranking: [foreignNid] }),
    })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run test/votes.test.ts`
Expected: FAIL — `404`/`400` on a route that doesn't exist yet (Hono returns 404 for unmatched routes), and the schema doesn't yet have `draft_ranking` so the first test's follow-up query would also error.

- [ ] **Step 3: Add the migration and update the test schema**

Create `worker/migrations/0005_draft_ranking.sql`:

```sql
ALTER TABLE participants ADD COLUMN draft_ranking TEXT;
```

In `worker/test/helpers.ts`, update the `participants` table definition inside the `SCHEMA` template string:

```sql
CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY, poll_id TEXT NOT NULL, name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE, joined_at INTEGER NOT NULL, draft_ranking TEXT
);
```

- [ ] **Step 4: Implement the route**

In `worker/src/routes/votes.ts`, add after the closing `})` of the existing `votesRouter.post('/:id/votes', ...)` handler and before `votesRouter.get('/:id/results', ...)`:

```ts
votesRouter.patch('/:id/vote-draft', participantAuth, async (c) => {
  const pollId = c.req.param('id')
  const participantId = c.get('participantId')

  const poll = await c.env.DB.prepare(
    'SELECT id, phase, voting_method FROM polls WHERE id = ?'
  ).bind(pollId).first<Pick<Poll, 'id' | 'phase' | 'voting_method'>>()
  if (!poll) return c.json({ error: 'Poll not found' }, 404)
  if (poll.phase !== 'voting') return c.json({ error: 'Poll is not in voting phase' }, 400)
  if (poll.voting_method === 'plurality') {
    return c.json({ error: 'Drafts are not supported for plurality polls' }, 400)
  }

  const body = await c.req.json<{ ranking?: string[] }>()
  const ranking = body.ranking
  if (!Array.isArray(ranking) || ranking.length === 0) {
    return c.json({ error: 'ranking must be a non-empty array' }, 400)
  }

  const { results: nomResults } = await c.env.DB.prepare(
    'SELECT id FROM nominations WHERE poll_id = ?'
  ).bind(pollId).all<{ id: string }>()
  const validNomIds = new Set(nomResults.map(n => n.id))
  for (const nomId of ranking) {
    if (!validNomIds.has(nomId)) {
      return c.json({ error: `Nomination ${nomId} not found in this poll` }, 400)
    }
  }

  await c.env.DB.prepare(
    'UPDATE participants SET draft_ranking = ? WHERE id = ?'
  ).bind(JSON.stringify(ranking), participantId).run()

  return c.json({ success: true })
})
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd worker && npx vitest run test/votes.test.ts`
Expected: PASS (all tests in the file, including the pre-existing ones)

- [ ] **Step 6: Apply the migration locally and to `polls-dev`**

```bash
cd worker
npx wrangler d1 migrations apply polls --local
npx wrangler d1 migrations apply polls-dev --env dev --remote
```

- [ ] **Step 7: Commit**

```bash
git add worker/migrations/0005_draft_ranking.sql worker/test/helpers.ts worker/src/routes/votes.ts worker/test/votes.test.ts
git commit -m "feat: add PATCH /polls/:id/vote-draft endpoint for ballot drafts"
```

---

### Task 2: Expose `draft_ranking` on `GET /polls/:id`

**Files:**
- Modify: `worker/src/lib/pollDetail.ts`
- Test: `worker/test/polls.test.ts`

**Interfaces:**
- Consumes: `participants.draft_ranking` column (Task 1).
- Produces: `PollDetail.draft_ranking: string[] | null` — populated only for the requesting participant, only when `phase === 'voting'`, `voting_method !== 'plurality'`, and they haven't voted yet.

- [ ] **Step 1: Write the failing test**

Add to `worker/test/polls.test.ts` (check the existing file first for its exact `describe`/import style, then add a new `it` inside the `GET /polls/:id` describe block, or a new describe block if none exists — match whichever pattern the file already uses):

```ts
describe('GET /polls/:id draft_ranking', () => {
  beforeEach(applySchema)

  it('returns the requesting participant draft_ranking during voting', async () => {
    const { id } = await seedPoll({ voting_method: 'ranked_choice' })
    const { id: pid, token } = await seedParticipant(id)
    const { id: nid1 } = await seedNomination(id, pid, 'A')
    const { id: nid2 } = await seedNomination(id, pid, 'B')
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    await env.DB.prepare('UPDATE participants SET draft_ranking = ? WHERE id = ?')
      .bind(JSON.stringify([nid2, nid1]), pid).run()

    const res = await SELF.fetch(`http://example.com/polls/${id}`, {
      headers: { 'Participant-Token': token },
    })
    const body = await res.json() as { draft_ranking: string[] | null }
    expect(body.draft_ranking).toEqual([nid2, nid1])
  })

  it('omits draft_ranking once the participant has voted', async () => {
    const { id } = await seedPoll({ voting_method: 'ranked_choice' })
    const { id: pid, token } = await seedParticipant(id)
    const { id: nid } = await seedNomination(id, pid, 'A')
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    await env.DB.prepare('UPDATE participants SET draft_ranking = ? WHERE id = ?')
      .bind(JSON.stringify([nid]), pid).run()
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v1', id, pid, nid, 1, Date.now()).run()

    const res = await SELF.fetch(`http://example.com/polls/${id}`, {
      headers: { 'Participant-Token': token },
    })
    const body = await res.json() as { draft_ranking: string[] | null }
    expect(body.draft_ranking).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run test/polls.test.ts`
Expected: FAIL — `body.draft_ranking` is `undefined`, not the expected array/`null`.

- [ ] **Step 3: Implement in `pollDetail.ts`**

In `worker/src/lib/pollDetail.ts`, add `draft_ranking: string[] | null` to the `PollDetail` interface (after `has_voted: boolean`):

```ts
  has_voted: boolean
  draft_ranking: string[] | null
```

Replace the existing `hasVoted` block:

```ts
  let hasVoted = false
  if (participantToken && poll.phase !== 'nominating') {
    const participant = await env.DB.prepare(
      'SELECT id FROM participants WHERE token = ? AND poll_id = ?'
    ).bind(participantToken, id).first<{ id: string }>()
    if (participant) {
      const voteRow = await env.DB.prepare(
        'SELECT id FROM votes WHERE poll_id = ? AND participant_id = ? LIMIT 1'
      ).bind(id, participant.id).first()
      hasVoted = !!voteRow
    }
  }
```

with:

```ts
  let hasVoted = false
  let draftRanking: string[] | null = null
  if (participantToken && poll.phase !== 'nominating') {
    const participant = await env.DB.prepare(
      'SELECT id, draft_ranking FROM participants WHERE token = ? AND poll_id = ?'
    ).bind(participantToken, id).first<{ id: string; draft_ranking: string | null }>()
    if (participant) {
      const voteRow = await env.DB.prepare(
        'SELECT id FROM votes WHERE poll_id = ? AND participant_id = ? LIMIT 1'
      ).bind(id, participant.id).first()
      hasVoted = !!voteRow
      if (poll.phase === 'voting' && poll.voting_method !== 'plurality' && !hasVoted && participant.draft_ranking) {
        draftRanking = JSON.parse(participant.draft_ranking) as string[]
      }
    }
  }
```

Add `draft_ranking: draftRanking,` to the returned object, next to the existing `has_voted: hasVoted,` line.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run test/polls.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full worker suite**

Run: `cd worker && npm test`
Expected: PASS (no regressions)

- [ ] **Step 6: Commit**

```bash
git add worker/src/lib/pollDetail.ts worker/test/polls.test.ts
git commit -m "feat: expose draft_ranking on GET /polls/:id"
```

---

### Task 3: Clear draft on submit + live-results invariant

**Files:**
- Modify: `worker/src/routes/votes.ts`
- Test: `worker/test/votes.test.ts`

**Interfaces:**
- Consumes: `participants.draft_ranking` (Task 1).
- Produces: on successful `POST /polls/:id/votes`, `draft_ranking` is set to `NULL` for that participant, in the same D1 batch as the vote write.

- [ ] **Step 1: Write the failing tests**

Add to the existing `describe('POST /polls/:id/votes', ...)` block in `worker/test/votes.test.ts`:

```ts
  it('clears any draft_ranking on successful submit', async () => {
    const { id } = await seedPoll({ voting_method: 'ranked_choice' })
    const { id: pid, token } = await seedParticipant(id)
    const { id: nid } = await seedNomination(id, pid, 'A')
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    await env.DB.prepare('UPDATE participants SET draft_ranking = ? WHERE id = ?')
      .bind(JSON.stringify([nid]), pid).run()

    await SELF.fetch(`http://example.com/polls/${id}/votes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': token },
      body: JSON.stringify([{ nomination_id: nid, rank: 1 }]),
    })

    const row = await env.DB.prepare('SELECT draft_ranking FROM participants WHERE id = ?').bind(pid).first<{ draft_ranking: string | null }>()
    expect(row?.draft_ranking).toBeNull()
  })

  it('does not let draft changes affect live results', async () => {
    const { id } = await seedPoll({ voting_method: 'ranked_choice', votes_visible: 1 })
    const { id: voterPid, token: voterToken } = await seedParticipant(id, 'Voter')
    const { id: draftPid, token: draftToken } = await seedParticipant(id, 'Drafter')
    const { id: nid1 } = await seedNomination(id, voterPid, 'A')
    const { id: nid2 } = await seedNomination(id, voterPid, 'B')
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()

    // Voter submits a real vote for A.
    await SELF.fetch(`http://example.com/polls/${id}/votes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': voterToken },
      body: JSON.stringify([{ nomination_id: nid1, rank: 1 }, { nomination_id: nid2, rank: 2 }]),
    })
    const before = await (await SELF.fetch(`http://example.com/polls/${id}/results`)).json()

    // Drafter only saves drafts, never submits.
    await SELF.fetch(`http://example.com/polls/${id}/vote-draft`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': draftToken },
      body: JSON.stringify({ ranking: [nid2, nid1] }),
    })
    await SELF.fetch(`http://example.com/polls/${id}/vote-draft`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': draftToken },
      body: JSON.stringify({ ranking: [nid1, nid2] }),
    })
    const after = await (await SELF.fetch(`http://example.com/polls/${id}/results`)).json()

    expect(after).toEqual(before)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run test/votes.test.ts`
Expected: The first new test FAILS (`draft_ranking` is still the JSON string, not `null`). The second should already PASS given Tasks 1-2 (it's here as a regression guard) — confirm it does.

- [ ] **Step 3: Implement**

In `worker/src/routes/votes.ts`, inside the `votesRouter.post('/:id/votes', ...)` handler, find the `statements` array:

```ts
  const statements = [
    c.env.DB.prepare('DELETE FROM votes WHERE poll_id = ? AND participant_id = ?').bind(pollId, participantId),
    ...voteItems.map(item =>
      c.env.DB.prepare(
        'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
      ).bind(nanoid(8), pollId, participantId, item.nomination_id, item.rank ?? null, Date.now())
    ),
  ]
```

Replace with:

```ts
  const statements = [
    c.env.DB.prepare('DELETE FROM votes WHERE poll_id = ? AND participant_id = ?').bind(pollId, participantId),
    c.env.DB.prepare('UPDATE participants SET draft_ranking = NULL WHERE id = ?').bind(participantId),
    ...voteItems.map(item =>
      c.env.DB.prepare(
        'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
      ).bind(nanoid(8), pollId, participantId, item.nomination_id, item.rank ?? null, Date.now())
    ),
  ]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run test/votes.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full worker suite**

Run: `cd worker && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/votes.ts worker/test/votes.test.ts
git commit -m "feat: clear draft_ranking on vote submit; guard live results against draft edits"
```

---

### Task 4: Frontend types + API client method

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api/client.ts`

**Interfaces:**
- Consumes: `PATCH /polls/:id/vote-draft`, `GET /polls/:id` → `draft_ranking` (Tasks 1-2).
- Produces: `Poll.draft_ranking: string[] | null`; `api.saveVoteDraft(pollId: string, ranking: string[]): Promise<void>`.

This task has no server behavior to test — it's a typed pass-through consumed by Task 5's test. Wire it directly.

- [ ] **Step 1: Add the field to the `Poll` interface**

In `frontend/src/types.ts`, add `draft_ranking: string[] | null` to the `Poll` interface, right after `has_voted: boolean`:

```ts
  has_voted: boolean
  draft_ranking: string[] | null
```

- [ ] **Step 2: Add the client method**

In `frontend/src/api/client.ts`, add after the existing `submitVotes` method:

```ts
  saveVoteDraft: async (pollId: string, ranking: string[]): Promise<void> => {
    await throwIfError(await fetch(`${BASE}/polls/${pollId}/vote-draft`, {
      method: 'PATCH',
      headers: participantHeaders(pollId),
      body: JSON.stringify({ ranking }),
    }))
  },
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: fails only on `frontend/src/components/VotingPhase.tsx` and any other place constructing a `Poll` object without `draft_ranking` (e.g. mock/test data) — there should be none yet since no tests exist. If it fails on `VotingPhase.tsx` usage, that's expected — Task 5 fixes it. If it fails anywhere else, add `draft_ranking: null` to that object literal.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types.ts frontend/src/api/client.ts
git commit -m "feat: add draft_ranking type and saveVoteDraft API client method"
```

---

### Task 5: Seed the ballot from `draft_ranking`

**Files:**
- Modify: `frontend/src/components/VotingPhase.tsx`
- Test: Create `frontend/src/components/VotingPhase.test.tsx`

**Interfaces:**
- Consumes: `Poll.draft_ranking` (Task 4).
- Produces: `applyDraftOrder(nominations: PollNomination[], draftRanking: string[] | null | undefined): PollNomination[]` — module-level helper in `VotingPhase.tsx`, used to seed initial `ranked` state.

This is the project's first frontend component test — there is no `vitest` browser/DOM environment configured yet (no `test` block in `vite.config.ts`, no jest-dom). Rather than add a global config for one file, use a per-file environment docblock, which is what Step 1 below does.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/VotingPhase.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VotingPhase } from './VotingPhase'
import type { Poll } from '../types'

// jsdom has no ResizeObserver; @dnd-kit's measuring hooks expect one to exist.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error -- polyfilling a browser API jsdom doesn't provide
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/components/VotingPhase.test.tsx`
Expected: FAIL — either a TypeScript error (`draft_ranking` doesn't exist on the object passed, if Task 4 wasn't picked up) or, once compiling, the first test fails because `ranked` is currently seeded straight from `nominations` (nomination order), not the draft.

- [ ] **Step 3: Implement `applyDraftOrder` and use it to seed `ranked`**

In `frontend/src/components/VotingPhase.tsx`, add this module-level function above the `VotingPhaseProps` interface:

```ts
function applyDraftOrder(
  nominations: PollNomination[],
  draftRanking: string[] | null | undefined
): PollNomination[] {
  if (!draftRanking || draftRanking.length === 0) return nominations
  const remaining = new Map(nominations.map(n => [n.id, n]))
  const ordered: PollNomination[] = []
  for (const id of draftRanking) {
    const nom = remaining.get(id)
    if (nom) {
      ordered.push(nom)
      remaining.delete(id)
    }
  }
  // Any nomination absent from the draft (shouldn't happen once voting has
  // started, since the list is frozen) is appended at the end.
  for (const nom of nominations) {
    if (remaining.has(nom.id)) ordered.push(nom)
  }
  return ordered
}
```

Change the `ranked` state initializer from:

```ts
  const [ranked, setRanked] = useState<PollNomination[]>(nominations)
```

to:

```ts
  const [ranked, setRanked] = useState<PollNomination[]>(() => applyDraftOrder(nominations, poll.draft_ranking))
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/components/VotingPhase.test.tsx`
Expected: PASS (both tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/VotingPhase.tsx frontend/src/components/VotingPhase.test.tsx
git commit -m "feat: seed ranked ballot order from draft_ranking on load"
```

---

### Task 6: Debounced autosave + status indicator

**Files:**
- Modify: `frontend/src/components/VotingPhase.tsx`

**Interfaces:**
- Consumes: `api.saveVoteDraft` (Task 4), `applyDraftOrder` (Task 5).
- Produces: no new exports — this task wires up the drag handler and UI only.

No new automated test here (the spec scopes frontend testing to the seed-order behavior in Task 5; simulating an actual `@dnd-kit` pointer drag through Testing Library is high-effort for low signal). Verify this task by running the app in a browser per Step 4 below.

- [ ] **Step 1: Add draft-save state and a debounce ref**

In `frontend/src/components/VotingPhase.tsx`, change the import line:

```ts
import { useState, useEffect } from 'react'
```

to:

```ts
import { useState, useEffect, useRef } from 'react'
```

Inside `VotingPhase`, after the existing `const [error, setError] = useState<string | null>(null)` line, add:

```ts
  const [draftStatus, setDraftStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const draftTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
```

- [ ] **Step 2: Schedule a debounced save from `handleDragEnd`, and cancel it on unmount / once submitted**

Replace the existing `handleDragEnd`:

```ts
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setRanked(items => {
        const oldIndex = items.findIndex(i => i.id === active.id)
        const newIndex = items.findIndex(i => i.id === over.id)
        return arrayMove(items, oldIndex, newIndex)
      })
    }
  }
```

with:

```ts
  const scheduleDraftSave = (order: PollNomination[]) => {
    if (poll.voting_method === 'plurality') return
    if (draftTimeoutRef.current) clearTimeout(draftTimeoutRef.current)
    setDraftStatus('saving')
    draftTimeoutRef.current = setTimeout(async () => {
      try {
        await api.saveVoteDraft(poll.id, order.map(n => n.id))
        setDraftStatus('saved')
      } catch {
        setDraftStatus('error')
      }
    }, 1200)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setRanked(items => {
      const oldIndex = items.findIndex(i => i.id === active.id)
      const newIndex = items.findIndex(i => i.id === over.id)
      const next = arrayMove(items, oldIndex, newIndex)
      scheduleDraftSave(next)
      return next
    })
  }

  useEffect(() => {
    return () => {
      if (draftTimeoutRef.current) clearTimeout(draftTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    if (submitted && draftTimeoutRef.current) {
      clearTimeout(draftTimeoutRef.current)
    }
  }, [submitted])
```

- [ ] **Step 3: Render the status indicator**

In the JSX, find:

```tsx
        <p className="text-sm font-semibold text-ink mb-4">
          {poll.voting_method === 'plurality'
            ? 'Pick your favourite'
            : 'Drag to rank — #1 is your top pick'}
        </p>
```

and add the indicator immediately after it:

```tsx
        <p className="text-sm font-semibold text-ink mb-4">
          {poll.voting_method === 'plurality'
            ? 'Pick your favourite'
            : 'Drag to rank — #1 is your top pick'}
        </p>

        {poll.voting_method !== 'plurality' && draftStatus !== 'idle' && (
          <p className="text-xs text-ink-3 mb-2">
            {draftStatus === 'saving' && 'Saving draft…'}
            {draftStatus === 'saved' && 'Draft saved'}
            {draftStatus === 'error' && "Couldn't save draft — it'll retry on your next change"}
          </p>
        )}
```

- [ ] **Step 4: Verify manually in the browser**

Run the app locally:

```bash
cd worker && npm run dev
```

In a second terminal:

```bash
cd frontend && npm run dev
```

Open `http://localhost:5173`, join a ranked-choice poll (or use the seeded `glarm26` event's `/e/glarm26` page against the dev environment), and:
1. Drag an item to reorder it. Confirm "Saving draft…" appears, then "Draft saved" after ~1.2s, and a `PATCH .../vote-draft` request appears in the Network tab.
2. Reload the page. Confirm the ballot reopens in the order you left it, not nomination order.
3. Open the same poll in a private/incognito window, join with the same name, drag to a different order, then reload the *original* window. Confirm it now shows the incognito window's order (last write wins, per the accepted tradeoff).
4. Submit the vote. Confirm no further "Saving draft…" appears if you (hypothetically) could still interact with the ballot — it should be replaced by the submitted confirmation view immediately.

- [ ] **Step 5: Run the full frontend and worker suites**

```bash
cd frontend && npx tsc --noEmit && npm test
cd worker && npm test
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/VotingPhase.tsx
git commit -m "feat: debounced draft ballot autosave with status indicator"
```
