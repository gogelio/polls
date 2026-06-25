# External Links for Book and Movie Nominations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make book and movie nomination cards link to their Google Books or TMDB page, opening in a new tab.

**Architecture:** Three independent frontend component edits. `category: Category` is added as a new prop to `NominationCard` and `SortableItem`; `ResultsView` already has `poll.category`. URL construction is inlined at each call site — no shared utility. Links are conditional on `meta?.external_id` being present.

**Tech Stack:** React 18, TypeScript, Tailwind CSS 3, Vite

## Global Constraints

- No new dependencies
- No worker changes
- All links: `target="_blank" rel="noopener noreferrer"`
- Links only rendered when `meta?.external_id` is present and `category` is `'book'` or `'movie'`
- URL patterns: books → `https://books.google.com/books?id={external_id}`, movies → `https://www.themoviedb.org/movie/{external_id}`
- No new components — inline JSX changes only

---

### Task 1: NominationCard — wrap whole card in link + thread category from NominationPhase

**Files:**
- Modify: `frontend/src/components/NominationCard.tsx`
- Modify: `frontend/src/components/NominationPhase.tsx`

**Interfaces:**
- Consumes: `Category` type from `../types`
- Produces: `NominationCard` now requires `category: Category` prop — Task 2 and 3 are independent

- [ ] **Step 1: Rewrite NominationCard.tsx**

Replace the entire file with:

```tsx
import type { Category, PollNomination, NominationMetadata } from '../types'

interface NominationCardProps {
  nomination: PollNomination
  category: Category
  onDelete?: () => void
}

export function NominationCard({ nomination, category, onDelete }: NominationCardProps) {
  const meta = nomination.metadata
    ? (typeof nomination.metadata === 'string'
        ? JSON.parse(nomination.metadata) as NominationMetadata
        : nomination.metadata)
    : null
  const imageUrl = meta?.cover_url ?? meta?.poster_url
  const externalUrl = meta?.external_id && (category === 'book' || category === 'movie')
    ? category === 'book'
      ? `https://books.google.com/books?id=${meta.external_id}`
      : `https://www.themoviedb.org/movie/${meta.external_id}`
    : null

  const inner = (
    <div className="flex items-center gap-3 bg-raised border border-line rounded-xl p-3 group">
      {imageUrl && (
        <img src={imageUrl} alt="" className="w-9 h-14 object-cover rounded-lg flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm text-ink truncate">{nomination.title}</div>
        {meta?.author && (
          <div className="text-xs text-ink-2">{meta.author}{meta.year ? ` · ${meta.year}` : ''}</div>
        )}
        {meta?.director && (
          <div className="text-xs text-ink-2">{meta.director}{meta.year ? ` · ${meta.year}` : ''}</div>
        )}
        <div className="text-xs text-ink-3 mt-0.5">by {nomination.participant_name}</div>
      </div>
      {onDelete && (
        <button
          onClick={e => { e.preventDefault(); e.stopPropagation(); onDelete() }}
          className="text-ink-3 hover:text-danger transition-colors flex-shrink-0 p-1.5 rounded-lg hover:bg-[oklch(62%_0.22_25_/_0.1)] opacity-0 group-hover:opacity-100"
          aria-label="Remove nomination"
        >
          ✕
        </button>
      )}
    </div>
  )

  if (externalUrl) {
    return (
      <a href={externalUrl} target="_blank" rel="noopener noreferrer" className="block">
        {inner}
      </a>
    )
  }
  return inner
}
```

Note: the delete button uses `e.preventDefault(); e.stopPropagation()` to prevent the anchor from navigating when the delete button is clicked.

- [ ] **Step 2: Pass `category` prop in NominationPhase.tsx**

In `frontend/src/components/NominationPhase.tsx`, find the `<NominationCard` call (around line 132):

```tsx
                  <NominationCard
                    key={nom.id}
                    nomination={nom}
                    onDelete={adminToken
                      ? () => api.deleteNomination(poll.id, nom.id, adminToken).then(onRefetch)
                      : undefined}
                  />
```

Replace with:

```tsx
                  <NominationCard
                    key={nom.id}
                    nomination={nom}
                    category={poll.category}
                    onDelete={adminToken
                      ? () => api.deleteNomination(poll.id, nom.id, adminToken).then(onRefetch)
                      : undefined}
                  />
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/bgogel/projects/polls/frontend && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Verify in browser**

```bash
cd /Users/bgogel/projects/polls/frontend && npm run dev
# In a separate terminal:
cd /Users/bgogel/projects/polls/worker && npm run dev
```

Open http://localhost:5173, create or open a book or movie poll in the nominating phase and add a nomination. Verify:
1. Clicking the nomination card opens the Google Books or TMDB page in a new tab
2. The delete button (admin only) still works without navigating to the external page
3. A general poll nomination card is not a link

- [ ] **Step 5: Commit**

```bash
cd /Users/bgogel/projects/polls && git add frontend/src/components/NominationCard.tsx frontend/src/components/NominationPhase.tsx
git commit -m "feat: link nomination cards to Google Books or TMDB page"
```

---

### Task 2: VotingPhase SortableItem — link title text only

**Files:**
- Modify: `frontend/src/components/VotingPhase.tsx`

**Interfaces:**
- Consumes: `Category` type (already imported via `Poll` in the file)
- Produces: nothing consumed by other tasks

- [ ] **Step 1: Update SortableItemProps and add link to title**

In `frontend/src/components/VotingPhase.tsx`, find and replace the `SortableItemProps` interface and `SortableItem` function (lines 15–49):

```tsx
interface SortableItemProps { nomination: PollNomination; rank: number; category: import('../types').Category }

function SortableItem({ nomination, rank, category }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: nomination.id })
  const meta = nomination.metadata
    ? (typeof nomination.metadata === 'string'
        ? JSON.parse(nomination.metadata) as NominationMetadata
        : nomination.metadata)
    : null
  const imageUrl = meta?.cover_url ?? meta?.poster_url
  const externalUrl = meta?.external_id && (category === 'book' || category === 'movie')
    ? category === 'book'
      ? `https://books.google.com/books?id=${meta.external_id}`
      : `https://www.themoviedb.org/movie/${meta.external_id}`
    : null

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="flex items-center gap-3 bg-raised border border-line rounded-xl p-3 cursor-grab active:cursor-grabbing select-none touch-none"
      {...attributes}
      {...listeners}
    >
      <span className="text-accent font-extrabold text-base w-6 text-center flex-shrink-0 tabular-nums">
        {rank}
      </span>
      {imageUrl && (
        <img src={imageUrl} alt="" className="w-8 h-11 object-cover rounded-lg flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        {externalUrl ? (
          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="font-semibold text-sm text-ink truncate hover:underline block"
          >
            {nomination.title}
          </a>
        ) : (
          <div className="font-semibold text-sm text-ink truncate">{nomination.title}</div>
        )}
        {meta?.author && <div className="text-xs text-ink-3">{meta.author}</div>}
        {meta?.director && <div className="text-xs text-ink-3">{meta.director}</div>}
      </div>
      <span className="text-ink-3 text-lg select-none flex-shrink-0">⠿</span>
    </div>
  )
}
```

Note: `onClick={e => e.stopPropagation()}` on the anchor prevents the drag handler from intercepting the link click.

- [ ] **Step 2: Pass `category` to SortableItem**

In the same file, find the `<SortableItem` call (around line 155):

```tsx
                {ranked.map((nom, i) => (
                  <SortableItem key={nom.id} nomination={nom} rank={i + 1} />
                ))}
```

Replace with:

```tsx
                {ranked.map((nom, i) => (
                  <SortableItem key={nom.id} nomination={nom} rank={i + 1} category={poll.category} />
                ))}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/bgogel/projects/polls/frontend && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Verify in browser**

Open a book or movie poll in the voting phase. Verify:
1. Clicking the title text navigates to the external page in a new tab
2. Clicking anywhere else on the card (image, drag handle, metadata) still enables dragging
3. The drag-to-rank functionality is fully preserved

- [ ] **Step 5: Commit**

```bash
cd /Users/bgogel/projects/polls && git add frontend/src/components/VotingPhase.tsx
git commit -m "feat: link voting card titles to Google Books or TMDB page"
```

---

### Task 3: ResultsView — link winner title and standings titles

**Files:**
- Modify: `frontend/src/components/ResultsView.tsx`

**Interfaces:**
- Consumes: `poll.category` already available via the `poll: Poll` prop
- Produces: nothing consumed by other tasks

- [ ] **Step 1: Update the winner card title**

In `frontend/src/components/ResultsView.tsx`, find the winner title `<p>` (around line 67):

```tsx
                    <p className="text-xl font-extrabold text-ink tracking-tight leading-tight text-wrap-balance">
                      {leader.title}
                    </p>
```

Replace with:

```tsx
                    {meta?.external_id && (poll.category === 'book' || poll.category === 'movie') ? (
                      <a
                        href={poll.category === 'book'
                          ? `https://books.google.com/books?id=${meta.external_id}`
                          : `https://www.themoviedb.org/movie/${meta.external_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xl font-extrabold text-ink tracking-tight leading-tight text-wrap-balance hover:underline"
                      >
                        {leader.title}
                      </a>
                    ) : (
                      <p className="text-xl font-extrabold text-ink tracking-tight leading-tight text-wrap-balance">
                        {leader.title}
                      </p>
                    )}
```

- [ ] **Step 2: Update the standings rows**

In the same file, find the standings `.map` (around line 85). Replace this block:

```tsx
        {results.results.map((r, i) => (
          <div key={r.nomination_id} className="space-y-1.5">
            <div className="flex items-center gap-3">
              <span className="w-5 text-xs font-bold text-ink-3 tabular-nums text-right flex-shrink-0">{i + 1}</span>
              <span className="flex-1 text-sm font-semibold text-ink truncate">{r.title}</span>
              <span className="text-xs text-ink-3 tabular-nums flex-shrink-0">{r.percentage}%</span>
            </div>
            <div className="ml-8 h-1.5 bg-surface rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-700"
                style={{ width: `${r.percentage}%` }}
              />
            </div>
          </div>
        ))}
```

With:

```tsx
        {results.results.map((r, i) => {
          const standingMeta = r.metadata
            ? (JSON.parse(r.metadata) as NominationMetadata)
            : null
          const standingUrl = standingMeta?.external_id && (poll.category === 'book' || poll.category === 'movie')
            ? poll.category === 'book'
              ? `https://books.google.com/books?id=${standingMeta.external_id}`
              : `https://www.themoviedb.org/movie/${standingMeta.external_id}`
            : null
          return (
            <div key={r.nomination_id} className="space-y-1.5">
              <div className="flex items-center gap-3">
                <span className="w-5 text-xs font-bold text-ink-3 tabular-nums text-right flex-shrink-0">{i + 1}</span>
                {standingUrl ? (
                  <a href={standingUrl} target="_blank" rel="noopener noreferrer" className="flex-1 text-sm font-semibold text-ink truncate hover:underline">
                    {r.title}
                  </a>
                ) : (
                  <span className="flex-1 text-sm font-semibold text-ink truncate">{r.title}</span>
                )}
                <span className="text-xs text-ink-3 tabular-nums flex-shrink-0">{r.percentage}%</span>
              </div>
              <div className="ml-8 h-1.5 bg-surface rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-all duration-700"
                  style={{ width: `${r.percentage}%` }}
                />
              </div>
            </div>
          )
        })}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/bgogel/projects/polls/frontend && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Verify in browser**

Open a closed book or movie poll with results. Verify:
1. The winner title links to the Google Books or TMDB page in a new tab
2. Each standings row title links to the correct external page
3. A general poll's results have no links

- [ ] **Step 5: Commit**

```bash
cd /Users/bgogel/projects/polls && git add frontend/src/components/ResultsView.tsx
git commit -m "feat: link results winner and standings titles to Google Books or TMDB"
```
