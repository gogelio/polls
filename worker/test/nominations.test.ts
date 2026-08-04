import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env } from 'cloudflare:test'
import { applySchema, seedPoll, seedParticipant, seedNomination, seedEvent, seedEventPoll } from './helpers'

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

  it('rejects nominations when poll is paused', async () => {
    const { id } = await seedPoll()
    const { token } = await seedParticipant(id)
    await env.DB.prepare('UPDATE polls SET is_paused = 1 WHERE id = ?').bind(id).run()
    const res = await SELF.fetch(`http://example.com/polls/${id}/nominations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': token },
      body: JSON.stringify({ title: 'Blocked', metadata: null }),
    })
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Poll is paused')
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

  it('returns 404 when deleting nomination that does not exist', async () => {
    const { id, adminToken } = await seedPoll()
    const res = await SELF.fetch(
      `http://example.com/polls/${id}/nominations/doesnotexist?admin=${adminToken}`,
      { method: 'DELETE' }
    )
    expect(res.status).toBe(404)
  })

  it('cascades the delete to any votes already cast for the nomination, leaving other votes intact', async () => {
    const { id, adminToken } = await seedPoll({ voting_method: 'ranked_choice' })
    const { id: nominatorId } = await seedParticipant(id, 'Nominator')
    const { id: nid1 } = await seedNomination(id, nominatorId, 'A')
    const { id: nid2 } = await seedNomination(id, nominatorId, 'B')
    const { id: voterId } = await seedParticipant(id, 'Voter')

    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
      ).bind('v1', id, voterId, nid1, 1, Date.now()),
      env.DB.prepare(
        'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
      ).bind('v2', id, voterId, nid2, 2, Date.now()),
    ])

    const res = await SELF.fetch(
      `http://example.com/polls/${id}/nominations/${nid1}?admin=${adminToken}`,
      { method: 'DELETE' }
    )
    expect(res.status).toBe(200)

    const { results } = await env.DB.prepare('SELECT id, nomination_id FROM votes WHERE poll_id = ?').bind(id).all()
    expect(results.map(r => r.id)).toEqual(['v2'])
    expect(results.map(r => r.nomination_id)).toEqual([nid2])
  })
})

describe('POST /polls/:id/nominations - validation', () => {
  beforeEach(applySchema)

  it('rejects nomination when title is missing', async () => {
    const { id } = await seedPoll()
    const { token } = await seedParticipant(id)
    const res = await SELF.fetch(`http://example.com/polls/${id}/nominations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': token },
      body: JSON.stringify({ title: '', metadata: null }),
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /polls/:id/nominations/search-movies', () => {
  beforeEach(applySchema)

  it('requires an admin token', async () => {
    const { id } = await seedPoll()
    const res = await SELF.fetch(`http://example.com/polls/${id}/nominations/search-movies?q=dune`)
    expect(res.status).toBe(401)
  })

  it('rejects an invalid admin token', async () => {
    const { id } = await seedPoll()
    const res = await SELF.fetch(`http://example.com/polls/${id}/nominations/search-movies?q=dune&admin=wrong`)
    expect(res.status).toBe(401)
  })

  it('returns 400 when q is missing', async () => {
    const { id, adminToken } = await seedPoll()
    const res = await SELF.fetch(`http://example.com/polls/${id}/nominations/search-movies?admin=${adminToken}`)
    expect(res.status).toBe(400)
  })
})

describe('PATCH /polls/:id/nominations/:nid', () => {
  beforeEach(applySchema)

  it('updates title and metadata with a valid admin token', async () => {
    const { id, adminToken } = await seedPoll()
    const { id: pid } = await seedParticipant(id)
    const { id: nid } = await seedNomination(id, pid, 'Wrong Movie')

    const res = await SELF.fetch(`http://example.com/polls/${id}/nominations/${nid}?admin=${adminToken}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Correct Movie', metadata: { external_id: '123', poster_url: 'https://example.com/p.jpg' } }),
    })
    expect(res.status).toBe(200)

    const row = await env.DB.prepare('SELECT title, metadata FROM nominations WHERE id = ?').bind(nid).first<{ title: string; metadata: string }>()
    expect(row?.title).toBe('Correct Movie')
    expect(JSON.parse(row!.metadata)).toEqual({ external_id: '123', poster_url: 'https://example.com/p.jpg' })
  })

  it('rejects an empty title', async () => {
    const { id, adminToken } = await seedPoll()
    const { id: pid } = await seedParticipant(id)
    const { id: nid } = await seedNomination(id, pid)

    const res = await SELF.fetch(`http://example.com/polls/${id}/nominations/${nid}?admin=${adminToken}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 404 for a nomination that does not exist', async () => {
    const { id, adminToken } = await seedPoll()
    const res = await SELF.fetch(`http://example.com/polls/${id}/nominations/doesnotexist?admin=${adminToken}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Anything' }),
    })
    expect(res.status).toBe(404)
  })

  it('rejects an invalid admin token', async () => {
    const { id } = await seedPoll()
    const { id: pid } = await seedParticipant(id)
    const { id: nid } = await seedNomination(id, pid)
    const res = await SELF.fetch(`http://example.com/polls/${id}/nominations/${nid}?admin=wrong`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Anything' }),
    })
    expect(res.status).toBe(401)
  })
})

describe('adminAuth event-token fallback for event-linked polls', () => {
  beforeEach(applySchema)

  it('accepts the event admin token for a poll linked to that event', async () => {
    const { id: pollId } = await seedPoll()
    const { id: pid } = await seedParticipant(pollId)
    const { id: nid } = await seedNomination(pollId, pid, 'Wrong Movie')
    const { id: eventId, adminToken: eventAdminToken } = await seedEvent()
    await seedEventPoll(eventId, pollId, 'Action', 0)

    const res = await SELF.fetch(`http://example.com/polls/${pollId}/nominations/${nid}?admin=${eventAdminToken}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Correct Movie' }),
    })
    expect(res.status).toBe(200)

    const searchRes = await SELF.fetch(`http://example.com/polls/${pollId}/nominations/search-movies?q=dune&admin=${eventAdminToken}`)
    expect(searchRes.status).not.toBe(401)
  })

  it('rejects the admin token of an unrelated event', async () => {
    const { id: pollId } = await seedPoll()
    const { id: pid } = await seedParticipant(pollId)
    const { id: nid } = await seedNomination(pollId, pid)
    const { id: eventId } = await seedEvent()
    await seedEventPoll(eventId, pollId, 'Action', 0)
    const { adminToken: otherEventAdminToken } = await seedEvent({ id: 'other-event' })

    const res = await SELF.fetch(`http://example.com/polls/${pollId}/nominations/${nid}?admin=${otherEventAdminToken}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Should not work' }),
    })
    expect(res.status).toBe(401)
  })

  it('rejects an event admin token for a poll not linked to that event', async () => {
    const { id: pollId } = await seedPoll()
    const { id: pid } = await seedParticipant(pollId)
    const { id: nid } = await seedNomination(pollId, pid)
    const { adminToken: eventAdminToken } = await seedEvent()
    // Note: pollId is never linked via seedEventPoll

    const res = await SELF.fetch(`http://example.com/polls/${pollId}/nominations/${nid}?admin=${eventAdminToken}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Should not work' }),
    })
    expect(res.status).toBe(401)
  })
})
