import type { Context, Next } from 'hono'
import type { Env } from '../types'

export async function participantAuth(
  c: Context<{ Bindings: Env; Variables: { participantId: string } }>,
  next: Next
) {
  const token = c.req.header('Participant-Token')
  if (!token) return c.json({ error: 'Missing Participant-Token header' }, 401)

  const participant = await c.env.DB.prepare(
    'SELECT id FROM participants WHERE token = ?'
  ).bind(token).first<{ id: string }>()

  if (!participant) return c.json({ error: 'Invalid participant token' }, 401)

  c.set('participantId', participant.id)
  await next()
}

export async function adminAuth(
  c: Context<{ Bindings: Env }>,
  next: Next
) {
  const pollId = c.req.param('id')
  const adminToken = c.req.query('admin')
  if (!adminToken) return c.json({ error: 'Missing admin query param' }, 401)

  const poll = await c.env.DB.prepare(
    'SELECT id FROM polls WHERE id = ? AND admin_token = ?'
  ).bind(pollId, adminToken).first()

  if (!poll) return c.json({ error: 'Invalid admin token' }, 401)

  await next()
}
