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

  it('hides resolved schedule slot movies when votes_visible is off and no admin token is provided', async () => {
    const { id: pollA } = await seedPoll({ title: 'Action', category: 'movie', voting_method: 'ranked_choice' })
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(pollA).run()
    const { id: p1 } = await seedParticipant(pollA, 'Alice')
    const { id: nomWinner } = await seedNomination(pollA, p1, 'Mad Max')
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v1', pollA, p1, nomWinner, 1, Date.now()).run()

    await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)
    await seedEventSlot('glarm26', 'Thursday', 1, 'Action', 1)

    const res = await SELF.fetch('http://example.com/events/glarm26')
    const body = await res.json() as { schedule: Array<{ slots: Array<{ status: string; movies: unknown[] }> }> }
    expect(body.schedule[0]!.slots[0]!.status).toBe('hidden')
    expect(body.schedule[0]!.slots[0]!.movies).toEqual([])
  })

  it('reveals resolved schedule slot movies to a valid event admin token even when votes_visible is off', async () => {
    const { id: pollA } = await seedPoll({ title: 'Action', category: 'movie', voting_method: 'ranked_choice' })
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(pollA).run()
    const { id: p1 } = await seedParticipant(pollA, 'Alice')
    const { id: nomWinner } = await seedNomination(pollA, p1, 'Mad Max')
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v1', pollA, p1, nomWinner, 1, Date.now()).run()

    const { adminToken: eventAdminToken } = await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)
    await seedEventSlot('glarm26', 'Thursday', 1, 'Action', 1)

    const res = await SELF.fetch(`http://example.com/events/glarm26?admin=${eventAdminToken}`)
    const body = await res.json() as { schedule: Array<{ slots: Array<{ status: string; movies: Array<{ title: string }> }> }> }
    expect(body.schedule[0]!.slots[0]!.status).toBe('resolved')
    expect(body.schedule[0]!.slots[0]!.movies[0]!.title).toBe('Mad Max')
  })

  it('still hides resolved schedule slot movies with an invalid admin token', async () => {
    const { id: pollA } = await seedPoll({ title: 'Action', category: 'movie', voting_method: 'ranked_choice' })
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(pollA).run()
    const { id: p1 } = await seedParticipant(pollA, 'Alice')
    const { id: nomWinner } = await seedNomination(pollA, p1, 'Mad Max')
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v1', pollA, p1, nomWinner, 1, Date.now()).run()

    await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)
    await seedEventSlot('glarm26', 'Thursday', 1, 'Action', 1)

    const res = await SELF.fetch('http://example.com/events/glarm26?admin=not-a-real-token')
    const body = await res.json() as { schedule: Array<{ slots: Array<{ status: string }> }> }
    expect(body.schedule[0]!.slots[0]!.status).toBe('hidden')
  })

  it('keeps schedule slot movies visible for a closed poll even without votes_visible or an admin token', async () => {
    const { id: pollA } = await seedPoll({ title: 'Action', category: 'movie', voting_method: 'ranked_choice' })
    await env.DB.prepare("UPDATE polls SET phase = 'closed' WHERE id = ?").bind(pollA).run()
    const { id: p1 } = await seedParticipant(pollA, 'Alice')
    const { id: nomWinner } = await seedNomination(pollA, p1, 'Mad Max')
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v1', pollA, p1, nomWinner, 1, Date.now()).run()

    await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)
    await seedEventSlot('glarm26', 'Thursday', 1, 'Action', 1)

    const res = await SELF.fetch('http://example.com/events/glarm26')
    const body = await res.json() as { schedule: Array<{ slots: Array<{ status: string; movies: Array<{ title: string }> }> }> }
    expect(body.schedule[0]!.slots[0]!.status).toBe('resolved')
    expect(body.schedule[0]!.slots[0]!.movies[0]!.title).toBe('Mad Max')
  })

  it('hides one category while showing another when they have different votes_visible settings', async () => {
    const { id: pollHidden } = await seedPoll({ title: 'Action', category: 'movie', voting_method: 'ranked_choice' })
    const { id: pollShown } = await seedPoll({ title: 'Comedy', category: 'movie', voting_method: 'ranked_choice' })
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(pollHidden).run()
    await env.DB.prepare("UPDATE polls SET phase = 'voting', votes_visible = 1 WHERE id = ?").bind(pollShown).run()
    const { id: p1 } = await seedParticipant(pollHidden, 'Alice')
    const { id: nomHidden } = await seedNomination(pollHidden, p1, 'Mad Max')
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v1', pollHidden, p1, nomHidden, 1, Date.now()).run()
    const { id: p2 } = await seedParticipant(pollShown, 'Bob')
    const { id: nomShown } = await seedNomination(pollShown, p2, 'Superbad')
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v2', pollShown, p2, nomShown, 1, Date.now()).run()

    await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollHidden, 'Action', 0)
    await seedEventPoll('glarm26', pollShown, 'Comedy', 1)
    await seedEventSlot('glarm26', 'Thursday', 1, 'Action', 1)
    await seedEventSlot('glarm26', 'Thursday', 2, 'Comedy', 1)

    const res = await SELF.fetch('http://example.com/events/glarm26')
    const body = await res.json() as { schedule: Array<{ slots: Array<{ category: string; status: string; movies: Array<{ title: string }> }> }> }
    const slots = body.schedule[0]!.slots
    expect(slots.find(s => s.category === 'Action')!.status).toBe('hidden')
    expect(slots.find(s => s.category === 'Comedy')!.status).toBe('resolved')
    expect(slots.find(s => s.category === 'Comedy')!.movies[0]!.title).toBe('Superbad')
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

  it('counts each distinct voter once across categories, not once per vote row', async () => {
    const { id: pollA } = await seedPoll({ title: 'Action', voting_method: 'plurality' })
    const { id: pollB } = await seedPoll({ title: 'Comedy', voting_method: 'plurality' })
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id IN (?, ?)").bind(pollA, pollB).run()

    // Alice joins (and votes in) both categories; her name appears as two
    // separate participant rows, one per poll — the same as a real event.
    const { id: aliceInA } = await seedParticipant(pollA, 'Alice')
    const { id: aliceInB } = await seedParticipant(pollB, 'Alice')
    const { id: bobInA } = await seedParticipant(pollA, 'Bob')

    const { id: nomA } = await seedNomination(pollA, aliceInA, 'Movie A')
    const { id: nomB } = await seedNomination(pollB, aliceInB, 'Movie B')

    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v1', pollA, aliceInA, nomA, null, Date.now()).run()
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v2', pollB, aliceInB, nomB, null, Date.now()).run()
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v3', pollA, bobInA, nomA, null, Date.now()).run()

    await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)
    await seedEventPoll('glarm26', pollB, 'Comedy', 1)

    const res = await SELF.fetch('http://example.com/events/glarm26')
    expect(res.status).toBe(200)
    const body = await res.json() as { voter_count: number }
    // Alice voted in both categories but counts once; Bob counts once. Not 3.
    expect(body.voter_count).toBe(2)
  })

  it('reports voter_count of 0 when no votes have been cast', async () => {
    const { id: pollA } = await seedPoll({ title: 'Action' })
    await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)

    const res = await SELF.fetch('http://example.com/events/glarm26')
    expect(res.status).toBe(200)
    const body = await res.json() as { voter_count: number }
    expect(body.voter_count).toBe(0)
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

describe('PATCH /events/:slug/votes-visible', () => {
  beforeEach(applySchema)

  it('toggles votes_visible on all linked polls together', async () => {
    const { id: pollA } = await seedPoll()
    const { id: pollB } = await seedPoll()
    const { adminToken } = await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)
    await seedEventPoll('glarm26', pollB, 'Comedy', 1)

    const res = await SELF.fetch(`http://example.com/events/glarm26/votes-visible?admin=${adminToken}`, { method: 'PATCH' })
    expect(res.status).toBe(200)
    const body = await res.json() as { votes_visible: boolean }
    expect(body.votes_visible).toBe(true)

    const polls = await env.DB.prepare('SELECT votes_visible FROM polls WHERE id IN (?, ?)').bind(pollA, pollB).all<{ votes_visible: number }>()
    expect(polls.results.every(p => p.votes_visible === 1)).toBe(true)

    const res2 = await SELF.fetch(`http://example.com/events/glarm26/votes-visible?admin=${adminToken}`, { method: 'PATCH' })
    const body2 = await res2.json() as { votes_visible: boolean }
    expect(body2.votes_visible).toBe(false)
  })

  it('rejects an invalid admin token', async () => {
    const { id: pollA } = await seedPoll()
    await seedEvent({ id: 'glarm26' })
    await seedEventPoll('glarm26', pollA, 'Action', 0)

    const res = await SELF.fetch('http://example.com/events/glarm26/votes-visible?admin=not-a-real-token', { method: 'PATCH' })
    expect(res.status).toBe(401)
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
