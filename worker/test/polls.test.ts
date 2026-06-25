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

  it('auto-advances phase to voting when nomination timer has expired', async () => {
    const pastTime = Date.now() - 1000
    const { id } = await seedPoll({ nomination_closes_at: pastTime })
    const res = await SELF.fetch(`http://example.com/polls/${id}`)
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.phase).toBe('voting')
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

describe('PATCH /polls/:id', () => {
  beforeEach(applySchema)

  it('updates the poll title', async () => {
    const { id, adminToken } = await seedPoll({ title: 'Old Title' })
    const res = await SELF.fetch(`http://example.com/polls/${id}?admin=${adminToken}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New Title' }),
    })
    expect(res.status).toBe(200)
    const check = await SELF.fetch(`http://example.com/polls/${id}`)
    const poll = await check.json() as Record<string, unknown>
    expect(poll.title).toBe('New Title')
  })

  it('updates voting_method in nominating phase', async () => {
    const { id, adminToken } = await seedPoll({ voting_method: 'plurality' })
    const res = await SELF.fetch(`http://example.com/polls/${id}?admin=${adminToken}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voting_method: 'ranked_choice' }),
    })
    expect(res.status).toBe(200)
    const check = await SELF.fetch(`http://example.com/polls/${id}`)
    const poll = await check.json() as Record<string, unknown>
    expect(poll.voting_method).toBe('ranked_choice')
  })

  it('rejects voting_method change after voting starts', async () => {
    const { id, adminToken } = await seedPoll()
    await SELF.fetch(`http://example.com/polls/${id}/phase?admin=${adminToken}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase: 'voting' }),
    })
    const res = await SELF.fetch(`http://example.com/polls/${id}?admin=${adminToken}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voting_method: 'ranked_pairs' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects empty title', async () => {
    const { id, adminToken } = await seedPoll()
    const res = await SELF.fetch(`http://example.com/polls/${id}?admin=${adminToken}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '   ' }),
    })
    expect(res.status).toBe(400)
  })

  it('clears nomination_closes_at when set to null', async () => {
    const { id, adminToken } = await seedPoll({ nomination_closes_at: Date.now() + 86400000 })
    const res = await SELF.fetch(`http://example.com/polls/${id}?admin=${adminToken}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nomination_closes_at: null }),
    })
    expect(res.status).toBe(200)
    const check = await SELF.fetch(`http://example.com/polls/${id}`)
    const poll = await check.json() as Record<string, unknown>
    expect(poll.nomination_closes_at).toBeNull()
  })

  it('rejects missing admin token', async () => {
    const { id } = await seedPoll()
    const res = await SELF.fetch(`http://example.com/polls/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Hacked' }),
    })
    expect(res.status).toBe(401)
  })
})
