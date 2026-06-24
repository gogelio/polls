import { describe, it, expect, beforeEach } from 'vitest'
import { SELF } from 'cloudflare:test'
import { applySchema, seedPoll, seedParticipant } from './helpers'

describe('GET /search/books', () => {
  beforeEach(applySchema)

  it('requires participant token', async () => {
    const res = await SELF.fetch('http://example.com/search/books?q=dune')
    expect(res.status).toBe(401)
  })

  it('returns 400 when q is missing', async () => {
    const { id } = await seedPoll()
    const { token } = await seedParticipant(id)
    const res = await SELF.fetch('http://example.com/search/books', {
      headers: { 'Participant-Token': token },
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /search/movies', () => {
  beforeEach(applySchema)

  it('requires participant token', async () => {
    const res = await SELF.fetch('http://example.com/search/movies?q=dune')
    expect(res.status).toBe(401)
  })
})
