# Design: No Floating Text — All Content on Card Backgrounds

**Date:** 2026-06-25

## Overview

Remove all instances of text rendering directly against the busy page background. Every piece of content must sit on a card or element with a solid background. Three components need changes.

## Principle

No `<p>` or text element should render at the top level of the page background without a card container. Loading states, error messages, and list headers all need a solid surface behind them.

## Scope

Three files change; no API or worker changes.

- `frontend/src/components/NominationPhase.tsx`
- `frontend/src/components/VotingPhase.tsx`
- `frontend/src/components/ResultsView.tsx`

## NominationPhase.tsx

**Grouped nominations card:** Replace the bare `<div className="space-y-2">` nominations list wrapper with a single `<div className="card p-5 space-y-3">` container. Inside:

1. The "X nominations" header `<p>` sits at the top of the card (remove the `px-1` padding — it's no longer needed against a card background).
2. Nominations render as sub-cards with `space-y-2`. Each `NominationCard` already uses `bg-raised border border-line rounded-xl` — `bg-raised` sits one visual level above the card's `bg-surface`, so they read as distinct items within the container.
3. The empty state ("No nominations yet — be the first!") moves inside the same card, centered.

**Hidden state:** The bare `<p className="text-ink-3 text-sm text-center py-8">Nominations are hidden until voting begins.</p>` gets wrapped in `<div className="card p-8 text-center">`.

## VotingPhase.tsx

**Error message:** The bare `{error && <p className="text-danger text-sm px-1">{error}</p>}` becomes:
```tsx
{error && <div className="card px-4 py-3"><p className="text-danger text-sm">{error}</p></div>}
```

## ResultsView.tsx

**Error state** (line 34): Wrap in a card:
```tsx
if (error) return <div className="card p-5 text-center"><p className="text-ink-3 text-sm">{error}</p></div>
```

**Loading state** (line 35): Wrap in a card:
```tsx
if (!results) return <div className="card p-5 text-center"><p className="text-ink-3 text-sm animate-pulse">Loading results…</p></div>
```
