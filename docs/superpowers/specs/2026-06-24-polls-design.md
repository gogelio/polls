# Polls App Design

**Date:** 2026-06-24
**Stack:** React SPA + Cloudflare Workers (Hono) + Cloudflare D1 + Cloudflare Pages

---

## Overview

A link-based polling web app for small groups of friends. Participants nominate items, then vote using one of three voting methods. No accounts required — access is link-based, identity is token-based. Hosted entirely on the Cloudflare free plan.

---

## Poll Lifecycle

A poll progresses through four phases:

1. **Create** — Creator configures the poll and receives two links: a participant link and a secret admin link.
2. **Nominating** — Participants enter a display name and submit nominations. A countdown timer is shown; nominations close when the creator manually triggers it or the timer expires, whichever comes first.
3. **Voting** — Participants cast votes using the configured method. Creator closes voting manually.
4. **Closed** — Results are permanently visible. A shareable results link is available.

---

## Poll Configuration (set at creation)

| Setting | Type | Description |
|---|---|---|
| `title` | string | Poll question or title |
| `category` | enum | `book`, `movie`, or `general` |
| `voting_method` | enum | `plurality`, `ranked_choice`, or `ranked_pairs` |
| `max_nominations` | integer | Max nominations per participant (creator-set) |
| `nomination_closes_at` | timestamp (nullable) | Optional timer; null means timer-free |
| `nominations_visible` | boolean | Whether nominations are shown live during nomination phase |
| `votes_visible` | boolean | Whether results are shown live during voting phase |

---

## Categories

### Book Club
- Nomination UI: search field powered by Google Books API (proxied through Worker)
- Results include: cover art, author, publication year
- Nomination metadata stored: `{ external_id, cover_url, author, year }`

### Movies
- Nomination UI: search field powered by TMDB API (proxied through Worker; API key stored as Worker secret)
- Results include: poster, director, release year
- Nomination metadata stored: `{ external_id, poster_url, director, year }`

### General
- Nomination UI: free-text input
- No external API, no metadata

---

## Voting Methods

All three methods use the same `votes` table. The algorithm runs server-side at results time.

| Method | Vote data | Algorithm |
|---|---|---|
| Plurality | One row per voter, `rank = NULL` | Most votes wins |
| Ranked Choice | One row per ranked item, `rank = 1, 2, 3…` | Instant-runoff elimination until majority |
| Ranked Pairs | Same rows as ranked choice | Tideman method: build preference graph, lock pairs by margin, find winner |

---

## Identity & Access

### Participants
- On first visit, participant enters a display name. The Worker creates a `participants` row and returns a token (nanoid, 24 chars).
- Token is stored in `localStorage` keyed by poll ID.
- Every nomination and vote request includes the token in the `Authorization: Bearer <token>` header.
- Returning participants with a valid token skip the name-entry step.

### Creator (Admin)
- No account needed. Poll creation returns an `admin_token` (nanoid, 24 chars).
- Admin link: `polls.example.com/p/:id?admin=<admin_token>`
- Admin token passed as query param on all admin API calls.
- Admin capabilities: close nominations early, transition to voting, close voting, delete any nomination.

---

## Data Model (D1 / SQLite)

### `polls`
```sql
CREATE TABLE polls (
  id TEXT PRIMARY KEY,                  -- nanoid, 8 chars
  admin_token TEXT NOT NULL,            -- nanoid, 24 chars
  title TEXT NOT NULL,
  category TEXT NOT NULL,               -- book|movie|general
  voting_method TEXT NOT NULL,          -- plurality|ranked_choice|ranked_pairs
  phase TEXT NOT NULL DEFAULT 'nominating', -- nominating|voting|closed
  max_nominations INTEGER NOT NULL,
  nominations_visible INTEGER NOT NULL DEFAULT 1, -- 0|1
  votes_visible INTEGER NOT NULL DEFAULT 0,       -- 0|1
  nomination_closes_at INTEGER,         -- unix timestamp, nullable
  created_at INTEGER NOT NULL
);
```

### `participants`
```sql
CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id),
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,           -- nanoid, 24 chars
  joined_at INTEGER NOT NULL
);
```

### `nominations`
```sql
CREATE TABLE nominations (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id),
  participant_id TEXT NOT NULL REFERENCES participants(id),
  title TEXT NOT NULL,
  metadata TEXT,                        -- JSON: {external_id, cover_url/poster_url, author/director, year}
  created_at INTEGER NOT NULL
);
```

### `votes`
```sql
CREATE TABLE votes (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id),
  participant_id TEXT NOT NULL REFERENCES participants(id),
  nomination_id TEXT NOT NULL REFERENCES nominations(id),
  rank INTEGER,                         -- NULL for plurality; 1=top for ranked methods
  created_at INTEGER NOT NULL,
  UNIQUE(poll_id, participant_id, nomination_id),
  UNIQUE(poll_id, participant_id, rank)
);
```

---

## API

All routes are mounted on a Hono router deployed as a Cloudflare Worker.

Auth:
- `Participant-Token: <token>` header for participant actions
- `?admin=<admin_token>` query param for admin actions

### Poll Management

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/polls` | None | Create poll. Returns `{ id, admin_token, participant_url, admin_url }` |
| `GET` | `/polls/:id` | None | Poll state + nominations (gated by `nominations_visible` and phase) |
| `PATCH` | `/polls/:id/phase` | Admin | Transition phase: `nominating→voting` or `voting→closed` |

### Participants

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/polls/:id/join` | None | Enter display name → returns `{ participant_id, token }` |

### Nominations

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/polls/:id/nominations` | Participant | Submit nomination. Worker rejects if `max_nominations` reached or `nomination_closes_at` has passed (server-enforced, not just UI). |
| `DELETE` | `/polls/:id/nominations/:nid` | Admin | Remove a nomination. |

### Votes

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/polls/:id/votes` | Participant | Submit vote(s). Body: `[{ nomination_id, rank }]`. Replaces prior vote atomically. |
| `GET` | `/polls/:id/results` | None | Computed results. Gated by `votes_visible` during voting phase; always available after close. |

### Search Proxy

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/search/books?q=` | Participant | Proxies Google Books. Returns `[{ external_id, title, author, year, cover_url }]` |
| `GET` | `/search/movies?q=` | Participant | Proxies TMDB. Returns `[{ external_id, title, director, year, poster_url }]` |

---

## Frontend (React SPA on Cloudflare Pages)

### Routes
- `/` — Create poll form
- `/p/:id` — Participant view (nomination, voting, or results depending on phase)
- `/p/:id?admin=<token>` — Same view with admin controls overlay

### Key UI Components
- **CreatePollForm** — title, category picker, voting method selector, timer input, max nominations, visibility toggles
- **NominationPhase** — search input (books/movies) or free-text (general), live nomination list, timer countdown, participant counter
- **VotingPhase** — drag-to-rank list (ranked methods) or single-select (plurality), submit button
- **ResultsView** — winner card with metadata, ranked standings with percentage bars, share button
- **AdminControls** — floating panel (visible only with admin token): phase transition buttons, delete nomination controls

### Live Updates
The SPA polls `GET /polls/:id` every 3 seconds during `nominating` and `voting` phases. Polling stops when phase is `closed`.

---

## Deployment

| Resource | Service | Notes |
|---|---|---|
| Frontend | Cloudflare Pages | Static React build, CI/CD via Pages Git integration |
| API | Cloudflare Workers | Hono router, bound to D1 |
| Database | Cloudflare D1 | One database, migrations via Wrangler |
| Secrets | Worker secrets | `TMDB_API_KEY` stored via `wrangler secret put` |

`.superpowers/` added to `.gitignore`.
