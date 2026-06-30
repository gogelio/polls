import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import type { Env, Participant } from '../types'

export const participantsRouter = new Hono<{ Bindings: Env }>()

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
