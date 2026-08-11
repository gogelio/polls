# Event admin voter roster

## Problem

An event admin has no way to see who has joined an event and how many of the event's category polls each person has actually voted in. `voter_count` on `GET /events/:slug` is only a headcount; there's no per-person breakdown, and it's not admin-gated (it's a public field). Add an admin-only view listing every joined participant's name and their submission count (0 to the event's category count).

## Design

### Backend: `GET /events/:slug/voters`

New route in `worker/src/routes/events.ts`, gated by the existing `eventAdminAuth` middleware (same pattern as `/pause`, `/votes-visible`, `DELETE /:slug`).

"Voter" = anyone who has joined the event. Joining (`POST /events/:slug/join` → `joinOrReclaim`) creates a `participants` row in *every* linked category poll immediately, regardless of whether they've voted yet — so the participant rows across an event's polls are exactly the set of "current voters," including people with zero submissions. Matched case-insensitively by name, the same dedup key `voter_count` already uses.

"Submission count" = number of distinct category polls in which that person has at least one `votes` row.

```ts
eventsRouter.get('/:slug/voters', eventAdminAuth, async (c) => {
  const slug = c.req.param('slug')
  const { results: links } = await c.env.DB.prepare(
    'SELECT poll_id FROM event_polls WHERE event_id = ?'
  ).bind(slug).all<{ poll_id: string }>()
  if (links.length === 0) return c.json({ error: 'Event not found' }, 404)

  const pollIds = links.map(l => l.poll_id)
  const placeholders = pollIds.map(() => '?').join(',')

  const [{ results: participants }, { results: votes }] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, poll_id, name FROM participants WHERE poll_id IN (${placeholders})`
    ).bind(...pollIds).all<{ id: string; poll_id: string; name: string }>(),
    c.env.DB.prepare(
      `SELECT DISTINCT poll_id, participant_id FROM votes WHERE poll_id IN (${placeholders})`
    ).bind(...pollIds).all<{ poll_id: string; participant_id: string }>(),
  ])

  const votedPollsByParticipant = new Map<string, Set<string>>()
  for (const v of votes) {
    if (!votedPollsByParticipant.has(v.participant_id)) votedPollsByParticipant.set(v.participant_id, new Set())
    votedPollsByParticipant.get(v.participant_id)!.add(v.poll_id)
  }

  const byName = new Map<string, { displayName: string; votedPolls: Set<string> }>()
  for (const p of participants) {
    const key = p.name.toLowerCase()
    if (!byName.has(key)) byName.set(key, { displayName: p.name, votedPolls: new Set() })
    const votedPolls = votedPollsByParticipant.get(p.id)
    if (votedPolls) for (const pollId of votedPolls) byName.get(key)!.votedPolls.add(pollId)
  }

  const voters = [...byName.values()]
    .map(({ displayName, votedPolls }) => ({ name: displayName, submitted_count: votedPolls.size }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

  return c.json({ voters, total_categories: pollIds.length })
})
```

Two batched queries total (no N+1, consistent with the rest of this file). `DISTINCT` on the votes query collapses ranked-ballot polls' multiple vote rows per participant down to one per poll.

### Frontend

`frontend/src/types.ts`: add
```ts
export interface EventVoter {
  name: string
  submitted_count: number
}
```

`frontend/src/api/client.ts`: add
```ts
getEventVoters: async (slug: string, adminToken: string): Promise<{ voters: EventVoter[]; total_categories: number }> => {
  const res = await throwIfError(await fetch(`${BASE}/events/${slug}/voters?admin=${adminToken}`))
  return res.json()
},
```

`frontend/src/components/EventAdminControls.tsx`: extend the existing `Mode` union with `'voters'`, add it to the `isWide` check (alongside `'deleting' | 'deleted'`), and add:
- A "👥 View voters" button in the `default` mode block, alongside the existing pause/live-results/delete buttons.
- A handler that sets `mode = 'voters'`, sets a loading flag, calls `api.getEventVoters`, and stores the result.
- A new `mode === 'voters'` render block: header `Voters ({voters.length})`, a `max-h-64 overflow-y-auto` scrollable list of rows (`{name}` — `{submitted_count}/{total_categories}`), and a "← Back" button that resets to `default` (and clears the fetched list, so reopening always re-fetches fresh — no caching, no polling; the admin can just reopen the panel to refresh).

## Testing

- `worker/test/events.test.ts`, new `describe('GET /events/:slug/voters', ...)`:
  - 401 without an admin token, 401 with an invalid one (mirrors the existing `/pause` tests).
  - 404 for an unknown slug.
  - Correctness: seed an event with 2 category polls and 3 participants — one who voted in both polls, one who voted in only one, one who joined but never voted — assert `submitted_count` is 2, 1, 0 respectively and `total_categories` is 2.
  - Case-insensitive merge: the same person joins two category polls under differently-cased names (e.g. `'Alice'` / `'alice'`) and votes in one of them; assert they appear once with `submitted_count: 1`, not as two separate rows.
  - Sort order: seed names out of alphabetical order, assert the response list comes back sorted.
- `frontend/src/components/EventAdminControls.test.tsx` (new file — this component currently has no tests; scope is limited to this feature, not a full backfill):
  - Clicking "👥 View voters" calls `api.getEventVoters` and renders the returned names and `submitted_count/total_categories` pairs.
  - "← Back" returns to the default panel view.

## Out of scope

- No live/polling refresh of the voter list while the panel is open.
- No per-poll-only voter roster (this is bundled at the event level only, matching how `voter_count` already works).
- No CSV export or any other roster action beyond viewing.
