# DateTimePicker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the native `<input type="datetime-local">` in the poll creation form with a custom popover-based DateTimePicker that gives users explicit, clear control over both date and time.

**Architecture:** One new component (`DateTimePicker.tsx`) rendered via a React portal; `CreatePoll.tsx` updated to use it. No backend changes — `nomination_closes_at` remains a Unix epoch in milliseconds.

**Tech Stack:** React 18, TypeScript, Tailwind CSS 3, `createPortal` from `react-dom`

## Global Constraints

- No new npm dependencies — use only `react`, `react-dom`, and native browser APIs
- No worker changes — `nomination_closes_at` stays a Unix timestamp in milliseconds
- Design system tokens: `--surface`, `--raised`, `--hover`, `--accent`, `--accent-hover`, `--accent-muted`, `--ink`, `--ink-2`, `--ink-3`, `--line`, `--line-bright`
- Tailwind utility classes only — no inline style except for `position: fixed` popover placement
- 12-hour time format, 15-minute increments only (0, 15, 30, 45)
- All times in the user's local browser timezone — no timezone display or conversion

---

### Task 1: Create `DateTimePicker` component

**Files:**
- Create: `frontend/src/components/DateTimePicker.tsx`

**Interfaces:**
- Consumes: nothing from other tasks
- Produces: `export function DateTimePicker({ value, onChange }: { value: Date | null; onChange: (date: Date | null) => void })`

- [ ] **Step 1: Create the file with the full implementation**

Create `frontend/src/components/DateTimePicker.tsx` with this exact content:

```tsx
import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

interface DateTimePickerProps {
  value: Date | null
  onChange: (date: Date | null) => void
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAYS = ['Su','Mo','Tu','We','Th','Fr','Sa']
const MINUTES = [0, 15, 30, 45]

function formatDateTime(d: Date): string {
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' at ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  )
}

function Stepper({ value, onUp, onDown }: { value: string; onUp: () => void; onDown: () => void }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <button type="button" onClick={onUp} className="text-ink-2 hover:text-ink transition-colors text-xs leading-none py-0.5">▲</button>
      <span className="text-sm font-semibold text-ink w-7 text-center tabular-nums">{value}</span>
      <button type="button" onClick={onDown} className="text-ink-2 hover:text-ink transition-colors text-xs leading-none py-0.5">▼</button>
    </div>
  )
}

export function DateTimePicker({ value, onChange }: DateTimePickerProps) {
  const [open, setOpen] = useState(false)
  const [popPos, setPopPos] = useState({ top: 0, left: 0, width: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Calendar view navigation (which month is displayed)
  const [viewYear, setViewYear] = useState(new Date().getFullYear())
  const [viewMonth, setViewMonth] = useState(new Date().getMonth())

  // Draft selection (uncommitted until Confirm)
  const [draftYear, setDraftYear] = useState(new Date().getFullYear())
  const [draftMonth, setDraftMonth] = useState(new Date().getMonth())
  const [draftDay, setDraftDay] = useState(new Date().getDate())
  const [draftHour, setDraftHour] = useState(11)      // 1–12
  const [draftMinute, setDraftMinute] = useState(45)  // 0 | 15 | 30 | 45
  const [draftAmPm, setDraftAmPm] = useState<'AM' | 'PM'>('PM')

  const seedDraft = useCallback((d: Date | null) => {
    const ref = d ?? new Date()
    setViewYear(ref.getFullYear())
    setViewMonth(ref.getMonth())
    setDraftYear(ref.getFullYear())
    setDraftMonth(ref.getMonth())
    setDraftDay(ref.getDate())
    if (d) {
      const h = d.getHours()
      setDraftAmPm(h >= 12 ? 'PM' : 'AM')
      setDraftHour(h % 12 || 12)
      const m = Math.round(d.getMinutes() / 15) * 15
      setDraftMinute(m >= 60 ? 45 : m)
    } else {
      // Default to 11:45 PM when no value is set
      setDraftHour(11)
      setDraftMinute(45)
      setDraftAmPm('PM')
    }
  }, [])

  const openPicker = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPopPos({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    }
    seedDraft(value)
    setOpen(true)
  }

  const confirm = () => {
    const h24 =
      draftAmPm === 'PM'
        ? draftHour === 12 ? 12 : draftHour + 12
        : draftHour === 12 ? 0 : draftHour
    onChange(new Date(draftYear, draftMonth, draftDay, h24, draftMinute, 0, 0))
    setOpen(false)
  }

  const clear = () => {
    onChange(null)
    setOpen(false)
  }

  // Dismiss on click outside
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Dismiss on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  // Calendar helpers
  const today = new Date()
  const todayY = today.getFullYear()
  const todayM = today.getMonth()
  const todayD = today.getDate()

  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array<null>(firstDayOfWeek).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  const isPast = (day: number) =>
    new Date(viewYear, viewMonth, day) < new Date(todayY, todayM, todayD)
  const isSelected = (day: number) =>
    viewYear === draftYear && viewMonth === draftMonth && day === draftDay
  const isToday = (day: number) =>
    viewYear === todayY && viewMonth === todayM && day === todayD

  const stepHour = (dir: 1 | -1) =>
    setDraftHour(h => { const n = h + dir; return n > 12 ? 1 : n < 1 ? 12 : n })
  const stepMinute = (dir: 1 | -1) =>
    setDraftMinute(m => {
      const idx = MINUTES.indexOf(m)
      const n = idx + dir
      return n >= MINUTES.length ? MINUTES[0] : n < 0 ? MINUTES[MINUTES.length - 1] : MINUTES[n]
    })

  const popover = (
    <div
      ref={popoverRef}
      style={{
        position: 'fixed',
        top: popPos.top,
        left: popPos.left,
        width: Math.max(popPos.width, 260),
        zIndex: 9999,
      }}
      className="bg-[var(--surface)] border border-line rounded-2xl shadow-2xl p-4 space-y-4"
    >
      {/* Calendar */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            onClick={prevMonth}
            className="text-ink-2 hover:text-ink w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--hover)] transition-colors"
          >
            ‹
          </button>
          <span className="text-sm font-semibold text-ink">{MONTHS[viewMonth]} {viewYear}</span>
          <button
            type="button"
            onClick={nextMonth}
            className="text-ink-2 hover:text-ink w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--hover)] transition-colors"
          >
            ›
          </button>
        </div>
        <div className="grid grid-cols-7 mb-1">
          {DAYS.map(d => (
            <span key={d} className="text-xs font-semibold text-ink-3 text-center py-1">{d}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-1">
          {cells.map((day, i) => {
            if (day === null) return <span key={i} />
            const past = isPast(day)
            const sel = isSelected(day)
            const tod = isToday(day)
            return (
              <button
                key={i}
                type="button"
                disabled={past}
                onClick={() => { setDraftYear(viewYear); setDraftMonth(viewMonth); setDraftDay(day) }}
                className={[
                  'w-8 h-8 mx-auto rounded-full text-sm transition-colors flex items-center justify-center',
                  past ? 'text-ink-3 opacity-30 cursor-not-allowed' : 'cursor-pointer',
                  sel ? 'bg-accent text-white' : '',
                  tod && !sel ? 'ring-1 ring-accent text-accent' : '',
                  !past && !sel ? 'hover:bg-[var(--hover)] text-ink' : '',
                ].filter(Boolean).join(' ')}
              >
                {day}
              </button>
            )
          })}
        </div>
      </div>

      <div className="border-t border-line" />

      {/* Time picker */}
      <div className="flex items-center justify-center gap-3">
        <Stepper
          value={String(draftHour).padStart(2, '0')}
          onUp={() => stepHour(1)}
          onDown={() => stepHour(-1)}
        />
        <span className="text-ink-2 font-bold text-lg">:</span>
        <Stepper
          value={String(draftMinute).padStart(2, '0')}
          onUp={() => stepMinute(1)}
          onDown={() => stepMinute(-1)}
        />
        <button
          type="button"
          onClick={() => setDraftAmPm(ap => ap === 'AM' ? 'PM' : 'AM')}
          className="text-sm font-semibold text-ink-2 hover:text-ink px-3 py-1.5 rounded-lg border border-line hover:border-line-bright transition-colors"
        >
          {draftAmPm}
        </button>
      </div>

      <div className="border-t border-line" />

      {/* Actions */}
      <div className="flex items-center justify-between">
        {value ? (
          <button
            type="button"
            onClick={clear}
            className="text-sm text-ink-3 hover:text-ink transition-colors"
          >
            Clear
          </button>
        ) : <span />}
        <button
          type="button"
          onClick={confirm}
          className="bg-accent hover:bg-accent-hover text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
        >
          Confirm
        </button>
      </div>
    </div>
  )

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openPicker}
        className="input flex items-center justify-between text-left w-full"
      >
        <span className={`flex items-center gap-2 min-w-0 ${value ? 'text-ink' : 'text-ink-3'}`}>
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
          </svg>
          <span className="text-sm truncate">{value ? formatDateTime(value) : 'No deadline'}</span>
        </span>
        {value && (
          <span
            role="button"
            onClick={e => { e.stopPropagation(); clear() }}
            className="text-ink-3 hover:text-ink transition-colors ml-1 flex-shrink-0 text-base leading-none"
          >
            ×
          </span>
        )}
      </button>
      {open && createPortal(popover, document.body)}
    </>
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
git add frontend/src/components/DateTimePicker.tsx
git commit -m "feat: add custom DateTimePicker popover component"
```

---

### Task 2: Wire `DateTimePicker` into `CreatePoll`

**Files:**
- Modify: `frontend/src/pages/CreatePoll.tsx`

**Interfaces:**
- Consumes: `DateTimePicker` from `'../components/DateTimePicker'` — props `value: Date | null`, `onChange: (date: Date | null) => void`
- Produces: `nomination_closes_at: number | null` sent to API (unchanged shape)

- [ ] **Step 1: Update the import and state in `CreatePoll.tsx`**

At the top of `frontend/src/pages/CreatePoll.tsx`, add the import after the existing imports:

```ts
import { DateTimePicker } from '../components/DateTimePicker'
```

Then change the `closesAt` state declaration (line 49):

```ts
// Before:
const [closesAt, setClosesAt] = useState('')

// After:
const [closesAt, setClosesAt] = useState<Date | null>(null)
```

- [ ] **Step 2: Update the API call in the submit handler**

In `handleSubmit`, change the `nomination_closes_at` line (line 73):

```ts
// Before:
nomination_closes_at: closesAt ? new Date(closesAt).getTime() : null,

// After:
nomination_closes_at: closesAt ? closesAt.getTime() : null,
```

- [ ] **Step 3: Replace the native input with `DateTimePicker`**

Find this block in the JSX (lines 166–177):

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

Replace with:

```tsx
<div>
  <label className="block text-xs font-semibold text-ink-2 uppercase tracking-widest mb-2">
    Nominations close
  </label>
  <DateTimePicker value={closesAt} onChange={setClosesAt} />
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

Open http://localhost:5173 and verify:

1. The "Nominations close" field shows a button with a calendar icon and "No deadline" placeholder
2. Clicking the button opens a popover with a calendar grid and time picker
3. The current month is shown; past days are dimmed and unclickable
4. Today's date has an accent-colored ring
5. Clicking a day highlights it with the accent fill color
6. `‹` / `›` navigate between months
7. Hour and minute steppers increment/decrement correctly and wrap around
8. AM/PM toggle switches between AM and PM
9. Clicking "Confirm" closes the popover and displays the formatted date/time in the trigger button (e.g., "Jun 30, 2026 at 11:45 PM")
10. Clicking `×` in the trigger clears the value and reverts to "No deadline"
11. Clicking outside the popover or pressing Escape dismisses without committing
12. Creating a poll with a deadline and without a deadline both succeed
13. A poll created with a deadline shows the `Timer` countdown on the poll page

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/CreatePoll.tsx
git commit -m "feat: replace native datetime input with custom DateTimePicker in CreatePoll"
```
