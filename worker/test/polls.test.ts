import { describe, it, expect, beforeEach } from 'vitest'
import { SELF } from 'cloudflare:test'
import { applySchema, seedPoll } from './helpers'

describe('POST /polls', () => {
  beforeEach(applySchema)

  it('creates a poll and returns participant + admin URLs', async () => {
    const res = await SELF.fetch('http://example.com/polls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Book Club',
        category: 'book',
        voting_method: 'ranked_choice',
        max_nominations: 2,
        nominations_visible: true,
        votes_visible: false,
        nomination_closes_at: null,
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body.id).toBeTruthy()
    expect(body.admin_token).toBeTruthy()
    expect(body.participant_url).toContain('/p/')
    expect(body.admin_url).toContain('admin=')
  })
})

describe('GET /polls/:id', () => {
  beforeEach(applySchema)

  it('returns poll state', async () => {
    const { id } = await seedPoll({ title: 'My Poll' })
    const res = await SELF.fetch(`http://example.com/polls/${id}`)
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.id).toBe(id)
    expect(body.phase).toBe('nominating')
  })

  it('returns 404 for unknown poll', async () => {
    const res = await SELF.fetch('http://example.com/polls/notreal')
    expect(res.status).toBe(404)
  })
})

describe('PATCH /polls/:id/phase', () => {
  beforeEach(applySchema)

  it('transitions phase with valid admin token', async () => {
    const { id, adminToken } = await seedPoll()
    const res = await SELF.fetch(`http://example.com/polls/${id}/phase?admin=${adminToken}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase: 'voting' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.phase).toBe('voting')
  })

  it('rejects invalid phase transitions', async () => {
    const { id, adminToken } = await seedPoll()
    const res = await SELF.fetch(`http://example.com/polls/${id}/phase?admin=${adminToken}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase: 'closed' }), // can't skip voting
    })
    expect(res.status).toBe(400)
  })

  it('rejects missing admin token', async () => {
    const { id } = await seedPoll()
    const res = await SELF.fetch(`http://example.com/polls/${id}/phase`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase: 'voting' }),
    })
    expect(res.status).toBe(401)
  })
})
