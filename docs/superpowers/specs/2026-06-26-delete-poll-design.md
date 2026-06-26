# Delete Poll Feature — Design Spec

**Date:** 2026-06-26

## Overview

Allow poll creators (admins) to permanently delete a poll, with a two-step confirmation in the admin panel and a 10-second countdown redirect after deletion.

---

## Backend

### `DELETE /polls/:id`

- Protected by `adminAuth` middleware (reads `?admin=` query param, constant-time comparison)
- Checks poll exists; returns 404 if not found
- Deletes child rows manually (no `ON DELETE CASCADE` in schema) in order:
  1. `votes` WHERE `poll_id = ?`
  2. `nominations` WHERE `poll_id = ?`
  3. `participants` WHERE `poll_id = ?`
  4. `polls` WHERE `id = ?`
- Returns `{ ok: true }` with HTTP 200 on success

---

## Frontend

### `api/client.ts`

New method:
```ts
deletePoll: async (pollId: string, adminToken: string) => { ... }
```
Sends `DELETE /polls/:pollId?admin=<adminToken>`. Throws on non-OK response.

### `AdminControls.tsx`

**New prop:** `onDeleted: () => void` — called after the countdown expires, triggers navigation.

**Mode type extended:** `'default' | 'editing' | 'confirming' | 'deleting' | 'deleted'`

**Default mode:** Add "Delete poll" link below "Edit poll" — small, muted text, `hover:text-danger` color. Clicking sets mode to `'deleting'`.

**`'deleting'` mode:**
- Header: "Delete this poll?"
- Warning text: "This cannot be undone. All nominations and votes will be permanently deleted."
- Two buttons: "Cancel" (returns to `'default'`) and "Delete" (`bg-danger`, calls `api.deletePoll`, on success sets mode to `'deleted'`)
- Error state shown inline if the API call fails

**`'deleted'` mode:**
- Shows "Poll deleted." message
- Shows "Redirecting in Xs…" countdown (starts at 10, decrements every second via `setInterval`)
- `useEffect` starts the interval on mount, clears on cleanup, calls `onDeleted()` when countdown hits 0

### `PollPage.tsx`

- Pass `onDeleted={() => navigate('/')}` to `<AdminControls />`
- Uses React Router's `useNavigate`

---

## Error Handling

- If `deletePoll` throws, display the error message inline in the `'deleting'` mode panel and remain in that mode (user can retry or cancel)
- No loading spinner needed for the delete confirmation step beyond disabling the button while the request is in flight

---

## Out of Scope

- Soft-delete / archive (hard delete only)
- Confirmation email or audit log
- Undo functionality
