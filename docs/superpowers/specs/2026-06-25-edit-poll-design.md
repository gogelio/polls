# Edit Poll Design Spec
**Date:** 2026-06-25

## Problem

Admins have no way to change poll settings after creation. The only post-creation action available is advancing the phase. Fields like the poll title, voting method, nomination deadline, and visibility toggles are locked in once the poll is created.

## Goal

Add an "Edit Poll" flow to the existing admin panel (bottom-right fixed card) that lets the admin edit poll settings with a confirmation step before saving.

## Scope

- Frontend: `AdminControls.tsx` (expand in-place), `api/client.ts` (new method)
- Backend: new `PATCH /polls/:id` worker endpoint
- Reuses `DateTimePicker` and `Toggle` components

---

## Frontend Design

### AdminControls — Three Modes

`AdminControls` gains a `mode` state with three values: `'default'` | `'editing'` | `'confirming'`.

| Mode | Panel width | Content |
|------|-------------|---------|
| `default` | `w-52` | Phase transition button(s) + "Edit Poll" button |
| `editing` | `w-72` | Edit form + Cancel / Save buttons |
| `confirming` | `w-72` | Changed fields diff + Go back / Confirm buttons |

Width transitions via Tailwind `transition-all`. No new component files — all state lives inside `AdminControls`.

### "Edit Poll" Entry Point

A text-style button at the bottom of the default view:

```
⚡ Admin
[Start voting →]
[Edit poll]        ← new, subtle text button
```

Clicking it seeds draft state from current `poll` props and switches to `editing` mode.

### Edit Form Fields (in order)

1. **Poll name** — text input (`.input`), always editable
2. **Voting method** — 3-button selector (same as `CreatePoll`); disabled with `opacity-40 pointer-events-none` when `phase !== 'nominating'`
3. **Nominations close** — `DateTimePicker` component; `value` is `new Date(poll.nomination_closes_at)` or `null`
4. **Show nominations live** — `Toggle`
5. **Show live vote counts** — `Toggle`
6. **List publicly on home page** — `Toggle`

Form is seeded when entering `editing`. No auto-save.

Footer buttons: "Cancel" (→ `default`, discard draft) and "Save" (→ `confirming` if anything changed; no-op if nothing changed).

### Confirmation View

Shows only changed fields — each as one line:

```
Title
  My New Poll Name

Voting method
  Plurality

Nominations close
  Jul 4, 2026 at 11:45 PM
```

Omits unchanged fields entirely.

Footer buttons: "Go back" (→ `editing`) and "Confirm" (submits, → `default`).

### Draft State

```ts
// seeded from poll when entering editing mode
draftTitle: string
draftVotingMethod: VotingMethod
draftClosesAt: Date | null
draftNominationsVisible: boolean
draftVotesVisible: boolean
draftIsPublic: boolean
```

On confirm, only changed fields are sent to the API. Change detection compares draft against the current `poll` prop values.

### Error Handling

If the API call fails, stay in `confirming` mode and show the error message above the action buttons. The admin can retry or go back to edit.

---

## API Design

### New Worker Endpoint: `PATCH /polls/:id`

Admin-authed (reads `?admin=` query param). Accepts a partial body:

```ts
{
  title?: string
  voting_method?: string
  nomination_closes_at?: number | null   // Unix ms, or null to clear
  nominations_visible?: boolean
  votes_visible?: boolean
  is_public?: boolean
}
```

**Validation:**
- `voting_method` can only change when `phase = 'nominating'`; returns 400 otherwise
- `title` must be non-empty if provided

**Implementation:** Builds a dynamic `UPDATE` using only the provided keys, runs it, returns the updated poll row (same shape as `GET /polls/:id`).

### New Frontend API Method

```ts
api.updatePoll(pollId: string, adminToken: string, changes: {
  title?: string
  voting_method?: string
  nomination_closes_at?: number | null
  nominations_visible?: boolean
  votes_visible?: boolean
  is_public?: boolean
}): Promise<void>
```

Calls `PATCH /polls/:id?admin=<token>` with the changes body.

---

## Out of Scope

- Editing the poll category (category affects nomination metadata; changing it mid-poll would be destructive)
- Editing `max_nominations` (changing it after nominations exist could exceed the new limit)
- Undo / history
