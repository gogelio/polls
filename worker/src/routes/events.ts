import { Hono } from 'hono'
import type { Env } from '../types'
import { buildPollResponse } from '../lib/pollDetail'
import { rankedChoice, type RankedResult, type NominationRow, type VoteRow } from '../lib/voting'
import { resolveSlot } from '../lib/bracket'
import { joinOrReclaim } from '../lib/joinOrReclaim'
import { eventAdminAuth } from '../middleware/auth'

export const eventsRouter = new Hono<{ Bindings: Env }>()

const DAY_ORDER = ['Thursday', 'Friday', 'Saturday']

function parseTokenHeader(header: string | undefined): Map<string, string> {
  const map = new Map<string, string>()
  if (!header) return map
  for (const pair of header.split(',')) {
    const [pollId, token] = pair.split(':')
    if (pollId && token) map.set(pollId, token)
  }
  return map
}

function buildSlotPayload(
  row: { day: string; slot_order: number; category: string; placement: number },
  resultsByCategory: Map<string, RankedResult[]>
) {
  const results = resultsByCategory.get(row.category) ?? []
  const resolved = resolveSlot(results, row.placement === 2 ? 2 : 1)
  return {
    slot_order: row.slot_order,
    category: row.category,
    placement: row.placement,
    status: resolved.status,
    movies: resolved.movies,
  }
}

eventsRouter.get('/:slug', async (c) => {
  const slug = c.req.param('slug')
  const event = await c.env.DB.prepare(
    'SELECT id, title, is_public, created_at FROM events WHERE id = ?'
  ).bind(slug).first<{ id: string; title: string; is_public: number; created_at: number }>()
  if (!event) return c.json({ error: 'Event not found' }, 404)

  const { results: links } = await c.env.DB.prepare(
    'SELECT poll_id, category, sort_order FROM event_polls WHERE event_id = ? ORDER BY sort_order ASC'
  ).bind(slug).all<{ poll_id: string; category: string; sort_order: number }>()

  const tokens = parseTokenHeader(c.req.header('Participant-Tokens'))

  const categories: Array<{ category: string; sort_order: number; poll: NonNullable<Awaited<ReturnType<typeof buildPollResponse>>> }> = []
  const resultsByCategory = new Map<string, RankedResult[]>()

  for (const link of links) {
    const pollResponse = await buildPollResponse(c.env, link.poll_id, tokens.get(link.poll_id) ?? null)
    if (!pollResponse) continue
    categories.push({ category: link.category, sort_order: link.sort_order, poll: pollResponse })

    const { results: nominations } = await c.env.DB.prepare(
      'SELECT id, title, metadata FROM nominations WHERE poll_id = ?'
    ).bind(link.poll_id).all<NominationRow>()
    const { results: votes } = await c.env.DB.prepare(
      'SELECT participant_id, nomination_id, rank FROM votes WHERE poll_id = ?'
    ).bind(link.poll_id).all<VoteRow>()
    resultsByCategory.set(link.category, rankedChoice(votes, nominations))
  }

  const phase = categories.length > 0 && categories.every(cat => cat.poll.phase === 'closed') ? 'closed' : 'voting'

  const { results: slotRows } = await c.env.DB.prepare(
    'SELECT day, slot_order, category, placement FROM event_slots WHERE event_id = ? ORDER BY slot_order ASC'
  ).bind(slug).all<{ day: string; slot_order: number; category: string; placement: number }>()

  const scheduleByDay = new Map<string, ReturnType<typeof buildSlotPayload>[]>()
  for (const row of slotRows) {
    const slot = buildSlotPayload(row, resultsByCategory)
    if (!scheduleByDay.has(row.day)) scheduleByDay.set(row.day, [])
    scheduleByDay.get(row.day)!.push(slot)
  }
  const schedule = DAY_ORDER
    .filter(day => scheduleByDay.has(day))
    .map(day => ({ day, slots: scheduleByDay.get(day)! }))

  return c.json({
    id: event.id,
    title: event.title,
    is_public: event.is_public === 1,
    phase,
    categories,
    schedule,
    created_at: event.created_at,
  })
})

eventsRouter.post('/:slug/join', async (c) => {
  const slug = c.req.param('slug')
  const body = await c.req.json<{ name?: string }>()
  const name = (body.name ?? '').trim()
  if (!name) return c.json({ error: 'name is required' }, 400)

  const { results: links } = await c.env.DB.prepare(
    'SELECT poll_id FROM event_polls WHERE event_id = ?'
  ).bind(slug).all<{ poll_id: string }>()
  if (links.length === 0) return c.json({ error: 'Event not found' }, 404)

  const participants: Array<{ poll_id: string; participant_id: string; token: string }> = []
  let anyRejoined = false

  for (const link of links) {
    const result = await joinOrReclaim(c.env, link.poll_id, name, null)
    if ('error' in result) return c.json({ error: result.error }, 500)
    if (result.rejoined) anyRejoined = true
    participants.push({ poll_id: link.poll_id, participant_id: result.participant_id, token: result.token })
  }

  return c.json({ name, rejoined: anyRejoined, participants })
})

eventsRouter.patch('/:slug/phase', eventAdminAuth, async (c) => {
  const slug = c.req.param('slug')
  const { phase } = await c.req.json<{ phase: string }>()
  if (phase !== 'closed') return c.json({ error: 'Only transition to closed is supported' }, 400)

  const { results: links } = await c.env.DB.prepare(
    'SELECT poll_id FROM event_polls WHERE event_id = ?'
  ).bind(slug).all<{ poll_id: string }>()

  await c.env.DB.batch(
    links.map(link =>
      c.env.DB.prepare("UPDATE polls SET phase = 'closed' WHERE id = ? AND phase = 'voting'").bind(link.poll_id)
    )
  )

  return c.json({ phase: 'closed' })
})
