import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import type { Env, Poll } from '../types'
import { participantAuth, adminAuth } from '../middleware/auth'
import { searchTmdbMovies } from '../lib/tmdb'

type Variables = { participantId: string }
export const nominationsRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

nominationsRouter.post('/:id/nominations', participantAuth, async (c) => {
  const pollId = c.req.param('id')
  const participantId = c.get('participantId')

  const poll = await c.env.DB.prepare(
    'SELECT id, phase, max_nominations, nomination_closes_at, is_paused FROM polls WHERE id = ?'
  ).bind(pollId).first<Pick<Poll, 'id' | 'phase' | 'max_nominations' | 'nomination_closes_at' | 'is_paused'>>()
  if (!poll) return c.json({ error: 'Poll not found' }, 404)
  if (poll.is_paused) return c.json({ error: 'Poll is paused' }, 403)
  if (poll.phase !== 'nominating') return c.json({ error: 'Poll is not accepting nominations' }, 400)
  if (poll.nomination_closes_at && Date.now() > poll.nomination_closes_at) {
    return c.json({ error: 'Nomination period has closed' }, 400)
  }

  const countRow = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM nominations WHERE poll_id = ? AND participant_id = ?'
  ).bind(pollId, participantId).first<{ count: number }>()

  if ((countRow?.count ?? 0) >= poll.max_nominations) {
    return c.json({ error: `Maximum of ${poll.max_nominations} nominations reached` }, 400)
  }

  const { title, metadata } = await c.req.json<{ title: string; metadata: unknown }>()
  if (!title?.trim()) return c.json({ error: 'title is required' }, 400)

  const id = nanoid(8)
  await c.env.DB.prepare(
    'INSERT INTO nominations (id, poll_id, participant_id, title, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, pollId, participantId, title.trim(), metadata ? JSON.stringify(metadata) : null, Date.now()).run()

  return c.json({ id }, 201)
})

nominationsRouter.delete('/:id/nominations/:nid', adminAuth, async (c) => {
  const pollId = c.req.param('id')
  const nid = c.req.param('nid')

  const nomination = await c.env.DB.prepare(
    'SELECT id FROM nominations WHERE id = ? AND poll_id = ?'
  ).bind(nid, pollId).first<{ id: string }>()
  if (!nomination) return c.json({ error: 'Nomination not found' }, 404)

  // Cascade the delete to any votes already cast for this nomination — a
  // nomination can be removed after voting has started (e.g. it was found
  // to be a duplicate or a bad TMDB match wasn't fixable), and leaving
  // those rows behind would be silently ignored by scoring but linger as
  // orphaned data.
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM votes WHERE poll_id = ? AND nomination_id = ?').bind(pollId, nid),
    c.env.DB.prepare('DELETE FROM nominations WHERE id = ? AND poll_id = ?').bind(nid, pollId),
  ])
  return c.json({ success: true })
})

nominationsRouter.get('/:id/nominations/search-movies', adminAuth, async (c) => {
  const q = c.req.query('q')?.trim()
  if (!q) return c.json({ error: 'q is required' }, 400)

  try {
    const results = await searchTmdbMovies(c.env.TMDB_API_KEY, q)
    return c.json(results)
  } catch {
    return c.json({ error: 'Movie search failed' }, 502)
  }
})

nominationsRouter.patch('/:id/nominations/:nid', adminAuth, async (c) => {
  const pollId = c.req.param('id')
  const nid = c.req.param('nid')
  const { title, metadata } = await c.req.json<{ title?: string; metadata?: unknown }>()

  if (title !== undefined && !title.trim()) return c.json({ error: 'title cannot be empty' }, 400)

  const fields: string[] = []
  const values: (string | null)[] = []
  if (title !== undefined) { fields.push('title = ?'); values.push(title.trim()) }
  if (metadata !== undefined) { fields.push('metadata = ?'); values.push(metadata ? JSON.stringify(metadata) : null) }
  if (fields.length === 0) return c.json({ error: 'No fields to update' }, 400)

  const result = await c.env.DB.prepare(
    `UPDATE nominations SET ${fields.join(', ')} WHERE id = ? AND poll_id = ?`
  ).bind(...values, nid, pollId).run()

  if (result.meta.changes === 0) return c.json({ error: 'Nomination not found' }, 404)
  return c.json({ success: true })
})
