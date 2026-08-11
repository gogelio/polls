import { Hono } from 'hono'
import type { Env } from '../types'
import { buildPollResponse } from '../lib/pollDetail'
import { plurality, rankedChoice, rankedPairs, computeVoterLuck, type RankedResult, type NominationRow, type VoteRow, type VoterLuck } from '../lib/voting'
import { resolveSlot } from '../lib/bracket'
import { joinOrReclaim } from '../lib/joinOrReclaim'
import { eventAdminAuth, isValidEventAdminToken } from '../middleware/auth'

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
  resultsByCategory: Map<string, RankedResult[]>,
  visibleCategories: Set<string>
) {
  if (!visibleCategories.has(row.category)) {
    return {
      slot_order: row.slot_order,
      category: row.category,
      placement: row.placement,
      status: 'hidden' as const,
      movies: [],
    }
  }
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
  const isEventAdmin = await isValidEventAdminToken(c.env, slug, c.req.query('admin'))

  const categories: Array<{ category: string; sort_order: number; poll: NonNullable<Awaited<ReturnType<typeof buildPollResponse>>> }> = []
  const resultsByCategory = new Map<string, RankedResult[]>()
  // Mirrors GET /polls/:id/results: hidden while voting is in progress and
  // votes_visible is off, unless the requester is the event admin — a
  // closed poll's results are always public, same as everywhere else.
  const visibleCategories = new Set<string>()
  // Each event participant is a separate row per poll (same name, distinct
  // token) — de-dupe by name (case-insensitively) to get a single
  // event-wide voter headcount, computed in one query across all linked
  // polls rather than once per poll.
  const { results: voterRows } = await c.env.DB.prepare(
    `SELECT DISTINCT LOWER(p.name) as name FROM participants p
     JOIN votes v ON v.participant_id = p.id
     JOIN event_polls ep ON ep.poll_id = p.poll_id
     WHERE ep.event_id = ?`
  ).bind(slug).all<{ name: string }>()
  const voterNames = new Set(voterRows.map(v => v.name))

  // Fetch nominations/votes for every category poll in two queries total
  // instead of two-per-category — an 8-category event was previously making
  // ~16 sequential round trips here alone, on top of buildPollResponse's own
  // per-poll queries, which was long enough to occasionally trip the
  // worker's request timeout and fail without ever reaching the CORS
  // middleware (the browser then reports it as a CORS error).
  const pollIds = links.map(link => link.poll_id)
  let nominationsByPoll: Partial<Record<string, (NominationRow & { poll_id: string })[]>> = {}
  let votesByPoll: Partial<Record<string, (VoteRow & { poll_id: string })[]>> = {}
  let participantNamesByPoll: Partial<Record<string, { id: string; poll_id: string; name: string }[]>> = {}
  if (pollIds.length > 0) {
    const placeholders = pollIds.map(() => '?').join(',')
    const [{ results: allNominations }, { results: allVotes }, { results: allParticipants }] = await Promise.all([
      c.env.DB.prepare(
        `SELECT id, poll_id, title, metadata FROM nominations WHERE poll_id IN (${placeholders})`
      ).bind(...pollIds).all<NominationRow & { poll_id: string }>(),
      c.env.DB.prepare(
        `SELECT poll_id, participant_id, nomination_id, rank FROM votes WHERE poll_id IN (${placeholders})`
      ).bind(...pollIds).all<VoteRow & { poll_id: string }>(),
      c.env.DB.prepare(
        `SELECT id, poll_id, name FROM participants WHERE poll_id IN (${placeholders})`
      ).bind(...pollIds).all<{ id: string; poll_id: string; name: string }>(),
    ])
    nominationsByPoll = Object.groupBy(allNominations, n => n.poll_id)
    votesByPoll = Object.groupBy(allVotes, v => v.poll_id)
    participantNamesByPoll = Object.groupBy(allParticipants, p => p.poll_id)
  }

  // Each poll's detail fetch is independent of the others, so run them
  // concurrently rather than awaiting one at a time — the same timeout risk
  // as the N+1 query fix above, just one level up.
  const pollResponses = await Promise.all(
    links.map(link => buildPollResponse(c.env, link.poll_id, tokens.get(link.poll_id) ?? null))
  )
  const luckScoresByName = new Map<string, { displayName: string; scores: number[] }>()

  links.forEach((link, i) => {
    const pollResponse = pollResponses[i]
    if (!pollResponse) return
    categories.push({ category: link.category, sort_order: link.sort_order, poll: pollResponse })
    const isVisible = pollResponse.votes_visible || pollResponse.phase === 'closed' || isEventAdmin
    if (isVisible) visibleCategories.add(link.category)

    const nominations = nominationsByPoll[link.poll_id] ?? []
    const votes = votesByPoll[link.poll_id] ?? []
    resultsByCategory.set(link.category, rankedChoice(votes, nominations))

    if (!isVisible) return
    const categoryResults = pollResponse.voting_method === 'plurality' ? plurality(votes, nominations)
      : pollResponse.voting_method === 'ranked_choice' ? rankedChoice(votes, nominations)
      : rankedPairs(votes, nominations)
    const namesForPoll = participantNamesByPoll[link.poll_id] ?? []
    const nameById = new Map(namesForPoll.map(p => [p.id, p.name]))
    const luck: VoterLuck[] = computeVoterLuck(votes, categoryResults, nameById)
    for (const entry of luck) {
      const key = entry.participant_name.toLowerCase()
      if (!luckScoresByName.has(key)) luckScoresByName.set(key, { displayName: entry.participant_name, scores: [] })
      luckScoresByName.get(key)!.scores.push(entry.score)
    }
  })

  const phase = categories.length > 0 && categories.every(cat => cat.poll.phase === 'closed') ? 'closed' : 'voting'

  let eventVoterStats: {
    luckiest: Array<{ name: string; average_score: number; categories_counted: number }>
    unluckiest: Array<{ name: string; average_score: number; categories_counted: number }>
  } | undefined
  if (phase === 'closed' || isEventAdmin) {
    const averaged = [...luckScoresByName.values()].map(({ displayName, scores }) => ({
      name: displayName,
      average_score: scores.reduce((sum, s) => sum + s, 0) / scores.length,
      categories_counted: scores.length,
    }))
    eventVoterStats = {
      luckiest: [...averaged].sort((a, b) => b.average_score - a.average_score).slice(0, 3),
      unluckiest: [...averaged].sort((a, b) => a.average_score - b.average_score).slice(0, 3),
    }
  }

  const { results: slotRows } = await c.env.DB.prepare(
    'SELECT day, slot_order, category, placement FROM event_slots WHERE event_id = ? ORDER BY slot_order ASC'
  ).bind(slug).all<{ day: string; slot_order: number; category: string; placement: number }>()

  const scheduleByDay = new Map<string, ReturnType<typeof buildSlotPayload>[]>()
  for (const row of slotRows) {
    const slot = buildSlotPayload(row, resultsByCategory, visibleCategories)
    if (!scheduleByDay.has(row.day)) scheduleByDay.set(row.day, [])
    scheduleByDay.get(row.day)!.push(slot)
  }
  const knownDays = DAY_ORDER.filter(day => scheduleByDay.has(day))
  const otherDays = [...scheduleByDay.keys()].filter(day => !DAY_ORDER.includes(day))
  const schedule = [...knownDays, ...otherDays].map(day => ({ day, slots: scheduleByDay.get(day)! }))

  return c.json({
    id: event.id,
    title: event.title,
    is_public: event.is_public === 1,
    phase,
    categories,
    schedule,
    voter_count: voterNames.size,
    created_at: event.created_at,
    voter_stats: eventVoterStats,
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

eventsRouter.patch('/:slug/pause', eventAdminAuth, async (c) => {
  const slug = c.req.param('slug')
  const { results: links } = await c.env.DB.prepare(
    'SELECT poll_id FROM event_polls WHERE event_id = ?'
  ).bind(slug).all<{ poll_id: string }>()
  if (links.length === 0) return c.json({ error: 'Event not found' }, 404)

  const firstPoll = await c.env.DB.prepare('SELECT is_paused FROM polls WHERE id = ?')
    .bind(links[0]!.poll_id).first<{ is_paused: number }>()
  const newValue = firstPoll?.is_paused === 1 ? 0 : 1

  await c.env.DB.batch(
    links.map(link => c.env.DB.prepare('UPDATE polls SET is_paused = ? WHERE id = ?').bind(newValue, link.poll_id))
  )

  return c.json({ is_paused: newValue === 1 })
})

eventsRouter.patch('/:slug/votes-visible', eventAdminAuth, async (c) => {
  const slug = c.req.param('slug')
  const { results: links } = await c.env.DB.prepare(
    'SELECT poll_id FROM event_polls WHERE event_id = ?'
  ).bind(slug).all<{ poll_id: string }>()
  if (links.length === 0) return c.json({ error: 'Event not found' }, 404)

  const firstPoll = await c.env.DB.prepare('SELECT votes_visible FROM polls WHERE id = ?')
    .bind(links[0]!.poll_id).first<{ votes_visible: number }>()
  const newValue = firstPoll?.votes_visible === 1 ? 0 : 1

  await c.env.DB.batch(
    links.map(link => c.env.DB.prepare('UPDATE polls SET votes_visible = ? WHERE id = ?').bind(newValue, link.poll_id))
  )

  return c.json({ votes_visible: newValue === 1 })
})

eventsRouter.delete('/:slug', eventAdminAuth, async (c) => {
  const slug = c.req.param('slug')
  const { results: links } = await c.env.DB.prepare(
    'SELECT poll_id FROM event_polls WHERE event_id = ?'
  ).bind(slug).all<{ poll_id: string }>()
  if (links.length === 0) return c.json({ error: 'Event not found' }, 404)

  const statements = []
  for (const link of links) {
    statements.push(c.env.DB.prepare('DELETE FROM votes WHERE poll_id = ?').bind(link.poll_id))
    statements.push(c.env.DB.prepare('DELETE FROM nominations WHERE poll_id = ?').bind(link.poll_id))
    statements.push(c.env.DB.prepare('DELETE FROM participants WHERE poll_id = ?').bind(link.poll_id))
  }
  statements.push(c.env.DB.prepare('DELETE FROM event_slots WHERE event_id = ?').bind(slug))
  statements.push(c.env.DB.prepare('DELETE FROM event_polls WHERE event_id = ?').bind(slug))
  for (const link of links) {
    statements.push(c.env.DB.prepare('DELETE FROM polls WHERE id = ?').bind(link.poll_id))
  }
  statements.push(c.env.DB.prepare('DELETE FROM events WHERE id = ?').bind(slug))

  await c.env.DB.batch(statements)
  return c.json({ ok: true })
})
