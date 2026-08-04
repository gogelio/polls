---
title: Per-participant randomized nomination order during voting
description: Show each voter their own consistent, pseudo-random ordering of nominations during the voting phase, so no single nomination systematically benefits from serial-position bias among lazy voters.
---

## Problem

`buildPollResponse()` (`worker/src/lib/pollDetail.ts`) always returns nominations `ORDER BY n.created_at ASC` — the same order for every participant. `VotingPhase.tsx` renders that order directly: as the button list for plurality polls, and as the fallback ballot order (before a voter drags anything) for ranked-choice/ranked-pairs polls.

Because the order is identical for everyone, any voter who doesn't bother reordering (plurality: picks the first reasonable option; ranked: submits without dragging) systematically favors whichever nomination happens to sit first. Movies nominated early end up over-represented in results independent of their actual merit.

## Goals

- Each participant sees nominations in an order that is random relative to submission time, but **stable** for that participant across repeated fetches (the poll page refetches every 3 seconds) and across nominations added after they joined.
- Applies to all three voting methods (plurality, ranked-choice, ranked-pairs) — position bias affects a single pick as much as a top ranking.
- Applies only during the `voting` (and `closed`) phase — while nominations are still being submitted, they stay in submission order (`nominating` phase) so people can track what's been added and spot duplicates.
- No new schema, no new write path, no "first join" bookkeeping.

## Non-goals

- Randomizing nomination order during the `nominating` phase.
- Changing `ResultsView`'s presentation (it already sorts by rank/score, not raw nomination order).
- Changing the canonical order used by admin-only views (nomination management, "Fix match") — those have no participant identity to shuffle against and should stay chronological for manageability.
- Cryptographic-quality randomness — this only needs to look unpredictable to a human, not resist adversarial analysis.

## Design

### Approach: deterministic hash-based shuffle, no stored state

Sort nominations by `hash(participant.id + nomination.id)` instead of `created_at`, computed at read time in `buildPollResponse()`. `participant.id` is already a unique, unpredictable `nanoid(8)` — it doubles as the per-participant shuffle seed with no new column needed.

This was chosen over two alternatives:
- **Snapshot the order at join time** (new `participants.nomination_order` column, written once at join): requires a migration and a write on every join, plus special-case logic for nominations added *after* a participant joins (append at the end? insert at a random position? both are arbitrary carve-outs).
- **Store an explicit random seed per participant** (new `participants.shuffle_seed` column): gets nothing the hash approach doesn't already have for free, since `participant.id` already serves as an unpredictable per-participant seed.

The hash approach needs zero schema changes, automatically and correctly places nominations added after a participant joined (each just gets its own fixed pseudo-random slot the moment it's hashed), and requires no explicit "is this their first join" tracking — the same deterministic formula naturally produces a stable order every time, for every participant, past or future.

### Hash function

FNV-1a (32-bit), applied to the concatenation `${participant.id}:${nomination.id}`. Fast, dependency-free, good-enough distribution for a UI shuffle. Lives in `worker/src/lib/voting.ts` (or a new small `worker/src/lib/shuffle.ts`) as a pure function:

```ts
function shuffleKey(participantId: string, nominationId: string): number
```

### Where it plugs in

`buildPollResponse()` already receives the requesting participant's token and already looks up the `participants` row (for `draft_ranking`/`has_voted`). Reorder that lookup to happen before the nominations query, and:

- If `poll.phase === 'voting'` or `poll.phase === 'closed'`, **and** a participant was resolved from the token: sort the nominations array by `shuffleKey(participant.id, nomination.id)` ascending.
- Otherwise (nominating phase, no token / admin fetch): keep the current `ORDER BY n.created_at ASC` behavior, unchanged.

The nominations SQL query itself stays `ORDER BY n.created_at ASC` (a stable base to sort from); the shuffle is applied in JS to the fetched array right before it's returned.

### Frontend impact

None. `VotingPhase.tsx`'s plurality list and the ranked ballot's `applyDraftOrder` fallback already just render `poll.nominations` in whatever order the server sends. A participant-specific shuffle from the server flows through automatically. Once a participant actually drags the ranked ballot, their existing `draft_ranking` mechanism takes over as it does today — the shuffle only governs the *starting* order.

### Testing

- Worker unit test: two different `participant.id`s against the same nomination set produce different (or at least not-guaranteed-identical) orderings; the same `participant.id` produces the identical ordering across repeated calls.
- Worker unit test: a nomination inserted after the first `buildPollResponse()` call for a participant still lands in a fixed, stable position on subsequent calls.
- Worker unit test: `nominating`-phase responses remain in `created_at ASC` order regardless of participant token.
- Worker unit test: no-token / admin-scoped responses remain in `created_at ASC` order during voting/closed phases.

### Accepted tradeoffs

- Two participants could coincidentally land on very similar orders — acceptable, this only needs to break the *systematic* bias across the whole voter pool, not guarantee pairwise distinctness.
- A participant who joins, sees an order, then the admin adds more nominations later will see the list grow with new items slotted in at their own fixed pseudo-random position, not appended at the end — this is intentional (matches "no special-casing" goal) and not surprising in practice since nominations are frozen once voting starts.
