# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

Two independent packages — no monorepo tooling:

```
worker/   — Cloudflare Worker (Hono 4, TypeScript)
frontend/ — React 18 SPA (Vite, Tailwind CSS 3, TypeScript)
docs/     — Design spec and implementation plan
```

## Commands

### Worker

```bash
cd worker
npm run dev          # wrangler dev on http://localhost:8787
npm test             # vitest run (all tests)
npm run test:watch   # vitest watch mode
```

Run a single test file:
```bash
cd worker && npx vitest run test/votes.test.ts
```

### Frontend

```bash
cd frontend
npm run dev          # Vite dev server on http://localhost:5173
npm run build        # tsc + vite build
npm run preview      # Preview production build
```

Local dev: Vite proxies `/api/*` → `http://localhost:8787`, so both processes must run together.

## Architecture

### Worker (`worker/src/`)

- `index.ts` — Hono app; mounts 5 route groups under CORS middleware
- `types.ts` — All shared TypeScript interfaces and the `Env` binding type (`DB: D1Database`, `TMDB_API_KEY: string`, `GOOGLE_BOOKS_API_KEY: string`)
- `middleware/auth.ts` — Two middlewares:
  - `participantAuth`: reads `Participant-Token` header; scopes the DB lookup to `poll_id` when the route has an `:id` param (search routes are poll-agnostic)
  - `adminAuth`: reads `?admin=` query param; uses `crypto.subtle.timingSafeEqual` for constant-time comparison
- `routes/` — One file per resource (`polls`, `participants`, `nominations`, `votes`, `search`)
- `lib/voting.ts` — Pure functions: `plurality()`, `rankedChoice()` (instant-runoff), `rankedPairs()` (Tideman). All three consume the same `votes` table; `rank=NULL` for plurality, `rank=1,2,3…` for ranked methods. Results include a `tied` boolean (true when top 2+ scores are equal).

### Frontend (`frontend/src/`)

- `App.tsx` — BrowserRouter with three routes: `/`, `/p/:id`, catch-all → `/`
- `api/client.ts` — All API calls; participant token stored in `localStorage` as `poll_token_<pollId>`; base URL from `VITE_API_URL` env var or `/api`
- `hooks/usePoll.ts` — Polls `GET /polls/:id` every 3 seconds using an `intervalRef` pattern (not state-based); stops automatically when phase becomes `closed`
- `pages/PollPage.tsx` — Orchestrates the full poll lifecycle: join flow → NominationPhase → VotingPhase → ResultsView; holds `joinedName` state (captured from join response, used to count per-user nominations)
- `components/` — Phase-specific components; admin token flows in via `?admin=` URL param and `sessionStorage`
- `components/AdminControls.tsx` — Admin panel rendered at every poll phase; manages a mode state machine (`default → editing | confirming | deleting | deleted`). Edit mode patches poll fields; delete mode cascades through a confirmation step then redirects home via `onDeleted` callback after a countdown.

### Admin Endpoints (all require `?admin=<token>`)

- `PATCH /polls/:id/phase` — advance phase (`nominating → voting → closed`); only valid transitions are accepted
- `PATCH /polls/:id` — edit poll metadata: `title`, `voting_method`, `nomination_closes_at`, `nominations_visible`, `votes_visible`, `is_public`. `voting_method` can only be changed while phase is `nominating`.
- `DELETE /polls/:id` — permanently deletes the poll and all related rows (votes → nominations → participants → poll) via a single D1 `batch()` call

Poll creation (`POST /polls`) returns an `admin_url` containing the admin token; this is the only time the token is surfaced.

### Data Flow

Poll lifecycle: `nominating` → `voting` → `closed`

- Phase transitions are admin-only (`PATCH /polls/:id/phase`)
- Auto-advance from `nominating` to `voting` happens server-side in `GET /polls/:id` when `nomination_closes_at` (stored in **milliseconds**) has passed; guarded by `WHERE phase = 'nominating'` to prevent TOCTOU races
- Votes are submitted as an array and replaced atomically via D1 `batch()` (delete + insert)

### Testing

Worker tests run inside the actual Workers runtime via `@cloudflare/vitest-pool-workers`. Each test file calls `applySchema()` (from `test/helpers.ts`) in `beforeEach` — the schema is split on `;` and executed one statement at a time because D1's test runtime rejects multi-statement `exec()` calls.

### Key Constraints

- `migrations_dir = "migrations"` in `wrangler.toml` must be a **top-level key**, not under a `[migrations]` section — the latter breaks vitest-pool-workers
- `frontend/src/**/*.js` is gitignored; `tsc` emits `.js` files alongside sources during type-checking, which are not committed
- No WebSockets/Durable Objects (not on Cloudflare free plan) — live updates use 3-second polling
- TMDB API key is a Worker secret (`wrangler secret put TMDB_API_KEY`); Google Books API key is optional but recommended (`wrangler secret put GOOGLE_BOOKS_API_KEY`) — without it, book search hits rate limits quickly
- CORS allowlist in `index.ts` explicitly includes `polls.gogel.io`; add any new custom domains there and redeploy the worker
- `polls` table has an `is_public` column (default 1); `GET /polls` returns all open public polls + 3 most recently closed for the home page listing

## Deployment

See `docs/DEPLOY.md` for full setup. In brief:
1. `wrangler d1 create polls` → paste `database_id` into `wrangler.toml`
2. `wrangler d1 migrations apply polls`
3. `wrangler secret put TMDB_API_KEY`
4. `wrangler deploy`
5. Frontend → Cloudflare Pages with build command `cd frontend && npm run build`, output dir `frontend/dist`, env var `VITE_API_URL=<worker-url>`
