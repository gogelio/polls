import type { Context, Next } from 'hono'
import type { Env } from '../types'

// Constant-time comparison to prevent timing attacks
function tokensMatch(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const aBytes = encoder.encode(a)
  const bBytes = encoder.encode(b)
  if (aBytes.length !== bBytes.length) return false
  return crypto.subtle.timingSafeEqual(aBytes, bBytes)
}

export async function participantAuth(
  c: Context<{ Bindings: Env; Variables: { participantId: string } }>,
  next: Next
) {
  const token = c.req.header('Participant-Token')
  if (!token) return c.json({ error: 'Missing Participant-Token header' }, 401)

  // Scope to poll when route has an :id param (poll-scoped routes)
  const pollId = c.req.param('id')
  const query = pollId
    ? 'SELECT id FROM participants WHERE token = ? AND poll_id = ?'
    : 'SELECT id FROM participants WHERE token = ?'
  const bindings = pollId ? [token, pollId] : [token]

  const participant = await c.env.DB.prepare(query).bind(...bindings).first<{ id: string }>()

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

  if (tokensMatch(adminToken, poll.admin_token)) {
    await next()
    return
  }

  // Fall back to the admin token of an event this poll is linked to, if any —
  // one event admin token administers every one of its linked category polls,
  // so the operator only ever needs to hand out the single event admin URL.
  const link = await c.env.DB.prepare(
    'SELECT event_id FROM event_polls WHERE poll_id = ?'
  ).bind(pollId).first<{ event_id: string }>()

  if (link) {
    const event = await c.env.DB.prepare(
      'SELECT admin_token FROM events WHERE id = ?'
    ).bind(link.event_id).first<{ admin_token: string }>()
    if (event && tokensMatch(adminToken, event.admin_token)) {
      await next()
      return
    }
  }

  return c.json({ error: 'Invalid admin token' }, 401)
}

export async function eventAdminAuth(
  c: Context<{ Bindings: Env }>,
  next: Next
) {
  const slug = c.req.param('slug')
  const adminToken = c.req.query('admin')
  if (!adminToken) return c.json({ error: 'Missing admin query param' }, 401)

  const event = await c.env.DB.prepare(
    'SELECT admin_token FROM events WHERE id = ?'
  ).bind(slug).first<{ admin_token: string }>()

  if (!event) return c.json({ error: 'Event not found' }, 404)

  if (!tokensMatch(adminToken, event.admin_token)) {
    return c.json({ error: 'Invalid admin token' }, 401)
  }

  await next()
}
