# Luckiest / unluckiest voters

## Problem

Once voting closes (or an admin is previewing during voting), there's no fun/social summary of whose picks did well or poorly. Add a "🍀 Luckiest Picks" / "💔 Unluckiest Picks" stats section: the 3 voters whose top choice landed highest in the final standings, and the 3 whose top choice landed lowest. Applies both to standalone polls and to each category poll inside an event, plus a combined event-wide version.

## Luck metric

A voter's "pick" is their top-ranked nomination: the single vote in a plurality poll, or the `rank = 1` entry in a ranked-choice/ranked-pairs ballot. Their luck is where that nomination landed in the final results.

- **Per-poll**: placement is a 1-indexed position in the poll's own `results` array (1 = winner). Luckiest = 3 lowest placements, unluckiest = 3 highest. Ties break by array/insertion order — no special tie-breaking, consistent with how `tied` is already handled elsewhere (simple equality check, no fine-grained ranking).
- **Event-level**: categories differ in nomination count and voting method, so raw placement isn't comparable across categories. Normalize each poll's placement to a score: `(total - placement) / (total - 1)` (1.0 = won, 0.0 = last place; a single-nomination poll scores everyone 1.0). Average a participant's scores across every category they voted in, joined by lowercase name — the same dedup key `events.ts` already uses for `voter_count`. Luckiest/unluckiest = top/bottom 3 by average score.

No minimum-voter threshold: in a small poll, the luckiest and unluckiest lists may overlap or be identical. That's expected and left as-is.

## Backend

### `worker/src/lib/voting.ts`

New pure function, alongside `plurality`/`rankedChoice`/`rankedPairs`:

```ts
export interface VoterLuck {
  participant_id: string
  participant_name: string
  nomination_id: string
  title: string
  placement: number   // 1-indexed position in `results`
  total: number        // results.length
  score: number         // normalized 0..1, 1 = matched the winner
}

export function computeVoterLuck(
  votes: VoteRow[],
  results: RankedResult[],
  participantNames: Map<string, string>
): VoterLuck[]
```

Builds each participant's top pick (the row where `rank === null || rank === 1` — this correctly covers both plurality's single unranked row and a ranked ballot's first choice with one pass), looks up its placement in `results`, and returns one entry per voter who has a resolvable top pick, sorted ascending by placement (luckiest first).

### `GET /polls/:id/results` (`worker/src/routes/votes.ts`)

- Fetch participant names in one query: `SELECT id, name FROM participants WHERE poll_id = ?` (matches the existing single-query-per-list pattern used for nominations/votes; no N+1).
- Compute `computeVoterLuck(votes, results, nameMap)`.
- Gate inclusion: `poll.phase === 'closed' || (poll.phase === 'voting' && await isValidAdminToken(c.env, pollId, c.req.query('admin')))`.
- When authorized, add to the response:
  ```ts
  voter_stats: { luckiest: VoterLuck[], unluckiest: VoterLuck[] }  // each sliced to at most 3
  ```
  `unluckiest` is the same array sliced from the end and reversed (worst first). Omit the field entirely when not authorized.

### `GET /events/:slug` (`worker/src/routes/events.ts`)

This route already batch-fetches `nominationsByPoll`/`votesByPoll` for all category polls in two queries. Reuse that data — add one more batched query for participant names across all `pollIds`: `SELECT id, poll_id, name FROM participants WHERE poll_id IN (...)`.

For each category poll, compute its results using the poll's *actual* `voting_method` (available on `pollResponses[i]`) — **not** the hardcoded `rankedChoice(...)` already used for `resultsByCategory` (that one stays exactly as-is; it only feeds bracket slot resolution and always wants a full ranking regardless of method). Run `computeVoterLuck` per category, then merge across categories by lowercase participant name into a running `{ displayName, scores: number[] }` map, respecting the same `visibleCategories` gate already computed in that route (so a category hidden by `votes_visible` doesn't leak into the aggregate either).

After the category loop, average each person's `scores`, sort, and — gated by `event.phase === 'closed' || isEventAdmin` (both already computed in this handler) — add to the response:

```ts
voter_stats: {
  luckiest: Array<{ name: string; average_score: number; categories_counted: number }>
  unluckiest: Array<{ name: string; average_score: number; categories_counted: number }>
}
```

Each list capped at 3, same as the per-poll version. Omit when not authorized.

## Frontend

### Types (`frontend/src/types.ts`)

Add `VoterLuck` (mirrors the worker interface) and extend `PollResults` with `voter_stats?: { luckiest: VoterLuck[]; unluckiest: VoterLuck[] }`. Extend the event payload type with the analogous `voter_stats` shape (name/average_score/categories_counted).

### `ResultsView.tsx`

New card at the bottom (after "Full standings", before the copy-link row), rendered only when `results.voter_stats` is present (backend already gates authorization, so presence alone is a safe frontend check — mirrors how `NominationMatchEditor` is gated purely by `adminToken` truthiness elsewhere in this file). Two columns/stacked lists:

```
🍀 Luckiest Picks          💔 Unluckiest Picks
1. Alice → The Matrix (#1)  1. Dave → Cats (#8)
2. Bob → Interstellar (#2)  2. Eve → Cats (#8)
3. Carol → Interstellar (#2) 3. Frank → Norbit (#7)
```

Because this is the same `ResultsView` component used by the standalone poll page, event category sections, and `AdminLiveResultsToggle`, no changes are needed in those call sites — the new card just shows up wherever the backend includes `voter_stats`.

### `EventPage.tsx`

New small component `EventVoterStats.tsx`, same two-list layout as above but using `name`/`average_score` instead of a single nomination. Rendered below the category list (`event.categories.map(...)`), gated on `event.voter_stats` being present, same pattern as `Bracket`.

## Error handling

No new error paths. Both routes already fetch poll/event + phase + admin validity before this point; `voter_stats` computation only runs after those existing checks pass, using data already being fetched (or one small additional query). Zero voters simply produces empty `luckiest`/`unluckiest` arrays, and the frontend cards render nothing visible for an empty array (acceptable — matches how e.g. the standings list already just renders per `results.results`, which could theoretically be empty too).

## Testing

- `worker/test/*` (wherever `voting.ts` is unit-tested): `computeVoterLuck` cases — plurality single-vote, ranked ballot (confirm only rank=1 is used, later ranks ignored), a tie in placement, a voter with no resolvable top pick (nomination removed) is skipped.
- `worker/test/votes.test.ts`: `voter_stats` absent during voting phase without admin token, present with a valid admin token during voting, present for everyone once closed.
- `worker/test/events.test.ts`: event-level aggregation across two categories with a participant who voted in both (name-matched, case-insensitive) vs. only one; gating by event admin/closed phase.
- `frontend/src/components/ResultsView.test.tsx`: card renders when `voter_stats` present, absent when not.
- New `frontend/src/components/EventVoterStats.test.tsx` or extend `EventPage.test.tsx`: renders/hides based on `event.voter_stats`.

## Out of scope

- No UI for adjusting the "top 3" count or the luck formula.
- No historical/trend tracking across multiple events for the same person.
- Bracket slot resolution (`resultsByCategory` in `events.ts`) is untouched.
