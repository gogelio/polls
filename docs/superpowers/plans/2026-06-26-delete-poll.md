# Delete Poll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow poll admins to permanently delete a poll from the admin panel, with a two-step confirmation and a 10-second countdown redirect to home.

**Architecture:** A new `DELETE /polls/:id` route on the worker handles hard deletion (votes → nominations → participants → polls, no cascade). The frontend adds a `'deleting'` and `'deleted'` mode to `AdminControls`, wired to a new `onDeleted` prop that `PollPage` uses to call `navigate('/')`.

**Tech Stack:** Hono 4 (worker routes), Cloudflare D1 (database), React 18, TypeScript, Tailwind CSS 3, Vitest + `@cloudflare/vitest-pool-workers` (worker tests)

## Global Constraints

- Worker tests run inside the actual Workers runtime via `@cloudflare/vitest-pool-workers`; each test file calls `applySchema()` in `beforeEach`
- `adminAuth` middleware reads `?admin=` query param and uses constant-time comparison — always use it for admin-only routes
- D1 has no `ON DELETE CASCADE` — always delete child rows manually before deleting the parent poll
- Delete order: `votes` → `nominations` → `participants` → `polls`
- Frontend API base URL comes from `import.meta.env.VITE_API_URL ?? '/api'`

---

## File Map

| File | Change |
|------|--------|
| `worker/src/routes/polls.ts` | Add `DELETE /:id` route |
| `worker/test/polls.test.ts` | Add tests for `DELETE /polls/:id` |
| `frontend/src/api/client.ts` | Add `deletePoll` method |
| `frontend/src/components/AdminControls.tsx` | Add `'deleting'` and `'deleted'` modes, `onDeleted` prop |
| `frontend/src/pages/PollPage.tsx` | Pass `onDeleted` to `<AdminControls />` |

---

## Task 1: Backend — `DELETE /polls/:id` route

**Files:**
- Modify: `worker/src/routes/polls.ts`
- Test: `worker/test/polls.test.ts`

**Interfaces:**
- Produces: `DELETE /polls/:id?admin=<token>` → `{ ok: true }` (200) or `{ error: "Poll not found" }` (404) or `{ error: "Unauthorized" }` (401)

- [ ] **Step 1: Write the failing tests**

Append this `describe` block to `worker/test/polls.test.ts`:

```ts
describe('DELETE /polls/:id', () => {
  beforeEach(applySchema)

  it('deletes the poll and all child rows with valid admin token', async () => {
    const { id, adminToken } = await seedPoll()
    const { id: participantId } = await seedParticipant(id)
    await seedNomination(id, participantId)

    const res = await SELF.fetch(`http://example.com/polls/${id}?admin=${adminToken}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.ok).toBe(true)

    // Poll is gone
    const gone = await SELF.fetch(`http://example.com/polls/${id}`)
    expect(gone.status).toBe(404)
  })

  it('returns 404 for unknown poll', async () => {
    const res = await SELF.fetch('http://example.com/polls/notreal?admin=sometoken', {
      method: 'DELETE',
    })
    expect(res.status).toBe(404)
  })

  it('returns 401 with wrong admin token', async () => {
    const { id } = await seedPoll()
    const res = await SELF.fetch(`http://example.com/polls/${id}?admin=wrongtoken`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd worker && npx vitest run test/polls.test.ts
```

Expected: the three new tests FAIL with "Not Found" or similar — the route does not exist yet.

- [ ] **Step 3: Add the `DELETE /:id` route to `worker/src/routes/polls.ts`**

Add this block at the end of `worker/src/routes/polls.ts`, before the final closing of the file:

```ts
pollsRouter.delete('/:id', adminAuth, async (c) => {
  const id = c.req.param('id')

  const poll = await c.env.DB.prepare('SELECT id FROM polls WHERE id = ?').bind(id).first<{ id: string }>()
  if (!poll) return c.json({ error: 'Poll not found' }, 404)

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM votes WHERE poll_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM nominations WHERE poll_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM participants WHERE poll_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM polls WHERE id = ?').bind(id),
  ])

  return c.json({ ok: true })
})
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd worker && npx vitest run test/polls.test.ts
```

Expected: all tests in the file PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/polls.ts worker/test/polls.test.ts
git commit -m "feat: add DELETE /polls/:id endpoint"
```

---

## Task 2: Frontend — `api.deletePoll` + `AdminControls` delete flow + `PollPage` wiring

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/components/AdminControls.tsx`
- Modify: `frontend/src/pages/PollPage.tsx`

**Interfaces:**
- Consumes: `DELETE /polls/:id?admin=<token>` from Task 1
- Produces:
  - `api.deletePoll(pollId: string, adminToken: string): Promise<void>`
  - `<AdminControls poll={...} adminToken={...} onRefetch={...} onDeleted={...} />`

- [ ] **Step 1: Add `deletePoll` to `frontend/src/api/client.ts`**

Add this method to the `api` object, after `updatePoll`:

```ts
  deletePoll: async (pollId: string, adminToken: string): Promise<void> => {
    await throwIfError(await fetch(`${BASE}/polls/${pollId}?admin=${adminToken}`, {
      method: 'DELETE',
    }))
  },
```

- [ ] **Step 2: Update `AdminControls` — extend `Mode` type and add `onDeleted` prop**

In `frontend/src/components/AdminControls.tsx`:

Replace the `Mode` type:
```ts
type Mode = 'default' | 'editing' | 'confirming' | 'deleting' | 'deleted'
```

Replace the `AdminControlsProps` interface:
```ts
interface AdminControlsProps {
  poll: Poll
  adminToken: string
  onRefetch: () => void
  onDeleted: () => void
}
```

Replace the destructure line in the function signature:
```ts
export function AdminControls({ poll, adminToken, onRefetch, onDeleted }: AdminControlsProps) {
```

- [ ] **Step 3: Add `countdown` state and `useEffect` for the `'deleted'` mode**

Add these two lines after the existing `useState` declarations (after `const [error, setError] = useState<string | null>(null)`):

```ts
  const [countdown, setCountdown] = useState(10)
```

Add this `useEffect` after all the existing handler functions (after `transitionPhase`), before the `isWide` calculation:

```ts
  useEffect(() => {
    if (mode !== 'deleted') return
    setCountdown(10)
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(interval)
          onDeleted()
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [mode])
```

- [ ] **Step 4: Update `isWide` to include the new modes**

Replace:
```ts
  const isWide = mode === 'editing' || mode === 'confirming'
```
With:
```ts
  const isWide = mode === 'editing' || mode === 'confirming' || mode === 'deleting' || mode === 'deleted'
```

- [ ] **Step 5: Add "Delete poll" button to default mode**

In the `{mode === 'default'}` block, add this button after the "Edit poll" button:

```tsx
          <button
            onClick={() => { setError(null); setMode('deleting') }}
            className="w-full text-xs text-ink-3 hover:text-danger transition-colors text-center py-1"
          >
            Delete poll
          </button>
```

- [ ] **Step 6: Add `'deleting'` mode UI**

After the closing `}` of the `{/* Editing mode */}` block and before the `{/* Confirming mode */}` block, add:

```tsx
      {/* Deleting mode */}
      {mode === 'deleting' && (
        <>
          <p className="text-xs font-semibold text-ink">Delete this poll?</p>
          <p className="text-xs text-ink-3">This cannot be undone. All nominations and votes will be permanently deleted.</p>
          <div className="flex gap-2 pt-1">
            <button
              disabled={loading}
              onClick={() => { setError(null); setMode('default') }}
              className="flex-1 text-xs text-ink-3 hover:text-ink border border-line rounded-xl py-2 transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              disabled={loading}
              onClick={async () => {
                setLoading(true)
                setError(null)
                try {
                  await api.deletePoll(poll.id, adminToken)
                  setMode('deleted')
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Failed to delete poll')
                } finally {
                  setLoading(false)
                }
              }}
              className="flex-1 bg-danger text-white text-xs font-semibold py-2 rounded-xl transition-colors disabled:opacity-40 hover:opacity-90"
            >
              Delete
            </button>
          </div>
        </>
      )}
```

- [ ] **Step 7: Add `'deleted'` mode UI**

After the closing `}` of the `{/* Confirming mode */}` block, add:

```tsx
      {/* Deleted mode */}
      {mode === 'deleted' && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-ink">Poll deleted.</p>
          <p className="text-xs text-ink-3">Redirecting in {countdown}s…</p>
        </div>
      )}
```

- [ ] **Step 8: Wire `onDeleted` in `PollPage.tsx`**

In `frontend/src/pages/PollPage.tsx`, add `useNavigate` to the React Router import. The existing import is:
```ts
import { useParams, useSearchParams, Navigate } from 'react-router-dom'
```
Replace with:
```ts
import { useParams, useSearchParams, Navigate, useNavigate } from 'react-router-dom'
```

Add `useNavigate` inside the `PollPage` function, after `const [searchParams] = useSearchParams()`:
```ts
  const navigate = useNavigate()
```

Find the `<AdminControls ... />` JSX. It currently looks like:
```tsx
        <AdminControls
          poll={poll}
          adminToken={adminToken}
          onRefetch={refetch}
        />
```
Replace with:
```tsx
        <AdminControls
          poll={poll}
          adminToken={adminToken}
          onRefetch={refetch}
          onDeleted={() => navigate('/')}
        />
```

- [ ] **Step 9: Verify TypeScript compiles**

```bash
cd frontend && npm run build
```

Expected: exits 0 with no TypeScript errors.

- [ ] **Step 10: Manual smoke test**

1. Start both servers: `cd worker && npm run dev` and `cd frontend && npm run dev`
2. Create a poll, copy the admin URL
3. Open the admin URL in a browser
4. In the Admin panel, click "Delete poll" — confirm the warning panel appears
5. Click "Delete" — confirm the "Poll deleted. Redirecting in 10s…" countdown appears and counts down
6. Confirm automatic redirect to home after 10 seconds
7. Confirm the poll URL returns 404 if revisited

- [ ] **Step 11: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/components/AdminControls.tsx frontend/src/pages/PollPage.tsx
git commit -m "feat: add delete poll flow with confirmation and countdown redirect"
```
