import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env } from 'cloudflare:test'
import { applySchema, seedPoll, seedParticipant, seedNomination, seedEvent, seedEventPoll } from './helpers'

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

  it('clears any draft_ranking on successful submit', async () => {
    const { id } = await seedPoll({ voting_method: 'ranked_choice' })
    const { id: pid, token } = await seedParticipant(id)
    const { id: nid } = await seedNomination(id, pid, 'A')
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    await env.DB.prepare('UPDATE participants SET draft_ranking = ? WHERE id = ?')
      .bind(JSON.stringify([nid]), pid).run()

    await SELF.fetch(`http://example.com/polls/${id}/votes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': token },
      body: JSON.stringify([{ nomination_id: nid, rank: 1 }]),
    })

    const row = await env.DB.prepare('SELECT draft_ranking FROM participants WHERE id = ?').bind(pid).first<{ draft_ranking: string | null }>()
    expect(row?.draft_ranking).toBeNull()
  })

  it('does not let draft changes affect live results', async () => {
    const { id } = await seedPoll({ voting_method: 'ranked_choice', votes_visible: 1 })
    const { id: voterPid, token: voterToken } = await seedParticipant(id, 'Voter')
    const { token: draftToken } = await seedParticipant(id, 'Drafter')
    const { id: nid1 } = await seedNomination(id, voterPid, 'A')
    const { id: nid2 } = await seedNomination(id, voterPid, 'B')
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()

    // Voter submits a real vote for A.
    await SELF.fetch(`http://example.com/polls/${id}/votes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': voterToken },
      body: JSON.stringify([{ nomination_id: nid1, rank: 1 }, { nomination_id: nid2, rank: 2 }]),
    })
    const before = await (await SELF.fetch(`http://example.com/polls/${id}/results`)).json()

    // Drafter only saves drafts, never submits.
    await SELF.fetch(`http://example.com/polls/${id}/vote-draft`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': draftToken },
      body: JSON.stringify({ ranking: [nid2, nid1] }),
    })
    await SELF.fetch(`http://example.com/polls/${id}/vote-draft`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': draftToken },
      body: JSON.stringify({ ranking: [nid1, nid2] }),
    })
    const after = await (await SELF.fetch(`http://example.com/polls/${id}/results`)).json()

    expect(after).toEqual(before)
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

  it('still hides results from a poll admin token when votes_visible=false and the poll is not event-linked', async () => {
    const { id, adminToken } = await seedPoll({ votes_visible: 0 })
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    const res = await SELF.fetch(`http://example.com/polls/${id}/results?admin=${adminToken}`)
    expect(res.status).toBe(403)
  })

  it('lets the poll admin token preview hidden results for an event-linked poll', async () => {
    const { id, adminToken } = await seedPoll({ votes_visible: 0 })
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    const { id: eventId } = await seedEvent()
    await seedEventPoll(eventId, id, 'Action')

    const res = await SELF.fetch(`http://example.com/polls/${id}/results?admin=${adminToken}`)
    expect(res.status).toBe(200)
  })

  it('lets the linked event\'s admin token preview hidden results for a category poll', async () => {
    const { id } = await seedPoll({ votes_visible: 0 })
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    const { id: eventId, adminToken: eventAdminToken } = await seedEvent()
    await seedEventPoll(eventId, id, 'Action')

    const res = await SELF.fetch(`http://example.com/polls/${id}/results?admin=${eventAdminToken}`)
    expect(res.status).toBe(200)
  })

  it('still hides results for an event-linked poll with no admin token', async () => {
    const { id } = await seedPoll({ votes_visible: 0 })
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    const { id: eventId } = await seedEvent()
    await seedEventPoll(eventId, id, 'Action')

    const res = await SELF.fetch(`http://example.com/polls/${id}/results`)
    expect(res.status).toBe(403)
  })

  it('still hides results for an event-linked poll with an invalid admin token', async () => {
    const { id } = await seedPoll({ votes_visible: 0 })
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    const { id: eventId } = await seedEvent()
    await seedEventPoll(eventId, id, 'Action')

    const res = await SELF.fetch(`http://example.com/polls/${id}/results?admin=not-a-real-token`)
    expect(res.status).toBe(403)
  })

  it('omits voter_stats during voting when no admin token is provided', async () => {
    const { id } = await seedPoll({ voting_method: 'plurality', votes_visible: 1 })
    const { id: pid } = await seedParticipant(id)
    const { id: nid } = await seedNomination(id, pid, 'Winner')
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v1', id, pid, nid, null, Date.now()).run()

    const res = await SELF.fetch(`http://example.com/polls/${id}/results`)
    const body = await res.json() as Record<string, unknown>
    expect(body.voter_stats).toBeUndefined()
  })

  it('includes voter_stats for a valid poll admin token during voting phase', async () => {
    const { id, adminToken } = await seedPoll({ voting_method: 'plurality', votes_visible: 1 })
    const { id: pid } = await seedParticipant(id)
    const { id: nid } = await seedNomination(id, pid, 'Winner')
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v1', id, pid, nid, null, Date.now()).run()

    const res = await SELF.fetch(`http://example.com/polls/${id}/results?admin=${adminToken}`)
    const body = await res.json() as { voter_stats?: { luckiest: unknown[]; unluckiest: unknown[] } }
    expect(body.voter_stats).toBeDefined()
    expect(body.voter_stats!.luckiest).toHaveLength(1)
  })

  it('includes voter_stats for everyone once the poll is closed', async () => {
    const { id } = await seedPoll({ voting_method: 'plurality' })
    const { id: pid } = await seedParticipant(id)
    const { id: nid } = await seedNomination(id, pid, 'Winner')
    await env.DB.prepare("UPDATE polls SET phase = 'closed' WHERE id = ?").bind(id).run()
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v1', id, pid, nid, null, Date.now()).run()

    const res = await SELF.fetch(`http://example.com/polls/${id}/results`)
    const body = await res.json() as { voter_stats?: { luckiest: unknown[] } }
    expect(body.voter_stats).toBeDefined()
  })

  it('lists the luckiest and unluckiest voters by their top pick\'s placement', async () => {
    const { id } = await seedPoll({ voting_method: 'plurality' })
    const { id: alice } = await seedParticipant(id, 'Alice')
    const { id: bob } = await seedParticipant(id, 'Bob')
    const { id: carol } = await seedParticipant(id, 'Carol')
    const { id: dave } = await seedParticipant(id, 'Dave')
    const { id: eve } = await seedParticipant(id, 'Eve')
    const { id: frank } = await seedParticipant(id, 'Frank')
    const { id: winner } = await seedNomination(id, alice, 'Winner')
    const { id: middle } = await seedNomination(id, dave, 'Middle')
    const { id: last } = await seedNomination(id, frank, 'Last')
    await env.DB.prepare("UPDATE polls SET phase = 'closed' WHERE id = ?").bind(id).run()

    const insertVote = (voteId: string, participantId: string, nominationId: string) =>
      env.DB.prepare(
        'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
      ).bind(voteId, id, participantId, nominationId, null, Date.now()).run()

    await insertVote('v1', alice, winner)
    await insertVote('v2', bob, winner)
    await insertVote('v3', carol, winner)
    await insertVote('v4', dave, middle)
    await insertVote('v5', eve, middle)
    await insertVote('v6', frank, last)

    const res = await SELF.fetch(`http://example.com/polls/${id}/results`)
    const body = await res.json() as {
      voter_stats: {
        luckiest: Array<{ participant_name: string; placement: number }>
        unluckiest: Array<{ participant_name: string; placement: number }>
      }
    }
    const luckyNames = body.voter_stats.luckiest.map(l => l.participant_name).sort()
    expect(luckyNames).toEqual(['Alice', 'Bob', 'Carol'])
    expect(body.voter_stats.luckiest.every(l => l.placement === 1)).toBe(true)
    expect(body.voter_stats.unluckiest[0]!.participant_name).toBe('Frank')
    expect(body.voter_stats.unluckiest[0]!.placement).toBe(3)
    expect(body.voter_stats.unluckiest.map(l => l.participant_name).sort()).toEqual(['Dave', 'Eve', 'Frank'])
  })
})

describe('PATCH /polls/:id/vote-draft', () => {
  beforeEach(applySchema)

  it('saves a draft ranking', async () => {
    const { id } = await seedPoll({ voting_method: 'ranked_choice' })
    const { id: pid, token } = await seedParticipant(id)
    const { id: nid1 } = await seedNomination(id, pid, 'A')
    const { id: nid2 } = await seedNomination(id, pid, 'B')
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()

    const res = await SELF.fetch(`http://example.com/polls/${id}/vote-draft`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': token },
      body: JSON.stringify({ ranking: [nid2, nid1] }),
    })
    expect(res.status).toBe(200)

    const row = await env.DB.prepare('SELECT draft_ranking FROM participants WHERE id = ?').bind(pid).first<{ draft_ranking: string }>()
    expect(JSON.parse(row!.draft_ranking)).toEqual([nid2, nid1])
  })

  it('requires participant auth', async () => {
    const { id } = await seedPoll({ voting_method: 'ranked_choice' })
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    const res = await SELF.fetch(`http://example.com/polls/${id}/vote-draft`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ranking: ['x'] }),
    })
    expect(res.status).toBe(401)
  })

  it('rejects when poll is not in voting phase', async () => {
    const { id } = await seedPoll({ voting_method: 'ranked_choice' })
    const { id: pid, token } = await seedParticipant(id)
    const { id: nid } = await seedNomination(id, pid)
    const res = await SELF.fetch(`http://example.com/polls/${id}/vote-draft`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': token },
      body: JSON.stringify({ ranking: [nid] }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects plurality polls', async () => {
    const { id } = await seedPoll({ voting_method: 'plurality' })
    const { id: pid, token } = await seedParticipant(id)
    const { id: nid } = await seedNomination(id, pid)
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    const res = await SELF.fetch(`http://example.com/polls/${id}/vote-draft`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': token },
      body: JSON.stringify({ ranking: [nid] }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects a ranking containing a nomination from another poll', async () => {
    const { id } = await seedPoll({ voting_method: 'ranked_choice' })
    const { id: otherId } = await seedPoll({ voting_method: 'ranked_choice' })
    const { id: pid, token } = await seedParticipant(id)
    const { id: otherPid } = await seedParticipant(otherId)
    const { id: foreignNid } = await seedNomination(otherId, otherPid, 'Foreign')
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    const res = await SELF.fetch(`http://example.com/polls/${id}/vote-draft`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': token },
      body: JSON.stringify({ ranking: [foreignNid] }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects draft saves when poll is paused', async () => {
    const { id } = await seedPoll({ voting_method: 'ranked_choice' })
    const { id: pid, token } = await seedParticipant(id)
    const { id: nid } = await seedNomination(id, pid)
    await env.DB.prepare("UPDATE polls SET phase = 'voting', is_paused = 1 WHERE id = ?").bind(id).run()
    const res = await SELF.fetch(`http://example.com/polls/${id}/vote-draft`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': token },
      body: JSON.stringify({ ranking: [nid] }),
    })
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Poll is paused')
  })

  it('rejects draft saves from a participant who has already voted', async () => {
    const { id } = await seedPoll({ voting_method: 'ranked_choice' })
    const { id: pid, token } = await seedParticipant(id)
    const { id: nid } = await seedNomination(id, pid)
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    await env.DB.prepare(
      'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('v1', id, pid, nid, 1, Date.now()).run()

    const res = await SELF.fetch(`http://example.com/polls/${id}/vote-draft`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': token },
      body: JSON.stringify({ ranking: [nid] }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('You have already voted')
  })

  it('rejects a ranking longer than the number of valid nominations', async () => {
    const { id } = await seedPoll({ voting_method: 'ranked_choice' })
    const { id: pid, token } = await seedParticipant(id)
    const { id: nid1 } = await seedNomination(id, pid, 'A')
    const { id: nid2 } = await seedNomination(id, pid, 'B')
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    const res = await SELF.fetch(`http://example.com/polls/${id}/vote-draft`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': token },
      body: JSON.stringify({ ranking: [nid1, nid2, nid1] }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects a ranking with duplicate nomination ids', async () => {
    const { id } = await seedPoll({ voting_method: 'ranked_choice' })
    const { id: pid, token } = await seedParticipant(id)
    const { id: nid1 } = await seedNomination(id, pid, 'A')
    await seedNomination(id, pid, 'B')
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ?").bind(id).run()
    const res = await SELF.fetch(`http://example.com/polls/${id}/vote-draft`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': token },
      body: JSON.stringify({ ranking: [nid1, nid1] }),
    })
    expect(res.status).toBe(400)
  })
})
