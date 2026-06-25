# Datetime Picker for Nomination Expiration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the minutes-based timer input on the poll creation form with a `datetime-local` picker, and update the countdown display to show human-readable durations for multi-day spans.

**Architecture:** Two frontend files change; no worker or API changes. The browser converts the local datetime string to a UTC epoch (ms) before submitting — the worker is already timezone-agnostic and stores/compares raw epoch values.

**Tech Stack:** React 18, TypeScript, Tailwind CSS 3, Vite

## Global Constraints

- No new dependencies — use only native browser APIs and existing packages
- No worker changes — `nomination_closes_at` stays a Unix timestamp in milliseconds
- Follow existing Tailwind class patterns in each file

---

### Task 1: Update Timer display format

**Files:**
- Modify: `frontend/src/components/Timer.tsx`

**Interfaces:**
- Consumes: `closesAt: number` (Unix ms) — unchanged
- Produces: same `Timer` component, same prop interface

- [ ] **Step 1: Replace the display logic in Timer.tsx**

Open `frontend/src/components/Timer.tsx` and replace the entire file with:

```tsx
import { useState, useEffect } from 'react'

interface TimerProps { closesAt: number }

function formatRemaining(ms: number): string {
  if (ms <= 0) return '0:00'
  const totalSecs = Math.floor(ms / 1000)
  const days = Math.floor(totalSecs / 86400)
  const hours = Math.floor((totalSecs % 86400) / 3600)
  const mins = Math.floor((totalSecs % 3600) / 60)
  const secs = totalSecs % 60

  if (ms >= 3600000) {
    // 1 hour or more: show Xd Xh or Xh Xm
    if (days > 0) return `${days}d ${hours}h`
    return `${hours}h ${mins}m`
  }
  if (ms >= 60000) {
    // 1 min to 1 hr: show Xm Xs
    return `${mins}m ${secs}s`
  }
  // Under 1 min: MM:SS
  return `${mins}:${String(secs).padStart(2, '0')}`
}

export function Timer({ closesAt }: TimerProps) {
  const [remaining, setRemaining] = useState(Math.max(0, closesAt - Date.now()))

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(Math.max(0, closesAt - Date.now()))
    }, 1000)
    return () => clearInterval(interval)
  }, [closesAt])

  const urgent = remaining < 60000

  return (
    <span className={`text-xs font-mono font-semibold tabular-nums px-2.5 py-1 rounded-full ${
      urgent ? 'text-danger bg-[oklch(62%_0.22_25_/_0.15)]' : 'text-warn bg-[oklch(72%_0.17_65_/_0.12)]'
    }`}>
      ⏱ {formatRemaining(remaining)}
    </span>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Timer.tsx
git commit -m "feat: update Timer to show human-readable countdown for multi-day spans"
```

---

### Task 2: Replace timer minutes input with datetime-local picker

**Files:**
- Modify: `frontend/src/pages/CreatePoll.tsx`

**Interfaces:**
- Consumes: nothing new
- Produces: `nomination_closes_at` sent to API as `number | null` (epoch ms) — unchanged

- [ ] **Step 1: Update state declaration**

In `frontend/src/pages/CreatePoll.tsx`, find line 49:
```ts
const [timerMinutes, setTimerMinutes] = useState<number | ''>('')
```
Replace with:
```ts
const [closesAt, setClosesAt] = useState('')
```

- [ ] **Step 2: Update the submit handler**

Find line 73:
```ts
nomination_closes_at: timerMinutes ? Date.now() + Number(timerMinutes) * 60 * 1000 : null,
```
Replace with:
```ts
nomination_closes_at: closesAt ? new Date(closesAt).getTime() : null,
```

- [ ] **Step 3: Replace the timer input in the JSX**

Find this block (lines ~166–179):
```tsx
<div>
  <label className="block text-xs font-semibold text-ink-2 uppercase tracking-widest mb-2">
    Timer (min)
  </label>
  <input
    type="number"
    min={1}
    className="input"
    value={timerMinutes}
    onChange={e => setTimerMinutes(e.target.value === '' ? '' : Number(e.target.value))}
    placeholder="None"
  />
</div>
```
Replace with:
```tsx
<div>
  <label className="block text-xs font-semibold text-ink-2 uppercase tracking-widest mb-2">
    Nominations close
  </label>
  <input
    type="datetime-local"
    className="input"
    value={closesAt}
    min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
    onChange={e => setClosesAt(e.target.value)}
  />
</div>
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 5: Verify in browser**

```bash
cd frontend && npm run dev
```

Open http://localhost:5173 and:
1. Confirm "Nominations close" label appears where "Timer (min)" was
2. Click the input — browser's native datetime picker should open
3. Confirm you cannot select a date/time in the past (min attribute enforces this)
4. Create a poll with an expiration a few days out — confirm it creates successfully
5. Open the poll page — confirm the `Timer` component shows e.g. `2d 4h` rather than a raw `MM:SS`
6. Confirm creating a poll with no expiration date still works (field left blank → `nomination_closes_at: null`)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/CreatePoll.tsx
git commit -m "feat: replace timer minutes input with datetime-local picker for nomination expiration"
```
