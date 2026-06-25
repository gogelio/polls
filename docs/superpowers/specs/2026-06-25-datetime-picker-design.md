# DateTimePicker Design Spec
**Date:** 2026-06-25

## Problem

The "Nominations close" field in `CreatePoll` uses `<input type="datetime-local">`, which has two issues:
1. Browser rendering varies — on some browsers only the date portion is easily accessible, and the time silently defaults to `00:00` (midnight at the start of the day, not the end).
2. No explicit time UI means users don't realize they're setting a midnight deadline.

## Goal

Replace the native datetime input with a custom popover-based `DateTimePicker` component that gives users explicit, clear control over both date and time.

## Component Interface

`frontend/src/components/DateTimePicker.tsx` — self-contained, no external dependencies.

```ts
interface DateTimePickerProps {
  value: Date | null
  onChange: (date: Date | null) => void
}
```

`CreatePoll` converts its `closesAt` state from `string` to `Date | null`, passes it to the picker, and converts back for the API:

```ts
nomination_closes_at: closesAt ? closesAt.getTime() : null
```

## Trigger Button

- Styled with the `.input` class to match the existing form
- Left: calendar icon + formatted value ("Jun 30, 2026 at 11:59 PM") or muted placeholder ("No deadline")
- Right: `×` clear button when a value is set; nothing otherwise
- Sits in the same 2-column grid cell as the current `datetime-local` input

## Popover

Opens directly below the trigger, matching its width. Dark-themed using design system tokens (`--surface`, `--raised`, `--accent`, etc.). Rendered in a portal on `document.body` to avoid clipping by overflow-hidden ancestors. Dismissed by clicking outside (discards draft) or pressing Escape.

### Calendar (top section)
- Month/year header with `‹` / `›` navigation arrows
- Day-of-week row: Su Mo Tu We Th Fr Sa
- Day grid: past days disabled and dimmed; today gets a subtle outline ring; selected day filled with `--accent`
- Clicking a day selects it without closing the popover

### Time Picker (middle section)
- 12-hour format: hour stepper + minute stepper + AM/PM toggle
- Minute increments of 15 (00, 15, 30, 45)
- Steppers use `∧` / `∨` arrow buttons; values wrap (12 → 1, PM → AM)

### Action Row (bottom)
- "Clear" link-style button on the left — only visible when a value is already committed; calls `onChange(null)` and closes
- "Confirm" accent button on the right — commits draft, calls `onChange(date)`, closes

## Internal State

The popover maintains internal draft state (`draftDate`, `draftHour`, `draftMinute`, `draftAmPm`) while open. Confirming writes draft → parent. Clicking outside discards draft and reverts to the last committed value.

When opened with an existing value, draft is seeded from that value. When opened with `null`, draft defaults to today's date at 11:59 PM.

## Timezone

All times use the user's local browser timezone. No timezone display or conversion.

## Keyboard / Accessibility

- Trigger is a `<button>` (keyboard-focusable)
- Popover dismisses on `Escape`
- Click-outside via `mousedown` listener on `document`

## Out of Scope

- Timezone selection
- Arbitrary minute increments (only 0/15/30/45)
- Reuse outside of `CreatePoll`
