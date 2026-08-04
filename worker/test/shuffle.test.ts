import { describe, it, expect } from 'vitest'
import { shuffleKey, shuffleByParticipant } from '../src/lib/shuffle'

describe('shuffleKey', () => {
  it('is deterministic for the same participant and nomination', () => {
    expect(shuffleKey('p1', 'n1')).toBe(shuffleKey('p1', 'n1'))
  })

  it('differs for different participants against the same nomination', () => {
    const a = shuffleKey('p1', 'n1')
    const b = shuffleKey('p2', 'n1')
    expect(a).not.toBe(b)
  })
})

describe('shuffleByParticipant', () => {
  it('returns all the same items, just reordered', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
    const shuffled = shuffleByParticipant(items, 'participant-1')
    expect(shuffled.map(i => i.id).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('produces the same order across repeated calls for the same participant', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }]
    const first = shuffleByParticipant(items, 'participant-1').map(i => i.id)
    const second = shuffleByParticipant(items, 'participant-1').map(i => i.id)
    expect(second).toEqual(first)
  })

  it('produces a different order than input order for at least one of several participants', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}` }))
    const inputOrder = items.map(i => i.id)
    const anyDifferent = ['p1', 'p2', 'p3', 'p4', 'p5'].some(pid =>
      shuffleByParticipant(items, pid).map(i => i.id).join(',') !== inputOrder.join(',')
    )
    expect(anyDifferent).toBe(true)
  })

  it('does not mutate the input array', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const original = [...items]
    shuffleByParticipant(items, 'participant-1')
    expect(items).toEqual(original)
  })
})
