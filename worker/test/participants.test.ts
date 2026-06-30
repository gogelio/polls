import { describe, it, expect, beforeEach } from 'vitest'
import { SELF } from 'cloudflare:test'
import { applySchema, seedPoll, seedParticipant } from './helpers'

describe('POST /polls/:id/join', () => {
  beforeEach(applySchema)

  it('creates a participant and returns a token', async () => {
    const { id } = await seedPoll()
    const res = await SELF.fetch(`http://example.com/polls/${id}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body.participant_id).toBeTruthy()
    expect(body.token).toBeTruthy()
    expect(body.name).toBe('Alice')
    expect(body.rejoined).toBe(false)
  })

  it('returns existing participant for known token', async () => {
    const { id } = await seedPoll()
    const { token } = await seedParticipant(id, 'Bob')
    const res = await SELF.fetch(`http://example.com/polls/${id}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Participant-Token': token },
      body: JSON.stringify({ name: 'Bob' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.token).toBe(token)
  })

  it('reclaims existing participant by name when no token provided', async () => {
    const { id } = await seedPoll()
    const { token } = await seedParticipant(id, 'Alice')
    const res = await SELF.fetch(`http://example.com/polls/${id}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.token).toBe(token)
    expect(body.rejoined).toBe(true)
    expect(body.name).toBe('Alice')
  })
})
