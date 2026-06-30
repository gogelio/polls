---
name: borda-ranked-choice
description: Replace IRV (instant runoff) with Borda count for ranked_choice voting method; update voting method descriptions
metadata:
  type: project
---

# Borda Count for Ranked Choice

## Problem

The current `ranked_choice` voting method uses Instant Runoff Voting (IRV). IRV has two user-facing problems:
1. With small voter counts, elimination order is determined by arbitrary tiebreaking, making results feel unfair.
2. Eliminated candidates show 0% even when they received meaningful rankings, making the results display misleading and hard to interpret.

Borda count is a better fit for small, casual, friend-group polls: every ranking on every ballot contributes to every candidate's score, results are directly comparable, and no candidate is unfairly zeroed out.

## Solution

Replace the `rankedChoice` function implementation with Borda count. The function signature, return type, and API contract are unchanged — only the algorithm changes. Update description strings in the two frontend files that label voting methods to reflect the new algorithm and add voter-count guidance for both ranked methods.

## Algorithm

With N candidates:
- 1st place = N points
- 2nd place = N-1 points
- ...
- Last place = 1 point
- Unranked candidate = 0 points

`score` = sum of points across all ballots for that candidate.

`percentage` = `Math.round(score / maxPossible * 100)` where `maxPossible = N × voterCount`.

`voterCount` = number of distinct `participant_id` values in the votes array.

Results sorted by `score` descending.

## Example (poll 3GQccA1k, 2 voters, 5 candidates)

| Candidate | Voter 1 | Voter 2 | Points | % |
|---|---|---|---|---|
| Hyperion | 1st (5pts) | 4th (2pts) | 7 | 70% |
| Doomsday Book | 3rd (3pts) | 3rd (3pts) | 6 | 60% |
| The Lies of Locke Lamora | 4th (2pts) | 2nd (4pts) | 6 | 60% |
| Red Rising | 5th (1pt) | 1st (5pts) | 6 | 60% |
| There Is No Antimemetics Division | 2nd (4pts) | 5th (1pt) | 5 | 50% |

maxPossible = 5 × 2 = 10.

## Files Changed

### `worker/src/lib/voting.ts`

Replace the body of `rankedChoice`. Signature unchanged:
```ts
export function rankedChoice(votes: VoteRow[], nominations: NominationRow[]): RankedResult[]
```

### `worker/test/voting.test.ts`

Replace the `rankedChoice` describe block. New test cases:
1. Correct point assignment and sort order (basic 3-candidate, 2-voter case)
2. Correct percentage calculation (score / maxPossible × 100, rounded)
3. Partial ballots: unranked candidates receive 0 points
4. Single candidate: 100%
5. Tie: tied candidates appear in nominations order

### `frontend/src/pages/CreatePoll.tsx`

Description string changes only (labels unchanged):
- `ranked_choice`: `'Drag to rank, instant runoff'` → `'Borda method, <20 voters'`
- `ranked_pairs`: unchanged (`'Tideman method, most fair'`)

### `frontend/src/components/AdminControls.tsx`

Description string changes in two places:
- Method option array: `ranked_choice` description `'Instant runoff'` → `'Borda method, <20 voters'`; `ranked_pairs` description unchanged (`'Tideman'`)
- `VOTING_METHOD_LABELS` display names ("Ranked Choice", "Ranked Pairs", "Plurality") are unchanged

## Out of Scope

- No changes to `plurality` or `rankedPairs` algorithms
- No changes to `ResultsView` — it already renders `score` and `percentage` from the API
- No API or DB schema changes
- No renaming of the `ranked_choice` method key
