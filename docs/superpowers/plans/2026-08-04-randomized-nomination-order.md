# Randomized Nomination Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each poll participant nominations in a pseudo-random order during voting (all three voting methods), stable for that participant across refetches, without a schema change.

**Architecture:** A pure, dependency-free hash function (`worker/src/lib/shuffle.ts`) derives a deterministic sort key from `participant.id + nomination.id` (FNV-1a). `buildPollResponse()` (`worker/src/lib/pollDetail.ts`) applies this sort to the nominations array it already fetches, only when a participant is resolved from the request token and the poll is in the `voting` or `closed` phase. No frontend changes — `VotingPhase.tsx` already renders whatever order the server sends.

**Tech Stack:** Cloudflare Worker (Hono 4, TypeScript), `@cloudflare/vitest-pool-workers` for tests.

## Global Constraints

- No new migration, no new column, no new write path — the shuffle is computed at read time from existing data (spec goal: "no new schema, no new write path, no first-join bookkeeping").
- Applies to all three voting methods (plurality, ranked-choice, ranked-pairs) — the shuffle only reorders the `nominations` array; it does not touch `draft_ranking` handling, which is unchanged.
- Only during `voting`/`closed` phase. During `nominating` phase, and for any request without a resolvable participant (no token, admin-only request, unknown token), nominations stay in `created_at ASC` order — unchanged from current behavior.
- Hash function must be deterministic (same participant + same nomination → same key, every call) and needs no external dependency.

---

### Task 1: Shuffle helper module

**Files:**
- Create: `worker/src/lib/shuffle.ts`
- Test: `worker/test/shuffle.test.ts`

**Interfaces:**
- Produces: `shuffleKey(participantId: string, nominationId: string): number` — deterministic FNV-1a hash of `"${participantId}:${nominationId}"`, returned as an unsigned 32-bit integer.
- Produces: `shuffleByParticipant<T extends { id: string }>(items: T[], participantId: string): T[]` — returns a **new** array (does not mutate `items`), sorted ascending by `shuffleKey(participantId, item.id)`.

- [ ] **Step 1: Write the failing tests**

Create `worker/test/shuffle.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { shuffleKey, shuffleByParticipant } from '../src/lib/shuffle'

describe('shuffleKey', () => {
  it('is deterministic for the same participant and nomination', () => {
    expect(shuffleKey('p1', 'n1')).toBe(shuffleKey('p1', 'n1'))
  })

  it('differs for different participants against the same nomination', () => {
    const a = shuffleKey('p1', 'n1')
    const b = shuffleKey('p2', 'n1')
    expect(a).not.toBe(b)
  })
})

describe('shuffleByParticipant', () => {
  it('returns all the same items, just reordered', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
    const shuffled = shuffleByParticipant(items, 'participant-1')
    expect(shuffled.map(i => i.id).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('produces the same order across repeated calls for the same participant', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }]
    const first = shuffleByParticipant(items, 'participant-1').map(i => i.id)
    const second = shuffleByParticipant(items, 'participant-1').map(i => i.id)
    expect(second).toEqual(first)
  })

  it('produces a different order than input order for at least one of several participants', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}` }))
    const inputOrder = items.map(i => i.id)
    const anyDifferent = ['p1', 'p2', 'p3', 'p4', 'p5'].some(pid =>
      shuffleByParticipant(items, pid).map(i => i.id).join(',') !== inputOrder.join(',')
    )
    expect(anyDifferent).toBe(true)
  })

  it('does not mutate the input array', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const original = [...items]
    shuffleByParticipant(items, 'participant-1')
    expect(items).toEqual(original)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd worker && npx vitest run test/shuffle.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/shuffle'` (the module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `worker/src/lib/shuffle.ts`:

```ts
// FNV-1a 32-bit hash. Not cryptographic — only needs to look unpredictable
// to a human, and to be fast and dependency-free.
function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function shuffleKey(participantId: string, nominationId: string): number {
  return fnv1a(`${participantId}:${nominationId}`)
}

export function shuffleByParticipant<T extends { id: string }>(items: T[], participantId: string): T[] {
  return [...items].sort(
    (a, b) => shuffleKey(participantId, a.id) - shuffleKey(participantId, b.id)
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd worker && npx vitest run test/shuffle.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/shuffle.ts worker/test/shuffle.test.ts
git commit -m "feat: add deterministic per-participant shuffle helper"
```

---

### Task 2: Wire the shuffle into `buildPollResponse`

**Files:**
- Modify: `worker/src/lib/pollDetail.ts:1` (import), `worker/src/lib/pollDetail.ts:60-78` (participant block)
- Test: `worker/test/polls.test.ts`

**Interfaces:**
- Consumes: `shuffleByParticipant<T extends { id: string }>(items: T[], participantId: string): T[]` from Task 1 (`worker/src/lib/shuffle.ts`).
- No new exports from `pollDetail.ts` — `buildPollResponse()`'s existing return shape (`PollDetail`, including `nominations: PollDetailNomination[] | null`) is unchanged; only the *order* of the `nominations` array changes under the conditions below.

- [ ] **Step 1: Write the failing tests**

Add this new `describe` block to `worker/test/polls.test.ts` (after the existing `describe('GET /polls/:id draft_ranking', ...)` block, using the same `applySchema`/`seedPoll`/`seedParticipant`/`seedNomination` helpers already imported at the top of the file):

```ts
describe('GET /polls/:id nomination order', () => {
  beforeEach(applySchema)

  it('keeps created_at order during the nominating phase, even with a participant token', async () => {
    const { id } = await seedPoll()
    const { id: pid, token } = await seedParticipant(id)
    const { id: n1 } = await seedNomination(id, pid, 'A')
    const { id: n2 } = await seedNomination(id, pid, 'B')
    const { id: n3 } = await seedNomination(id, pid, 'C')

    const res = await SELF.fetch(`http://example.com/polls/${id}`, {
      headers: { 'Participant-Token': token },
    })
    const body = await res.json() as { nominations: { id: string }[] }
    expect(body.nominations.map(n => n.id)).toEqual([n1, n2, n3])
  })

  it('keeps created_at order during voting when no participant token is present', async () => {
    const { id } = await seedPoll()
    const { id: pid } = await seedParticipant(id)
    const { id: n1 } = await seedNomination(id, pid, 'A')
    const { id: n2 } = await seedNomination(id, pid, 'B')
    const { id: n3 } = await seedNomination(id, pid, 'C')
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()

    const res = await SELF.fetch(`http://example.com/polls/${id}`)
    const body = await res.json() as { nominations: { id: string }[] }
    expect(body.nominations.map(n => n.id)).toEqual([n1, n2, n3])
  })

  it('keeps created_at order in the closed phase when no participant token is present', async () => {
    const { id } = await seedPoll()
    const { id: pid } = await seedParticipant(id)
    const { id: n1 } = await seedNomination(id, pid, 'A')
    const { id: n2 } = await seedNomination(id, pid, 'B')
    await env.DB.prepare("UPDATE polls SET phase = 'closed' WHERE id = ?").bind(id).run()

    const res = await SELF.fetch(`http://example.com/polls/${id}`)
    const body = await res.json() as { nominations: { id: string }[] }
    expect(body.nominations.map(n => n.id)).toEqual([n1, n2])
  })

  it('returns the same participant-specific order across repeated fetches during voting', async () => {
    const { id } = await seedPoll()
    const { id: pid, token } = await seedParticipant(id)
    for (const title of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
      await seedNomination(id, pid, title)
    }
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()

    const first = await SELF.fetch(`http://example.com/polls/${id}`, {
      headers: { 'Participant-Token': token },
    })
    const firstBody = await first.json() as { nominations: { id: string }[] }
    const second = await SELF.fetch(`http://example.com/polls/${id}`, {
      headers: { 'Participant-Token': token },
    })
    const secondBody = await second.json() as { nominations: { id: string }[] }

    expect(secondBody.nominations.map(n => n.id)).toEqual(firstBody.nominations.map(n => n.id))
  })

  it('reorders nominations relative to creation order for at least one of several participants during voting', async () => {
    const { id } = await seedPoll()
    const { id: pid } = await seedParticipant(id, 'Nominator')
    const creationOrder: string[] = []
    for (const title of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
      const { id: nid } = await seedNomination(id, pid, title)
      creationOrder.push(nid)
    }
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()

    const voters = await Promise.all(
      ['Voter1', 'Voter2', 'Voter3', 'Voter4', 'Voter5'].map(name => seedParticipant(id, name))
    )

    let anyDifferent = false
    for (const { token } of voters) {
      const res = await SELF.fetch(`http://example.com/polls/${id}`, {
        headers: { 'Participant-Token': token },
      })
      const body = await res.json() as { nominations: { id: string }[] }
      const order = body.nominations.map(n => n.id)
      expect(order.slice().sort()).toEqual(creationOrder.slice().sort())
      if (order.join(',') !== creationOrder.join(',')) anyDifferent = true
    }
    expect(anyDifferent).toBe(true)
  })

  it('also reorders nominations for a participant once the poll is closed', async () => {
    const { id } = await seedPoll()
    const { id: pid } = await seedParticipant(id, 'Nominator')
    const creationOrder: string[] = []
    for (const title of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
      const { id: nid } = await seedNomination(id, pid, title)
      creationOrder.push(nid)
    }
    await env.DB.prepare("UPDATE polls SET phase = 'closed' WHERE id = ?").bind(id).run()

    const voters = await Promise.all(
      ['Voter1', 'Voter2', 'Voter3', 'Voter4', 'Voter5'].map(name => seedParticipant(id, name))
    )

    let anyDifferent = false
    for (const { token } of voters) {
      const res = await SELF.fetch(`http://example.com/polls/${id}`, {
        headers: { 'Participant-Token': token },
      })
      const body = await res.json() as { nominations: { id: string }[] }
      const order = body.nominations.map(n => n.id)
      expect(order.slice().sort()).toEqual(creationOrder.slice().sort())
      if (order.join(',') !== creationOrder.join(',')) anyDifferent = true
    }
    expect(anyDifferent).toBe(true)
  })

  it('keeps a nomination added after a participant\'s first fetch in a stable position across subsequent fetches', async () => {
    const { id } = await seedPoll()
    const { id: pid, token } = await seedParticipant(id)
    for (const title of ['A', 'B', 'C', 'D', 'E', 'F']) {
      await seedNomination(id, pid, title)
    }
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()

    const before = await SELF.fetch(`http://example.com/polls/${id}`, {
      headers: { 'Participant-Token': token },
    })
    const beforeBody = await before.json() as { nominations: { id: string }[] }
    const beforeOrder = beforeBody.nominations.map(n => n.id)

    const { id: lateNominationId } = await seedNomination(id, pid, 'Late Addition')

    const after1 = await SELF.fetch(`http://example.com/polls/${id}`, {
      headers: { 'Participant-Token': token },
    })
    const after1Body = await after1.json() as { nominations: { id: string }[] }
    const after2 = await SELF.fetch(`http://example.com/polls/${id}`, {
      headers: { 'Participant-Token': token },
    })
    const after2Body = await after2.json() as { nominations: { id: string }[] }

    // The original 6 nominations keep the exact same relative order as before the addition.
    expect(after1Body.nominations.map(n => n.id).filter(nid => nid !== lateNominationId)).toEqual(beforeOrder)
    // The late addition lands in the same position on every subsequent fetch.
    expect(after2Body.nominations.map(n => n.id)).toEqual(after1Body.nominations.map(n => n.id))
    expect(after1Body.nominations.map(n => n.id)).toContain(lateNominationId)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd worker && npx vitest run test/polls.test.ts -t "nomination order"`
Expected: since nominations currently always come back in plain `created_at ASC` order regardless of participant:
- The 3 "keeps created_at order" tests PASS (current behavior already matches — nothing reorders yet).
- "returns the same participant-specific order across repeated fetches" PASSES too (two `created_at ASC` fetches are trivially identical) — this test is a regression guard for later, not a signal of missing behavior yet.
- "reorders nominations relative to creation order for at least one of several participants during voting" FAILS with `expected false to be true` (nothing reorders anything yet).
- "also reorders nominations for a participant once the poll is closed" FAILS the same way.
- "keeps a nomination added after a participant's first fetch in a stable position" PASSES trivially (unshuffled `created_at ASC` is already stable and always appends new rows last) — again a regression guard, not a failing signal.

- [ ] **Step 3: Write the implementation**

In `worker/src/lib/pollDetail.ts`, add the import at the top of the file (after the existing `import type { Env, Poll } from '../types'` line):

```ts
import { shuffleByParticipant } from './shuffle'
```

Then replace the participant-resolution block (currently):

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
        try {
          const parsed = JSON.parse(participant.draft_ranking)
          draftRanking = Array.isArray(parsed) ? parsed as string[] : null
        } catch {
          draftRanking = null
        }
      }
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
      if (nominations && (poll.phase === 'voting' || poll.phase === 'closed')) {
        nominations = shuffleByParticipant(nominations, participant.id)
      }
      const voteRow = await env.DB.prepare(
        'SELECT id FROM votes WHERE poll_id = ? AND participant_id = ? LIMIT 1'
      ).bind(id, participant.id).first()
      hasVoted = !!voteRow
      if (poll.phase === 'voting' && poll.voting_method !== 'plurality' && !hasVoted && participant.draft_ranking) {
        try {
          const parsed = JSON.parse(participant.draft_ranking)
          draftRanking = Array.isArray(parsed) ? parsed as string[] : null
        } catch {
          draftRanking = null
        }
      }
    }
  }
```

(`nominations` is already declared with `let nominations: PollDetailNomination[] | null = null` earlier in the function, so reassigning it here is valid.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd worker && npx vitest run test/polls.test.ts`
Expected: PASS (all tests in the file, including the 7 new ones and the pre-existing `draft_ranking` ones).

Then run the full worker suite to confirm nothing else broke:

Run: `cd worker && npm test`
Expected: PASS (all test files).

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/pollDetail.ts worker/test/polls.test.ts
git commit -m "feat: randomize nomination order per participant during voting"
```
