import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env } from 'cloudflare:test'
import { applySchema, seedPoll, seedParticipant, seedNomination } from './helpers'

describe('POST /polls/:id/votes', () => {
  beforeEach(applySchema)

  it('submits plurality vote', async () => {
    const { id } = await seedPoll({ voting_method: 'plurality' })
    const { id: pid, token } = await seedParticipant(id)
    const { id: nid } = await seedNomination(id, pid, 'Option A')
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()

    const res = await SELF.fetch(`http://example.com/polls/${id}/votes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': token },
      body: JSON.stringify([{ nomination_id: nid, rank: null }]),
    })
    expect(res.status).toBe(200)
  })

  it('replaces prior vote on re-submission', async () => {
    const { id } = await seedPoll({ voting_method: 'plurality' })
    const { id: pid, token } = await seedParticipant(id)
    const { id: nid1 } = await seedNomination(id, pid, 'A')
    const { id: nid2 } = await seedNomination(id, pid, 'B')
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()

    await SELF.fetch(`http://example.com/polls/${id}/votes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': token },
      body: JSON.stringify([{ nomination_id: nid1, rank: null }]),
    })
    const res = await SELF.fetch(`http://example.com/polls/${id}/votes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': token },
      body: JSON.stringify([{ nomination_id: nid2, rank: null }]),
    })
    expect(res.status).toBe(200)

    const voteCount = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM votes WHERE poll_id = ? AND participant_id = ?'
    ).bind(id, pid).first<{ count: number }>()
    expect(voteCount?.count).toBe(1)
  })

  it('rejects votes when poll is not in voting phase', async () => {
    const { id } = await seedPoll()
    const { id: pid, token } = await seedParticipant(id)
    const { id: nid } = await seedNomination(id, pid)
    const res = await SELF.fetch(`http://example.com/polls/${id}/votes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': token },
      body: JSON.stringify([{ nomination_id: nid, rank: null }]),
    })
    expect(res.status).toBe(400)
  })

  it('rejects votes when poll is paused', async () => {
    const { id } = await seedPoll({ voting_method: 'plurality' })
    const { id: pid, token } = await seedParticipant(id)
    const { id: nomId } = await seedNomination(id, pid)
    await env.DB.prepare("UPDATE polls SET phase = 'voting', is_paused = 1 WHERE id = ?").bind(id).run()
    const res = await SELF.fetch(`http://example.com/polls/${id}/votes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': token },
      body: JSON.stringify([{ nomination_id: nomId, rank: null }]),
    })
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Poll is paused')
  })
})

describe('GET /polls/:id/results', () => {
  beforeEach(applySchema)

  it('returns results after poll is closed', async () => {
    const { id } = await seedPoll({ voting_method: 'plurality' })
    const { id: pid } = await seedParticipant(id)
    const { id: nid } = await seedNomination(id, pid, 'Winner')
    await env.DB.prepare("UPDATE polls SET phase = 'closed' WHERE id = ?").bind(id).run()
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v1', id, pid, nid, null, Date.now()).run()

    const res = await SELF.fetch(`http://example.com/polls/${id}/results`)
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(Array.isArray(body.results)).toBe(true)
  })

  it('hides results during voting when votes_visible=false', async () => {
    const { id } = await seedPoll({ votes_visible: 0 })
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    const res = await SELF.fetch(`http://example.com/polls/${id}/results`)
    expect(res.status).toBe(403)
  })
})
