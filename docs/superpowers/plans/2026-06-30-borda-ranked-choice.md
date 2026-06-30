# Borda Count for Ranked Choice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ranked_choice voting algorithm (currently IRV/instant-runoff) with Borda count, and update the two description strings that label it in the frontend.

**Architecture:** The `rankedChoice` function in `worker/src/lib/voting.ts` is replaced wholesale — same signature, new algorithm. Two frontend files each have one description string changed. No API, DB, or display component changes are needed.

**Tech Stack:** Cloudflare Workers (Vitest pool), TypeScript, React 18

## Global Constraints

- `rankedChoice` function signature must remain: `(votes: VoteRow[], nominations: NominationRow[]) => RankedResult[]`
- Worker tests run with `cd worker && npm test`; each describe block uses shared `noms` fixture — maintain this pattern
- Borda points: N candidates → 1st = N pts, 2nd = N-1 pts, …, last = 1 pt, unranked = 0 pts
- `percentage` = `Math.round(score / (N * voterCount) * 100)` where `voterCount` = distinct participant_id count in votes
- Sort results by `score` descending; ties preserve nominations array order

---

### Task 1: Replace rankedChoice with Borda count + update tests

**Files:**
- Modify: `worker/src/lib/voting.ts`
- Modify: `worker/test/voting.test.ts`

**Interfaces:**
- Produces: `rankedChoice(votes, nominations)` returns `RankedResult[]` sorted by Borda score descending. `RankedResult` shape unchanged: `{ nomination_id, title, metadata, nominated_by?, score, percentage }`.

- [ ] **Step 1: Write failing tests**

Replace the entire `describe('rankedChoice', ...)` block in `worker/test/voting.test.ts` with:

```typescript
describe('rankedChoice', () => {
  it('assigns Borda points and sorts by score descending', () => {
    // 3 candidates (N=3): 1st=3pts, 2nd=2pts, 3rd=1pt
    // p1: a>b>c → a gets 3, b gets 2, c gets 1
    // p2: b>a>c → b gets 3, a gets 2, c gets 1
    // Totals: a=5, b=5, c=2
    // Tie between a and b — a comes first in nominations array
    const votes: VoteRow[] = [
      { participant_id: 'p1', nomination_id: 'a', rank: 1 },
      { participant_id: 'p1', nomination_id: 'b', rank: 2 },
      { participant_id: 'p1', nomination_id: 'c', rank: 3 },
      { participant_id: 'p2', nomination_id: 'b', rank: 1 },
      { participant_id: 'p2', nomination_id: 'a', rank: 2 },
      { participant_id: 'p2', nomination_id: 'c', rank: 3 },
    ]
    const results = rankedChoice(votes, noms)
    expect(results[0]!.nomination_id).toBe('a')
    expect(results[0]!.score).toBe(5)
    expect(results[1]!.nomination_id).toBe('b')
    expect(results[1]!.score).toBe(5)
    expect(results[2]!.nomination_id).toBe('c')
    expect(results[2]!.score).toBe(2)
  })

  it('calculates percentage as score / (N * voterCount) * 100 rounded', () => {
    // N=3, voterCount=2, maxPossible=6
    // p1: a>b>c → a=3, b=2, c=1
    // p2: a>b>c → a=3, b=2, c=1
    // Totals: a=6 (100%), b=4 (67%), c=2 (33%)
    const votes: VoteRow[] = [
      { participant_id: 'p1', nomination_id: 'a', rank: 1 },
      { participant_id: 'p1', nomination_id: 'b', rank: 2 },
      { participant_id: 'p1', nomination_id: 'c', rank: 3 },
      { participant_id: 'p2', nomination_id: 'a', rank: 1 },
      { participant_id: 'p2', nomination_id: 'b', rank: 2 },
      { participant_id: 'p2', nomination_id: 'c', rank: 3 },
    ]
    const results = rankedChoice(votes, noms)
    expect(results[0]!.percentage).toBe(100)
    expect(results[1]!.percentage).toBe(67)
    expect(results[2]!.percentage).toBe(33)
  })

  it('gives 0 points to unranked candidates', () => {
    // p1 only ranks a (rank 1) — b and c are unranked → 0 pts each
    // N=3, voterCount=1, maxPossible=3
    // a = 3pts (100%), b = 0pts (0%), c = 0pts (0%)
    const votes: VoteRow[] = [
      { participant_id: 'p1', nomination_id: 'a', rank: 1 },
    ]
    const results = rankedChoice(votes, noms)
    expect(results[0]!.nomination_id).toBe('a')
    expect(results[0]!.score).toBe(3)
    expect(results[0]!.percentage).toBe(100)
    expect(results[1]!.score).toBe(0)
    expect(results[1]!.percentage).toBe(0)
    expect(results[2]!.score).toBe(0)
    expect(results[2]!.percentage).toBe(0)
  })

  it('returns 100% for single candidate', () => {
    const singleNom: NominationRow[] = [{ id: 'a', title: 'A', metadata: null }]
    const votes: VoteRow[] = [
      { participant_id: 'p1', nomination_id: 'a', rank: 1 },
    ]
    const results = rankedChoice(votes, singleNom)
    expect(results[0]!.nomination_id).toBe('a')
    expect(results[0]!.percentage).toBe(100)
  })

  it('returns zero scores when no votes', () => {
    const results = rankedChoice([], noms)
    expect(results.every(r => r.score === 0)).toBe(true)
    expect(results.every(r => r.percentage === 0)).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd worker && npx vitest run test/voting.test.ts
```

Expected: the 5 new `rankedChoice` tests fail (IRV algorithm produces different results).

- [ ] **Step 3: Replace rankedChoice implementation**

In `worker/src/lib/voting.ts`, delete the existing `rankedChoice` function body (lines 51–122). Do NOT remove `buildBallots` (lines 37–49) — it is still used by `rankedPairs`. Replace `rankedChoice` with:

```typescript
export function rankedChoice(votes: VoteRow[], nominations: NominationRow[]): RankedResult[] {
  const N = nominations.length
  if (N === 0) return []

  const voterIds = new Set(votes.map(v => v.participant_id))
  const voterCount = voterIds.size
  const maxPossible = N * voterCount

  const scores = new Map<string, number>()
  for (const nom of nominations) scores.set(nom.id, 0)

  for (const vote of votes) {
    if (vote.rank === null) continue
    const points = N - vote.rank + 1
    if (points > 0) scores.set(vote.nomination_id, (scores.get(vote.nomination_id) ?? 0) + points)
  }

  return [...nominations]
    .map(nom => ({
      nomination_id: nom.id,
      title: nom.title,
      metadata: nom.metadata,
      nominated_by: nom.nominated_by,
      score: scores.get(nom.id) ?? 0,
      percentage: maxPossible > 0
        ? Math.round(((scores.get(nom.id) ?? 0) / maxPossible) * 100)
        : 0,
    }))
    .sort((a, b) => b.score - a.score)
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd worker && npx vitest run test/voting.test.ts
```

Expected: all tests pass (plurality, rankedChoice ×5, rankedPairs).

- [ ] **Step 5: Run full test suite to confirm no regressions**

```bash
cd worker && npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add worker/src/lib/voting.ts worker/test/voting.test.ts
git commit -m "feat: replace IRV with Borda count for ranked_choice method"
```

---

### Task 2: Update voting method description strings in frontend

**Files:**
- Modify: `frontend/src/pages/CreatePoll.tsx`
- Modify: `frontend/src/components/AdminControls.tsx`

**Interfaces:**
- Consumes: nothing from Task 1 (independent change)
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Update CreatePoll.tsx**

In `frontend/src/pages/CreatePoll.tsx`, find the `VOTING_METHODS` array (around line 15) and change the `ranked_choice` description:

```typescript
// Before:
{ value: 'ranked_choice', label: 'Ranked Choice', description: 'Drag to rank, instant runoff' },

// After:
{ value: 'ranked_choice', label: 'Ranked Choice', description: 'Borda method, <20 voters' },
```

Leave `ranked_pairs` and `plurality` entries unchanged.

- [ ] **Step 2: Update AdminControls.tsx**

In `frontend/src/components/AdminControls.tsx`, find the voting method options array (around line 25) and change the `ranked_choice` description:

```typescript
// Before:
{ value: 'ranked_choice', label: 'Ranked Choice', description: 'Instant runoff' },

// After:
{ value: 'ranked_choice', label: 'Ranked Choice', description: 'Borda method, <20 voters' },
```

Leave `ranked_pairs` (`'Tideman'`) and `plurality` entries unchanged.

- [ ] **Step 3: Verify frontend builds**

```bash
cd frontend && npm run build
```

Expected: exits 0 with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/CreatePoll.tsx frontend/src/components/AdminControls.tsx
git commit -m "feat: update ranked_choice description to Borda method, <20 voters"
```
