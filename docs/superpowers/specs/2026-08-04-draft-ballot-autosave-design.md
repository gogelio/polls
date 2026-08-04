---
title: Draft ballot autosave for ranked voting
description: Persist in-progress ranked-choice/ranked-pairs ballots server-side so a voter who abandons mid-session (and may switch devices) can resume where they left off, without affecting live results.
---

## Problem

Voting on a ranked ballot (e.g. the 91-movie glarm26 categories) requires dragging every item into an order before hitting submit. If a voter closes their browser mid-drag, that ordering is currently held only in React component state and is lost — they start over from scratch on return. Voters may also start on one device (phone) and finish on another (laptop), and expect their progress to follow them, the same way already-submitted votes and nominations do (via name-based participant reclaim).

## Goals

- A voter's in-progress ranking survives a closed tab/browser and is resumable from any device, as long as they rejoin with the same name (reusing the existing `joinOrReclaim` identity mechanism).
- Draft state never influences live results — only a submitted vote counts. A voter cannot game the live leaderboard by reordering their draft.
- Minimal new surface area: reuse the existing participant identity and poll-detail/vote endpoints where possible.

## Non-goals

- Plurality ballots (single click, nothing to lose) — out of scope.
- Conflict resolution between two devices editing the same draft concurrently — last write wins is acceptable.
- Retry/queueing infrastructure for failed autosave writes — a subsequent reorder naturally retries.

## Design

### Data model

Add a column to the existing `participants` table (migration `0005_draft_ranking.sql`):

```sql
ALTER TABLE participants ADD COLUMN draft_ranking TEXT;
```

`draft_ranking` is a JSON-encoded array of nomination IDs representing the voter's current in-progress order, or `NULL` if there's no draft. A participant row already belongs to exactly one poll (`participants.poll_id`), so no separate table or join is needed — the draft is naturally 1:1 with the participant.

Crucially, `draft_ranking` lives outside the `votes` table entirely. `GET /polls/:id/results` reads only from `votes`, which is written exclusively by the final submit endpoint. This is the mechanism that guarantees a reshuffled draft never affects live results — it's structural, not a runtime check.

### API

**`PATCH /polls/:id/vote-draft`** (new; `participantAuth`, mirrors `POST /polls/:id/votes`)
- Body: `{ ranking: string[] }` — nomination IDs in order.
- 400 if `poll.phase !== 'voting'` or `poll.voting_method === 'plurality'`.
- 400 if any ID in `ranking` doesn't belong to the poll's nominations.
- On success: `UPDATE participants SET draft_ranking = ? WHERE id = ?`.

**`GET /polls/:id`** (`buildPollResponse`, existing)
- New field `draft_ranking: string[] | null` on the response, populated only for the authenticated participant, only when `phase === 'voting'`, `voting_method !== 'plurality'`, and `has_voted === false`. Otherwise `null`.

**`POST /polls/:id/votes`** (existing, final submit)
- The existing D1 `batch()` that deletes+inserts vote rows also sets `draft_ranking = NULL` for that participant, in the same atomic batch. A submitted vote always leaves no stale draft behind.

### Frontend behavior

- `VotingPhase` seeds its `ranked` state from `poll.draft_ranking` when present (map IDs → nomination objects, in draft order; any nomination absent from the draft — not expected once voting has started and the nomination list is frozen — is appended at the end, mirroring the existing defensive metadata-sync effect).
- After each `handleDragEnd`, for ranked voting methods only, a debounced (~1.2s) call fires `api.saveVoteDraft(pollId, ranking)`. The timer resets on every reorder so a burst of dragging produces one save, not dozens.
- A small status indicator near the ballot shows `Saving… / Draft saved / Couldn't save draft` so voters can see their progress is actually persisted — important for trust on a long ballot.
- The debounce timer is cancelled on unmount and the instant `submitted` flips true (whether from this device's own submit or from `poll.has_voted` becoming true via the 3-second poll — e.g. submitted from another device) — a stale save must never fire after the ballot is locked.
- A failed save shows the quiet error state; no retry loop — the next reorder attempts again naturally.

### Accepted tradeoffs

- Two devices editing the same draft concurrently: last write wins, no merge.
- No draft expiry/cleanup job — abandoned drafts sit in the `participants` row indefinitely, same lifecycle as the participant itself. Negligible storage cost at this scale.

## Testing

**Worker** (`worker/test/votes.test.ts` or a new `vote-draft.test.ts`):
- `PATCH /polls/:id/vote-draft` requires participant auth.
- Rejected when `phase !== 'voting'`.
- Rejected when `voting_method === 'plurality'`.
- Rejected when the ranking includes a nomination ID not in the poll.
- Saved draft round-trips through `GET /polls/:id` as `draft_ranking` for that participant only (not visible to other participants).
- `draft_ranking` is cleared to `null` after `POST /polls/:id/votes` succeeds.
- **Invariant test:** saving/changing a draft ranking does not change `GET /polls/:id/results` output — only a submitted vote does.

**Frontend** (`VotingPhase` test):
- A poll loaded with `draft_ranking` set renders the ballot in that order rather than default nomination order.
