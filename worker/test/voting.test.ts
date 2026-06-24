import { describe, it, expect } from 'vitest'
import { plurality, rankedChoice, rankedPairs } from '../src/lib/voting'
import type { VoteRow, NominationRow } from '../src/lib/voting'

const noms: NominationRow[] = [
  { id: 'a', title: 'A', metadata: null },
  { id: 'b', title: 'B', metadata: null },
  { id: 'c', title: 'C', metadata: null },
]

describe('plurality', () => {
  it('picks the nomination with most votes', () => {
    const votes: VoteRow[] = [
      { participant_id: 'p1', nomination_id: 'a', rank: null },
      { participant_id: 'p2', nomination_id: 'a', rank: null },
      { participant_id: 'p3', nomination_id: 'b', rank: null },
    ]
    const results = plurality(votes, noms)
    expect(results[0]!.nomination_id).toBe('a')
    expect(results[0]!.score).toBe(2)
    expect(results[1]!.nomination_id).toBe('b')
  })

  it('returns zero scores when no votes', () => {
    const results = plurality([], noms)
    expect(results.every(r => r.score === 0)).toBe(true)
  })
})

describe('rankedChoice', () => {
  it('picks winner with outright majority', () => {
    const votes: VoteRow[] = [
      { participant_id: 'p1', nomination_id: 'a', rank: 1 },
      { participant_id: 'p1', nomination_id: 'b', rank: 2 },
      { participant_id: 'p2', nomination_id: 'a', rank: 1 },
      { participant_id: 'p2', nomination_id: 'c', rank: 2 },
      { participant_id: 'p3', nomination_id: 'a', rank: 1 },
    ]
    const results = rankedChoice(votes, noms)
    expect(results[0]!.nomination_id).toBe('a')
  })

  it('eliminates and redistributes to find winner', () => {
    // p1: a>b>c, p2: b>c>a, p3: b>a>c, p4: c>b>a
    // Round 1: a=1, b=2, c=1. Tie between a and c for fewest votes.
    // Tie-breaking: eliminate the one that appears first in nominations order → 'a' is eliminated.
    // After eliminating a: p1's vote goes to b, p2 stays b, p3 stays b, p4 stays c.
    // Round 2: b=3, c=1 → b wins.
    const votes: VoteRow[] = [
      { participant_id: 'p1', nomination_id: 'a', rank: 1 },
      { participant_id: 'p1', nomination_id: 'b', rank: 2 },
      { participant_id: 'p1', nomination_id: 'c', rank: 3 },
      { participant_id: 'p2', nomination_id: 'b', rank: 1 },
      { participant_id: 'p2', nomination_id: 'c', rank: 2 },
      { participant_id: 'p2', nomination_id: 'a', rank: 3 },
      { participant_id: 'p3', nomination_id: 'b', rank: 1 },
      { participant_id: 'p3', nomination_id: 'a', rank: 2 },
      { participant_id: 'p3', nomination_id: 'c', rank: 3 },
      { participant_id: 'p4', nomination_id: 'c', rank: 1 },
      { participant_id: 'p4', nomination_id: 'b', rank: 2 },
      { participant_id: 'p4', nomination_id: 'a', rank: 3 },
    ]
    const results = rankedChoice(votes, noms)
    expect(results[0]!.nomination_id).toBe('b')
  })
})

describe('rankedPairs', () => {
  it('finds Condorcet winner when one exists', () => {
    // b beats a and c head-to-head → b is Condorcet winner
    // p1: b>a>c, p2: b>c>a, p3: a>b>c → b beats a 2:1, b beats c 3:0
    const votes: VoteRow[] = [
      { participant_id: 'p1', nomination_id: 'b', rank: 1 },
      { participant_id: 'p1', nomination_id: 'a', rank: 2 },
      { participant_id: 'p1', nomination_id: 'c', rank: 3 },
      { participant_id: 'p2', nomination_id: 'b', rank: 1 },
      { participant_id: 'p2', nomination_id: 'c', rank: 2 },
      { participant_id: 'p2', nomination_id: 'a', rank: 3 },
      { participant_id: 'p3', nomination_id: 'a', rank: 1 },
      { participant_id: 'p3', nomination_id: 'b', rank: 2 },
      { participant_id: 'p3', nomination_id: 'c', rank: 3 },
    ]
    const results = rankedPairs(votes, noms)
    expect(results[0]!.nomination_id).toBe('b')
  })
})
