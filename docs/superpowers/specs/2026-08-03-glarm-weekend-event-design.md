---
name: glarm-weekend-event
description: A reusable "event" feature bundling multiple preset-nomination ranked-choice polls under one page with a live results-driven bracket, launched this year as /e/glarm26
metadata:
  type: project
---

# Glarm Weekend Movie Event

## Problem

"Glarm Weekend 2026" is a movie-watching weekend with 91 candidate movies split across 8 voting
categories (Action, Big Star, Campy, Comedy, Music/Documentary, Other, So Bad It's Good, Triple B).
Voting determines which movies get watched on which of the three nights (Thursday/Friday/Saturday,
up to 4 movies per night), according to a fixed bracket: each night slot is filled by the 1st- or
2nd-place finisher of a specific category's ranked-choice vote.

The existing polls app supports one poll at a time with an open nomination phase. This event needs:
straight ranked-choice voting across 8 categories with movies preset by the organizer (no open
nomination phase), all on a single page, with a live bracket showing which movie currently occupies
each night slot as votes come in — plus the same simple nickname-based join and admin controls the
rest of the app already has. The organizer expects to reuse this for future years with a new
spreadsheet of movies and schedule.

## Goals

- One URL (`/e/glarm26`) hosting all 8 category votes plus a live bracket.
- Reuse the existing poll/voting/participant infrastructure as much as possible — no parallel voting
  engine.
- Simple nickname join (honor-system reclaim, same as today) that authenticates the participant
  across all 8 categories at once.
- Admin controls scoped to the whole event (close voting, pause, delete) via one admin link.
- A repeatable, code-free way to stand up next year's event from a new spreadsheet.

## Non-goals

- An admin UI for authoring events from scratch (movies/schedule are imported from a spreadsheet via
  a script, not typed into a form).
- Open nomination/add-a-movie flow for this event.
- Password/PIN-protected identity (same honor-system trust model as existing polls).
- Handling more than one bracket "shape" generically — the bracket is a flat list of
  (day, slot, category, placement) tuples; any future event's schedule must be expressible that way.

## Data model

Each of the 8 categories is a real row in the existing `polls` table: `voting_method='ranked_choice'`,
created directly in phase `'voting'` (the `'nominating'` phase is skipped entirely), `votes_visible=1`
so live standings are readable during voting, with its movies pre-inserted as `nominations` rows
(one per movie, `metadata` holds `{ trailer_url }` when the spreadsheet has a YouTube link). Because
these are ordinary polls, `VotingPhase`, `ResultsView`, and the ranked-choice engine
(`lib/voting.ts`) work completely unmodified.

Three new tables (migration `0004_events.sql`) tie the 8 polls together into an event:

```sql
CREATE TABLE events (
  id TEXT PRIMARY KEY,          -- the slug, e.g. 'glarm26' — human-chosen, not a nanoid
  admin_token TEXT NOT NULL,
  title TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE event_polls (
  event_id TEXT NOT NULL REFERENCES events(id),
  poll_id TEXT NOT NULL REFERENCES polls(id),
  category TEXT NOT NULL,       -- display name, e.g. "Action"
  sort_order INTEGER NOT NULL,  -- display order of the 8 sections on the page
  PRIMARY KEY (event_id, poll_id)
);

CREATE TABLE event_slots (
  event_id TEXT NOT NULL REFERENCES events(id),
  day TEXT NOT NULL,            -- 'Thursday' | 'Friday' | 'Saturday'
  slot_order INTEGER NOT NULL,  -- 1..4, display order within the day
  category TEXT NOT NULL,       -- must match an event_polls.category for this event
  placement INTEGER NOT NULL CHECK(placement IN (1, 2)),
  PRIMARY KEY (event_id, day, slot_order)
);
```

`events` deliberately has no `phase` column. An event's phase is derived at read time from its 8
polls: `'closed'` if every linked poll is closed, otherwise `'voting'`. Storing it separately would
create a second source of truth that could drift from the underlying polls (e.g. if a poll is closed
directly rather than through the event endpoint).

## Backend

### `worker/src/lib/pollDetail.ts` (extracted, no behavior change)

The response-building logic currently inline in `pollsRouter.get('/:id')` (auto-advance check,
nominations visibility, has-voted lookup, participant count) is extracted into
`buildPollResponse(db, pollId, participantToken)`, returning the same shape as today. Both
`GET /polls/:id` and the new event route call this function — avoids duplicating poll-shape logic.

### `worker/src/lib/joinOrReclaim.ts` (extracted, no behavior change)

The reclaim-or-create logic in `POST /polls/:id/join` is extracted into
`joinOrReclaim(db, pollId, name)` returning `{ participant_id, token, name, rejoined }`. Both
`POST /polls/:id/join` and the new event join route call this.

### `worker/src/lib/bracket.ts` (new)

`resolveSlot(results: RankedResult[], placement: 1 | 2)`:
- If every result has `score === 0` (no votes cast in that category yet), return
  `{ status: 'awaiting_votes', movies: [] }`.
- Otherwise, group results into descending score tiers. Placement 1 = the top tier. Placement 2 =
  the next distinct tier after the top one (i.e. skip past however many movies tied for 1st place).
  If placement 2 doesn't exist (e.g. all movies tied for 1st), return
  `{ status: 'unresolved', movies: [] }`.
- Return `{ status: 'resolved', movies: [{ nomination_id, title }, ...] }` — an array because ties
  mean more than one movie can occupy a placement.

### `worker/src/routes/events.ts` (new)

- `GET /events/:slug` — public. Loads the event, its 8 linked polls (via `buildPollResponse`, so the
  payload shape for each category matches the existing `Poll` type exactly), and its slots (via
  `resolveSlot`, using each category's live `rankedChoice()` results). Derives event phase as
  described above. 404 if the slug doesn't exist.
- `POST /events/:slug/join` — body `{ name }`. Calls `joinOrReclaim` for each of the event's 8 polls
  in turn. If any individual call throws (e.g. poll not found — shouldn't happen for a well-formed
  event), the whole join fails with a 500 and no tokens are returned, since a partial join would
  leave the participant unable to vote in some categories. Returns
  `{ name, rejoined, participants: [{ poll_id, participant_id, token }, ...] }`.
- `PATCH /events/:slug/phase` (admin, via `?admin=` on the event's `admin_token`) — body
  `{ phase: 'closed' }` is the only accepted value (there's no `'voting'` transition to make since
  events start in voting). Applies `'voting' -> 'closed'` to each linked poll via a single
  `db.batch()`. Polls already closed are left alone (idempotent).
- `PATCH /events/:slug/pause` (admin) — flips `is_paused` on all 8 linked polls to the same new
  value in one `db.batch()`.
- `DELETE /events/:slug` (admin) — cascades: for each linked poll, delete votes → nominations →
  participants → poll (same order as the existing single-poll delete), then delete `event_slots`,
  `event_polls`, and the `events` row — all in one `db.batch()`.

### Import script: `worker/scripts/build-event-seed.ts`

A standalone Node script (run with `tsx`, not deployed with the Worker) with signature:

```
npx tsx scripts/build-event-seed.ts <path-to.xlsx> <slug> <title> > seed-<slug>.sql
```

1. Parses the workbook's "Movie List" sheet (columns: Title, Trailer Link, Description, Category,
   Subcategory, Voting Category). Groups rows by `Voting Category`, normalizing whitespace/case so
   near-duplicate labels (`"Music /Documentary"` vs `"Music / Documentary"`, trailing spaces on
   `"Comedy "`) collapse into one category.
2. Parses the schedule sheet's Day / Movie Category N columns into `(day, slot_order, category,
   placement)` tuples — "1st choice" → placement 1, "2nd choice" → placement 2.
3. Emits SQL: one `polls` row per category (phase `'voting'`, `voting_method='ranked_choice'`,
   `votes_visible=1`, `nominations_visible=1`, `max_nominations` set to that category's movie count
   since it's otherwise unused, `is_public=0`), one `nominations` row per movie (`metadata` JSON with
   `trailer_url` when present), one `events` row (fresh `admin_token`), the `event_polls` rows, and
   the `event_slots` rows.
4. Prints the admin URL (`https://<host>/e/<slug>?admin=<token>`) to stderr as a final line so it's
   visible without grepping the SQL.

The operator applies the output with `wrangler d1 execute polls --remote --file=seed-<slug>.sql`,
the same pattern already used for schema migrations. Re-running the script for next year only
requires a new spreadsheet, slug, and title — no code changes.

## Frontend

### New route: `/e/:slug`

Generic (not glarm-specific) so future years reuse it unchanged. Registered in `App.tsx` alongside
the existing `/p/:id` route.

### `frontend/src/hooks/useEvent.ts` (new, mirrors `usePoll.ts`)

Polls `GET /events/:slug` every 3 seconds using the same `intervalRef` pattern as `usePoll`; stops
automatically once the derived event phase is `'closed'`.

### `frontend/src/pages/EventPage.tsx` (new)

- Name-entry gate at top when no participant tokens are found for this event's polls (mirrors
  `PollPage`'s join flow), calling `api.joinEvent(slug, name)`.
- A progress line, e.g. "5 of 8 voted", derived from `has_voted` across the 8 embedded polls.
- 8 collapsible sections (one per category, in `sort_order`), each rendering the existing
  `VotingPhase` / `ResultsView` components unmodified against that category's embedded poll object —
  drag-to-rank, live standings, and "vote submitted" states all come for free.
- Bracket section at the bottom (see below).
- `EventAdminControls` (new, simpler than the per-poll `AdminControls`) rendered when `?admin=` is
  present: "Close event & reveal results" button, pause/unpause toggle, delete (with the same
  confirm → countdown → redirect flow as the existing delete), and a "copy admin link" action.

### `frontend/src/components/Bracket.tsx` (new)

Three day columns (Thursday/Friday/Saturday), 4 slot cards each, sourced from the event payload's
`schedule` field. Each card shows the category + placement label ("Action — 1st choice") and:
- `resolved`: the movie title(s) — more than one when tied.
- `unresolved`: "Tied — not yet decided" (only possible when 2nd place is requested but everything
  is tied for 1st).
- `awaiting_votes`: "Awaiting votes".

Same 3-second live refresh as the rest of the page (driven by `useEvent`).

### `frontend/src/api/client.ts` additions

- `getEvent(slug)`, `joinEvent(slug, name)` — the latter stores each returned poll token via the
  existing `poll_token_<pollId>` `localStorage` mechanism, so no other API client method needs to
  change; `submitVotes`, `getResults`, etc. work against the embedded polls exactly as they do on
  `/p/:id` today.
- `closeEvent(slug, adminToken)`, `toggleEventPause(slug, adminToken)`, `deleteEvent(slug, adminToken)`.

### Minor: trailer link on nomination cards

`frontend/src/components/NominationCard.tsx` and `VotingPhase.tsx`'s `SortableItem` gain a small
"▶ Trailer" link rendered when `metadata.trailer_url` is present (alongside the existing
external-id/cover-image handling), so voters can preview a movie before ranking it.

## Testing

`worker/test/events.test.ts` (new), following the existing `applySchema()`-per-test pattern:
- `GET /events/:slug` returns the event with all 8 polls and a resolved bracket; 404 for unknown slug.
- Bracket resolution: awaiting-votes state with no votes cast; correct 1st/2nd placement once votes
  exist; tie handling (multiple movies tied for 1st shows all of them; 2nd place unresolved when
  everything is tied for 1st).
- `POST /events/:slug/join` creates a participant with the same name+token behavior in all 8 polls;
  re-joining with the same name reclaims the same 8 tokens (`rejoined: true`).
- `PATCH /events/:slug/phase` closes all 8 polls in one call; is idempotent if some are already closed.
- `PATCH /events/:slug/pause` toggles `is_paused` on all 8 polls together.
- `DELETE /events/:slug` removes all votes/nominations/participants/polls for the event plus the
  event's own rows.

`worker/test/voting.test.ts` gains cases for `resolveSlot()` covering the three statuses above.

## Out of scope

- Editing an event's title/category list/bracket after import (delete and re-import instead).
- Any UI for creating events without the import script.
- Supporting bracket placements beyond 1st/2nd.
