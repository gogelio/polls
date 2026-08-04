# Glarm Weekend Event Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable "event" feature — a group of 8 preset-nomination ranked-choice polls sharing one nickname-based join, one admin, and a live results-driven bracket — served at `/e/glarm26` this year and re-launchable for future years via a spreadsheet import script.

**Architecture:** Each category is an ordinary row in the existing `polls` table (created directly in phase `voting`, movies pre-seeded as `nominations`), so `VotingPhase`/`ResultsView`/the ranked-choice engine work unmodified. Three new tables (`events`, `event_polls`, `event_slots`) group 8 polls into an event and describe the bracket. A new `routes/events.ts` aggregates per-poll data, computes live bracket placements from each category's `rankedChoice()` results, and exposes bulk admin actions (close/pause/delete) across the 8 linked polls. A Node script parses the source spreadsheet into a SQL seed file applied via `wrangler d1 execute`.

**Tech Stack:** Hono 4 / TypeScript / D1 (worker), React 18 / TypeScript / Tailwind (frontend), `xlsx` (SheetJS) + `tsx` for the one-off import script.

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-08-03-glarm-weekend-event-design.md` — follow it for anything not explicitly covered by a task below.
- Worker `tsconfig.json` has `strict: true` and `noUncheckedIndexedAccess: true` — array/regex-match indexing needs `!` assertions or guards, matching the style already used in `worker/src/lib/voting.ts`.
- Worker tests run via `@cloudflare/vitest-pool-workers`; every test file calls `applySchema()` (from `worker/test/helpers.ts`) in `beforeEach`, and the schema string is split on `;` — every new `CREATE TABLE` statement must end with a semicolon.
- No frontend test suite exists in this repo today (tooling is present but unused) — new frontend work is verified by running the dev server and checking in the browser (final task), not by adding a new test convention unprompted.
- Run worker tests with `cd worker && npx vitest run <file>` for a single file or `npm test` for all.

---

### Task 1: Extract `buildPollResponse` into `lib/pollDetail.ts`

**Files:**
- Create: `worker/src/lib/pollDetail.ts`
- Modify: `worker/src/routes/polls.ts:82-142`
- Test: `worker/test/polls.test.ts` (existing — no new test needed, this is a behavior-preserving extraction)

**Interfaces:**
- Produces: `buildPollResponse(env: Env, id: string, participantToken: string | null): Promise<PollDetail | null>` — used by Task 5's event route.

- [ ] **Step 1: Create `worker/src/lib/pollDetail.ts`**

```ts
import type { Env, Poll } from '../types'

export interface PollDetailNomination {
  id: string
  title: string
  metadata: string | null
  participant_name: string
  created_at: number
}

export interface PollDetail {
  id: string
  title: string
  category: Poll['category']
  voting_method: Poll['voting_method']
  phase: Poll['phase']
  max_nominations: number
  nominations_visible: boolean
  votes_visible: boolean
  is_public: boolean
  is_paused: boolean
  nomination_closes_at: number | null
  nominations: PollDetailNomination[] | null
  has_voted: boolean
  participant_count: number
  created_at: number
}

export async function buildPollResponse(
  env: Env,
  id: string,
  participantToken: string | null
): Promise<PollDetail | null> {
  let poll = await env.DB.prepare(
    'SELECT id, title, category, voting_method, phase, max_nominations, nominations_visible, votes_visible, is_public, is_paused, nomination_closes_at, created_at FROM polls WHERE id = ?'
  ).bind(id).first<Poll>()
  if (!poll) return null

  // Auto-advance phase if nomination timer has expired
  if (poll.phase === 'nominating' && poll.nomination_closes_at && Date.now() > poll.nomination_closes_at) {
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ? AND phase = 'nominating'").bind(id).run()
    poll = { ...poll, phase: 'voting' }
  }

  const showNominations = poll.phase !== 'nominating' || poll.nominations_visible === 1
  let nominations: PollDetailNomination[] | null = null

  if (showNominations) {
    const { results } = await env.DB.prepare(
      `SELECT n.id, n.title, n.metadata, p.name as participant_name, n.created_at
       FROM nominations n JOIN participants p ON n.participant_id = p.id
       WHERE n.poll_id = ? ORDER BY n.created_at ASC`
    ).bind(id).all<PollDetailNomination>()
    nominations = results
  }

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

  const participantCountRow = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM participants WHERE poll_id = ?'
  ).bind(id).first<{ count: number }>()

  return {
    id: poll.id,
    title: poll.title,
    category: poll.category,
    voting_method: poll.voting_method,
    phase: poll.phase,
    max_nominations: poll.max_nominations,
    nominations_visible: poll.nominations_visible === 1,
    votes_visible: poll.votes_visible === 1,
    is_public: poll.is_public === 1,
    is_paused: poll.is_paused === 1,
    nomination_closes_at: poll.nomination_closes_at,
    nominations,
    has_voted: hasVoted,
    participant_count: participantCountRow?.count ?? 0,
    created_at: poll.created_at,
  }
}
```

- [ ] **Step 2: Replace the inline handler in `worker/src/routes/polls.ts`**

Replace lines 82-142 (the entire `pollsRouter.get('/:id', ...)` handler) with:

```ts
pollsRouter.get('/:id', async (c) => {
  const id = c.req.param('id')
  const participantToken = c.req.header('Participant-Token') ?? null
  const response = await buildPollResponse(c.env, id, participantToken)
  if (!response) return c.json({ error: 'Poll not found' }, 404)
  return c.json(response)
})
```

Add the import near the top of the file (after the existing `import type { Env, Poll, Phase } from '../types'` line):

```ts
import { buildPollResponse } from '../lib/pollDetail'
```

- [ ] **Step 3: Run the existing poll tests to confirm the refactor is behavior-preserving**

Run: `cd worker && npx vitest run test/polls.test.ts -v`
Expected: all tests PASS (same assertions as before — this is a pure extraction).

- [ ] **Step 4: Commit**

```bash
git add worker/src/lib/pollDetail.ts worker/src/routes/polls.ts
git commit -m "refactor: extract poll detail response building into lib/pollDetail"
```

---

### Task 2: Extract `joinOrReclaim` into `lib/joinOrReclaim.ts`

**Files:**
- Create: `worker/src/lib/joinOrReclaim.ts`
- Modify: `worker/src/routes/participants.ts` (entire file, 47 lines)
- Test: `worker/test/participants.test.ts` (existing — no new test needed)

**Interfaces:**
- Produces: `joinOrReclaim(env: Env, pollId: string, name: string, existingToken: string | null): Promise<JoinResult | JoinError>` — used by Task 6's event join route.

- [ ] **Step 1: Create `worker/src/lib/joinOrReclaim.ts`**

```ts
import { nanoid } from 'nanoid'
import type { Env, Participant } from '../types'

export interface JoinResult {
  participant_id: string
  token: string
  name: string
  rejoined: boolean
  created: boolean
}

export interface JoinError {
  error: string
  status: 400 | 404
}

export async function joinOrReclaim(
  env: Env,
  pollId: string,
  name: string,
  existingToken: string | null
): Promise<JoinResult | JoinError> {
  if (existingToken) {
    const existing = await env.DB.prepare(
      'SELECT * FROM participants WHERE token = ? AND poll_id = ?'
    ).bind(existingToken, pollId).first<Participant>()
    if (existing) {
      return { participant_id: existing.id, token: existing.token, name: existing.name, rejoined: false, created: false }
    }
    // Token not found for this poll — fall through to name-based reclaim
  }

  const trimmedName = name.trim()

  if (trimmedName) {
    const byName = await env.DB.prepare(
      'SELECT * FROM participants WHERE poll_id = ? AND LOWER(name) = LOWER(?)'
    ).bind(pollId, trimmedName).first<Participant>()
    if (byName) {
      return { participant_id: byName.id, token: byName.token, name: byName.name, rejoined: true, created: false }
    }
  }

  if (!trimmedName) return { error: 'name is required', status: 400 }

  const poll = await env.DB.prepare('SELECT id FROM polls WHERE id = ?').bind(pollId).first()
  if (!poll) return { error: 'Poll not found', status: 404 }

  const id = nanoid(8)
  const token = nanoid(24)
  await env.DB.prepare(
    'INSERT INTO participants (id, poll_id, name, token, joined_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, pollId, trimmedName, token, Date.now()).run()

  return { participant_id: id, token, name: trimmedName, rejoined: false, created: true }
}
```

- [ ] **Step 2: Rewrite `worker/src/routes/participants.ts`**

```ts
import { Hono } from 'hono'
import type { Env } from '../types'
import { joinOrReclaim } from '../lib/joinOrReclaim'

export const participantsRouter = new Hono<{ Bindings: Env }>()

participantsRouter.post('/:id/join', async (c) => {
  const pollId = c.req.param('id')
  const existingToken = c.req.header('Participant-Token') ?? null
  const body = await c.req.json<{ name?: string }>()

  const result = await joinOrReclaim(c.env, pollId, body.name ?? '', existingToken)
  if ('error' in result) return c.json({ error: result.error }, result.status)

  const { created, ...response } = result
  return c.json(response, created ? 201 : 200)
})
```

- [ ] **Step 3: Run the existing participant tests to confirm the refactor is behavior-preserving**

Run: `cd worker && npx vitest run test/participants.test.ts -v`
Expected: all 4 tests PASS with the same status codes and response shapes as before.

- [ ] **Step 4: Commit**

```bash
git add worker/src/lib/joinOrReclaim.ts worker/src/routes/participants.ts
git commit -m "refactor: extract join-or-reclaim logic into lib/joinOrReclaim"
```

---

### Task 3: Bracket placement resolution (`lib/bracket.ts`)

**Files:**
- Create: `worker/src/lib/bracket.ts`
- Modify: `worker/test/voting.test.ts:1-2` (add import), append tests at end (after line 126)

**Interfaces:**
- Consumes: `RankedResult` from `worker/src/lib/voting.ts` (already exists: `{ nomination_id, title, metadata, nominated_by?, score, percentage }`).
- Produces: `resolveSlot(results: RankedResult[], placement: 1 | 2): ResolvedSlot` where `ResolvedSlot = { status: 'awaiting_votes' | 'resolved' | 'unresolved', movies: Array<{ nomination_id: string; title: string }> }` — used by Task 5's event route.

- [ ] **Step 1: Write the failing tests**

Add this import at the top of `worker/test/voting.test.ts` (alongside the existing imports on lines 1-3):

```ts
import { resolveSlot } from '../src/lib/bracket'
```

Append at the end of the file (after line 126):

```ts

describe('resolveSlot', () => {
  it('reports awaiting_votes when nobody has voted yet', () => {
    const results: RankedResult[] = [
      { nomination_id: 'a', title: 'A', metadata: null, score: 0, percentage: 0 },
      { nomination_id: 'b', title: 'B', metadata: null, score: 0, percentage: 0 },
    ]
    expect(resolveSlot(results, 1)).toEqual({ status: 'awaiting_votes', movies: [] })
  })

  it('resolves 1st and 2nd place from distinct score tiers', () => {
    const results: RankedResult[] = [
      { nomination_id: 'a', title: 'A', metadata: null, score: 5, percentage: 100 },
      { nomination_id: 'b', title: 'B', metadata: null, score: 3, percentage: 60 },
      { nomination_id: 'c', title: 'C', metadata: null, score: 1, percentage: 20 },
    ]
    expect(resolveSlot(results, 1)).toEqual({ status: 'resolved', movies: [{ nomination_id: 'a', title: 'A' }] })
    expect(resolveSlot(results, 2)).toEqual({ status: 'resolved', movies: [{ nomination_id: 'b', title: 'B' }] })
  })

  it('groups every tied movie into the same placement', () => {
    const results: RankedResult[] = [
      { nomination_id: 'a', title: 'A', metadata: null, score: 5, percentage: 100 },
      { nomination_id: 'b', title: 'B', metadata: null, score: 5, percentage: 100 },
      { nomination_id: 'c', title: 'C', metadata: null, score: 1, percentage: 20 },
    ]
    const first = resolveSlot(results, 1)
    expect(first.status).toBe('resolved')
    expect(first.movies.map(m => m.nomination_id).sort()).toEqual(['a', 'b'])
    expect(resolveSlot(results, 2)).toEqual({ status: 'resolved', movies: [{ nomination_id: 'c', title: 'C' }] })
  })

  it('reports unresolved for 2nd place when everything is tied for 1st', () => {
    const results: RankedResult[] = [
      { nomination_id: 'a', title: 'A', metadata: null, score: 2, percentage: 100 },
      { nomination_id: 'b', title: 'B', metadata: null, score: 2, percentage: 100 },
    ]
    expect(resolveSlot(results, 2)).toEqual({ status: 'unresolved', movies: [] })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd worker && npx vitest run test/voting.test.ts -v`
Expected: FAIL — `Cannot find module '../src/lib/bracket'`

- [ ] **Step 3: Implement `worker/src/lib/bracket.ts`**

```ts
import type { RankedResult } from './voting'

export type SlotStatus = 'awaiting_votes' | 'resolved' | 'unresolved'

export interface SlotMovie {
  nomination_id: string
  title: string
}

export interface ResolvedSlot {
  status: SlotStatus
  movies: SlotMovie[]
}

export function resolveSlot(results: RankedResult[], placement: 1 | 2): ResolvedSlot {
  if (results.length === 0 || results.every(r => r.score === 0)) {
    return { status: 'awaiting_votes', movies: [] }
  }

  const tiers: RankedResult[][] = []
  for (const r of results) {
    const lastTier = tiers[tiers.length - 1]
    if (lastTier && lastTier[0]!.score === r.score) {
      lastTier.push(r)
    } else {
      tiers.push([r])
    }
  }

  const tier = tiers[placement - 1]
  if (!tier) return { status: 'unresolved', movies: [] }

  return {
    status: 'resolved',
    movies: tier.map(r => ({ nomination_id: r.nomination_id, title: r.title })),
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd worker && npx vitest run test/voting.test.ts -v`
Expected: PASS (all `resolveSlot` cases plus the pre-existing `plurality`/`rankedChoice`/`rankedPairs` cases).

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/bracket.ts worker/test/voting.test.ts
git commit -m "feat: add bracket slot resolution from ranked-choice results"
```

---

### Task 4: `events`/`event_polls`/`event_slots` schema + test helpers

**Files:**
- Create: `worker/migrations/0004_events.sql`
- Modify: `worker/test/helpers.ts` (append to `SCHEMA` string, add three new exported functions)

**Interfaces:**
- Produces: `seedEvent(overrides?)`, `seedEventPoll(eventId, pollId, category, sortOrder?)`, `seedEventSlot(eventId, day, slotOrder, category, placement)` — used by Tasks 5-9's tests.

- [ ] **Step 1: Create the migration**

```sql
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  admin_token TEXT NOT NULL,
  title TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS event_polls (
  event_id TEXT NOT NULL REFERENCES events(id),
  poll_id TEXT NOT NULL REFERENCES polls(id),
  category TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (event_id, poll_id)
);

CREATE TABLE IF NOT EXISTS event_slots (
  event_id TEXT NOT NULL REFERENCES events(id),
  day TEXT NOT NULL,
  slot_order INTEGER NOT NULL,
  category TEXT NOT NULL,
  placement INTEGER NOT NULL CHECK(placement IN (1, 2)),
  PRIMARY KEY (event_id, day, slot_order)
);
```

Save as `worker/migrations/0004_events.sql`.

- [ ] **Step 2: Extend the test schema in `worker/test/helpers.ts`**

In the `SCHEMA` template string (lines 4-26), change the closing of the string so the existing `votes` table statement still ends in `;` and append the three new tables before the closing backtick. Replace lines 21-26 (the `votes` table through the closing backtick) with:

```ts
CREATE TABLE IF NOT EXISTS votes (
  id TEXT PRIMARY KEY, poll_id TEXT NOT NULL, participant_id TEXT NOT NULL,
  nomination_id TEXT NOT NULL, rank INTEGER, created_at INTEGER NOT NULL,
  UNIQUE(poll_id, participant_id, nomination_id),
  UNIQUE(poll_id, participant_id, rank)
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, admin_token TEXT NOT NULL, title TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS event_polls (
  event_id TEXT NOT NULL, poll_id TEXT NOT NULL, category TEXT NOT NULL,
  sort_order INTEGER NOT NULL, PRIMARY KEY (event_id, poll_id)
);
CREATE TABLE IF NOT EXISTS event_slots (
  event_id TEXT NOT NULL, day TEXT NOT NULL, slot_order INTEGER NOT NULL,
  category TEXT NOT NULL, placement INTEGER NOT NULL,
  PRIMARY KEY (event_id, day, slot_order)
);`
```

- [ ] **Step 3: Append seed helpers to `worker/test/helpers.ts`**

Add at the end of the file (after the existing `seedNomination` function):

```ts

export async function seedEvent(overrides: Record<string, unknown> = {}) {
  const id = (overrides.id as string) ?? nanoid(8)
  const adminToken = (overrides.admin_token as string) ?? nanoid(24)
  await env.DB.prepare(
    'INSERT INTO events (id, admin_token, title, is_public, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(
    id,
    adminToken,
    overrides.title ?? 'Test Event',
    overrides.is_public ?? 0,
    Date.now()
  ).run()
  return { id, adminToken }
}

export async function seedEventPoll(eventId: string, pollId: string, category: string, sortOrder = 0) {
  await env.DB.prepare(
    'INSERT INTO event_polls (event_id, poll_id, category, sort_order) VALUES (?, ?, ?, ?)'
  ).bind(eventId, pollId, category, sortOrder).run()
}

export async function seedEventSlot(eventId: string, day: string, slotOrder: number, category: string, placement: number) {
  await env.DB.prepare(
    'INSERT INTO event_slots (event_id, day, slot_order, category, placement) VALUES (?, ?, ?, ?, ?)'
  ).bind(eventId, day, slotOrder, category, placement).run()
}
```

- [ ] **Step 4: Run the full worker test suite to confirm the schema change doesn't break anything**

Run: `cd worker && npm test`
Expected: PASS — all existing tests still work (the new tables are additive; `applySchema` just creates three more tables no existing test touches yet).

- [ ] **Step 5: Commit**

```bash
git add worker/migrations/0004_events.sql worker/test/helpers.ts
git commit -m "feat: add events/event_polls/event_slots schema and test seed helpers"
```

---

### Task 5: `GET /events/:slug`

**Files:**
- Create: `worker/src/routes/events.ts`
- Modify: `worker/src/index.ts:1-34`
- Test: `worker/test/events.test.ts` (new file)

**Interfaces:**
- Consumes: `buildPollResponse` (Task 1), `rankedChoice`/`RankedResult` (existing `lib/voting.ts`), `resolveSlot` (Task 3).
- Produces: `eventsRouter` (Hono router), mounted at `/events` — extended by Tasks 6-9.

- [ ] **Step 1: Write the failing tests**

Create `worker/test/events.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env } from 'cloudflare:test'
import {
  applySchema, seedPoll, seedParticipant, seedNomination,
  seedEvent, seedEventPoll, seedEventSlot,
} from './helpers'

describe('GET /events/:slug', () => {
  beforeEach(applySchema)

  it('returns 404 for unknown slug', async () => {
    const res = await SELF.fetch('http://example.com/events/nope')
    expect(res.status).toBe(404)
  })

  it('returns categories and a resolved bracket', async () => {
    const { id: pollA } = await seedPoll({ title: 'Action', category: 'movie', voting_method: 'ranked_choice' })
    await env.DB.prepare("UPDATE polls SET phase = 'voting', votes_visible = 1 WHERE id = ?").bind(pollA).run()
    const { id: p1 } = await seedParticipant(pollA, 'Alice')
    const { id: nomWinner } = await seedNomination(pollA, p1, 'Mad Max')
    const { id: nomLoser } = await seedNomination(pollA, p1, 'Dredd')
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v1', pollA, p1, nomWinner, 1, Date.now()).run()
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v2', pollA, p1, nomLoser, 2, Date.now()).run()

    await seedEvent({ id: 'glarm26', title: 'Glarm Weekend' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)
    await seedEventSlot('glarm26', 'Thursday', 1, 'Action', 1)

    const res = await SELF.fetch('http://example.com/events/glarm26')
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.id).toBe('glarm26')
    expect(body.phase).toBe('voting')

    const categories = body.categories as Array<{ category: string; poll: { title: string } }>
    expect(categories).toHaveLength(1)
    expect(categories[0]!.category).toBe('Action')

    const schedule = body.schedule as Array<{ day: string; slots: Array<{ status: string; movies: Array<{ title: string }> }> }>
    expect(schedule).toHaveLength(1)
    expect(schedule[0]!.day).toBe('Thursday')
    expect(schedule[0]!.slots[0]!.status).toBe('resolved')
    expect(schedule[0]!.slots[0]!.movies[0]!.title).toBe('Mad Max')
  })

  it('reports phase closed only once every linked poll is closed', async () => {
    const { id: pollA } = await seedPoll()
    const { id: pollB } = await seedPoll()
    await env.DB.prepare("UPDATE polls SET phase = 'closed' WHERE id = ?").bind(pollA).run()
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(pollB).run()
    await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)
    await seedEventPoll('glarm26', pollB, 'Comedy', 1)

    const res = await SELF.fetch('http://example.com/events/glarm26')
    const body = await res.json() as { phase: string }
    expect(body.phase).toBe('voting')

    await env.DB.prepare("UPDATE polls SET phase = 'closed' WHERE id = ?").bind(pollB).run()
    const res2 = await SELF.fetch('http://example.com/events/glarm26')
    const body2 = await res2.json() as { phase: string }
    expect(body2.phase).toBe('closed')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd worker && npx vitest run test/events.test.ts -v`
Expected: FAIL with connection/404-shaped errors — `/events` isn't routed yet.

- [ ] **Step 3: Create `worker/src/routes/events.ts`**

```ts
import { Hono } from 'hono'
import type { Env } from '../types'
import { buildPollResponse } from '../lib/pollDetail'
import { rankedChoice, type RankedResult, type NominationRow, type VoteRow } from '../lib/voting'
import { resolveSlot } from '../lib/bracket'

export const eventsRouter = new Hono<{ Bindings: Env }>()

const DAY_ORDER = ['Thursday', 'Friday', 'Saturday']

function parseTokenHeader(header: string | undefined): Map<string, string> {
  const map = new Map<string, string>()
  if (!header) return map
  for (const pair of header.split(',')) {
    const [pollId, token] = pair.split(':')
    if (pollId && token) map.set(pollId, token)
  }
  return map
}

function buildSlotPayload(
  row: { day: string; slot_order: number; category: string; placement: number },
  resultsByCategory: Map<string, RankedResult[]>
) {
  const results = resultsByCategory.get(row.category) ?? []
  const resolved = resolveSlot(results, row.placement === 2 ? 2 : 1)
  return {
    slot_order: row.slot_order,
    category: row.category,
    placement: row.placement,
    status: resolved.status,
    movies: resolved.movies,
  }
}

eventsRouter.get('/:slug', async (c) => {
  const slug = c.req.param('slug')
  const event = await c.env.DB.prepare(
    'SELECT id, title, is_public, created_at FROM events WHERE id = ?'
  ).bind(slug).first<{ id: string; title: string; is_public: number; created_at: number }>()
  if (!event) return c.json({ error: 'Event not found' }, 404)

  const { results: links } = await c.env.DB.prepare(
    'SELECT poll_id, category, sort_order FROM event_polls WHERE event_id = ? ORDER BY sort_order ASC'
  ).bind(slug).all<{ poll_id: string; category: string; sort_order: number }>()

  const tokens = parseTokenHeader(c.req.header('Participant-Tokens'))

  const categories: Array<{ category: string; sort_order: number; poll: NonNullable<Awaited<ReturnType<typeof buildPollResponse>>> }> = []
  const resultsByCategory = new Map<string, RankedResult[]>()

  for (const link of links) {
    const pollResponse = await buildPollResponse(c.env, link.poll_id, tokens.get(link.poll_id) ?? null)
    if (!pollResponse) continue
    categories.push({ category: link.category, sort_order: link.sort_order, poll: pollResponse })

    const { results: nominations } = await c.env.DB.prepare(
      'SELECT id, title, metadata FROM nominations WHERE poll_id = ?'
    ).bind(link.poll_id).all<NominationRow>()
    const { results: votes } = await c.env.DB.prepare(
      'SELECT participant_id, nomination_id, rank FROM votes WHERE poll_id = ?'
    ).bind(link.poll_id).all<VoteRow>()
    resultsByCategory.set(link.category, rankedChoice(votes, nominations))
  }

  const phase = categories.length > 0 && categories.every(cat => cat.poll.phase === 'closed') ? 'closed' : 'voting'

  const { results: slotRows } = await c.env.DB.prepare(
    'SELECT day, slot_order, category, placement FROM event_slots WHERE event_id = ? ORDER BY slot_order ASC'
  ).bind(slug).all<{ day: string; slot_order: number; category: string; placement: number }>()

  const scheduleByDay = new Map<string, ReturnType<typeof buildSlotPayload>[]>()
  for (const row of slotRows) {
    const slot = buildSlotPayload(row, resultsByCategory)
    if (!scheduleByDay.has(row.day)) scheduleByDay.set(row.day, [])
    scheduleByDay.get(row.day)!.push(slot)
  }
  const schedule = DAY_ORDER
    .filter(day => scheduleByDay.has(day))
    .map(day => ({ day, slots: scheduleByDay.get(day)! }))

  return c.json({
    id: event.id,
    title: event.title,
    is_public: event.is_public === 1,
    phase,
    categories,
    schedule,
    created_at: event.created_at,
  })
})
```

- [ ] **Step 4: Wire the router into `worker/src/index.ts`**

Add the import after the existing `import { searchRouter } from './routes/search'` (line 8):

```ts
import { eventsRouter } from './routes/events'
```

Add the route after the existing `app.route('/search', searchRouter)` (line 32):

```ts
app.route('/events', eventsRouter)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd worker && npx vitest run test/events.test.ts -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/events.ts worker/src/index.ts worker/test/events.test.ts
git commit -m "feat: add GET /events/:slug with live bracket resolution"
```

---

### Task 6: `POST /events/:slug/join`

**Files:**
- Modify: `worker/src/routes/events.ts` (append route)
- Modify: `worker/test/events.test.ts` (append tests)

**Interfaces:**
- Consumes: `joinOrReclaim` (Task 2).
- Produces: `POST /events/:slug/join` → `{ name: string, rejoined: boolean, participants: Array<{ poll_id: string, participant_id: string, token: string }> }`.

- [ ] **Step 1: Write the failing tests**

Append to `worker/test/events.test.ts`:

```ts

describe('POST /events/:slug/join', () => {
  beforeEach(applySchema)

  it('joins all linked polls with the same name', async () => {
    const { id: pollA } = await seedPoll({ title: 'Action' })
    const { id: pollB } = await seedPoll({ title: 'Comedy' })
    await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)
    await seedEventPoll('glarm26', pollB, 'Comedy', 1)

    const res = await SELF.fetch('http://example.com/events/glarm26/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { name: string; rejoined: boolean; participants: Array<{ poll_id: string; token: string }> }
    expect(body.name).toBe('Alice')
    expect(body.rejoined).toBe(false)
    expect(body.participants).toHaveLength(2)
    expect(body.participants.map(p => p.poll_id).sort()).toEqual([pollA, pollB].sort())
  })

  it('reclaims the same tokens across all polls on repeat join', async () => {
    const { id: pollA } = await seedPoll()
    await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)

    const first = await SELF.fetch('http://example.com/events/glarm26/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bob' }),
    })
    const firstBody = await first.json() as { participants: Array<{ token: string }> }

    const second = await SELF.fetch('http://example.com/events/glarm26/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bob' }),
    })
    expect(second.status).toBe(200)
    const secondBody = await second.json() as { rejoined: boolean; participants: Array<{ token: string }> }
    expect(secondBody.rejoined).toBe(true)
    expect(secondBody.participants[0]!.token).toBe(firstBody.participants[0]!.token)
  })

  it('returns 400 when name is missing', async () => {
    await seedEvent({ id: 'glarm26' })
    const res = await SELF.fetch('http://example.com/events/glarm26/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd worker && npx vitest run test/events.test.ts -v`
Expected: FAIL — `POST /events/:slug/join` returns 404 (route not defined).

- [ ] **Step 3: Append the route to `worker/src/routes/events.ts`**

Add the import at the top (alongside the existing `lib/pollDetail` import):

```ts
import { joinOrReclaim } from '../lib/joinOrReclaim'
```

Append at the end of the file:

```ts

eventsRouter.post('/:slug/join', async (c) => {
  const slug = c.req.param('slug')
  const body = await c.req.json<{ name?: string }>()
  const name = (body.name ?? '').trim()
  if (!name) return c.json({ error: 'name is required' }, 400)

  const { results: links } = await c.env.DB.prepare(
    'SELECT poll_id FROM event_polls WHERE event_id = ?'
  ).bind(slug).all<{ poll_id: string }>()
  if (links.length === 0) return c.json({ error: 'Event not found' }, 404)

  const participants: Array<{ poll_id: string; participant_id: string; token: string }> = []
  let anyRejoined = false

  for (const link of links) {
    const result = await joinOrReclaim(c.env, link.poll_id, name, null)
    if ('error' in result) return c.json({ error: result.error }, 500)
    if (result.rejoined) anyRejoined = true
    participants.push({ poll_id: link.poll_id, participant_id: result.participant_id, token: result.token })
  }

  return c.json({ name, rejoined: anyRejoined, participants })
})
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd worker && npx vitest run test/events.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/events.ts worker/test/events.test.ts
git commit -m "feat: add POST /events/:slug/join for shared-identity event join"
```

---

### Task 7: `PATCH /events/:slug/phase` + `eventAdminAuth` middleware

**Files:**
- Modify: `worker/src/middleware/auth.ts` (append middleware)
- Modify: `worker/src/routes/events.ts` (append route)
- Modify: `worker/test/events.test.ts` (append tests)

**Interfaces:**
- Produces: `eventAdminAuth` Hono middleware (validates `?admin=` against `events.admin_token` for the `:slug` param) — reused by Tasks 8 and 9.

- [ ] **Step 1: Write the failing tests**

Append to `worker/test/events.test.ts`:

```ts

describe('PATCH /events/:slug/phase', () => {
  beforeEach(applySchema)

  it('closes all linked polls with a valid admin token', async () => {
    const { id: pollA } = await seedPoll()
    const { id: pollB } = await seedPoll()
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id IN (?, ?)").bind(pollA, pollB).run()
    const { adminToken } = await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)
    await seedEventPoll('glarm26', pollB, 'Comedy', 1)

    const res = await SELF.fetch(`http://example.com/events/glarm26/phase?admin=${adminToken}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase: 'closed' }),
    })
    expect(res.status).toBe(200)

    const polls = await env.DB.prepare('SELECT phase FROM polls WHERE id IN (?, ?)').bind(pollA, pollB).all<{ phase: string }>()
    expect(polls.results.every(p => p.phase === 'closed')).toBe(true)
  })

  it('rejects an invalid admin token', async () => {
    const { id: pollA } = await seedPoll()
    await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)

    const res = await SELF.fetch('http://example.com/events/glarm26/phase?admin=wrong', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase: 'closed' }),
    })
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd worker && npx vitest run test/events.test.ts -v`
Expected: FAIL — route not defined (404).

- [ ] **Step 3: Append `eventAdminAuth` to `worker/src/middleware/auth.ts`**

Append at the end of the file (after the existing `adminAuth` function, line 49):

```ts

export async function eventAdminAuth(
  c: Context<{ Bindings: Env }>,
  next: Next
) {
  const slug = c.req.param('slug')
  const adminToken = c.req.query('admin')
  if (!adminToken) return c.json({ error: 'Missing admin query param' }, 401)

  const event = await c.env.DB.prepare(
    'SELECT admin_token FROM events WHERE id = ?'
  ).bind(slug).first<{ admin_token: string }>()

  if (!event) return c.json({ error: 'Event not found' }, 404)

  const encoder = new TextEncoder()
  const a = encoder.encode(adminToken)
  const b = encoder.encode(event.admin_token)
  if (a.length !== b.length) return c.json({ error: 'Invalid admin token' }, 401)
  const equal = crypto.subtle.timingSafeEqual(a, b)
  if (!equal) return c.json({ error: 'Invalid admin token' }, 401)

  await next()
}
```

- [ ] **Step 4: Append the route to `worker/src/routes/events.ts`**

Add the import at the top:

```ts
import { eventAdminAuth } from '../middleware/auth'
```

Append at the end of the file:

```ts

eventsRouter.patch('/:slug/phase', eventAdminAuth, async (c) => {
  const slug = c.req.param('slug')
  const { phase } = await c.req.json<{ phase: string }>()
  if (phase !== 'closed') return c.json({ error: 'Only transition to closed is supported' }, 400)

  const { results: links } = await c.env.DB.prepare(
    'SELECT poll_id FROM event_polls WHERE event_id = ?'
  ).bind(slug).all<{ poll_id: string }>()

  await c.env.DB.batch(
    links.map(link =>
      c.env.DB.prepare("UPDATE polls SET phase = 'closed' WHERE id = ? AND phase = 'voting'").bind(link.poll_id)
    )
  )

  return c.json({ phase: 'closed' })
})
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd worker && npx vitest run test/events.test.ts -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/middleware/auth.ts worker/src/routes/events.ts worker/test/events.test.ts
git commit -m "feat: add PATCH /events/:slug/phase with event-scoped admin auth"
```

---

### Task 8: `PATCH /events/:slug/pause`

**Files:**
- Modify: `worker/src/routes/events.ts` (append route)
- Modify: `worker/test/events.test.ts` (append test)

- [ ] **Step 1: Write the failing test**

Append to `worker/test/events.test.ts`:

```ts

describe('PATCH /events/:slug/pause', () => {
  beforeEach(applySchema)

  it('toggles is_paused on all linked polls together', async () => {
    const { id: pollA } = await seedPoll()
    const { id: pollB } = await seedPoll()
    const { adminToken } = await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)
    await seedEventPoll('glarm26', pollB, 'Comedy', 1)

    const res = await SELF.fetch(`http://example.com/events/glarm26/pause?admin=${adminToken}`, { method: 'PATCH' })
    expect(res.status).toBe(200)
    const body = await res.json() as { is_paused: boolean }
    expect(body.is_paused).toBe(true)

    const polls = await env.DB.prepare('SELECT is_paused FROM polls WHERE id IN (?, ?)').bind(pollA, pollB).all<{ is_paused: number }>()
    expect(polls.results.every(p => p.is_paused === 1)).toBe(true)

    const res2 = await SELF.fetch(`http://example.com/events/glarm26/pause?admin=${adminToken}`, { method: 'PATCH' })
    const body2 = await res2.json() as { is_paused: boolean }
    expect(body2.is_paused).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd worker && npx vitest run test/events.test.ts -v`
Expected: FAIL — route not defined.

- [ ] **Step 3: Append the route to `worker/src/routes/events.ts`**

```ts

eventsRouter.patch('/:slug/pause', eventAdminAuth, async (c) => {
  const slug = c.req.param('slug')
  const { results: links } = await c.env.DB.prepare(
    'SELECT poll_id FROM event_polls WHERE event_id = ?'
  ).bind(slug).all<{ poll_id: string }>()
  if (links.length === 0) return c.json({ error: 'Event not found' }, 404)

  const firstPoll = await c.env.DB.prepare('SELECT is_paused FROM polls WHERE id = ?')
    .bind(links[0]!.poll_id).first<{ is_paused: number }>()
  const newValue = firstPoll?.is_paused === 1 ? 0 : 1

  await c.env.DB.batch(
    links.map(link => c.env.DB.prepare('UPDATE polls SET is_paused = ? WHERE id = ?').bind(newValue, link.poll_id))
  )

  return c.json({ is_paused: newValue === 1 })
})
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd worker && npx vitest run test/events.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/events.ts worker/test/events.test.ts
git commit -m "feat: add PATCH /events/:slug/pause to pause all linked polls"
```

---

### Task 9: `DELETE /events/:slug`

**Files:**
- Modify: `worker/src/routes/events.ts` (append route)
- Modify: `worker/test/events.test.ts` (append test)

- [ ] **Step 1: Write the failing test**

Append to `worker/test/events.test.ts`:

```ts

describe('DELETE /events/:slug', () => {
  beforeEach(applySchema)

  it('cascades through all linked polls and event rows', async () => {
    const { id: pollA } = await seedPoll()
    const { id: p1 } = await seedParticipant(pollA, 'Alice')
    const { id: nomA } = await seedNomination(pollA, p1, 'Movie A')
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v1', pollA, p1, nomA, null, Date.now()).run()

    const { adminToken } = await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)
    await seedEventSlot('glarm26', 'Thursday', 1, 'Action', 1)

    const res = await SELF.fetch(`http://example.com/events/glarm26?admin=${adminToken}`, { method: 'DELETE' })
    expect(res.status).toBe(200)

    const poll = await env.DB.prepare('SELECT id FROM polls WHERE id = ?').bind(pollA).first()
    expect(poll).toBeNull()
    const votes = await env.DB.prepare('SELECT id FROM votes WHERE poll_id = ?').bind(pollA).all()
    expect(votes.results).toHaveLength(0)
    const event = await env.DB.prepare('SELECT id FROM events WHERE id = ?').bind('glarm26').first()
    expect(event).toBeNull()
    const slots = await env.DB.prepare('SELECT * FROM event_slots WHERE event_id = ?').bind('glarm26').all()
    expect(slots.results).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd worker && npx vitest run test/events.test.ts -v`
Expected: FAIL — route not defined.

- [ ] **Step 3: Append the route to `worker/src/routes/events.ts`**

```ts

eventsRouter.delete('/:slug', eventAdminAuth, async (c) => {
  const slug = c.req.param('slug')
  const { results: links } = await c.env.DB.prepare(
    'SELECT poll_id FROM event_polls WHERE event_id = ?'
  ).bind(slug).all<{ poll_id: string }>()
  if (links.length === 0) return c.json({ error: 'Event not found' }, 404)

  const statements = []
  for (const link of links) {
    statements.push(c.env.DB.prepare('DELETE FROM votes WHERE poll_id = ?').bind(link.poll_id))
    statements.push(c.env.DB.prepare('DELETE FROM nominations WHERE poll_id = ?').bind(link.poll_id))
    statements.push(c.env.DB.prepare('DELETE FROM participants WHERE poll_id = ?').bind(link.poll_id))
    statements.push(c.env.DB.prepare('DELETE FROM polls WHERE id = ?').bind(link.poll_id))
  }
  statements.push(c.env.DB.prepare('DELETE FROM event_slots WHERE event_id = ?').bind(slug))
  statements.push(c.env.DB.prepare('DELETE FROM event_polls WHERE event_id = ?').bind(slug))
  statements.push(c.env.DB.prepare('DELETE FROM events WHERE id = ?').bind(slug))

  await c.env.DB.batch(statements)
  return c.json({ ok: true })
})
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd worker && npx vitest run test/events.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Run the entire worker test suite**

Run: `cd worker && npm test`
Expected: PASS — all files including `polls.test.ts`, `participants.test.ts`, `votes.test.ts`, `nominations.test.ts`, `search.test.ts`, `voting.test.ts`, `events.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/events.ts worker/test/events.test.ts
git commit -m "feat: add DELETE /events/:slug cascading through all linked polls"
```

---

### Task 10: Trailer link support on nominations

**Files:**
- Modify: `worker/src/types.ts:45-52`
- Modify: `frontend/src/types.ts:5-12`
- Modify: `frontend/src/components/NominationCard.tsx:28-37`
- Modify: `frontend/src/components/VotingPhase.tsx:59-61`

**Interfaces:**
- Produces: `NominationMetadata.trailer_url?: string` — populated by Task 17's import script.

- [ ] **Step 1: Add `trailer_url` to the worker's `NominationMetadata`**

In `worker/src/types.ts`, replace lines 45-52:

```ts
export interface NominationMetadata {
  external_id?: string
  cover_url?: string
  poster_url?: string
  author?: string
  director?: string
  year?: number
  trailer_url?: string
}
```

- [ ] **Step 2: Add `trailer_url` to the frontend's `NominationMetadata`**

In `frontend/src/types.ts`, replace lines 5-12:

```ts
export interface NominationMetadata {
  external_id?: string
  cover_url?: string
  poster_url?: string
  author?: string
  director?: string
  year?: number
  trailer_url?: string
}
```

- [ ] **Step 3: Render the trailer link in `NominationCard.tsx`**

In `frontend/src/components/NominationCard.tsx`, replace lines 28-37:

```tsx
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-ink truncate">{nomination.title}</div>
          {meta?.author && (
            <div className="text-xs text-ink-2">{meta.author}{meta.year ? ` · ${meta.year}` : ''}</div>
          )}
          {meta?.director && (
            <div className="text-xs text-ink-2">{meta.director}{meta.year ? ` · ${meta.year}` : ''}</div>
          )}
          {meta?.trailer_url && (
            <a
              href={meta.trailer_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-xs text-accent hover:underline"
            >
              ▶ Trailer
            </a>
          )}
          <div className="text-xs text-ink-3 mt-0.5">by {nomination.participant_name}</div>
        </div>
```

- [ ] **Step 4: Render the trailer link in `VotingPhase.tsx`'s `SortableItem`**

In `frontend/src/components/VotingPhase.tsx`, replace lines 59-61:

```tsx
        {meta?.author && <div className="text-xs text-ink-3">{meta.author}</div>}
        {meta?.director && <div className="text-xs text-ink-3">{meta.director}</div>}
        {meta?.trailer_url && (
          <a
            href={meta.trailer_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="text-xs text-accent hover:underline"
          >
            ▶ Trailer
          </a>
        )}
```

- [ ] **Step 5: Type-check the frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add worker/src/types.ts frontend/src/types.ts frontend/src/components/NominationCard.tsx frontend/src/components/VotingPhase.tsx
git commit -m "feat: show a trailer link on nomination cards when metadata has one"
```

---

### Task 11: Frontend `Event*` types

**Files:**
- Modify: `frontend/src/types.ts` (append after line 75, following Task 10's edit)

**Interfaces:**
- Produces: `EventCategory`, `EventSlotMovie`, `EventSlot`, `EventDay`, `EventPayload` — used by Tasks 12-16.

- [ ] **Step 1: Append the new types**

Append at the end of `frontend/src/types.ts`:

```ts

export interface EventCategory {
  category: string
  sort_order: number
  poll: Poll
}

export interface EventSlotMovie {
  nomination_id: string
  title: string
}

export interface EventSlot {
  slot_order: number
  category: string
  placement: 1 | 2
  status: 'awaiting_votes' | 'resolved' | 'unresolved'
  movies: EventSlotMovie[]
}

export interface EventDay {
  day: string
  slots: EventSlot[]
}

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

- [ ] **Step 2: Type-check the frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types.ts
git commit -m "feat: add frontend types for the event/bracket payload"
```

---

### Task 12: `api/client.ts` event methods

**Files:**
- Modify: `frontend/src/api/client.ts:1`, append methods before the closing `}` (after line 150)

**Interfaces:**
- Consumes: `EventPayload` (Task 11), module-scope `getToken`/`setToken`/`throwIfError`/`BASE` (already defined in this file).
- Produces: `api.getEvent`, `api.joinEvent`, `api.closeEvent`, `api.toggleEventPause`, `api.deleteEvent` — used by Tasks 13, 15, 16.

- [ ] **Step 1: Update the type import**

Replace line 1:

```ts
import type { Poll, PollResults, PublicPollSummary, SearchResult, EventPayload } from '../types'
```

- [ ] **Step 2: Append the event methods**

Insert before the closing `hasToken` method's line (i.e. just before line 150, `hasToken: (pollId: string) => !!getToken(pollId),`), add:

```ts

  getEvent: async (slug: string, pollIds: string[] = []): Promise<EventPayload> => {
    const tokenPairs = pollIds
      .map(id => { const t = getToken(id); return t ? `${id}:${t}` : null })
      .filter((v): v is string => v !== null)
    const headers: HeadersInit = tokenPairs.length ? { 'Participant-Tokens': tokenPairs.join(',') } : {}
    const res = await throwIfError(await fetch(`${BASE}/events/${slug}`, { headers }))
    return res.json()
  },

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

  closeEvent: async (slug: string, adminToken: string): Promise<void> => {
    await throwIfError(await fetch(`${BASE}/events/${slug}/phase?admin=${adminToken}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase: 'closed' }),
    }))
  },

  toggleEventPause: async (slug: string, adminToken: string): Promise<{ is_paused: boolean }> => {
    const res = await throwIfError(await fetch(`${BASE}/events/${slug}/pause?admin=${adminToken}`, {
      method: 'PATCH',
    }))
    return res.json()
  },

  deleteEvent: async (slug: string, adminToken: string): Promise<void> => {
    await throwIfError(await fetch(`${BASE}/events/${slug}?admin=${adminToken}`, {
      method: 'DELETE',
    }))
  },
```

- [ ] **Step 3: Type-check the frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/client.ts
git commit -m "feat: add event API client methods"
```

---

### Task 13: `useEvent` hook

**Files:**
- Create: `frontend/src/hooks/useEvent.ts`

**Interfaces:**
- Consumes: `api.getEvent` (Task 12), `EventPayload` (Task 11).
- Produces: `useEvent(slug: string): { event: EventPayload | null, error: string | null, loading: boolean, refetch: () => Promise<void> }` — used by Task 16.

- [ ] **Step 1: Create `frontend/src/hooks/useEvent.ts`**

```ts
import { useState, useEffect, useCallback, useRef } from 'react'
import type { EventPayload } from '../types'
import { api } from '../api/client'

export function useEvent(slug: string) {
  const [event, setEvent] = useState<EventPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollIdsRef = useRef<string[]>([])

  const fetchEvent = useCallback(async () => {
    try {
      const data = await api.getEvent(slug, pollIdsRef.current)
      pollIdsRef.current = data.categories.map(cat => cat.poll.id)
      setEvent(data)
      setError(null)
      if (data.phase === 'closed' && intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load event')
    } finally {
      setLoading(false)
    }
  }, [slug])

  useEffect(() => {
    fetchEvent()
    intervalRef.current = setInterval(fetchEvent, 3000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchEvent])

  return { event, error, loading, refetch: fetchEvent }
}
```

- [ ] **Step 2: Type-check the frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useEvent.ts
git commit -m "feat: add useEvent hook polling GET /events/:slug"
```

---

### Task 14: `Bracket` component

**Files:**
- Create: `frontend/src/components/Bracket.tsx`

**Interfaces:**
- Consumes: `EventDay` (Task 11).
- Produces: `Bracket({ schedule: EventDay[] })` — used by Task 16.

- [ ] **Step 1: Create `frontend/src/components/Bracket.tsx`**

```tsx
import type { EventDay, EventSlot } from '../types'

const PLACEMENT_LABEL: Record<number, string> = { 1: '1st choice', 2: '2nd choice' }

function SlotCard({ slot }: { slot: EventSlot }) {
  return (
    <div className="card p-4 space-y-1">
      <p className="text-xs font-bold text-ink-3 uppercase tracking-widest">
        {slot.category} — {PLACEMENT_LABEL[slot.placement] ?? `#${slot.placement}`}
      </p>
      {slot.status === 'awaiting_votes' && <p className="text-ink-3 text-sm">Awaiting votes</p>}
      {slot.status === 'unresolved' && <p className="text-ink-3 text-sm">Tied — not yet decided</p>}
      {slot.status === 'resolved' && (
        <p className="text-sm font-semibold text-ink">{slot.movies.map(m => m.title).join(' / ')}</p>
      )}
    </div>
  )
}

export function Bracket({ schedule }: { schedule: EventDay[] }) {
  if (schedule.length === 0) return null
  return (
    <div className="card p-5 space-y-4">
      <p className="text-xs font-bold text-ink-3 uppercase tracking-widest">🎟️ Watch schedule</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {schedule.map(day => (
          <div key={day.day} className="space-y-2">
            <p className="text-sm font-extrabold text-ink">{day.day}</p>
            {day.slots.map(slot => <SlotCard key={slot.slot_order} slot={slot} />)}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check the frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Bracket.tsx
git commit -m "feat: add Bracket component for the live watch schedule"
```

---

### Task 15: `EventAdminControls` component

**Files:**
- Create: `frontend/src/components/EventAdminControls.tsx`

**Interfaces:**
- Consumes: `api.closeEvent`, `api.toggleEventPause`, `api.deleteEvent` (Task 12), `EventPayload` (Task 11).
- Produces: `EventAdminControls({ event, adminToken, onRefetch, onDeleted })` — used by Task 16.

- [ ] **Step 1: Create `frontend/src/components/EventAdminControls.tsx`**

```tsx
import { useState, useEffect } from 'react'
import type { EventPayload } from '../types'
import { api } from '../api/client'

interface EventAdminControlsProps {
  event: EventPayload
  adminToken: string
  onRefetch: () => void
  onDeleted: () => void
}

type Mode = 'default' | 'deleting' | 'deleted'

export function EventAdminControls({ event, adminToken, onRefetch, onDeleted }: EventAdminControlsProps) {
  const [mode, setMode] = useState<Mode>('default')
  const [loading, setLoading] = useState(false)
  const [pauseLoading, setPauseLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(10)
  const isPaused = event.categories.some(cat => cat.poll.is_paused)

  const handleClose = async () => {
    setLoading(true)
    setError(null)
    try {
      await api.closeEvent(event.id, adminToken)
      await onRefetch()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to close event')
    } finally {
      setLoading(false)
    }
  }

  const handleTogglePause = async () => {
    setPauseLoading(true)
    setError(null)
    try {
      await api.toggleEventPause(event.id, adminToken)
      await onRefetch()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to toggle pause')
    } finally {
      setPauseLoading(false)
    }
  }

  useEffect(() => {
    if (mode !== 'deleted') return
    setCountdown(10)
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(interval)
          onDeleted()
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [mode])

  const isWide = mode === 'deleting' || mode === 'deleted'

  return (
    <div className={`fixed bottom-4 right-4 bg-[var(--raised-glass)] backdrop-blur-md border border-line-bright rounded-2xl p-4 shadow-2xl shadow-black/60 space-y-3 transition-all duration-200 ${isWide ? 'w-72' : 'w-52'}`}>
      <div className="flex items-center gap-2">
        <span className="text-warn text-xs">⚡</span>
        <p className="text-xs font-bold text-ink-2 uppercase tracking-widest">Event Admin</p>
      </div>

      {error && <p className="text-danger text-xs">{error}</p>}

      {mode === 'default' && (
        <>
          {event.phase === 'voting' && (
            <button
              disabled={loading}
              onClick={handleClose}
              className="w-full bg-danger text-white text-sm font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-40 hover:opacity-90"
            >
              Close event & show results →
            </button>
          )}
          {event.phase === 'closed' && <p className="text-ink-3 text-xs">Event is closed.</p>}
          <button
            disabled={pauseLoading || event.phase === 'closed'}
            onClick={handleTogglePause}
            className="w-full text-xs font-semibold py-2 rounded-xl transition-colors disabled:opacity-40 border border-line hover:border-line-bright text-ink-2 hover:text-ink"
          >
            {pauseLoading ? '…' : isPaused ? '▶ Unpause all' : '⏸ Pause all'}
          </button>
          <button
            onClick={() => { setError(null); setMode('deleting') }}
            className="w-full text-xs text-ink-3 hover:text-danger transition-colors text-center py-1"
          >
            Delete event
          </button>
        </>
      )}

      {mode === 'deleting' && (
        <>
          <p className="text-xs font-semibold text-ink">Delete this event?</p>
          <p className="text-xs text-ink-3">This cannot be undone. All 8 category polls, nominations, and votes will be permanently deleted.</p>
          <div className="flex gap-2 pt-1">
            <button
              disabled={loading}
              onClick={() => { setError(null); setMode('default') }}
              className="flex-1 text-xs text-ink-3 hover:text-ink border border-line rounded-xl py-2 transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              disabled={loading}
              onClick={async () => {
                setLoading(true)
                setError(null)
                try {
                  await api.deleteEvent(event.id, adminToken)
                  setMode('deleted')
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Failed to delete event')
                } finally {
                  setLoading(false)
                }
              }}
              className="flex-1 bg-danger text-white text-xs font-semibold py-2 rounded-xl transition-colors disabled:opacity-40 hover:opacity-90"
            >
              Delete
            </button>
          </div>
        </>
      )}

      {mode === 'deleted' && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-ink">Event deleted.</p>
          <p className="text-xs text-ink-3">Redirecting in {countdown}s…</p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check the frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/EventAdminControls.tsx
git commit -m "feat: add EventAdminControls for bulk close/pause/delete"
```

---

### Task 16: `EventPage` + route registration

**Files:**
- Create: `frontend/src/pages/EventPage.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `useEvent` (Task 13), `Bracket` (Task 14), `EventAdminControls` (Task 15), `api.joinEvent`/`api.hasToken` (Task 12), existing `VotingPhase`/`ResultsView` components (unmodified).

- [ ] **Step 1: Create `frontend/src/pages/EventPage.tsx`**

```tsx
import { useState, useEffect } from 'react'
import { useParams, useSearchParams, Navigate, useNavigate } from 'react-router-dom'
import { useEvent } from '../hooks/useEvent'
import { api } from '../api/client'
import { VotingPhase } from '../components/VotingPhase'
import { ResultsView } from '../components/ResultsView'
import { EventAdminControls } from '../components/EventAdminControls'
import { Bracket } from '../components/Bracket'
import type { Poll } from '../types'

function CategorySection({ poll, onRefetch }: { poll: Poll; onRefetch: () => void }) {
  return (
    <details className="card p-0 overflow-hidden" open>
      <summary className="cursor-pointer select-none px-5 py-4 font-bold text-ink flex items-center justify-between">
        <span>{poll.title}</span>
        {poll.has_voted && <span className="text-success text-xs font-bold">✓ Voted</span>}
      </summary>
      <div className="px-5 pb-5">
        {poll.phase === 'closed' ? (
          <ResultsView poll={poll} />
        ) : (
          <VotingPhase poll={poll} onRefetch={onRefetch} />
        )}
      </div>
    </details>
  )
}

export function EventPage() {
  const { slug } = useParams<{ slug: string }>()
  if (!slug) return <Navigate to="/" />

  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const adminToken = searchParams.get('admin')
  const { event, error, loading, refetch } = useEvent(slug)

  const [joinedName, setJoinedName] = useState<string | null>(null)
  const [participantName, setParticipantName] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [welcomeBack, setWelcomeBack] = useState(false)

  useEffect(() => {
    if (event) document.title = `${event.title} - Polls`
    return () => { document.title = 'Polls' }
  }, [event?.title])

  useEffect(() => {
    if (!welcomeBack) return
    const t = setTimeout(() => setWelcomeBack(false), 4000)
    return () => clearTimeout(t)
  }, [welcomeBack])

  if (loading) return (
    <div className="flex items-center justify-center py-24 text-ink-3 animate-pulse text-sm">
      Loading…
    </div>
  )
  if (error && !event) return (
    <div className="flex items-center justify-center py-24 text-danger text-sm">{error}</div>
  )
  if (!event) return null

  const needsJoin = event.categories.some(cat => !api.hasToken(cat.poll.id))
  const votedCount = event.categories.filter(cat => cat.poll.has_voted).length

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!participantName.trim()) return
    setJoining(true)
    setJoinError(null)
    try {
      const data = await api.joinEvent(slug, participantName.trim())
      setJoinedName(data.name)
      if (data.rejoined) setWelcomeBack(true)
      await refetch()
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : 'Failed to join')
    } finally {
      setJoining(false)
    }
  }

  const header = (
    <div className="card p-6">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="badge text-ink-3 bg-surface border border-line">🎬 Event</span>
        <span className={`badge ${event.phase === 'closed' ? 'text-success bg-[oklch(68%_0.18_145_/_0.12)]' : 'text-warn bg-[oklch(72%_0.17_65_/_0.12)]'}`}>
          {event.phase === 'closed' ? 'Closed' : 'Voting'}
        </span>
      </div>
      <h1 className="text-2xl font-extrabold text-ink tracking-tight text-wrap-balance">{event.title}</h1>
      {!needsJoin && (
        <p className="text-ink-3 text-sm mt-1">{votedCount} of {event.categories.length} categories voted</p>
      )}
    </div>
  )

  if (needsJoin) {
    return (
      <div className="max-w-2xl mx-auto py-8 px-4 space-y-4">
        {header}
        <div className="card p-6">
          <p className="font-bold text-ink mb-4">Join this event</p>
          <form onSubmit={handleJoin} className="space-y-3">
            <input
              className="input"
              value={participantName}
              onChange={e => setParticipantName(e.target.value)}
              placeholder="Your name"
              autoFocus
            />
            {joinError && <p className="text-danger text-sm">{joinError}</p>}
            <button type="submit" disabled={joining} className="btn-primary">
              {joining ? 'Joining…' : 'Join →'}
            </button>
          </form>
        </div>
        {adminToken && (
          <EventAdminControls event={event} adminToken={adminToken} onRefetch={refetch} onDeleted={() => navigate('/')} />
        )}
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-4">
      {header}

      {welcomeBack && (
        <div className="card px-5 py-3 text-sm text-success bg-[oklch(68%_0.18_145_/_0.08)] border border-[oklch(68%_0.18_145_/_0.2)]">
          Welcome back, {joinedName}!
        </div>
      )}

      <div className="space-y-3">
        {event.categories.map(cat => (
          <CategorySection key={cat.poll.id} poll={cat.poll} onRefetch={refetch} />
        ))}
      </div>

      <Bracket schedule={event.schedule} />

      {adminToken && (
        <EventAdminControls event={event} adminToken={adminToken} onRefetch={refetch} onDeleted={() => navigate('/')} />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Register the route in `frontend/src/App.tsx`**

Add the import after `import { LearnPage } from './pages/LearnPage'` (line 5):

```ts
import { EventPage } from './pages/EventPage'
```

Add the route after `<Route path="/learn" element={<LearnPage />} />` (line 37):

```tsx
          <Route path="/e/:slug" element={<EventPage />} />
```

- [ ] **Step 3: Type-check the frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/EventPage.tsx frontend/src/App.tsx
git commit -m "feat: add EventPage at /e/:slug with category sections and bracket"
```

---

### Task 17: Spreadsheet import script

**Files:**
- Create: `worker/scripts/build-event-seed.ts`
- Modify: `worker/package.json`

**Interfaces:**
- Produces: a CLI script printing SQL `INSERT` statements to stdout, given `<xlsx-path> <slug> <title>`.

- [ ] **Step 1: Add devDependencies and an npm script**

In `worker/package.json`, add to `"scripts"` (after `"test:watch": "vitest"`):

```json
    "import-event": "tsx scripts/build-event-seed.ts"
```

Add to `"devDependencies"` (alphabetical position, after `"@cloudflare/workers-types"`):

```json
    "tsx": "^4.19.0",
    "xlsx": "^0.18.5",
```

- [ ] **Step 2: Install the new dependencies**

Run: `cd worker && npm install`
Expected: `xlsx` and `tsx` appear in `node_modules` and `package-lock.json` is updated.

- [ ] **Step 3: Create `worker/scripts/build-event-seed.ts`**

```ts
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { customAlphabet } from 'nanoid'

const nanoid = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 12)

// Known spelling/casing variants seen in the source spreadsheet, mapped to one canonical
// category name. If next year's spreadsheet introduces a new spelling, this script will
// throw a clear "Unknown voting category" error — add the new alias here and re-run.
const CATEGORY_ALIASES: Record<string, string> = {
  'comedy': 'Comedy',
  'other': 'Other',
  'action': 'Action',
  'big star': 'Big Star',
  'campy': 'Campy',
  'triple b': 'Triple B',
  "so bad, it's good.": "So Bad It's Good",
  "so bad its good": "So Bad It's Good",
  'music / documentary': 'Music/Documentary',
  'music /documentary': 'Music/Documentary',
  'music/documentary': 'Music/Documentary',
}

function normalizeCategory(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  const alias = CATEGORY_ALIASES[key]
  if (!alias) throw new Error(`Unknown voting category: "${raw}". Add it to CATEGORY_ALIASES in build-event-seed.ts.`)
  return alias
}

function parseSlotLabel(label: string): { category: string; placement: 1 | 2 } {
  const m = label.match(/^(.*?)\s*(1st|first|2nd|second)\s*choice\s*$/i)
  if (!m) throw new Error(`Cannot parse schedule slot label: "${label}"`)
  const placement: 1 | 2 = /1st|first/i.test(m[2]!) ? 1 : 2
  return { category: normalizeCategory(m[1]!), placement }
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function sqlValue(value: string | number | null): string {
  if (value === null) return 'NULL'
  if (typeof value === 'number') return String(value)
  return sqlString(value)
}

interface Movie {
  title: string
  trailerUrl: string | null
  category: string
}

function parseMovies(rows: unknown[][]): Movie[] {
  const header = rows[0] as string[]
  const titleCol = header.indexOf('Title')
  const trailerCol = header.indexOf('Trailer Link')
  const categoryCol = header.indexOf('Voting Category')
  if (titleCol === -1 || categoryCol === -1) {
    throw new Error('Movie List sheet must have "Title" and "Voting Category" columns')
  }

  const movies: Movie[] = []
  for (const row of rows.slice(1)) {
    const title = row[titleCol]
    if (!title || typeof title !== 'string' || !title.trim()) continue
    const rawCategory = row[categoryCol]
    if (!rawCategory || typeof rawCategory !== 'string' || !rawCategory.trim()) {
      throw new Error(`Movie "${title}" has no Voting Category`)
    }
    const trailerUrl = row[trailerCol]
    movies.push({
      title: title.trim(),
      trailerUrl: typeof trailerUrl === 'string' && trailerUrl.trim() ? trailerUrl.trim() : null,
      category: normalizeCategory(rawCategory),
    })
  }
  return movies
}

interface Slot {
  day: string
  slotOrder: number
  category: string
  placement: 1 | 2
}

function parseSchedule(rows: unknown[][]): Slot[] {
  const header = rows[0] as string[]
  const dayCol = header.indexOf('Day')
  const categoryCols = header
    .map((h, i) => ({ h, i }))
    .filter(({ h, i }) => i !== dayCol && typeof h === 'string' && h.trim())

  const slots: Slot[] = []
  for (const row of rows.slice(1)) {
    const day = row[dayCol]
    if (!day || typeof day !== 'string' || !day.trim()) continue
    let slotOrder = 1
    for (const { i } of categoryCols) {
      const label = row[i]
      if (!label || typeof label !== 'string' || !label.trim()) continue
      const { category, placement } = parseSlotLabel(label.trim())
      slots.push({ day: day.trim(), slotOrder, category, placement })
      slotOrder++
    }
  }
  return slots
}

function main() {
  const [xlsxPath, slug, title] = process.argv.slice(2)
  if (!xlsxPath || !slug || !title) {
    console.error('Usage: npm run import-event -- <path-to.xlsx> <slug> <title>')
    process.exit(1)
  }

  const workbook = XLSX.read(readFileSync(xlsxPath))
  const movieSheet = workbook.Sheets['Movie List']
  const scheduleSheet = workbook.Sheets['Movie Assignment']
  if (!movieSheet) throw new Error('Workbook has no "Movie List" sheet')
  if (!scheduleSheet) throw new Error('Workbook has no "Movie Assignment" sheet')

  const movieRows = XLSX.utils.sheet_to_json(movieSheet, { header: 1, defval: null }) as unknown[][]
  const scheduleRows = XLSX.utils.sheet_to_json(scheduleSheet, { header: 1, defval: null }) as unknown[][]

  const movies = parseMovies(movieRows)
  const slots = parseSchedule(scheduleRows)

  const categories = [...new Set(movies.map(m => m.category))]
  const slotCategories = new Set(slots.map(s => s.category))
  for (const cat of slotCategories) {
    if (!categories.includes(cat)) {
      throw new Error(`Schedule references category "${cat}" which has no movies`)
    }
  }

  const now = Date.now()
  const eventAdminToken = nanoid(24)
  const statements: string[] = []
  const pollIdByCategory = new Map<string, string>()
  const systemParticipantIdByCategory = new Map<string, string>()

  categories.forEach((category, index) => {
    const pollId = nanoid(8)
    const pollAdminToken = nanoid(24)
    const movieCount = movies.filter(m => m.category === category).length
    pollIdByCategory.set(category, pollId)

    statements.push(
      `INSERT INTO polls (id, admin_token, title, category, voting_method, phase, max_nominations, nominations_visible, votes_visible, is_public, nomination_closes_at, created_at) VALUES (${sqlValue(pollId)}, ${sqlValue(pollAdminToken)}, ${sqlValue(category)}, 'movie', 'ranked_choice', 'voting', ${movieCount}, 1, 1, 0, NULL, ${now});`
    )

    const systemParticipantId = nanoid(8)
    systemParticipantIdByCategory.set(category, systemParticipantId)
    statements.push(
      `INSERT INTO participants (id, poll_id, name, token, joined_at) VALUES (${sqlValue(systemParticipantId)}, ${sqlValue(pollId)}, 'Preset', ${sqlValue(nanoid(24))}, ${now});`
    )

    statements.push(
      `INSERT INTO event_polls (event_id, poll_id, category, sort_order) VALUES (${sqlValue(slug)}, ${sqlValue(pollId)}, ${sqlValue(category)}, ${index});`
    )
  })

  movies.forEach((movie, index) => {
    const pollId = pollIdByCategory.get(movie.category)!
    const participantId = systemParticipantIdByCategory.get(movie.category)!
    const nominationId = nanoid(8)
    const metadata = movie.trailerUrl ? JSON.stringify({ trailer_url: movie.trailerUrl }) : null
    statements.push(
      `INSERT INTO nominations (id, poll_id, participant_id, title, metadata, created_at) VALUES (${sqlValue(nominationId)}, ${sqlValue(pollId)}, ${sqlValue(participantId)}, ${sqlValue(movie.title)}, ${sqlValue(metadata)}, ${now + index});`
    )
  })

  statements.push(
    `INSERT INTO events (id, admin_token, title, is_public, created_at) VALUES (${sqlValue(slug)}, ${sqlValue(eventAdminToken)}, ${sqlValue(title)}, 0, ${now});`
  )

  for (const slot of slots) {
    statements.push(
      `INSERT INTO event_slots (event_id, day, slot_order, category, placement) VALUES (${sqlValue(slug)}, ${sqlValue(slot.day)}, ${slot.slotOrder}, ${sqlValue(slot.category)}, ${slot.placement});`
    )
  }

  console.log(statements.join('\n'))
  console.error(`\n${categories.length} categories, ${movies.length} movies, ${slots.length} schedule slots.`)
  console.error(`Admin URL (after deploy): https://<your-frontend-host>/e/${slug}?admin=${eventAdminToken}`)
}

main()
```

- [ ] **Step 4: Commit**

```bash
git add worker/package.json worker/package-lock.json worker/scripts/build-event-seed.ts
git commit -m "feat: add spreadsheet-to-SQL import script for events"
```

---

### Task 18: End-to-end verification

**Files:** none (manual verification only)

- [ ] **Step 1: Generate a seed file from the real spreadsheet**

Run:
```bash
cd worker && npx tsx scripts/build-event-seed.ts ~/Downloads/glarm.xlsx glarm26 "Glarm Weekend 2026 Movies" > seed-glarm26.sql
```
Expected: the script prints `8 categories, 91 movies, 12 schedule slots.` and an admin URL to stderr, and `seed-glarm26.sql` contains only `INSERT` statements (no errors about unknown categories or unparseable slot labels).

- [ ] **Step 2: Apply the seed to the local D1 database**

Run:
```bash
cd worker && npx wrangler d1 execute polls --local --file=seed-glarm26.sql
```
Expected: command succeeds, reporting rows written.

- [ ] **Step 3: Start both dev servers**

Run (in two terminals, or backgrounded):
```bash
cd worker && npm run dev
cd frontend && npm run dev
```
Expected: worker on `http://localhost:8787`, frontend on `http://localhost:5173`.

- [ ] **Step 4: Browser walkthrough**

Open `http://localhost:5173/e/glarm26`:
1. Confirm the join form appears; join as "Alice". Confirm the 8 category sections and the "0 of 8 categories voted" line appear.
2. Rank and submit a vote in 2-3 categories (including at least one category referenced by a Thursday slot, e.g. Action, Big Star, Other, or Triple B). Confirm "✓ Voted" appears on those sections and the progress count updates.
3. Scroll to the bracket. Confirm slots for the categories just voted in show a movie title (or "Awaiting votes" for untouched categories).
4. Open a private/incognito window, visit `http://localhost:5173/e/glarm26`, join as "Alice" again. Confirm "Welcome back, Alice!" appears and previously-voted categories still show "✓ Voted" (proves cross-device reclaim works).
5. Copy the admin URL printed by the script in Step 1, open it, confirm the `EventAdminControls` panel appears bottom-right with "Close event & show results", "Pause all", and "Delete event".
6. Click "Pause all"; confirm attempting to submit a vote in an unvoted category shows the "This poll is paused" message; click "Unpause all" to restore.
7. Click "Close event & show results"; confirm all 8 sections switch to `ResultsView` and the bracket keeps showing final placements.

- [ ] **Step 5: Clean up the local database**

Run:
```bash
cd worker && npx wrangler d1 execute polls --local --command "DELETE FROM event_slots WHERE event_id = 'glarm26'; DELETE FROM event_polls WHERE event_id = 'glarm26'; DELETE FROM events WHERE id = 'glarm26';"
```
This removes the local test data. (The `polls`/`nominations`/`participants`/`votes` rows for glarm26's 8 category polls are harmless leftovers in the local dev DB and can be ignored or wiped with `rm -rf worker/.wrangler/state/v3/d1` if a clean slate is wanted.)

- [ ] **Step 6: Report results**

Summarize in the session which of the 7 sub-checks in Step 4 passed, and paste any errors encountered. Do not mark this plan complete until all 7 pass.

---

## Deploying for real next

This plan only covers local verification. When ready to run the real 2026 event:
1. Apply the migration to production: `cd worker && npx wrangler d1 migrations apply polls --remote`.
2. Generate and apply the real seed against production: `npx tsx scripts/build-event-seed.ts ~/Downloads/glarm.xlsx glarm26 "Glarm Weekend 2026 Movies" > seed-glarm26.sql && npx wrangler d1 execute polls --remote --file=seed-glarm26.sql`.
3. Deploy the worker (`npm run deploy`) and the frontend (existing Cloudflare Pages flow per `docs/DEPLOY.md`).
4. Save the admin URL printed to stderr somewhere safe — it's the only time it's shown.
