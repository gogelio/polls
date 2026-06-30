---
name: name-based-reclaim
description: Allow users to reclaim their poll session on a new device by entering their name
metadata:
  type: project
---

# Name-Based Session Reclaim

## Problem

Participant tokens are stored in `localStorage`, keyed as `poll_token_<pollId>`. Switching browsers or devices loses the token, leaving the user unable to vote after nominating on another device.

## Solution

When a user joins without a valid token and supplies a name that already exists in the poll, return that participant's existing token instead of a 409 error. The frontend stores the reclaimed token in `localStorage`, restoring the session. A "Welcome back, [name]!" banner confirms the reclaim.

This is an honor-system approach — no password or PIN required. Appropriate for trusted, small-group polls.

## Backend

**File:** `worker/src/routes/participants.ts` — `POST /:id/join`

### Updated logic

1. If `Participant-Token` header present and valid → return existing participant (unchanged, status 200).
2. If no token (or token not found for this poll):
   - Look up participant by `LOWER(name) = LOWER(?)` within the poll.
   - If found → return that participant's `{ participant_id, token, name, rejoined: true }` with status 200.
   - If not found → create new participant, return `{ participant_id, token, name, rejoined: false }` with status 201 (unchanged).

The empty-name auto-rejoin path (`joinPoll(id, '')` called on page load when a token exists) hits case 1 and is unaffected.

### Response shape (addition)

```ts
{
  participant_id: string
  token: string
  name: string
  rejoined: boolean   // NEW
}
```

## Frontend

### `frontend/src/api/client.ts`

`joinPoll` return type gains `rejoined: boolean`. No other change.

### `frontend/src/pages/PollPage.tsx`

- Add `welcomeBack` boolean state (default `false`).
- In `handleJoin`: if response has `rejoined: true`, set `welcomeBack(true)`.
- Add a `useEffect` that clears `welcomeBack` after 4 seconds when it becomes true.
- Render a dismissible banner above the phase content when `welcomeBack` is true:
  > "Welcome back, [joinedName]!"
- The auto-rejoin path on page load (`useEffect` with `hasToken`) does not set `welcomeBack`.

## Tests

**File:** `worker/test/participants.test.ts`

Add one test case in the existing `POST /polls/:id/join` describe block:

- Seed a poll and a participant ("Alice").
- POST `/join` with no token and `{ name: 'Alice' }`.
- Assert status 200, `body.token === original token`, `body.rejoined === true`.

Update the existing "creates a participant" test to assert `rejoined: false` on the new-participant response.

## Out of scope

- PIN or passphrase protection (future work if trust becomes a concern).
- Cross-device token sync or QR code sharing.
- Rate limiting on the join endpoint.
