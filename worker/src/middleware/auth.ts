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
    'SELECT admin_token FROM polls WHERE id = ?'
  ).bind(pollId).first<{ admin_token: string }>()

  if (!poll) return c.json({ error: 'Poll not found' }, 404)

  // Constant-time comparison to prevent timing attacks
  const encoder = new TextEncoder()
  const a = encoder.encode(adminToken)
  const b = encoder.encode(poll.admin_token)
  if (a.length !== b.length) return c.json({ error: 'Invalid admin token' }, 401)
  const equal = crypto.subtle.timingSafeEqual(a, b)
  if (!equal) return c.json({ error: 'Invalid admin token' }, 401)

  await next()
}
