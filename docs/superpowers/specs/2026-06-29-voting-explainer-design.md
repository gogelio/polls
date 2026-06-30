---
name: voting-explainer
description: Interactive /learn page explaining the three voting methods (Plurality, Borda, Ranked Pairs) with a step-through curated scenario
metadata:
  type: project
---

# Voting Methods Explainer Page

## Goal

An interactive `/learn` page that teaches users how each voting method works, using a step-through curated example. Linked from the home page voting method selector and accessible directly at `/learn`.

## Curated Scenario

**Setup:** 3 voters picking a movie night film from 4 candidates.

| Voter | 1st | 2nd | 3rd | 4th |
|---|---|---|---|---|
| Alice | Dune | Oppenheimer | Barbie | Alien |
| Bob | Dune | Oppenheimer | Barbie | Alien |
| Carol | Oppenheimer | Barbie | Alien | Dune |

This scenario is carefully chosen so Plurality and Ranked Pairs elect Dune (majority prefers it), while Borda elects Oppenheimer (consensus — less resistance from Carol). The same three ballots, three different stories.

### Pre-computed results

**Plurality:**
- Dune: 2 first-place votes
- Oppenheimer: 1
- Barbie: 0
- Alien: 0
- Winner: **Dune**

**Borda** (N=4: 1st=4pts, 2nd=3pts, 3rd=2pts, 4th=1pt; maxPossible=12):
- Dune: 4+4+1=9 (75%)
- Oppenheimer: 3+3+4=10 (83%)
- Barbie: 2+2+3=7 (58%)
- Alien: 1+1+2=4 (33%)
- Winner: **Oppenheimer**

**Ranked Pairs** (pairwise head-to-head):
- Dune beats Oppenheimer 2-1
- Dune beats Barbie 2-1
- Dune beats Alien 2-1
- Oppenheimer beats Barbie 3-0
- Oppenheimer beats Alien 3-0
- Barbie beats Alien 3-0
- Lock order by margin: Opp>Barbie, Opp>Alien, Barbie>Alien (all 3-0), then Dune>Opp, Dune>Barbie, Dune>Alien (all 2-1)
- Winner: **Dune** (Condorcet winner — beats everyone head-to-head)

## Route & Navigation

- New route `/learn` → `LearnPage.tsx`
- Added to `App.tsx` alongside existing routes
- `CreatePoll.tsx`: small "How does this work? →" link near the voting method selector, opens `/learn` in a new tab (so users don't lose their form state)
- `LearnPage.tsx`: back arrow / "← Create a poll" link at the top

## Page Layout

```
[ ← Create a poll ]

  How voting methods work

  [ Scenario badge: 3 voters · 4 films ]

  ┌──────────────────────────────────────┐
  │  Plurality                           │
  │  Most first-place votes wins         │
  │  [ ballot table ]                    │
  │  ─────────────────────────────────── │
  │  [ step display area ]               │
  │  [ ← Prev ]  Step 1 of 3  [ Next → ]│
  └──────────────────────────────────────┘

  ┌──────────────────────────────────────┐
  │  Ranked Choice (Borda)               │
  │  ...                                 │
  └──────────────────────────────────────┘

  ┌──────────────────────────────────────┐
  │  Ranked Pairs (Tideman)              │
  │  ...                                 │
  └──────────────────────────────────────┘

  ┌──────────────────────────────────────┐
  │  Which should you pick?              │
  │  [ comparison table ]                │
  └──────────────────────────────────────┘
```

## Method Cards

Each card is a `.card` with padding. Visual style matches the existing glassmorphism design (`bg-[var(--raised-glass)] backdrop-blur-md border border-line rounded-2xl`).

**Card header:**
- Method name (large, `text-ink font-semibold text-lg`)
- Tagline (small, `text-ink-2 text-sm`)
- Badge on the right showing who wins this example (hidden until final step, then animates in with a green highlight)

**Ballot table:**
- Compact table showing the three voters' preferences
- Always visible at the top of each card
- Desktop: full table. Mobile: scrollable horizontally.

**Step display area:**
- Region with `min-h-[10rem]` that swaps content between steps (min-height prevents layout shift; actual height grows to content)
- Content is static JSX objects keyed by step index (no runtime computation)
- Steps use simple bar-chart style tallies for Plurality, score rows for Borda, matchup rows for Ranked Pairs
- Final step always shows the winner with `text-accent font-bold` highlight and a trophy or star emoji

**Navigation:**
- `← Prev` button (disabled on step 0) — `btn-secondary`
- `Step N of M` counter — `text-ink-2 text-sm text-center`
- `Next →` button (disabled on last step, becomes "See winner →" on penultimate step) — `btn-secondary`
- All three reset to step 0 independently

## Step Definitions

### Plurality (3 steps)

**Step 1:** Alice casts her vote. Show Dune with 1 tally mark, others at 0.
> "Alice picks Dune — her top choice."

**Step 2:** Bob casts his vote. Show Dune at 2, others at 0.
> "Bob also picks Dune. First-place votes only — rankings beyond 1st are ignored."

**Step 3 (final):** Carol casts her vote. Show Dune:2, Oppenheimer:1, Barbie:0, Alien:0. Winner banner.
> "Carol picks Oppenheimer. Dune wins with the most first-place votes. But notice: Carol would rather watch anything else — Plurality doesn't capture that."

### Ranked Choice / Borda (4 steps)

**Step 1:** Alice's ballot is counted. Show running scores: Dune:4, Opp:3, Barbie:2, Alien:1.
> "Each position earns points: 1st=4pts, 2nd=3pts, 3rd=2pts, 4th=1pt."

**Step 2:** Bob's ballot added. Running totals: Dune:8, Opp:6, Barbie:4, Alien:2.
> "Bob's ballot matches Alice's, so Dune stretches its lead."

**Step 3:** Carol's ballot added. Final totals: Dune:9, Opp:10, Barbie:7, Alien:4. Shown as mini bar chart with percentages (75%, 83%, 58%, 33%).
> "Carol loves Oppenheimer and puts Dune last. That penalty pulls Dune's total below Oppenheimer's."

**Step 4 (final):** Winner banner for Oppenheimer.
> "Oppenheimer wins — it's Carol's top pick and Alice & Bob's solid second. Borda rewards broad appeal over concentrated first-place support."

### Ranked Pairs / Tideman (4 steps)

**Step 1:** Show all 6 head-to-head matchups as a grid.
> "Every candidate faces every other candidate in a head-to-head vote."

| Match | Result |
|---|---|
| Dune vs Oppenheimer | Dune 2–1 |
| Dune vs Barbie | Dune 2–1 |
| Dune vs Alien | Dune 2–1 |
| Oppenheimer vs Barbie | Oppenheimer 3–0 |
| Oppenheimer vs Alien | Oppenheimer 3–0 |
| Barbie vs Alien | Barbie 3–0 |

**Step 2:** Sort matchups by margin of victory (strongest wins locked first).
> "Lock the clearest wins first: Oppenheimer swept Barbie and Alien 3-0. These are locked in."

**Step 3:** Lock all pairs. Show the resulting ranked chain: Dune > Oppenheimer > Barbie > Alien.
> "Dune beats Oppenheimer 2–1 — locked in without creating any cycle. The full order emerges."

**Step 4 (final):** Winner banner for Dune.
> "Dune wins — it beat every other film head-to-head. When a Condorcet winner exists, Ranked Pairs always finds them."

## Bottom Comparison Table

A `.card` section titled "Which should you pick?" with a three-column table:

| | Plurality | Ranked Choice | Ranked Pairs |
|---|---|---|---|
| **Best for** | Quick, low-stakes decisions | Small groups, consensus-finding | Larger groups, highest fairness |
| **Ballot** | Pick one | Drag to rank | Drag to rank |
| **Wins by** | Most first-place votes | Highest total Borda points | Beats everyone head-to-head |
| **Strength** | Simple & familiar | Rewards broad appeal | Finds true majority preference |
| **In this example** | Dune | Oppenheimer | Dune |

## Component Architecture

Single file: `frontend/src/pages/LearnPage.tsx`

- `LearnPage` (default export) — page shell, layout, back link, scenario intro, comparison table
- `MethodCard` (local component) — receives `{ title, tagline, steps: Step[] }` props; owns `currentStep` state
- `Step` type: `{ label: string; description: string; content: React.ReactNode }`
- All step content is authored as static JSX inline in `LearnPage.tsx` (no data fetching, no computation)
- No new dependencies

## Files Changed

- **Create:** `frontend/src/pages/LearnPage.tsx`
- **Modify:** `frontend/src/App.tsx` — add `/learn` route
- **Modify:** `frontend/src/pages/CreatePoll.tsx` — add "How does this work?" link near voting method selector

## Out of Scope

- No animation between steps (simple content swap)
- No user-editable ballots
- No backend changes
- No mobile-specific layout beyond horizontal scroll on the ballot table
