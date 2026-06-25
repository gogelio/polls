# Design: Date/Time Picker for Nomination Expiration

**Date:** 2026-06-25

## Overview

Replace the "Timer (min)" number input on the poll creation form with a `datetime-local` picker that lets the admin set an absolute expiration date and time. Update the `Timer` countdown component to display human-readable durations appropriate for multi-day spans.

## Scope

Two files change; no worker or API changes required.

- `frontend/src/pages/CreatePoll.tsx`
- `frontend/src/components/Timer.tsx`

## CreatePoll.tsx Changes

**State:** Replace `timerMinutes: number | ''` with `closesAt: string` (the raw value from the `datetime-local` input, e.g. `"2026-07-01T14:30"`). Default: `''` (no expiration).

**Timestamp conversion on submit:**
```ts
nomination_closes_at: closesAt ? new Date(closesAt).getTime() : null
```
`new Date("2026-07-01T14:30")` is interpreted in the user's local timezone by JavaScript, producing the correct UTC epoch. No timezone handling needed on the worker.

**Input element:** Replace the `type="number"` timer input with:
```tsx
<input
  type="datetime-local"
  className="input"
  value={closesAt}
  min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
  onChange={e => setClosesAt(e.target.value)}
/>
```
The `min` attribute is set to the current local datetime so the user cannot select a past time. Label changes from "Timer (min)" to "Nominations close".

## Timer.tsx Changes

Format remaining milliseconds into a human-readable string based on magnitude:

| Remaining | Display format | Example |
|-----------|---------------|---------|
| ≥ 1 hour  | `Xd Xh` or `Xh Xm` | `2d 4h`, `3h 22m` |
| 1 min – 1 hr | `Xm Xs` | `45m 30s` |
| < 1 min   | `MM:SS` (existing urgent red styling) | `0:42` |

Polling interval stays at 1 second. The urgent red styling only applies at < 1 minute.

## No Worker Changes

The worker stores and compares `nomination_closes_at` as a Unix timestamp in milliseconds. The conversion from local datetime string to epoch happens entirely in the browser. The worker is timezone-agnostic by design.
