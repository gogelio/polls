import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env } from 'cloudflare:test'
import { applySchema, seedPoll, seedParticipant, seedNomination } from './helpers'

describe('POST /polls/:id/nominations', () => {
  beforeEach(applySchema)

  it('adds a nomination', async () => {
    const { id } = await seedPoll({ max_nominations: 2 })
    const { token } = await seedParticipant(id)
    const res = await SELF.fetch(`http://example.com/polls/${id}/nominations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': token },
      body: JSON.stringify({ title: 'Dune', metadata: null }),
    })
    expect(res.status).toBe(201)
  })

  it('enforces max_nominations per participant', async () => {
    const { id } = await seedPoll({ max_nominations: 1 })
    const { id: pid, token } = await seedParticipant(id)
    await seedNomination(id, pid, 'Item 1')
    const res = await SELF.fetch(`http://example.com/polls/${id}/nominations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': token },
      body: JSON.stringify({ title: 'Item 2', metadata: null }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects nominations when poll is not in nominating phase', async () => {
    const { id } = await seedPoll()
    const { token } = await seedParticipant(id)
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    const res = await SELF.fetch(`http://example.com/polls/${id}/nominations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': token },
      body: JSON.stringify({ title: 'Too Late', metadata: null }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects nominations after nomination_closes_at', async () => {
    const pastTime = Date.now() - 1000
    const { id } = await seedPoll({ nomination_closes_at: pastTime })
    const { token } = await seedParticipant(id)
    const res = await SELF.fetch(`http://example.com/polls/${id}/nominations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': token },
      body: JSON.stringify({ title: 'Late Entry', metadata: null }),
    })
    expect(res.status).toBe(400)
  })
})

describe('DELETE /polls/:id/nominations/:nid', () => {
  beforeEach(applySchema)

  it('removes a nomination with admin token', async () => {
    const { id, adminToken } = await seedPoll()
    const { id: pid } = await seedParticipant(id)
    const { id: nid } = await seedNomination(id, pid)
    const res = await SELF.fetch(
      `http://example.com/polls/${id}/nominations/${nid}?admin=${adminToken}`,
      { method: 'DELETE' }
    )
    expect(res.status).toBe(200)
  })
})
