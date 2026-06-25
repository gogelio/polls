# Design: External Links for Book and Movie Nominations

**Date:** 2026-06-25

## Overview

Nomination and results cards for books and movies should link to their Google Books or TMDB page. The link target depends on the poll category and uses the `external_id` already stored in `NominationMetadata`. General category nominations have no external link.

## URL Patterns

| Category | URL |
|----------|-----|
| `book`   | `https://books.google.com/books?id={external_id}` |
| `movie`  | `https://www.themoviedb.org/movie/{external_id}` |

All links open in a new tab: `target="_blank" rel="noopener noreferrer"`.

Links are only rendered when `meta?.external_id` is present. If `external_id` is absent (e.g., free-text general nominations or nominations made before external IDs were stored), the card renders without a link.

## Scope

Three files change; no worker or API changes.

- `frontend/src/components/NominationCard.tsx`
- `frontend/src/components/VotingPhase.tsx`
- `frontend/src/components/ResultsView.tsx`

## Approach

Inline URL construction — no shared utility. The two-branch conditional is simple enough to repeat at each call site. `category: Category` is added as a new prop where needed.

```ts
const url = category === 'book'
  ? `https://books.google.com/books?id=${meta.external_id}`
  : `https://www.themoviedb.org/movie/${meta.external_id}`
```

## NominationCard.tsx

**Prop change:** Add `category: Category` to `NominationCardProps`.

**Link behaviour:** When `meta?.external_id` exists and `category` is `'book'` or `'movie'`, wrap the entire card `<div>` in an `<a href={url} target="_blank" rel="noopener noreferrer">`. The card's existing styles are unchanged. The delete button remains a separate click target inside the anchor and continues to work. When there is no external link, the `<div>` renders as today.

**Call sites:** `NominationPhase.tsx` — pass `category={poll.category}` to each `<NominationCard>`.

## VotingPhase.tsx (SortableItem)

**Prop change:** Add `category: Category` to `SortableItemProps`.

**Link behaviour:** When `meta?.external_id` exists and `category` is `'book'` or `'movie'`, wrap only the title `<div>` in an `<a href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>`. The `stopPropagation` prevents the click from triggering the drag handler. The drag handle, rank number, cover image, and metadata text remain outside the anchor and fully draggable.

**Call sites:** `VotingPhase` renders `<SortableItem>` — pass `category={poll.category}`.

## ResultsView.tsx

`ResultsView` already receives `poll` (with `poll.category`). No new prop needed.

**Winner card:** `meta` is already parsed in the winner map. When `meta?.external_id` exists, wrap the title `<p>` in `<a href={url} target="_blank" rel="noopener noreferrer">`.

**Standings rows:** `r.metadata` is a raw JSON string. Parse it the same way as in the winner block: `r.metadata ? JSON.parse(r.metadata) as NominationMetadata : null`. When `parsedMeta?.external_id` exists, wrap the title `<span>` in `<a href={url} target="_blank" rel="noopener noreferrer">`.
