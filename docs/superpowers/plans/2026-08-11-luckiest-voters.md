# Luckiest / Unluckiest Voters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the 3 "luckiest" (top-pick landed highest) and 3 "unluckiest" (top-pick landed lowest) voters at the bottom of a poll's results, and a combined version across an event's category polls — visible to admins during voting, everyone once closed.

**Architecture:** A new pure function `computeVoterLuck()` in `worker/src/lib/voting.ts` maps each voter's top-ranked pick to its placement in a poll's already-computed results. `GET /polls/:id/results` uses it directly and gates the field by phase/admin token. `GET /events/:slug` runs it once per category poll (using each poll's real voting method, not the bracket-only `rankedChoice` shortcut already in that file) and averages a normalized score per participant across categories, joined by lowercase name — the same key `events.ts` already uses for its voter headcount. Frontend renders both as small new cards, gated purely on the field being present in the API response (the backend has already decided visibility).

**Tech Stack:** Hono 4 + D1 (`@cloudflare/vitest-pool-workers`) on the worker side; React 18 + Vitest/@testing-library/react on the frontend. No new dependencies.

## Global Constraints

- Luck metric: a voter's "pick" is their top-ranked nomination only (the single row for plurality, `rank = 1` for ranked ballots) — never the full ballot.
- Per-poll placement is 1-indexed position in the poll's `results` array (1 = winner). Ties break by array/insertion order — no special tie-breaking logic.
- Event-level score is normalized per poll as `(total - placement) / (total - 1)`, or `1` when `total <= 1`, then averaged across the categories a person voted in.
- No minimum-voter threshold anywhere — small polls may show overlapping luckiest/unluckiest lists, and that's fine.
- Visibility is enforced server-side: per-poll `voter_stats` requires `phase === 'closed'` OR (`phase === 'voting'` AND a valid admin token for that poll); event-level `voter_stats` requires the event to be fully closed OR a valid event admin token. Omit the field entirely (not `null`) when unauthorized.
- Section labels: **"🍀 Luckiest Picks"** / **"💔 Unluckiest Picks"** per-poll; **"🍀 Luckiest Overall"** / **"💔 Unluckiest Overall"** for the event aggregate.

---

### Task 1: `computeVoterLuck` pure function

**Files:**
- Modify: `worker/src/lib/voting.ts`
- Test: `worker/test/voting.test.ts`

**Interfaces:**
- Consumes: existing exports `VoteRow`, `RankedResult` from the same file.
- Produces:
  ```ts
  export interface VoterLuck {
    participant_id: string
    participant_name: string
    nomination_id: string
    title: string
    placement: number  // 1-indexed position in `results`
    total: number       // results.length
    score: number        // normalized 0..1, 1 = matched the winner
  }

  export function computeVoterLuck(
    votes: VoteRow[],
    results: RankedResult[],
    participantNames: Map<string, string>
  ): VoterLuck[]
  ```
  Sorted ascending by `placement` (luckiest first). Later tasks rely on this exact name, signature, and ordering.

- [ ] **Step 1: Write the failing tests**

Append to `worker/test/voting.test.ts` (add `computeVoterLuck` to the existing import from `../src/lib/voting`, and add `type VoterLuck` alongside the other type imports):

```ts
import { plurality, rankedChoice, rankedPairs, computeVoterLuck } from '../src/lib/voting'
```

```ts
describe('computeVoterLuck', () => {
  const results: RankedResult[] = [
    { nomination_id: 'a', title: 'A', metadata: null, score: 10, percentage: 50 },
    { nomination_id: 'b', title: 'B', metadata: null, score: 6, percentage: 30 },
    { nomination_id: 'c', title: 'C', metadata: null, score: 2, percentage: 20 },
  ]
  const names = new Map([['p1', 'Alice'], ['p2', 'Bob'], ['p3', 'Carol']])

  it('uses the single vote for plurality (rank=null)', () => {
    const votes: VoteRow[] = [
      { participant_id: 'p1', nomination_id: 'a', rank: null },
      { participant_id: 'p2', nomination_id: 'c', rank: null },
    ]
    const luck = computeVoterLuck(votes, results, names)
    expect(luck).toHaveLength(2)
    const alice = luck.find(l => l.participant_id === 'p1')!
    expect(alice.placement).toBe(1)
    expect(alice.score).toBe(1)
    expect(alice.participant_name).toBe('Alice')
    expect(alice.title).toBe('A')
    const bob = luck.find(l => l.participant_id === 'p2')!
    expect(bob.placement).toBe(3)
    expect(bob.score).toBe(0)
  })

  it('uses only the rank=1 entry for a ranked ballot, ignoring later ranks', () => {
    const votes: VoteRow[] = [
      { participant_id: 'p1', nomination_id: 'b', rank: 1 },
      { participant_id: 'p1', nomination_id: 'a', rank: 2 },
      { participant_id: 'p1', nomination_id: 'c', rank: 3 },
    ]
    const luck = computeVoterLuck(votes, results, names)
    expect(luck).toHaveLength(1)
    expect(luck[0]!.nomination_id).toBe('b')
    expect(luck[0]!.placement).toBe(2)
  })

  it('skips a voter whose top pick is not in results (e.g. a removed nomination)', () => {
    const votes: VoteRow[] = [{ participant_id: 'p1', nomination_id: 'ghost', rank: null }]
    const luck = computeVoterLuck(votes, results, names)
    expect(luck).toHaveLength(0)
  })

  it('sorts luckiest (lowest placement) first', () => {
    const votes: VoteRow[] = [
      { participant_id: 'p1', nomination_id: 'c', rank: null },
      { participant_id: 'p2', nomination_id: 'a', rank: null },
      { participant_id: 'p3', nomination_id: 'b', rank: null },
    ]
    const luck = computeVoterLuck(votes, results, names)
    expect(luck.map(l => l.participant_id)).toEqual(['p2', 'p3', 'p1'])
  })

  it('gives everyone a score of 1 when there is only one nomination', () => {
    const single: RankedResult[] = [{ nomination_id: 'a', title: 'A', metadata: null, score: 1, percentage: 100 }]
    const votes: VoteRow[] = [{ participant_id: 'p1', nomination_id: 'a', rank: null }]
    const luck = computeVoterLuck(votes, single, names)
    expect(luck[0]!.score).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run test/voting.test.ts`
Expected: FAIL — `computeVoterLuck is not a function` / import error.

- [ ] **Step 3: Implement `computeVoterLuck`**

Append to `worker/src/lib/voting.ts` (after the existing `rankedPairs` function):

```ts
export interface VoterLuck {
  participant_id: string
  participant_name: string
  nomination_id: string
  title: string
  placement: number
  total: number
  score: number
}

export function computeVoterLuck(
  votes: VoteRow[],
  results: RankedResult[],
  participantNames: Map<string, string>
): VoterLuck[] {
  const placementByNomination = new Map(results.map((r, i) => [r.nomination_id, i + 1]))
  const total = results.length

  // A voter's "pick" is their top choice: the single row for plurality
  // (rank always null) or the rank=1 row for a ranked ballot — this one
  // condition covers both without branching on voting method.
  const topPickByParticipant = new Map<string, string>()
  for (const vote of votes) {
    if (vote.rank === null || vote.rank === 1) topPickByParticipant.set(vote.participant_id, vote.nomination_id)
  }

  const luck: VoterLuck[] = []
  for (const [participantId, nominationId] of topPickByParticipant) {
    const placement = placementByNomination.get(nominationId)
    const result = results.find(r => r.nomination_id === nominationId)
    if (placement === undefined || !result) continue
    luck.push({
      participant_id: participantId,
      participant_name: participantNames.get(participantId) ?? 'Unknown',
      nomination_id: nominationId,
      title: result.title,
      placement,
      total,
      score: total > 1 ? (total - placement) / (total - 1) : 1,
    })
  }

  return luck.sort((a, b) => a.placement - b.placement)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run test/voting.test.ts`
Expected: PASS (all `computeVoterLuck` cases plus the existing `plurality`/`rankedChoice`/`rankedPairs` suites).

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/voting.ts worker/test/voting.test.ts
git commit -m "feat: add computeVoterLuck for luckiest/unluckiest voter stats"
```

---

### Task 2: Per-poll `voter_stats` on `GET /polls/:id/results`

**Files:**
- Modify: `worker/src/routes/votes.ts:1-5,120-138`
- Test: `worker/test/votes.test.ts`

**Interfaces:**
- Consumes: `computeVoterLuck`, `VoterLuck` from Task 1 (`worker/src/lib/voting.ts`); existing `isValidAdminToken` from `../middleware/auth.ts` (already imported).
- Produces: response field `voter_stats?: { luckiest: VoterLuck[]; unluckiest: VoterLuck[] }` on `GET /polls/:id/results`, present only when authorized. Frontend tasks rely on this exact shape and key name.

- [ ] **Step 1: Write the failing tests**

Add these `it` blocks inside the existing `describe('GET /polls/:id/results', ...)` in `worker/test/votes.test.ts` (after the existing cases):

```ts
  it('omits voter_stats during voting when no admin token is provided', async () => {
    const { id } = await seedPoll({ voting_method: 'plurality', votes_visible: 1 })
    const { id: pid } = await seedParticipant(id)
    const { id: nid } = await seedNomination(id, pid, 'Winner')
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v1', id, pid, nid, null, Date.now()).run()

    const res = await SELF.fetch(`http://example.com/polls/${id}/results`)
    const body = await res.json() as Record<string, unknown>
    expect(body.voter_stats).toBeUndefined()
  })

  it('includes voter_stats for a valid poll admin token during voting phase', async () => {
    const { id, adminToken } = await seedPoll({ voting_method: 'plurality', votes_visible: 1 })
    const { id: pid } = await seedParticipant(id)
    const { id: nid } = await seedNomination(id, pid, 'Winner')
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v1', id, pid, nid, null, Date.now()).run()

    const res = await SELF.fetch(`http://example.com/polls/${id}/results?admin=${adminToken}`)
    const body = await res.json() as { voter_stats?: { luckiest: unknown[]; unluckiest: unknown[] } }
    expect(body.voter_stats).toBeDefined()
    expect(body.voter_stats!.luckiest).toHaveLength(1)
  })

  it('includes voter_stats for everyone once the poll is closed', async () => {
    const { id } = await seedPoll({ voting_method: 'plurality' })
    const { id: pid } = await seedParticipant(id)
    const { id: nid } = await seedNomination(id, pid, 'Winner')
    await env.DB.prepare("UPDATE polls SET phase = 'closed' WHERE id = ?").bind(id).run()
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v1', id, pid, nid, null, Date.now()).run()

    const res = await SELF.fetch(`http://example.com/polls/${id}/results`)
    const body = await res.json() as { voter_stats?: { luckiest: unknown[] } }
    expect(body.voter_stats).toBeDefined()
  })

  it('lists the luckiest and unluckiest voters by their top pick\'s placement', async () => {
    const { id } = await seedPoll({ voting_method: 'plurality' })
    const { id: p1 } = await seedParticipant(id, 'Alice')
    const { id: p2 } = await seedParticipant(id, 'Bob')
    const { id: p3 } = await seedParticipant(id, 'Carol')
    const { id: winner } = await seedNomination(id, p1, 'Winner')
    const { id: loser } = await seedNomination(id, p2, 'Loser')
    await env.DB.prepare("UPDATE polls SET phase = 'closed' WHERE id = ?").bind(id).run()
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v1', id, p1, winner, null, Date.now()).run()
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v2', id, p2, winner, null, Date.now()).run()
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v3', id, p3, loser, null, Date.now()).run()

    const res = await SELF.fetch(`http://example.com/polls/${id}/results`)
    const body = await res.json() as {
      voter_stats: {
        luckiest: Array<{ participant_name: string; placement: number }>
        unluckiest: Array<{ participant_name: string; placement: number }>
      }
    }
    const luckyNames = body.voter_stats.luckiest.map(l => l.participant_name).sort()
    expect(luckyNames).toEqual(['Alice', 'Bob'])
    expect(body.voter_stats.unluckiest[0]!.participant_name).toBe('Carol')
    expect(body.voter_stats.unluckiest[0]!.placement).toBe(2)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run test/votes.test.ts`
Expected: FAIL — `body.voter_stats` assertions fail because the field doesn't exist yet.

- [ ] **Step 3: Implement the endpoint change**

In `worker/src/routes/votes.ts`, change the import line:

```ts
import { plurality, rankedChoice, rankedPairs, computeVoterLuck, type VoterLuck } from '../lib/voting'
```

Then replace the end of the `votesRouter.get('/:id/results', ...)` handler (from `const tied = ...` through the final `return c.json(...)`) with:

```ts
  const tied = results.length > 1 && results[0]?.score === results[1]?.score

  const isAuthorizedForVoterStats = poll.phase === 'closed'
    || (poll.phase === 'voting' && await isValidAdminToken(c.env, pollId, c.req.query('admin')))

  let voterStats: { luckiest: VoterLuck[]; unluckiest: VoterLuck[] } | undefined
  if (isAuthorizedForVoterStats) {
    const { results: participants } = await c.env.DB.prepare(
      'SELECT id, name FROM participants WHERE poll_id = ?'
    ).bind(pollId).all<{ id: string; name: string }>()
    const nameById = new Map(participants.map(p => [p.id, p.name]))
    const luck = computeVoterLuck(votes, results, nameById)
    voterStats = { luckiest: luck.slice(0, 3), unluckiest: luck.slice(-3).reverse() }
  }

  return c.json({
    poll_id: pollId,
    voting_method: poll.voting_method,
    results,
    total_voters: voterCount,
    tied,
    voter_stats: voterStats,
  })
```

`c.json` serializes via `JSON.stringify`, which drops `undefined`-valued keys entirely, so `voter_stats` is genuinely absent from the response when unauthorized (not present-as-`null`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run test/votes.test.ts`
Expected: PASS — all `GET /polls/:id/results` cases, including the 4 new ones, plus every pre-existing test in the file (confirms the existing gating for `votes_visible` is untouched).

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/votes.ts worker/test/votes.test.ts
git commit -m "feat: add voter_stats to GET /polls/:id/results"
```

---

### Task 3: Event-level `voter_stats` on `GET /events/:slug`

**Files:**
- Modify: `worker/src/routes/events.ts:1-4,86-148`
- Test: `worker/test/events.test.ts`

**Interfaces:**
- Consumes: `computeVoterLuck`, `VoterLuck` from Task 1; existing `plurality`, `rankedChoice`, `rankedPairs` from `../lib/voting`; existing `isEventAdmin`, `phase`, `pollResponses`, `nominationsByPoll`, `votesByPoll` already computed in this handler.
- Produces: response field on `GET /events/:slug`:
  ```ts
  voter_stats?: {
    luckiest: Array<{ name: string; average_score: number; categories_counted: number }>
    unluckiest: Array<{ name: string; average_score: number; categories_counted: number }>
  }
  ```
  present only when authorized. Frontend Task 5 relies on this exact shape.

- [ ] **Step 1: Write the failing test**

Add to `worker/test/events.test.ts`, inside the existing `describe('GET /events/:slug', ...)` block:

```ts
  it('omits voter_stats while the event is still open, without an admin token', async () => {
    const { id: pollA } = await seedPoll({ title: 'Action', category: 'movie', voting_method: 'plurality', votes_visible: 1 })
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(pollA).run()
    const { id: p1 } = await seedParticipant(pollA, 'Alice')
    const { id: nom } = await seedNomination(pollA, p1, 'Mad Max')
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v1', pollA, p1, nom, null, Date.now()).run()

    await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)

    const res = await SELF.fetch('http://example.com/events/glarm26')
    const body = await res.json() as Record<string, unknown>
    expect(body.voter_stats).toBeUndefined()
  })

  it('includes voter_stats for a valid event admin token while still open', async () => {
    const { id: pollA } = await seedPoll({ title: 'Action', category: 'movie', voting_method: 'plurality', votes_visible: 1 })
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(pollA).run()
    const { id: p1 } = await seedParticipant(pollA, 'Alice')
    const { id: nom } = await seedNomination(pollA, p1, 'Mad Max')
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v1', pollA, p1, nom, null, Date.now()).run()

    const { adminToken: eventAdminToken } = await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)

    const res = await SELF.fetch(`http://example.com/events/glarm26?admin=${eventAdminToken}`)
    const body = await res.json() as { voter_stats?: { luckiest: unknown[] } }
    expect(body.voter_stats).toBeDefined()
    expect(body.voter_stats!.luckiest).toHaveLength(1)
  })

  it('averages a participant\'s luck score across categories once the event is closed', async () => {
    const { id: pollA } = await seedPoll({ title: 'Action', category: 'movie', voting_method: 'plurality' })
    const { id: pollB } = await seedPoll({ title: 'Comedy', category: 'movie', voting_method: 'plurality' })
    await env.DB.prepare("UPDATE polls SET phase = 'closed' WHERE id IN (?, ?)").bind(pollA, pollB).run()

    // Poll A: Alice's pick wins (score 1), Bob's pick loses (score 0).
    const { id: aliceA } = await seedParticipant(pollA, 'Alice')
    const { id: bobA } = await seedParticipant(pollA, 'Bob')
    const { id: aWin } = await seedNomination(pollA, aliceA, 'Mad Max')
    const { id: aLose } = await seedNomination(pollA, bobA, 'Norbit')
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v1', pollA, aliceA, aWin, null, Date.now()).run()
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v2', pollA, bobA, aLose, null, Date.now()).run()

    // Poll B: Alice votes again (case-different name) and wins again.
    const { id: aliceB } = await seedParticipant(pollB, 'alice')
    const { id: bWin } = await seedNomination(pollB, aliceB, 'Anchorman')
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v3', pollB, aliceB, bWin, null, Date.now()).run()

    await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)
    await seedEventPoll('glarm26', pollB, 'Comedy', 1)

    const res = await SELF.fetch('http://example.com/events/glarm26')
    const body = await res.json() as {
      voter_stats: {
        luckiest: Array<{ name: string; average_score: number; categories_counted: number }>
        unluckiest: Array<{ name: string; average_score: number; categories_counted: number }>
      }
    }
    // Alice voted in both categories and won both — averages to 1, counted once
    // despite the case-different name across the two polls.
    const alice = body.voter_stats.luckiest.find(l => l.name.toLowerCase() === 'alice')!
    expect(alice.average_score).toBe(1)
    expect(alice.categories_counted).toBe(2)
    expect(body.voter_stats.unluckiest[0]!.name).toBe('Bob')
    expect(body.voter_stats.unluckiest[0]!.average_score).toBe(0)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run test/events.test.ts`
Expected: FAIL — `body.voter_stats` assertions fail.

- [ ] **Step 3: Implement the aggregation**

In `worker/src/routes/events.ts`, change the import line:

```ts
import { plurality, rankedChoice, rankedPairs, computeVoterLuck, type RankedResult, type NominationRow, type VoteRow, type VoterLuck } from '../lib/voting'
```

In the batched-fetch block, add a third query for participant names alongside nominations/votes:

```ts
  const pollIds = links.map(link => link.poll_id)
  let nominationsByPoll: Partial<Record<string, (NominationRow & { poll_id: string })[]>> = {}
  let votesByPoll: Partial<Record<string, (VoteRow & { poll_id: string })[]>> = {}
  let participantNamesByPoll: Partial<Record<string, { id: string; poll_id: string; name: string }[]>> = {}
  if (pollIds.length > 0) {
    const placeholders = pollIds.map(() => '?').join(',')
    const [{ results: allNominations }, { results: allVotes }, { results: allParticipants }] = await Promise.all([
      c.env.DB.prepare(
        `SELECT id, poll_id, title, metadata FROM nominations WHERE poll_id IN (${placeholders})`
      ).bind(...pollIds).all<NominationRow & { poll_id: string }>(),
      c.env.DB.prepare(
        `SELECT poll_id, participant_id, nomination_id, rank FROM votes WHERE poll_id IN (${placeholders})`
      ).bind(...pollIds).all<VoteRow & { poll_id: string }>(),
      c.env.DB.prepare(
        `SELECT id, poll_id, name FROM participants WHERE poll_id IN (${placeholders})`
      ).bind(...pollIds).all<{ id: string; poll_id: string; name: string }>(),
    ])
    nominationsByPoll = Object.groupBy(allNominations, n => n.poll_id)
    votesByPoll = Object.groupBy(allVotes, v => v.poll_id)
    participantNamesByPoll = Object.groupBy(allParticipants, p => p.poll_id)
  }
```

Replace the `links.forEach(...)` block with a version that also accumulates per-category luck, using each poll's real voting method (the existing `resultsByCategory.set(link.category, rankedChoice(...))` line for bracket slots is untouched):

```ts
  const luckScoresByName = new Map<string, { displayName: string; scores: number[] }>()

  links.forEach((link, i) => {
    const pollResponse = pollResponses[i]
    if (!pollResponse) return
    categories.push({ category: link.category, sort_order: link.sort_order, poll: pollResponse })
    const isVisible = pollResponse.votes_visible || pollResponse.phase === 'closed' || isEventAdmin
    if (isVisible) visibleCategories.add(link.category)

    const nominations = nominationsByPoll[link.poll_id] ?? []
    const votes = votesByPoll[link.poll_id] ?? []
    resultsByCategory.set(link.category, rankedChoice(votes, nominations))

    if (!isVisible) return
    const categoryResults = pollResponse.voting_method === 'plurality' ? plurality(votes, nominations)
      : pollResponse.voting_method === 'ranked_choice' ? rankedChoice(votes, nominations)
      : rankedPairs(votes, nominations)
    const namesForPoll = participantNamesByPoll[link.poll_id] ?? []
    const nameById = new Map(namesForPoll.map(p => [p.id, p.name]))
    const luck: VoterLuck[] = computeVoterLuck(votes, categoryResults, nameById)
    for (const entry of luck) {
      const key = entry.participant_name.toLowerCase()
      if (!luckScoresByName.has(key)) luckScoresByName.set(key, { displayName: entry.participant_name, scores: [] })
      luckScoresByName.get(key)!.scores.push(entry.score)
    }
  })
```

After the existing `const phase = ...` line, add the aggregation and gating:

```ts
  let eventVoterStats: {
    luckiest: Array<{ name: string; average_score: number; categories_counted: number }>
    unluckiest: Array<{ name: string; average_score: number; categories_counted: number }>
  } | undefined
  if (phase === 'closed' || isEventAdmin) {
    const averaged = [...luckScoresByName.values()].map(({ displayName, scores }) => ({
      name: displayName,
      average_score: scores.reduce((sum, s) => sum + s, 0) / scores.length,
      categories_counted: scores.length,
    }))
    eventVoterStats = {
      luckiest: [...averaged].sort((a, b) => b.average_score - a.average_score).slice(0, 3),
      unluckiest: [...averaged].sort((a, b) => a.average_score - b.average_score).slice(0, 3),
    }
  }
```

Finally, add `voter_stats: eventVoterStats` to the existing `return c.json({...})` object at the end of the handler (same `undefined`-drops-the-key behavior as Task 2).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run test/events.test.ts`
Expected: PASS — all 3 new cases plus every pre-existing test in the file (confirms bracket slot resolution via `resultsByCategory`/`rankedChoice` is unaffected).

- [ ] **Step 5: Run the full worker suite**

Run: `cd worker && npm test`
Expected: PASS (no regressions in other route files).

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/events.ts worker/test/events.test.ts
git commit -m "feat: add event-level voter_stats aggregated across category polls"
```

---

### Task 4: Frontend types + per-poll `ResultsView` stats card

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/components/ResultsView.tsx`
- Test: `frontend/src/components/ResultsView.test.tsx`

**Interfaces:**
- Consumes: the `voter_stats` shape produced by Task 2 (`{ luckiest: VoterLuck[]; unluckiest: VoterLuck[] }`).
- Produces: `VoterLuck` type and `PollResults.voter_stats?` field, consumed by this task's own component only (no later task depends on this one).

- [ ] **Step 1: Add types**

In `frontend/src/types.ts`, add after the existing `RankedResult` interface:

```ts
export interface VoterLuck {
  participant_id: string
  participant_name: string
  nomination_id: string
  title: string
  placement: number
  total: number
  score: number
}
```

Change `PollResults` to:

```ts
export interface PollResults {
  poll_id: string
  voting_method: VotingMethod
  results: RankedResult[]
  total_voters: number
  tied: boolean
  voter_stats?: { luckiest: VoterLuck[]; unluckiest: VoterLuck[] }
}
```

- [ ] **Step 2: Write the failing frontend tests**

Add to `frontend/src/components/ResultsView.test.tsx` (new `describe` block; `buildResults()` and `buildPoll()` already exist in this file):

```tsx
describe('ResultsView voter stats', () => {
  it('renders luckiest and unluckiest picks when voter_stats is present', async () => {
    vi.mocked(api.getResults).mockResolvedValue({
      ...buildResults(),
      voter_stats: {
        luckiest: [{ participant_id: 'p1', participant_name: 'Alice', nomination_id: 'a', title: 'Movie A', placement: 1, total: 2, score: 1 }],
        unluckiest: [{ participant_id: 'p2', participant_name: 'Bob', nomination_id: 'b', title: 'Movie B', placement: 2, total: 2, score: 0 }],
      },
    })
    render(
      <MemoryRouter>
        <ResultsView poll={buildPoll()} />
      </MemoryRouter>
    )

    expect(await screen.findByText('🍀 Luckiest Picks')).toBeTruthy()
    expect(screen.getByText('💔 Unluckiest Picks')).toBeTruthy()
    expect(screen.getByText('Alice')).toBeTruthy()
    expect(screen.getByText('Bob')).toBeTruthy()
  })

  it('omits the voter stats card when voter_stats is absent', async () => {
    vi.mocked(api.getResults).mockResolvedValue(buildResults())
    render(
      <MemoryRouter>
        <ResultsView poll={buildPoll()} />
      </MemoryRouter>
    )

    await waitFor(() => expect(screen.getAllByText('Movie A').length).toBeGreaterThan(0))
    expect(screen.queryByText('🍀 Luckiest Picks')).toBeNull()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/ResultsView.test.tsx`
Expected: FAIL — "🍀 Luckiest Picks" not found.

- [ ] **Step 4: Implement the card**

In `frontend/src/components/ResultsView.tsx`, insert this block immediately before the existing `{!hideLinks && (...)}` block (after the "Full standings" card's closing `</div>`):

```tsx
      {results.voter_stats && (results.voter_stats.luckiest.length > 0 || results.voter_stats.unluckiest.length > 0) && (
        <div className="card p-5 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-bold text-ink-3 uppercase tracking-widest mb-2">🍀 Luckiest Picks</p>
            <ol className="space-y-1 text-sm">
              {results.voter_stats.luckiest.map(l => (
                <li key={l.participant_id} className="text-ink-2">
                  <span className="font-semibold text-ink">{l.participant_name}</span>{' '}
                  → {l.title} <span className="text-ink-3">(#{l.placement})</span>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <p className="text-xs font-bold text-ink-3 uppercase tracking-widest mb-2">💔 Unluckiest Picks</p>
            <ol className="space-y-1 text-sm">
              {results.voter_stats.unluckiest.map(l => (
                <li key={l.participant_id} className="text-ink-2">
                  <span className="font-semibold text-ink">{l.participant_name}</span>{' '}
                  → {l.title} <span className="text-ink-3">(#{l.placement})</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/ResultsView.test.tsx`
Expected: PASS — all voter stats cases plus every pre-existing test in the file (confirms the card doesn't interfere with the leader/standings rendering).

- [ ] **Step 6: Type-check and commit**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

```bash
git add frontend/src/types.ts frontend/src/components/ResultsView.tsx frontend/src/components/ResultsView.test.tsx
git commit -m "feat: show luckiest/unluckiest voter picks on ResultsView"
```

---

### Task 5: Frontend `EventVoterStats` component + `EventPage` wiring

**Files:**
- Modify: `frontend/src/types.ts`
- Create: `frontend/src/components/EventVoterStats.tsx`
- Modify: `frontend/src/pages/EventPage.tsx`
- Test: `frontend/src/components/EventVoterStats.test.tsx`

**Interfaces:**
- Consumes: the `voter_stats` shape produced by Task 3 (`{ luckiest: EventVoterStat[]; unluckiest: EventVoterStat[] }`).
- Produces: `EventVoterStat` type, `EventPayload.voter_stats?` field, and `EventVoterStats` component (props: `{ luckiest: EventVoterStat[]; unluckiest: EventVoterStat[] }`) — no later task depends on this one.

- [ ] **Step 1: Add types**

In `frontend/src/types.ts`, add after `VoterLuck` (from Task 4):

```ts
export interface EventVoterStat {
  name: string
  average_score: number
  categories_counted: number
}
```

Change `EventPayload` to add one field:

```ts
export interface EventPayload {
  id: string
  title: string
  is_public: boolean
  phase: Phase
  categories: EventCategory[]
  schedule: EventDay[]
  voter_count: number
  voter_stats?: { luckiest: EventVoterStat[]; unluckiest: EventVoterStat[] }
  created_at: number
}
```

- [ ] **Step 2: Write the failing component test**

Create `frontend/src/components/EventVoterStats.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { EventVoterStats } from './EventVoterStats'

afterEach(() => cleanup())

describe('EventVoterStats', () => {
  it('renders luckiest and unluckiest overall lists', () => {
    render(
      <EventVoterStats
        luckiest={[{ name: 'Alice', average_score: 1, categories_counted: 2 }]}
        unluckiest={[{ name: 'Bob', average_score: 0, categories_counted: 2 }]}
      />
    )
    expect(screen.getByText('🍀 Luckiest Overall')).toBeTruthy()
    expect(screen.getByText('💔 Unluckiest Overall')).toBeTruthy()
    expect(screen.getByText('Alice')).toBeTruthy()
    expect(screen.getByText('Bob')).toBeTruthy()
  })

  it('renders nothing when both lists are empty', () => {
    const { container } = render(<EventVoterStats luckiest={[]} unluckiest={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/EventVoterStats.test.tsx`
Expected: FAIL — module `./EventVoterStats` not found.

- [ ] **Step 4: Implement the component**

Create `frontend/src/components/EventVoterStats.tsx`:

```tsx
import type { EventVoterStat } from '../types'

interface EventVoterStatsProps {
  luckiest: EventVoterStat[]
  unluckiest: EventVoterStat[]
}

export function EventVoterStats({ luckiest, unluckiest }: EventVoterStatsProps) {
  if (luckiest.length === 0 && unluckiest.length === 0) return null

  return (
    <div className="card p-5 grid grid-cols-2 gap-4">
      <div>
        <p className="text-xs font-bold text-ink-3 uppercase tracking-widest mb-2">🍀 Luckiest Overall</p>
        <ol className="space-y-1 text-sm">
          {luckiest.map(l => (
            <li key={l.name} className="text-ink-2">
              <span className="font-semibold text-ink">{l.name}</span>{' '}
              <span className="text-ink-3">({Math.round(l.average_score * 100)}%)</span>
            </li>
          ))}
        </ol>
      </div>
      <div>
        <p className="text-xs font-bold text-ink-3 uppercase tracking-widest mb-2">💔 Unluckiest Overall</p>
        <ol className="space-y-1 text-sm">
          {unluckiest.map(l => (
            <li key={l.name} className="text-ink-2">
              <span className="font-semibold text-ink">{l.name}</span>{' '}
              <span className="text-ink-3">({Math.round(l.average_score * 100)}%)</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/EventVoterStats.test.tsx`
Expected: PASS.

- [ ] **Step 6: Wire into `EventPage.tsx`**

In `frontend/src/pages/EventPage.tsx`, add the import alongside the other component imports:

```tsx
import { EventVoterStats } from '../components/EventVoterStats'
```

Insert this block immediately after `<Bracket schedule={event.schedule} />` and before the `{adminToken && (...)}` admin-controls block:

```tsx
      {event.voter_stats && (
        <EventVoterStats luckiest={event.voter_stats.luckiest} unluckiest={event.voter_stats.unluckiest} />
      )}
```

- [ ] **Step 7: Write the failing `EventPage` integration test**

Add to `frontend/src/pages/EventPage.test.tsx`, as a new `describe` block. Extend the existing `buildEvent` helper's return type usage by spreading in a `voter_stats` override — no change to `buildEvent` itself is needed since the extra field is simply omitted (`undefined`) unless added:

```tsx
describe('EventPage voter stats', () => {
  afterEach(() => {
    cleanup()
    fakeTokenStore.clear()
  })

  it('renders the event voter stats section when voter_stats is present', async () => {
    fakeTokenStore.add('action-poll')
    vi.mocked(api.getEvent).mockResolvedValue({
      ...buildEvent(['a', 'b', 'c']),
      voter_stats: {
        luckiest: [{ name: 'Alice', average_score: 1, categories_counted: 1 }],
        unluckiest: [{ name: 'Bob', average_score: 0, categories_counted: 1 }],
      },
    })

    render(
      <MemoryRouter initialEntries={['/e/glarm26']}>
        <Routes>
          <Route path="/e/:slug" element={<EventPage />} />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByText('🍀 Luckiest Overall')).toBeTruthy()
  })

  it('omits the voter stats section when voter_stats is absent', async () => {
    fakeTokenStore.add('action-poll')
    vi.mocked(api.getEvent).mockResolvedValue(buildEvent(['a', 'b', 'c']))

    render(
      <MemoryRouter initialEntries={['/e/glarm26']}>
        <Routes>
          <Route path="/e/:slug" element={<EventPage />} />
        </Routes>
      </MemoryRouter>
    )

    await screen.findByText('Action')
    expect(screen.queryByText('🍀 Luckiest Overall')).toBeNull()
  })
})
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/EventPage.test.tsx`
Expected: PASS — both new cases plus every pre-existing test in the file.

- [ ] **Step 9: Full frontend verification**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: type-check and build both succeed.

Run: `cd frontend && npx vitest run`
Expected: full frontend suite passes.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/types.ts frontend/src/components/EventVoterStats.tsx frontend/src/components/EventVoterStats.test.tsx frontend/src/pages/EventPage.tsx frontend/src/pages/EventPage.test.tsx
git commit -m "feat: show combined luckiest/unluckiest voters on the event page"
```

---

## Final Verification

- [ ] Run the full worker suite: `cd worker && npm test` — expect all green.
- [ ] Run the full frontend suite: `cd frontend && npx vitest run` — expect all green.
- [ ] Run `cd frontend && npm run build` — expect success (this is the actual bundling step; `tsc` alone is only a type-check gate per `frontend/tsconfig.json`'s `noEmit: true`).
