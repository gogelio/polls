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

pollsRouter.get('/', async (c) => {
  const { results: open } = await c.env.DB.prepare(
    `SELECT id, title, category, phase, nomination_closes_at, created_at,
       (SELECT COUNT(*) FROM participants WHERE poll_id = polls.id) as participant_count
     FROM polls WHERE is_public = 1 AND phase != 'closed' ORDER BY created_at DESC`
  ).all<{ id: string; title: string; category: string; phase: string; nomination_closes_at: number | null; created_at: number; participant_count: number }>()

  const { results: closed } = await c.env.DB.prepare(
    `SELECT id, title, category, phase, nomination_closes_at, created_at,
       (SELECT COUNT(*) FROM participants WHERE poll_id = polls.id) as participant_count
     FROM polls WHERE is_public = 1 AND phase = 'closed' ORDER BY created_at DESC LIMIT 3`
  ).all<{ id: string; title: string; category: string; phase: string; nomination_closes_at: number | null; created_at: number; participant_count: number }>()

  return c.json([...open, ...closed])
})

pollsRouter.post('/', async (c) => {
  try {
    const body = await c.req.json<{
      title: string
      category: string
      voting_method: string
      max_nominations: number
      nominations_visible: boolean
      votes_visible: boolean
      is_public: boolean
      nomination_closes_at: number | null
    }>()

    if (!body.title?.trim()) return c.json({ error: 'title is required' }, 400)
    const VALID_CATEGORIES = ['book', 'movie', 'general']
    const VALID_METHODS = ['plurality', 'ranked_choice', 'ranked_pairs']
    if (!VALID_CATEGORIES.includes(body.category)) return c.json({ error: 'invalid category' }, 400)
    if (!VALID_METHODS.includes(body.voting_method)) return c.json({ error: 'invalid voting_method' }, 400)
    if (!body.max_nominations || body.max_nominations < 1) return c.json({ error: 'max_nominations must be >= 1' }, 400)

    const id = nanoid(8)
    const adminToken = nanoid(24)
    const now = Date.now()
    const isPublic = body.is_public !== false

    await c.env.DB.prepare(
      `INSERT INTO polls (id, admin_token, title, category, voting_method, max_nominations,
        nominations_visible, votes_visible, is_public, nomination_closes_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, adminToken, body.title, body.category, body.voting_method,
      body.max_nominations, body.nominations_visible ? 1 : 0,
      body.votes_visible ? 1 : 0,
      isPublic ? 1 : 0,
      // nomination_closes_at is stored as Unix timestamp in milliseconds
      body.nomination_closes_at ?? null,
      now
    ).run()

    const base = new URL(c.req.url).origin
    return c.json({
      id,
      admin_token: adminToken,
      participant_url: `${base}/p/${id}`,
      admin_url: `${base}/p/${id}?admin=${adminToken}`,
    }, 201)
  } catch (e) {
    if (e instanceof SyntaxError) return c.json({ error: 'Invalid JSON body' }, 400)
    throw e
  }
})

pollsRouter.get('/:id', async (c) => {
  const id = c.req.param('id')
  let poll = await c.env.DB.prepare(
    'SELECT id, title, category, voting_method, phase, max_nominations, nominations_visible, votes_visible, is_public, nomination_closes_at, created_at FROM polls WHERE id = ?'
  ).bind(id).first<Poll>()
  if (!poll) return c.json({ error: 'Poll not found' }, 404)

  // Auto-advance phase if nomination timer has expired
  if (poll.phase === 'nominating' && poll.nomination_closes_at && Date.now() > poll.nomination_closes_at) {
    await c.env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ? AND phase = 'nominating'").bind(id).run()
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
    is_public: poll.is_public === 1,
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
