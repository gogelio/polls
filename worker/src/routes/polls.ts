import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import type { Env, Poll, Phase } from '../types'
import { adminAuth } from '../middleware/auth'

export const pollsRouter = new Hono<{ Bindings: Env }>()

const VALID_TRANSITIONS: Record<Phase, Phase | null> = {
  nominating: 'voting',
  voting: 'closed',
  closed: null,
}

pollsRouter.post('/', async (c) => {
  const body = await c.req.json<{
    title: string
    category: string
    voting_method: string
    max_nominations: number
    nominations_visible: boolean
    votes_visible: boolean
    nomination_closes_at: number | null
  }>()

  const id = nanoid(8)
  const adminToken = nanoid(24)
  const now = Date.now()

  await c.env.DB.prepare(
    `INSERT INTO polls (id, admin_token, title, category, voting_method, max_nominations,
      nominations_visible, votes_visible, nomination_closes_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, adminToken, body.title, body.category, body.voting_method,
    body.max_nominations, body.nominations_visible ? 1 : 0,
    body.votes_visible ? 1 : 0, body.nomination_closes_at ?? null, now
  ).run()

  const base = new URL(c.req.url).origin
  return c.json({
    id,
    admin_token: adminToken,
    participant_url: `${base}/p/${id}`,
    admin_url: `${base}/p/${id}?admin=${adminToken}`,
  }, 201)
})

pollsRouter.get('/:id', async (c) => {
  const id = c.req.param('id')
  let poll = await c.env.DB.prepare('SELECT * FROM polls WHERE id = ?').bind(id).first<Poll>()
  if (!poll) return c.json({ error: 'Poll not found' }, 404)

  // Auto-advance phase if nomination timer has expired
  if (poll.phase === 'nominating' && poll.nomination_closes_at && Date.now() > poll.nomination_closes_at) {
    await c.env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    poll = { ...poll, phase: 'voting' }
  }

  const showNominations = poll.phase !== 'nominating' || poll.nominations_visible === 1
  let nominations = null

  if (showNominations) {
    const { results } = await c.env.DB.prepare(
      `SELECT n.id, n.title, n.metadata, p.name as participant_name, n.created_at
       FROM nominations n JOIN participants p ON n.participant_id = p.id
       WHERE n.poll_id = ? ORDER BY n.created_at ASC`
    ).bind(id).all()
    nominations = results
  }

  const participantCountRow = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM participants WHERE poll_id = ?'
  ).bind(id).first<{ count: number }>()

  return c.json({
    id: poll.id,
    title: poll.title,
    category: poll.category,
    voting_method: poll.voting_method,
    phase: poll.phase,
    max_nominations: poll.max_nominations,
    nominations_visible: poll.nominations_visible === 1,
    votes_visible: poll.votes_visible === 1,
    nomination_closes_at: poll.nomination_closes_at,
    nominations,
    participant_count: participantCountRow?.count ?? 0,
    created_at: poll.created_at,
  })
})

pollsRouter.patch('/:id/phase', adminAuth, async (c) => {
  const id = c.req.param('id')
  const { phase: nextPhase } = await c.req.json<{ phase: Phase }>()

  const poll = await c.env.DB.prepare('SELECT phase FROM polls WHERE id = ?').bind(id).first<{ phase: Phase }>()
  if (!poll) return c.json({ error: 'Poll not found' }, 404)

  if (VALID_TRANSITIONS[poll.phase] !== nextPhase) {
    return c.json({ error: `Cannot transition from ${poll.phase} to ${nextPhase}` }, 400)
  }

  await c.env.DB.prepare('UPDATE polls SET phase = ? WHERE id = ?').bind(nextPhase, id).run()
  return c.json({ phase: nextPhase })
})
