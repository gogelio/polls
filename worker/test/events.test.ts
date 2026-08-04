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
