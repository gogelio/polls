# Event header voter stats

## Problem

The event page header (`EventPage.tsx`) currently shows only "{votedCount} of {N} categories voted" for the current viewer. There's no way to see event-wide participation at a glance, and no confirmation of which name a returning voter is identified as.

## Design

Extend the header line to three pipe-separated sections:

```
{votedCount} of {N} categories voted | {voter_count} Vote Submission{s} | Voting as {name}
```

All three sections remain gated behind the existing `!needsJoin` check (unchanged).

### 1. Vote Submissions (backend)

Each event participant is stored per-poll: joining an event creates a separate `participants` row (same name, distinct token) in every linked poll via `joinOrReclaim`. There's no existing concept of a single event-wide "voter."

`GET /events/:slug` already loops over the event's linked polls to build ranked-choice results, fetching each poll's `votes` rows. Extend that loop to also collect the **distinct participant names** that have a vote in that poll, accumulated into one `Set<string>` across all polls in the event. Return the set's size as a new top-level field:

```ts
voter_count: number
```

This is a headcount only — it reveals nothing about who voted for what — so it's always included regardless of each poll's `votes_visible` setting, consistent with how `participant_count` is already always shown on `Poll`.

Frontend: add `voter_count: number` to `EventPayload` (`types.ts`). Render `"{voter_count} Vote Submission{s}"`, pluralized (`"1 Vote Submission"` vs `"0 Vote Submissions"` / `"2 Vote Submissions"`).

### 2. Voting as {name} (frontend only)

The participant's name is currently only known transiently, in React state (`joinedName`), set inside `handleJoin` after a successful join/rejoin. On a fresh page load with existing tokens (returning voter, `needsJoin` false, `justJoined` false), `joinedName` is never set, so there'd be nothing to show.

Persist the name the same way tokens are already persisted:

- On successful `joinEvent` (both fresh join and rejoin), store `localStorage.setItem(`event_name_${slug}`, data.name)` alongside the existing per-poll token storage (which `joinOrReclaim`/`api.joinEvent` already handles for tokens).
- On page load, resolve the display name as `joinedName ?? localStorage.getItem(`event_name_${slug}`)`.
- Render "Voting as {name}" only when a name is resolved (i.e., effectively only when `!needsJoin`, same as the rest of the line).

No backend changes needed for this part.

## Testing

- Backend: extend `worker/test/events.test.ts` with a case where distinct participants vote across overlapping and non-overlapping categories in the same event; assert `voter_count` reflects unique names, not total vote rows (e.g., one person voting in 3 categories still counts once).
- Frontend: extend `EventPage.test.tsx` to cover:
  - Header renders all three sections with correct pluralization at `voter_count` = 0, 1, and 2+.
  - "Voting as {name}" appears on reload (simulated by pre-seeding `localStorage` with `event_name_${slug}` and poll tokens, without going through `handleJoin`).

## Out of scope

- No change to per-category "✓ Voted" badges.
- No change to `votes_visible` gating anywhere else.
- Not clearing `event_name_${slug}` on any kind of "leave event" flow — no such flow exists today.
