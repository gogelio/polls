import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import type { Env, Poll } from '../types'
import { participantAuth, adminAuth } from '../middleware/auth'

type Variables = { participantId: string }
export const nominationsRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

nominationsRouter.post('/:id/nominations', participantAuth, async (c) => {
  const pollId = c.req.param('id')
  const participantId = c.get('participantId')

  const poll = await c.env.DB.prepare(
    'SELECT id, phase, max_nominations, nomination_closes_at FROM polls WHERE id = ?'
  ).bind(pollId).first<Pick<Poll, 'id' | 'phase' | 'max_nominations' | 'nomination_closes_at'>>()
  if (!poll) return c.json({ error: 'Poll not found' }, 404)
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
  const result = await c.env.DB.prepare(
    'DELETE FROM nominations WHERE id = ? AND poll_id = ?'
  ).bind(nid, pollId).run()
  if (result.meta.changes === 0) return c.json({ error: 'Nomination not found' }, 404)
  return c.json({ success: true })
})
