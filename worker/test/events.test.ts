import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env } from 'cloudflare:test'
import {
  applySchema, seedPoll, seedParticipant, seedNomination,
  seedEvent, seedEventPoll, seedEventSlot,
} from './helpers'

describe('GET /events/:slug', () => {
  beforeEach(applySchema)

  it('returns 404 for unknown slug', async () => {
    const res = await SELF.fetch('http://example.com/events/nope')
    expect(res.status).toBe(404)
  })

  it('returns categories and a resolved bracket', async () => {
    const { id: pollA } = await seedPoll({ title: 'Action', category: 'movie', voting_method: 'ranked_choice' })
    await env.DB.prepare("UPDATE polls SET phase = 'voting', votes_visible = 1 WHERE id = ?").bind(pollA).run()
    const { id: p1 } = await seedParticipant(pollA, 'Alice')
    const { id: nomWinner } = await seedNomination(pollA, p1, 'Mad Max')
    const { id: nomLoser } = await seedNomination(pollA, p1, 'Dredd')
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v1', pollA, p1, nomWinner, 1, Date.now()).run()
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v2', pollA, p1, nomLoser, 2, Date.now()).run()

    await seedEvent({ id: 'glarm26', title: 'Glarm Weekend' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)
    await seedEventSlot('glarm26', 'Thursday', 1, 'Action', 1)

    const res = await SELF.fetch('http://example.com/events/glarm26')
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.id).toBe('glarm26')
    expect(body.phase).toBe('voting')

    const categories = body.categories as Array<{ category: string; poll: { title: string } }>
    expect(categories).toHaveLength(1)
    expect(categories[0]!.category).toBe('Action')

    const schedule = body.schedule as Array<{ day: string; slots: Array<{ status: string; movies: Array<{ title: string }> }> }>
    expect(schedule).toHaveLength(1)
    expect(schedule[0]!.day).toBe('Thursday')
    expect(schedule[0]!.slots[0]!.status).toBe('resolved')
    expect(schedule[0]!.slots[0]!.movies[0]!.title).toBe('Mad Max')
  })

  it('reports phase closed only once every linked poll is closed', async () => {
    const { id: pollA } = await seedPoll()
    const { id: pollB } = await seedPoll()
    await env.DB.prepare("UPDATE polls SET phase = 'closed' WHERE id = ?").bind(pollA).run()
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(pollB).run()
    await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)
    await seedEventPoll('glarm26', pollB, 'Comedy', 1)

    const res = await SELF.fetch('http://example.com/events/glarm26')
    const body = await res.json() as { phase: string }
    expect(body.phase).toBe('voting')

    await env.DB.prepare("UPDATE polls SET phase = 'closed' WHERE id = ?").bind(pollB).run()
    const res2 = await SELF.fetch('http://example.com/events/glarm26')
    const body2 = await res2.json() as { phase: string }
    expect(body2.phase).toBe('closed')
  })

  it('does not silently drop days that are not in the canonical DAY_ORDER list', async () => {
    const { id: pollA } = await seedPoll({ category: 'movie' })
    await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)
    await seedEventSlot('glarm26', 'Sunday', 1, 'Action', 1)

    const res = await SELF.fetch('http://example.com/events/glarm26')
    expect(res.status).toBe(200)
    const body = await res.json() as { schedule: Array<{ day: string }> }
    expect(body.schedule.map(s => s.day)).toContain('Sunday')
  })

  it('reports phase voting when the event has no linked polls', async () => {
    await seedEvent({ id: 'glarm26' })

    const res = await SELF.fetch('http://example.com/events/glarm26')
    expect(res.status).toBe(200)
    const body = await res.json() as { phase: string; categories: unknown[] }
    expect(body.categories).toHaveLength(0)
    expect(body.phase).toBe('voting')
  })

  it('applies each Participant-Tokens entry to its own poll only', async () => {
    const { id: pollA } = await seedPoll()
    const { id: pollB } = await seedPoll()
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(pollA).run()
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(pollB).run()

    const { id: p1, token } = await seedParticipant(pollA, 'Alice')
    const { id: nom } = await seedNomination(pollA, p1, 'Mad Max')
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v1', pollA, p1, nom, null, Date.now()).run()

    await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)
    await seedEventPoll('glarm26', pollB, 'Comedy', 1)

    const res = await SELF.fetch('http://example.com/events/glarm26', {
      headers: { 'Participant-Tokens': `${pollA}:${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { categories: Array<{ category: string; poll: { has_voted: boolean } }> }

    const categoryA = body.categories.find(c => c.category === 'Action')
    const categoryB = body.categories.find(c => c.category === 'Comedy')
    expect(categoryA?.poll.has_voted).toBe(true)
    expect(categoryB?.poll.has_voted).toBe(false)
  })
})

describe('POST /events/:slug/join', () => {
  beforeEach(applySchema)

  it('joins all linked polls with the same name', async () => {
    const { id: pollA } = await seedPoll({ title: 'Action' })
    const { id: pollB } = await seedPoll({ title: 'Comedy' })
    await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)
    await seedEventPoll('glarm26', pollB, 'Comedy', 1)

    const res = await SELF.fetch('http://example.com/events/glarm26/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { name: string; rejoined: boolean; participants: Array<{ poll_id: string; token: string }> }
    expect(body.name).toBe('Alice')
    expect(body.rejoined).toBe(false)
    expect(body.participants).toHaveLength(2)
    expect(body.participants.map(p => p.poll_id).sort()).toEqual([pollA, pollB].sort())
  })

  it('reclaims the same tokens across all polls on repeat join', async () => {
    const { id: pollA } = await seedPoll()
    await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)

    const first = await SELF.fetch('http://example.com/events/glarm26/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bob' }),
    })
    const firstBody = await first.json() as { participants: Array<{ token: string }> }

    const second = await SELF.fetch('http://example.com/events/glarm26/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bob' }),
    })
    expect(second.status).toBe(200)
    const secondBody = await second.json() as { rejoined: boolean; participants: Array<{ token: string }> }
    expect(secondBody.rejoined).toBe(true)
    expect(secondBody.participants[0]!.token).toBe(firstBody.participants[0]!.token)
  })

  it('returns 400 when name is missing', async () => {
    await seedEvent({ id: 'glarm26' })
    const res = await SELF.fetch('http://example.com/events/glarm26/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})

describe('PATCH /events/:slug/phase', () => {
  beforeEach(applySchema)

  it('closes all linked polls with a valid admin token', async () => {
    const { id: pollA } = await seedPoll()
    const { id: pollB } = await seedPoll()
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id IN (?, ?)").bind(pollA, pollB).run()
    const { adminToken } = await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)
    await seedEventPoll('glarm26', pollB, 'Comedy', 1)

    const res = await SELF.fetch(`http://example.com/events/glarm26/phase?admin=${adminToken}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase: 'closed' }),
    })
    expect(res.status).toBe(200)

    const polls = await env.DB.prepare('SELECT phase FROM polls WHERE id IN (?, ?)').bind(pollA, pollB).all<{ phase: string }>()
    expect(polls.results.every(p => p.phase === 'closed')).toBe(true)
  })

  it('rejects an invalid admin token', async () => {
    const { id: pollA } = await seedPoll()
    await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)

    const res = await SELF.fetch('http://example.com/events/glarm26/phase?admin=wrong', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase: 'closed' }),
    })
    expect(res.status).toBe(401)
  })
})

describe('PATCH /events/:slug/pause', () => {
  beforeEach(applySchema)

  it('toggles is_paused on all linked polls together', async () => {
    const { id: pollA } = await seedPoll()
    const { id: pollB } = await seedPoll()
    const { adminToken } = await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)
    await seedEventPoll('glarm26', pollB, 'Comedy', 1)

    const res = await SELF.fetch(`http://example.com/events/glarm26/pause?admin=${adminToken}`, { method: 'PATCH' })
    expect(res.status).toBe(200)
    const body = await res.json() as { is_paused: boolean }
    expect(body.is_paused).toBe(true)

    const polls = await env.DB.prepare('SELECT is_paused FROM polls WHERE id IN (?, ?)').bind(pollA, pollB).all<{ is_paused: number }>()
    expect(polls.results.every(p => p.is_paused === 1)).toBe(true)

    const res2 = await SELF.fetch(`http://example.com/events/glarm26/pause?admin=${adminToken}`, { method: 'PATCH' })
    const body2 = await res2.json() as { is_paused: boolean }
    expect(body2.is_paused).toBe(false)
  })
})

describe('DELETE /events/:slug', () => {
  beforeEach(applySchema)

  it('cascades through all linked polls and event rows', async () => {
    const { id: pollA } = await seedPoll()
    const { id: p1 } = await seedParticipant(pollA, 'Alice')
    const { id: nomA } = await seedNomination(pollA, p1, 'Movie A')
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v1', pollA, p1, nomA, null, Date.now()).run()

    const { adminToken } = await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)
    await seedEventSlot('glarm26', 'Thursday', 1, 'Action', 1)

    const res = await SELF.fetch(`http://example.com/events/glarm26?admin=${adminToken}`, { method: 'DELETE' })
    expect(res.status).toBe(200)

    const poll = await env.DB.prepare('SELECT id FROM polls WHERE id = ?').bind(pollA).first()
    expect(poll).toBeNull()
    const votes = await env.DB.prepare('SELECT id FROM votes WHERE poll_id = ?').bind(pollA).all()
    expect(votes.results).toHaveLength(0)
    const event = await env.DB.prepare('SELECT id FROM events WHERE id = ?').bind('glarm26').first()
    expect(event).toBeNull()
    const slots = await env.DB.prepare('SELECT * FROM event_slots WHERE event_id = ?').bind('glarm26').all()
    expect(slots.results).toHaveLength(0)
  })
})
