# Card Backgrounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure no text renders directly against the busy page background — all content sits on a card or solid surface.

**Architecture:** Three isolated frontend component edits, no shared logic, no new abstractions. Each task is independent and can be reviewed separately.

**Tech Stack:** React 18, TypeScript, Tailwind CSS 3, Vite

## Global Constraints

- No new dependencies
- No worker changes
- Follow existing Tailwind class patterns (`card`, `bg-raised`, `text-ink-3`, etc.)
- No new components — inline JSX changes only

---

### Task 1: Group nominations list into a single card (NominationPhase)

**Files:**
- Modify: `frontend/src/components/NominationPhase.tsx`

**Interfaces:**
- Consumes: nothing from other tasks
- Produces: nothing consumed by other tasks

- [ ] **Step 1: Replace the nominations list section**

In `frontend/src/components/NominationPhase.tsx`, find lines 120–147 (the `{/* Nominations list */}` block):

```tsx
      {/* Nominations list */}
      {poll.nominations !== null ? (
        <div className="space-y-2">
          {poll.nominations.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="text-ink-3 text-sm">No nominations yet — be the first!</p>
            </div>
          ) : (
            <>
              <p className="text-xs text-ink-3 font-semibold uppercase tracking-widest px-1">
                {poll.nominations.length} nomination{poll.nominations.length !== 1 ? 's' : ''}
              </p>
              {poll.nominations.map(nom => (
                <NominationCard
                  key={nom.id}
                  nomination={nom}
                  onDelete={adminToken
                    ? () => api.deleteNomination(poll.id, nom.id, adminToken).then(onRefetch)
                    : undefined}
                />
              ))}
            </>
          )}
        </div>
      ) : (
        <p className="text-ink-3 text-sm text-center py-8">Nominations are hidden until voting begins.</p>
      )}
```

Replace with:

```tsx
      {/* Nominations list */}
      {poll.nominations !== null ? (
        <div className="card p-5 space-y-3">
          {poll.nominations.length === 0 ? (
            <p className="text-ink-3 text-sm text-center py-3">No nominations yet — be the first!</p>
          ) : (
            <>
              <p className="text-xs text-ink-3 font-semibold uppercase tracking-widest">
                {poll.nominations.length} nomination{poll.nominations.length !== 1 ? 's' : ''}
              </p>
              <div className="space-y-2">
                {poll.nominations.map(nom => (
                  <NominationCard
                    key={nom.id}
                    nomination={nom}
                    onDelete={adminToken
                      ? () => api.deleteNomination(poll.id, nom.id, adminToken).then(onRefetch)
                      : undefined}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="card p-8 text-center">
          <p className="text-ink-3 text-sm">Nominations are hidden until voting begins.</p>
        </div>
      )}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/bgogel/projects/polls/frontend && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Verify in browser**

```bash
cd /Users/bgogel/projects/polls/frontend && npm run dev
```

Also start the worker in a separate terminal:
```bash
cd /Users/bgogel/projects/polls/worker && npm run dev
```

Open http://localhost:5173 and create or open a poll in the nominating phase. Verify:
1. The nominations header ("X nominations") appears inside a card, not against the raw background
2. Each nomination renders as a sub-card (`bg-raised`) visually nested within the outer card
3. With zero nominations, "No nominations yet — be the first!" appears inside the card
4. As a non-joined viewer with hidden nominations, "Nominations are hidden until voting begins." appears inside a card

- [ ] **Step 4: Commit**

```bash
cd /Users/bgogel/projects/polls && git add frontend/src/components/NominationPhase.tsx
git commit -m "feat: group nominations list into single card with sub-cards"
```

---

### Task 2: Wrap VotingPhase error message in a card

**Files:**
- Modify: `frontend/src/components/VotingPhase.tsx`

**Interfaces:**
- Consumes: nothing from other tasks
- Produces: nothing consumed by other tasks

- [ ] **Step 1: Fix the floating error message**

In `frontend/src/components/VotingPhase.tsx`, find line 164:

```tsx
      {error && <p className="text-danger text-sm px-1">{error}</p>}
```

Replace with:

```tsx
      {error && <div className="card px-4 py-3"><p className="text-danger text-sm">{error}</p></div>}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/bgogel/projects/polls/frontend && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Verify in browser**

Open a poll in the voting phase. Trigger an error (e.g., try submitting without selecting a vote for plurality). Verify the error message appears on a card surface rather than floating against the background.

- [ ] **Step 4: Commit**

```bash
cd /Users/bgogel/projects/polls && git add frontend/src/components/VotingPhase.tsx
git commit -m "feat: wrap voting phase error message in card"
```

---

### Task 3: Wrap ResultsView loading and error states in cards

**Files:**
- Modify: `frontend/src/components/ResultsView.tsx`

**Interfaces:**
- Consumes: nothing from other tasks
- Produces: nothing consumed by other tasks

- [ ] **Step 1: Fix the floating error and loading states**

In `frontend/src/components/ResultsView.tsx`, find lines 34–35:

```tsx
  if (error) return <p className="text-ink-3 text-sm text-center py-10">{error}</p>
  if (!results) return <p className="text-ink-3 text-sm text-center py-10 animate-pulse">Loading results…</p>
```

Replace with:

```tsx
  if (error) return <div className="card p-5 text-center"><p className="text-ink-3 text-sm">{error}</p></div>
  if (!results) return <div className="card p-5 text-center"><p className="text-ink-3 text-sm animate-pulse">Loading results…</p></div>
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/bgogel/projects/polls/frontend && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Verify in browser**

Open a closed poll (or a poll with `votes_visible: true` in the voting phase). Verify:
1. While results are loading, the "Loading results…" pulse text appears inside a card
2. If results fail to load (e.g., disconnect the worker), the error appears inside a card

- [ ] **Step 4: Commit**

```bash
cd /Users/bgogel/projects/polls && git add frontend/src/components/ResultsView.tsx
git commit -m "feat: wrap results loading and error states in cards"
```
