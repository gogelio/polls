# Pause Poll & Admin Panel UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pause/unpause feature that immediately locks participant submissions, and move "Delete poll" into the edit panel.

**Architecture:** New `is_paused` DB column toggled by a new `PATCH /polls/:id/pause` admin endpoint; nominations and votes routes check `is_paused` before accepting writes; the frontend shows a paused card in place of submission forms and surfaces the toggle + delete inside the edit panel.

**Tech Stack:** Cloudflare Workers, Hono, D1 (SQLite), React 18, TypeScript, Vite, Tailwind CSS, vitest-pool-workers

## Global Constraints

- Worker tests run via `@cloudflare/vitest-pool-workers`; use `SELF.fetch` with `http://example.com/...` as the base URL
- Test schema in `worker/test/helpers.ts` must stay in sync with real migrations — add `is_paused` to the `SCHEMA` string there
- D1 booleans are stored as `INTEGER` (0/1); coerce to JS `boolean` in the `GET /polls/:id` response with `=== 1`
- No `wrangler.toml` changes needed for this feature
- Frontend `.js` files in `frontend/src/` are gitignored build artifacts — never edit them

---

## Files

**Created:**
- `worker/migrations/0003_pause_poll.sql`

**Modified:**
- `worker/test/helpers.ts` — add `is_paused` to SCHEMA and `seedPoll`
- `worker/src/types.ts` — add `is_paused` to `Poll`
- `worker/src/routes/polls.ts` — add pause endpoint, include `is_paused` in GET response
- `worker/src/routes/nominations.ts` — enforce pause
- `worker/src/routes/votes.ts` — enforce pause
- `frontend/src/types.ts` — add `is_paused` to `Poll`
- `frontend/src/api/client.ts` — add `togglePause`
- `frontend/src/components/AdminControls.tsx` — move delete into edit mode, add pause toggle
- `frontend/src/components/NominationPhase.tsx` — show paused card
- `frontend/src/components/VotingPhase.tsx` — show paused card

---

## Task 1: Migration and test schema

**Files:**
- Create: `worker/migrations/0003_pause_poll.sql`
- Modify: `worker/test/helpers.ts`

**Interfaces:**
- Produces: `is_paused INTEGER NOT NULL DEFAULT 0` column on `polls` table; `seedPoll` accepts `is_paused` override

- [ ] **Step 1: Create migration file**

```sql
-- worker/migrations/0003_pause_poll.sql
ALTER TABLE polls ADD COLUMN is_paused INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 2: Add `is_paused` to test schema**

In `worker/test/helpers.ts`, update the `SCHEMA` constant — add `is_paused INTEGER NOT NULL DEFAULT 0,` to the polls table definition, after `is_public INTEGER NOT NULL DEFAULT 1,`:

```typescript
const SCHEMA = `
CREATE TABLE IF NOT EXISTS polls (
  id TEXT PRIMARY KEY, admin_token TEXT NOT NULL, title TEXT NOT NULL,
  category TEXT NOT NULL, voting_method TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'nominating', max_nominations INTEGER NOT NULL DEFAULT 3,
  nominations_visible INTEGER NOT NULL DEFAULT 1, votes_visible INTEGER NOT NULL DEFAULT 0,
  is_public INTEGER NOT NULL DEFAULT 1, is_paused INTEGER NOT NULL DEFAULT 0,
  nomination_closes_at INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY, poll_id TEXT NOT NULL, name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE, joined_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS nominations (
  id TEXT PRIMARY KEY, poll_id TEXT NOT NULL, participant_id TEXT NOT NULL,
  title TEXT NOT NULL, metadata TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS votes (
  id TEXT PRIMARY KEY, poll_id TEXT NOT NULL, participant_id TEXT NOT NULL,
  nomination_id TEXT NOT NULL, rank INTEGER, created_at INTEGER NOT NULL,
  UNIQUE(poll_id, participant_id, nomination_id),
  UNIQUE(poll_id, participant_id, rank)
);`
```

- [ ] **Step 3: Apply migration locally**

```bash
cd worker
npx wrangler d1 migrations apply polls --local
```

Expected: `✅ Applied migration 0003_pause_poll.sql`

- [ ] **Step 4: Commit**

```bash
git add worker/migrations/0003_pause_poll.sql worker/test/helpers.ts
git commit -m "feat: add is_paused column to polls table"
```

---

## Task 2: Backend — pause endpoint and enforcement

**Files:**
- Modify: `worker/src/types.ts`
- Modify: `worker/src/routes/polls.ts`
- Modify: `worker/src/routes/nominations.ts`
- Modify: `worker/src/routes/votes.ts`
- Test: `worker/test/polls.test.ts`
- Test: `worker/test/nominations.test.ts`
- Test: `worker/test/votes.test.ts`

**Interfaces:**
- Produces: `PATCH /polls/:id/pause?admin=<token>` → `200 { is_paused: boolean }` or `404`/`401`
- Produces: `GET /polls/:id` response now includes `is_paused: boolean`
- Produces: `POST /polls/:id/nominations` returns `403 { error: 'Poll is paused' }` when `is_paused`
- Produces: `POST /polls/:id/votes` returns `403 { error: 'Poll is paused' }` when `is_paused`

- [ ] **Step 1: Add `is_paused` to the `Poll` type in `worker/src/types.ts`**

```typescript
export interface Poll {
  id: string
  admin_token: string
  title: string
  category: Category
  voting_method: VotingMethod
  phase: Phase
  max_nominations: number
  nominations_visible: number
  votes_visible: number
  is_public: number
  is_paused: number
  nomination_closes_at: number | null
  created_at: number
}
```

- [ ] **Step 2: Write failing tests**

In `worker/test/polls.test.ts`, add a new `describe` block at the bottom of the file:

```typescript
describe('PATCH /polls/:id/pause', () => {
  beforeEach(applySchema)

  it('pauses a poll', async () => {
    const { id, adminToken } = await seedPoll()
    const res = await SELF.fetch(`http://example.com/polls/${id}/pause?admin=${adminToken}`, {
      method: 'PATCH',
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { is_paused: boolean }
    expect(body.is_paused).toBe(true)
  })

  it('unpauses a poll', async () => {
    const { id, adminToken } = await seedPoll()
    await env.DB.prepare('UPDATE polls SET is_paused = 1 WHERE id = ?').bind(id).run()
    const res = await SELF.fetch(`http://example.com/polls/${id}/pause?admin=${adminToken}`, {
      method: 'PATCH',
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { is_paused: boolean }
    expect(body.is_paused).toBe(false)
  })

  it('returns 401 with bad admin token', async () => {
    const { id } = await seedPoll()
    const res = await SELF.fetch(`http://example.com/polls/${id}/pause?admin=wrong`, {
      method: 'PATCH',
    })
    expect(res.status).toBe(401)
  })

  it('GET /polls/:id includes is_paused', async () => {
    const { id, adminToken } = await seedPoll()
    await env.DB.prepare('UPDATE polls SET is_paused = 1 WHERE id = ?').bind(id).run()
    const res = await SELF.fetch(`http://example.com/polls/${id}`)
    const body = await res.json() as { is_paused: boolean }
    expect(body.is_paused).toBe(true)
  })
})
```

In `worker/test/nominations.test.ts`, add inside the existing `describe('POST /polls/:id/nominations')` block:

```typescript
  it('rejects nominations when poll is paused', async () => {
    const { id } = await seedPoll()
    const { token } = await seedParticipant(id)
    await env.DB.prepare('UPDATE polls SET is_paused = 1 WHERE id = ?').bind(id).run()
    const res = await SELF.fetch(`http://example.com/polls/${id}/nominations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': token },
      body: JSON.stringify({ title: 'Blocked', metadata: null }),
    })
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Poll is paused')
  })
```

In `worker/test/votes.test.ts`, add inside the existing `describe('POST /polls/:id/votes')` block:

```typescript
  it('rejects votes when poll is paused', async () => {
    const { id } = await seedPoll({ voting_method: 'plurality' })
    const { id: pid, token } = await seedParticipant(id)
    const { id: nomId } = await seedNomination(id, pid)
    await env.DB.prepare("UPDATE polls SET phase = 'voting', is_paused = 1 WHERE id = ?").bind(id).run()
    const res = await SELF.fetch(`http://example.com/polls/${id}/votes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': token },
      body: JSON.stringify([{ nomination_id: nomId, rank: null }]),
    })
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Poll is paused')
  })
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
cd worker
npx vitest run test/polls.test.ts test/nominations.test.ts test/votes.test.ts
```

Expected: the new tests fail with 404 or wrong status codes.

- [ ] **Step 4: Add the pause endpoint to `worker/src/routes/polls.ts`**

In `polls.ts`, update the SELECT in `GET /:id` to include `is_paused`:

```typescript
'SELECT id, title, category, voting_method, phase, max_nominations, nominations_visible, votes_visible, is_public, is_paused, nomination_closes_at, created_at FROM polls WHERE id = ?'
```

Add `is_paused` to the `c.json(...)` response object (after `nominations`):

```typescript
    is_paused: poll.is_paused === 1,
```

Add the pause endpoint after the existing `PATCH /:id/phase` handler:

```typescript
pollsRouter.patch('/:id/pause', adminAuth, async (c) => {
  const id = c.req.param('id')
  const poll = await c.env.DB.prepare('SELECT is_paused FROM polls WHERE id = ?')
    .bind(id).first<{ is_paused: number }>()
  if (!poll) return c.json({ error: 'Poll not found' }, 404)
  const newValue = poll.is_paused === 1 ? 0 : 1
  await c.env.DB.prepare('UPDATE polls SET is_paused = ? WHERE id = ?').bind(newValue, id).run()
  return c.json({ is_paused: newValue === 1 })
})
```

- [ ] **Step 5: Enforce pause in `worker/src/routes/nominations.ts`**

Update the SELECT in `POST /:id/nominations` to also fetch `is_paused`:

```typescript
  const poll = await c.env.DB.prepare(
    'SELECT id, phase, max_nominations, nomination_closes_at, is_paused FROM polls WHERE id = ?'
  ).bind(pollId).first<Pick<Poll, 'id' | 'phase' | 'max_nominations' | 'nomination_closes_at' | 'is_paused'>>()
  if (!poll) return c.json({ error: 'Poll not found' }, 404)
  if (poll.is_paused) return c.json({ error: 'Poll is paused' }, 403)
  if (poll.phase !== 'nominating') return c.json({ error: 'Poll is not accepting nominations' }, 400)
```

- [ ] **Step 6: Enforce pause in `worker/src/routes/votes.ts`**

Update the SELECT in `POST /:id/votes` to also fetch `is_paused`:

```typescript
  const poll = await c.env.DB.prepare(
    'SELECT id, phase, voting_method, is_paused FROM polls WHERE id = ?'
  ).bind(pollId).first<Pick<Poll, 'id' | 'phase' | 'voting_method' | 'is_paused'>>()
  if (!poll) return c.json({ error: 'Poll not found' }, 404)
  if (poll.phase !== 'voting') return c.json({ error: 'Poll is not in voting phase' }, 400)
  if (poll.is_paused) return c.json({ error: 'Poll is paused' }, 403)
```

- [ ] **Step 7: Run tests to confirm they pass**

```bash
cd worker
npx vitest run test/polls.test.ts test/nominations.test.ts test/votes.test.ts
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add worker/src/types.ts worker/src/routes/polls.ts worker/src/routes/nominations.ts worker/src/routes/votes.ts worker/test/polls.test.ts worker/test/nominations.test.ts worker/test/votes.test.ts
git commit -m "feat: add PATCH /polls/:id/pause endpoint and enforce pause on submissions"
```

---

## Task 3: Frontend types and API client

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api/client.ts`

**Interfaces:**
- Produces: `Poll.is_paused: boolean`
- Produces: `api.togglePause(pollId: string, adminToken: string): Promise<{ is_paused: boolean }>`

- [ ] **Step 1: Add `is_paused` to the `Poll` interface in `frontend/src/types.ts`**

```typescript
export interface Poll {
  id: string
  title: string
  category: Category
  voting_method: VotingMethod
  phase: Phase
  max_nominations: number
  nominations_visible: boolean
  votes_visible: boolean
  is_public: boolean
  is_paused: boolean
  nomination_closes_at: number | null
  nominations: PollNomination[] | null
  has_voted: boolean
  participant_count: number
  created_at: number
}
```

- [ ] **Step 2: Add `togglePause` to `frontend/src/api/client.ts`**

Add after `transitionPhase`:

```typescript
  togglePause: async (pollId: string, adminToken: string): Promise<{ is_paused: boolean }> => {
    const res = await throwIfError(await fetch(`${BASE}/polls/${pollId}/pause?admin=${adminToken}`, {
      method: 'PATCH',
    }))
    return res.json()
  },
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types.ts frontend/src/api/client.ts
git commit -m "feat: add is_paused to Poll type and togglePause API method"
```

---

## Task 4: AdminControls — pause toggle and delete relocation

**Files:**
- Modify: `frontend/src/components/AdminControls.tsx`

**Interfaces:**
- Consumes: `api.togglePause(pollId, adminToken)` from Task 3
- Consumes: `poll.is_paused: boolean` from Task 3

- [ ] **Step 1: Update the `Mode` type and remove delete from default mode**

`AdminControls.tsx` currently has:
```typescript
type Mode = 'default' | 'editing' | 'confirming' | 'deleting' | 'deleted'
```
No change needed to `Mode` — `'deleting'` and `'deleted'` remain.

In the `{mode === 'default'}` block, remove the "Delete poll" button entirely. After the change, default mode renders only:

```tsx
{mode === 'default' && (
  <>
    {poll.phase === 'nominating' && (
      <button
        disabled={loading}
        onClick={() => transitionPhase('voting')}
        className="w-full bg-accent hover:bg-accent-hover text-white text-sm font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-40"
      >
        Start voting →
      </button>
    )}
    {poll.phase === 'voting' && (
      <button
        disabled={loading}
        onClick={() => transitionPhase('closed')}
        className="w-full bg-danger text-white text-sm font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-40 hover:opacity-90"
      >
        Close & show results →
      </button>
    )}
    {poll.phase === 'closed' && (
      <p className="text-ink-3 text-xs">Poll is closed.</p>
    )}
    <button
      onClick={enterEditing}
      className="w-full text-xs text-ink-3 hover:text-ink transition-colors text-center py-1"
    >
      Edit poll
    </button>
  </>
)}
```

- [ ] **Step 2: Add `pauseLoading` state and `handleTogglePause` handler**

Add after the existing `const [loading, setLoading] = useState(false)` line:

```typescript
const [pauseLoading, setPauseLoading] = useState(false)

const handleTogglePause = async () => {
  setPauseLoading(true)
  setError(null)
  try {
    await api.togglePause(poll.id, adminToken)
    await onRefetch()
  } catch (e) {
    setError(e instanceof Error ? e.message : 'Failed to toggle pause')
  } finally {
    setPauseLoading(false)
  }
}
```

- [ ] **Step 3: Add pause toggle and delete button to edit mode**

In the `{mode === 'editing'}` block, add the following between the toggles section and the Save/Cancel buttons. Replace the existing `<div className="flex gap-2 pt-1">` Save/Cancel section with:

```tsx
          <div className="border-t border-line pt-3 space-y-2">
            <button
              disabled={pauseLoading}
              onClick={handleTogglePause}
              className="w-full text-xs font-semibold py-2 rounded-xl transition-colors disabled:opacity-40 border border-line hover:border-line-bright text-ink-2 hover:text-ink"
            >
              {pauseLoading ? '…' : poll.is_paused ? '▶ Unpause poll' : '⏸ Pause poll'}
            </button>
            <button
              onClick={() => { setError(null); setMode('deleting') }}
              className="w-full text-xs text-ink-3 hover:text-danger transition-colors text-center py-1"
            >
              Delete poll
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => { setError(null); setMode('default') }}
              className="flex-1 text-xs text-ink-3 hover:text-ink border border-line rounded-xl py-2 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="flex-1 bg-accent hover:bg-accent-hover text-white text-xs font-semibold py-2 rounded-xl transition-colors"
            >
              Save
            </button>
          </div>
```

- [ ] **Step 4: Verify `isWide` still covers `'deleting'` and `'deleted'`**

The existing line:
```typescript
const isWide = mode === 'editing' || mode === 'confirming' || mode === 'deleting' || mode === 'deleted'
```
No change needed — this is already correct.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AdminControls.tsx
git commit -m "feat: move delete into edit panel and add pause toggle to admin controls"
```

---

## Task 5: Participant UI — paused card

**Files:**
- Modify: `frontend/src/components/NominationPhase.tsx`
- Modify: `frontend/src/components/VotingPhase.tsx`

**Interfaces:**
- Consumes: `poll.is_paused: boolean` from Task 3

- [ ] **Step 1: Read NominationPhase to find the top-level return**

```bash
head -30 frontend/src/components/NominationPhase.tsx
```

- [ ] **Step 2: Add paused card to `NominationPhase`**

At the top of the component's return, before any existing JSX, add an early return when `poll.is_paused` is true. Find the opening of the component's return statement and add before it:

```tsx
  if (poll.is_paused) {
    return (
      <div className="card p-10 text-center space-y-2">
        <p className="text-3xl">⏸</p>
        <p className="text-lg font-extrabold text-ink">This poll is paused</p>
        <p className="text-ink-3 text-sm">The admin has temporarily paused submissions.</p>
      </div>
    )
  }
```

- [ ] **Step 3: Add paused card to `VotingPhase`**

Same pattern — add an early return before the component's existing return. In `VotingPhase.tsx`, add after the existing `if (submitted)` block and before the main voting form return:

```tsx
  if (poll.is_paused) {
    return (
      <div className="card p-10 text-center space-y-2">
        <p className="text-3xl">⏸</p>
        <p className="text-lg font-extrabold text-ink">This poll is paused</p>
        <p className="text-ink-3 text-sm">The admin has temporarily paused submissions.</p>
      </div>
    )
  }
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/NominationPhase.tsx frontend/src/components/VotingPhase.tsx
git commit -m "feat: show paused card in nomination and voting phases when poll is paused"
```

---

## Task 6: Run full test suite and push

- [ ] **Step 1: Run all worker tests**

```bash
cd worker
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Build frontend to check for type errors**

```bash
cd frontend
npm run build
```

Expected: no TypeScript errors, build succeeds.

- [ ] **Step 3: Push**

```bash
git push
```
