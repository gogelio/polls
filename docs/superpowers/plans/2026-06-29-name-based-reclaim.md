# Name-Based Session Reclaim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to reclaim their poll session on a new device by entering the same name they used originally — no token required.

**Architecture:** The join endpoint gains a name-lookup fallback: if no valid token is present and the supplied name matches an existing participant, return that participant's token instead of a 409. The response gains a `rejoined` boolean so the frontend can show a "Welcome back" banner. All other join paths are unchanged.

**Tech Stack:** Cloudflare Workers (Hono 4), D1 (SQLite), React 18, TypeScript, Vitest (workers pool)

## Global Constraints

- Worker tests run via `@cloudflare/vitest-pool-workers`; run them with `cd worker && npm test`
- Test files call `applySchema()` in `beforeEach` — keep this pattern in new tests
- Name comparison is case-insensitive (`LOWER(name) = LOWER(?)`) — maintain this
- Never introduce a breaking change to the existing 200/201 status semantics

---

### Task 1: Backend — name-based reclaim in join endpoint + tests

**Files:**
- Modify: `worker/src/routes/participants.ts`
- Modify: `worker/test/participants.test.ts`

**Interfaces:**
- Produces: `POST /polls/:id/join` response shape gains `rejoined: boolean`
  - New participant → status 201, `{ participant_id, token, name, rejoined: false }`
  - Reclaimed session → status 200, `{ participant_id, token, name, rejoined: true }`
  - Existing token → status 200, `{ participant_id, token, name, rejoined: false }` (unchanged)

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe('POST /polls/:id/join', ...)` block in `worker/test/participants.test.ts`:

```typescript
it('reclaims existing participant by name when no token provided', async () => {
  const { id } = await seedPoll()
  const { token } = await seedParticipant(id, 'Alice')
  const res = await SELF.fetch(`http://example.com/polls/${id}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Alice' }),
  })
  expect(res.status).toBe(200)
  const body = await res.json() as Record<string, unknown>
  expect(body.token).toBe(token)
  expect(body.rejoined).toBe(true)
  expect(body.name).toBe('Alice')
})
```

Also update the existing "creates a participant" test to assert `rejoined: false`:

```typescript
it('creates a participant and returns a token', async () => {
  const { id } = await seedPoll()
  const res = await SELF.fetch(`http://example.com/polls/${id}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Alice' }),
  })
  expect(res.status).toBe(201)
  const body = await res.json() as Record<string, unknown>
  expect(body.participant_id).toBeTruthy()
  expect(body.token).toBeTruthy()
  expect(body.name).toBe('Alice')
  expect(body.rejoined).toBe(false)
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd worker && npx vitest run test/participants.test.ts
```

Expected: the new reclaim test fails ("rejoined" not present / status 409), and the existing test fails ("rejoined" not present).

- [ ] **Step 3: Update the join handler**

Replace the join handler in `worker/src/routes/participants.ts` with:

```typescript
participantsRouter.post('/:id/join', async (c) => {
  const pollId = c.req.param('id')
  const existingToken = c.req.header('Participant-Token')

  // Return existing participant if token provided and valid
  if (existingToken) {
    const existing = await c.env.DB.prepare(
      'SELECT * FROM participants WHERE token = ? AND poll_id = ?'
    ).bind(existingToken, pollId).first<Participant>()
    if (existing) {
      return c.json({ participant_id: existing.id, token: existing.token, name: existing.name, rejoined: false })
    }
    // Token not found for this poll — fall through to name-based reclaim
  }

  const body = await c.req.json<{ name?: string }>()
  const name = body.name?.trim()

  // Name-based reclaim: no valid token, but name matches an existing participant
  if (name) {
    const byName = await c.env.DB.prepare(
      'SELECT * FROM participants WHERE poll_id = ? AND LOWER(name) = LOWER(?)'
    ).bind(pollId, name).first<Participant>()
    if (byName) {
      return c.json({ participant_id: byName.id, token: byName.token, name: byName.name, rejoined: true })
    }
  }

  if (!name) return c.json({ error: 'name is required' }, 400)

  const poll = await c.env.DB.prepare('SELECT id FROM polls WHERE id = ?').bind(pollId).first()
  if (!poll) return c.json({ error: 'Poll not found' }, 404)

  const id = nanoid(8)
  const token = nanoid(24)
  await c.env.DB.prepare(
    'INSERT INTO participants (id, poll_id, name, token, joined_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, pollId, name, token, Date.now()).run()

  return c.json({ participant_id: id, token, name, rejoined: false }, 201)
})
```

Note: the original handler had a redundant `nameTaken` check before inserting — this is removed because the name-based reclaim above already handles the taken-name case (returns the existing participant). A truly duplicate insert would fail on the `UNIQUE` constraint on `token` anyway, and the name column has no unique constraint.

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd worker && npx vitest run test/participants.test.ts
```

Expected: all tests in the file pass.

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/participants.ts worker/test/participants.test.ts
git commit -m "feat: reclaim participant session by name when no token present"
```

---

### Task 2: Frontend — expose rejoined flag and show welcome-back banner

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/pages/PollPage.tsx`

**Interfaces:**
- Consumes: `POST /polls/:id/join` response with `rejoined: boolean` (from Task 1)

- [ ] **Step 1: Update joinPoll return type in api/client.ts**

In `frontend/src/api/client.ts`, find the `joinPoll` function and update the cast on the json response:

```typescript
// Before:
const data = await res.json() as { participant_id: string; token: string; name: string }

// After:
const data = await res.json() as { participant_id: string; token: string; name: string; rejoined: boolean }
```

And update the return statement so `rejoined` is passed through:

```typescript
setToken(pollId, data.token)
return data
```

No change needed to `return data` — it already returns the full object. Only the type cast above needs updating.

- [ ] **Step 2: Add welcomeBack state and banner in PollPage.tsx**

Open `frontend/src/pages/PollPage.tsx`.

Add `welcomeBack` state alongside the existing state declarations (around line 33):

```typescript
const [welcomeBack, setWelcomeBack] = useState(false)
```

In `handleJoin`, after setting `participantId` and `joinedName`, add the rejoined check:

```typescript
const handleJoin = async (e: React.FormEvent) => {
  e.preventDefault()
  if (!participantName.trim() || !id) return
  setJoining(true)
  setJoinError(null)
  try {
    const data = await api.joinPoll(id, participantName.trim())
    setParticipantId(data.participant_id)
    setJoinedName(data.name)
    if (data.rejoined) setWelcomeBack(true)
  } catch (e) {
    setJoinError(e instanceof Error ? e.message : 'Failed to join')
  } finally {
    setJoining(false)
  }
}
```

Add a `useEffect` to auto-dismiss the banner after 4 seconds (place it alongside the other `useEffect` hooks):

```typescript
useEffect(() => {
  if (!welcomeBack) return
  const t = setTimeout(() => setWelcomeBack(false), 4000)
  return () => clearTimeout(t)
}, [welcomeBack])
```

Add the banner to the main poll view (the final `return` block, just before the `poll.phase === 'nominating'` check, around line 164):

```tsx
return (
  <div className="max-w-lg mx-auto py-8 px-4 space-y-4">
    {pollHeader}

    {welcomeBack && (
      <div className="card px-5 py-3 text-sm text-success bg-[oklch(68%_0.18_145_/_0.08)] border border-[oklch(68%_0.18_145_/_0.2)]">
        Welcome back, {joinedName}!
      </div>
    )}

    {poll.phase === 'nominating' && (
      <NominationPhase ... />
    )}
    {/* rest unchanged */}
  </div>
)
```

- [ ] **Step 3: Verify frontend builds without type errors**

```bash
cd frontend && npm run build
```

Expected: exits 0 with no TypeScript errors.

- [ ] **Step 4: Smoke test manually**

Start both servers:
```bash
# Terminal 1
cd worker && npm run dev

# Terminal 2
cd frontend && npm run dev
```

1. Open `http://localhost:5173`, create or open a poll.
2. Join as "TestUser" in one browser tab — note the URL's poll ID.
3. Open an incognito window, navigate to the same poll URL.
4. Join as "TestUser" — you should see "Welcome back, TestUser!" and land in the same participant session (same nominations visible, etc.).
5. Banner should disappear after ~4 seconds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/pages/PollPage.tsx
git commit -m "feat: show welcome-back banner when session reclaimed by name"
```
