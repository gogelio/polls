import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env } from 'cloudflare:test'
import { applySchema, seedPoll, seedParticipant, seedNomination } from './helpers'

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

describe('GET /polls/:id draft_ranking', () => {
  beforeEach(applySchema)

  it('returns the requesting participant draft_ranking during voting', async () => {
    const { id } = await seedPoll({ voting_method: 'ranked_choice' })
    const { id: pid, token } = await seedParticipant(id)
    const { id: nid1 } = await seedNomination(id, pid, 'A')
    const { id: nid2 } = await seedNomination(id, pid, 'B')
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    await env.DB.prepare('UPDATE participants SET draft_ranking = ? WHERE id = ?')
      .bind(JSON.stringify([nid2, nid1]), pid).run()

    const res = await SELF.fetch(`http://example.com/polls/${id}`, {
      headers: { 'Participant-Token': token },
    })
    const body = await res.json() as { draft_ranking: string[] | null }
    expect(body.draft_ranking).toEqual([nid2, nid1])
  })

  it('omits draft_ranking once the participant has voted', async () => {
    const { id } = await seedPoll({ voting_method: 'ranked_choice' })
    const { id: pid, token } = await seedParticipant(id)
    const { id: nid } = await seedNomination(id, pid, 'A')
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    await env.DB.prepare('UPDATE participants SET draft_ranking = ? WHERE id = ?')
      .bind(JSON.stringify([nid]), pid).run()
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v1', id, pid, nid, 1, Date.now()).run()

    const res = await SELF.fetch(`http://example.com/polls/${id}`, {
      headers: { 'Participant-Token': token },
    })
    const body = await res.json() as { draft_ranking: string[] | null }
    expect(body.draft_ranking).toBeNull()
  })

  it('omits draft_ranking for plurality polls even if the column has a value', async () => {
    const { id } = await seedPoll({ voting_method: 'plurality' })
    const { id: pid, token } = await seedParticipant(id)
    const { id: nid } = await seedNomination(id, pid, 'A')
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    await env.DB.prepare('UPDATE participants SET draft_ranking = ? WHERE id = ?')
      .bind(JSON.stringify([nid]), pid).run()

    const res = await SELF.fetch(`http://example.com/polls/${id}`, {
      headers: { 'Participant-Token': token },
    })
    const body = await res.json() as { draft_ranking: string[] | null }
    expect(body.draft_ranking).toBeNull()
  })

  it('omits draft_ranking during the nominating phase', async () => {
    const { id } = await seedPoll({ voting_method: 'ranked_choice' })
    const { id: pid, token } = await seedParticipant(id)
    const { id: nid } = await seedNomination(id, pid, 'A')
    await env.DB.prepare('UPDATE participants SET draft_ranking = ? WHERE id = ?')
      .bind(JSON.stringify([nid]), pid).run()

    const res = await SELF.fetch(`http://example.com/polls/${id}`, {
      headers: { 'Participant-Token': token },
    })
    const body = await res.json() as { draft_ranking: string[] | null }
    expect(body.draft_ranking).toBeNull()
  })

  it('never returns another participant draft_ranking', async () => {
    const { id } = await seedPoll({ voting_method: 'ranked_choice' })
    const { id: pidA } = await seedParticipant(id, 'Alice')
    const { token: tokenB } = await seedParticipant(id, 'Bob')
    const { id: nid } = await seedNomination(id, pidA, 'A')
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    await env.DB.prepare('UPDATE participants SET draft_ranking = ? WHERE id = ?')
      .bind(JSON.stringify([nid]), pidA).run()

    const res = await SELF.fetch(`http://example.com/polls/${id}`, {
      headers: { 'Participant-Token': tokenB },
    })
    const body = await res.json() as { draft_ranking: string[] | null }
    expect(body.draft_ranking).toBeNull()
  })

  it('omits draft_ranking with no or invalid participant token', async () => {
    const { id } = await seedPoll({ voting_method: 'ranked_choice' })
    const { id: pid } = await seedParticipant(id)
    const { id: nid } = await seedNomination(id, pid, 'A')
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    await env.DB.prepare('UPDATE participants SET draft_ranking = ? WHERE id = ?')
      .bind(JSON.stringify([nid]), pid).run()

    const noTokenRes = await SELF.fetch(`http://example.com/polls/${id}`)
    const noTokenBody = await noTokenRes.json() as { draft_ranking: string[] | null }
    expect(noTokenBody.draft_ranking).toBeNull()

    const invalidTokenRes = await SELF.fetch(`http://example.com/polls/${id}`, {
      headers: { 'Participant-Token': 'not-a-real-token' },
    })
    const invalidTokenBody = await invalidTokenRes.json() as { draft_ranking: string[] | null }
    expect(invalidTokenBody.draft_ranking).toBeNull()
  })

  it('returns draft_ranking: null instead of 500ing when the stored value is malformed JSON', async () => {
    const { id } = await seedPoll({ voting_method: 'ranked_choice' })
    const { id: pid, token } = await seedParticipant(id)
    await seedNomination(id, pid, 'A')
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    await env.DB.prepare('UPDATE participants SET draft_ranking = ? WHERE id = ?')
      .bind('not valid json', pid).run()

    const res = await SELF.fetch(`http://example.com/polls/${id}`, {
      headers: { 'Participant-Token': token },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { draft_ranking: string[] | null }
    expect(body.draft_ranking).toBeNull()
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

  it('rejects invalid voting_method', async () => {
    const { id, adminToken } = await seedPoll()
    const res = await SELF.fetch(`http://example.com/polls/${id}?admin=${adminToken}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voting_method: 'instant_runoff' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('DELETE /polls/:id', () => {
  beforeEach(applySchema)

  it('deletes the poll and all child rows with valid admin token', async () => {
    const { id, adminToken } = await seedPoll()
    const { id: participantId } = await seedParticipant(id)
    await seedNomination(id, participantId)

    const res = await SELF.fetch(`http://example.com/polls/${id}?admin=${adminToken}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.ok).toBe(true)

    // Poll is gone
    const gone = await SELF.fetch(`http://example.com/polls/${id}`)
    expect(gone.status).toBe(404)
  })

  it('returns 404 for unknown poll', async () => {
    const res = await SELF.fetch('http://example.com/polls/notreal?admin=sometoken', {
      method: 'DELETE',
    })
    expect(res.status).toBe(404)
  })

  it('returns 401 with wrong admin token', async () => {
    const { id } = await seedPoll()
    const res = await SELF.fetch(`http://example.com/polls/${id}?admin=wrongtoken`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(401)
  })
})

describe('PATCH /polls/:id/pause', () => {
  beforeEach(applySchema)

  it('pauses a poll', async () => {
    const { id, adminToken } = await seedPoll()
    const res = await SELF.fetch(`http://example.com/polls/${id}/pause?admin=${adminToken}`, {
      method: 'PATCH',
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { is_paused: boolean }
    expect(body.is_paused).toBe(true)
  })

  it('unpauses a poll', async () => {
    const { id, adminToken } = await seedPoll()
    await env.DB.prepare('UPDATE polls SET is_paused = 1 WHERE id = ?').bind(id).run()
    const res = await SELF.fetch(`http://example.com/polls/${id}/pause?admin=${adminToken}`, {
      method: 'PATCH',
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { is_paused: boolean }
    expect(body.is_paused).toBe(false)
  })

  it('returns 401 with bad admin token', async () => {
    const { id } = await seedPoll()
    const res = await SELF.fetch(`http://example.com/polls/${id}/pause?admin=wrong`, {
      method: 'PATCH',
    })
    expect(res.status).toBe(401)
  })

  it('GET /polls/:id includes is_paused', async () => {
    const { id, adminToken } = await seedPoll()
    await env.DB.prepare('UPDATE polls SET is_paused = 1 WHERE id = ?').bind(id).run()
    const res = await SELF.fetch(`http://example.com/polls/${id}`)
    const body = await res.json() as { is_paused: boolean }
    expect(body.is_paused).toBe(true)
  })
})
