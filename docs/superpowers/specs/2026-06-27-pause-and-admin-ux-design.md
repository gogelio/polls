# Design: Poll Pause & Admin Panel UX Cleanup

**Date:** 2026-06-27

## Overview

Two related changes to the admin panel:

1. Move "Delete poll" out of the default admin view and into the edit panel
2. Add a pause/unpause feature that immediately locks participant submissions without changing the poll phase

---

## Backend

### Migration

Add `is_paused INTEGER NOT NULL DEFAULT 0` to the `polls` table.

```sql
ALTER TABLE polls ADD COLUMN is_paused INTEGER NOT NULL DEFAULT 0;
```

### `GET /polls/:id`

Include `is_paused: boolean` in the response (coerce from integer, same pattern as `nominations_visible`).

### `PATCH /polls/:id/pause` (admin auth)

Toggles `is_paused` on the poll. No request body. Returns `{ is_paused: boolean }`.

```
PATCH /polls/:id/pause?admin=<token>
→ 200 { is_paused: true }   (or false)
→ 404 if poll not found
→ 401 if bad admin token
```

### Enforcement in existing routes

- `POST /polls/:id/nominations`: check `is_paused`; return `403 { error: 'Poll is paused' }` if true
- `POST /polls/:id/votes`: check `is_paused`; return `403 { error: 'Poll is paused' }` if true

### `api/client.ts`

Add `togglePause(pollId: string, adminToken: string): Promise<{ is_paused: boolean }>`.

---

## Frontend types

`Poll` interface: add `is_paused: boolean`.

---

## Admin panel (`AdminControls`)

### Default mode

Remove the "Delete poll" button. Default mode now shows only:
- Phase transition button (Start voting / Close & show results / closed label)
- "Edit poll" button

### Edit mode

Add above the Save/Cancel buttons, visually separated with a top border:

- **Pause/Unpause button**: calls `togglePause` immediately on click, then `onRefetch()`. No Save → Confirm loop. Label: "⏸ Pause poll" when active, "▶ Unpause poll" when paused. Disabled while the request is in flight.
- **Delete poll button**: below Save/Cancel at the bottom. Clicking sets `mode = 'deleting'` as today.

The existing Save → Confirm flow for other edit fields is unchanged.

### Mode state machine

No new modes added. `'deleting'` and `'deleted'` remain. The delete entry point moves from default mode to edit mode.

---

## Participant UI

### `NominationPhase`

When `poll.is_paused` is true, render a paused card instead of the nomination form:

```
⏸  This poll is paused
The admin has temporarily paused submissions.
```

### `VotingPhase`

Same treatment — replace the voting form with the same paused card when `poll.is_paused` is true.

The 3-second polling in `usePoll` picks up the resumed state automatically when the admin unpauses.

---

## What does not change

- Phase transitions (Start voting, Close & show results) are unaffected by pause state
- The Save → Confirm flow for poll edits is unchanged
- The deletion confirmation and countdown flow is unchanged
- `usePoll` polling interval and stop-on-close logic are unchanged
