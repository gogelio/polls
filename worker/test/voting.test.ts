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
  it('assigns Borda points and sorts by score descending', () => {
    // 3 candidates (N=3): 1st=3pts, 2nd=2pts, 3rd=1pt
    // p1: a>b>c → a gets 3, b gets 2, c gets 1
    // p2: b>a>c → b gets 3, a gets 2, c gets 1
    // Totals: a=5, b=5, c=2
    // Tie between a and b — a comes first in nominations array
    const votes: VoteRow[] = [
      { participant_id: 'p1', nomination_id: 'a', rank: 1 },
      { participant_id: 'p1', nomination_id: 'b', rank: 2 },
      { participant_id: 'p1', nomination_id: 'c', rank: 3 },
      { participant_id: 'p2', nomination_id: 'b', rank: 1 },
      { participant_id: 'p2', nomination_id: 'a', rank: 2 },
      { participant_id: 'p2', nomination_id: 'c', rank: 3 },
    ]
    const results = rankedChoice(votes, noms)
    expect(results[0]!.nomination_id).toBe('a')
    expect(results[0]!.score).toBe(5)
    expect(results[1]!.nomination_id).toBe('b')
    expect(results[1]!.score).toBe(5)
    expect(results[2]!.nomination_id).toBe('c')
    expect(results[2]!.score).toBe(2)
  })

  it('calculates percentage as score / (N * voterCount) * 100 rounded', () => {
    // N=3, voterCount=2, maxPossible=6
    // p1: a>b>c → a=3, b=2, c=1
    // p2: a>b>c → a=3, b=2, c=1
    // Totals: a=6 (100%), b=4 (67%), c=2 (33%)
    const votes: VoteRow[] = [
      { participant_id: 'p1', nomination_id: 'a', rank: 1 },
      { participant_id: 'p1', nomination_id: 'b', rank: 2 },
      { participant_id: 'p1', nomination_id: 'c', rank: 3 },
      { participant_id: 'p2', nomination_id: 'a', rank: 1 },
      { participant_id: 'p2', nomination_id: 'b', rank: 2 },
      { participant_id: 'p2', nomination_id: 'c', rank: 3 },
    ]
    const results = rankedChoice(votes, noms)
    expect(results[0]!.percentage).toBe(100)
    expect(results[1]!.percentage).toBe(67)
    expect(results[2]!.percentage).toBe(33)
  })

  it('gives 0 points to unranked candidates', () => {
    // p1 only ranks a (rank 1) — b and c are unranked → 0 pts each
    // N=3, voterCount=1, maxPossible=3
    // a = 3pts (100%), b = 0pts (0%), c = 0pts (0%)
    const votes: VoteRow[] = [
      { participant_id: 'p1', nomination_id: 'a', rank: 1 },
    ]
    const results = rankedChoice(votes, noms)
    expect(results[0]!.nomination_id).toBe('a')
    expect(results[0]!.score).toBe(3)
    expect(results[0]!.percentage).toBe(100)
    expect(results[1]!.score).toBe(0)
    expect(results[1]!.percentage).toBe(0)
    expect(results[2]!.score).toBe(0)
    expect(results[2]!.percentage).toBe(0)
  })

  it('returns 100% for single candidate', () => {
    const singleNom: NominationRow[] = [{ id: 'a', title: 'A', metadata: null }]
    const votes: VoteRow[] = [
      { participant_id: 'p1', nomination_id: 'a', rank: 1 },
    ]
    const results = rankedChoice(votes, singleNom)
    expect(results[0]!.nomination_id).toBe('a')
    expect(results[0]!.percentage).toBe(100)
  })

  it('returns zero scores when no votes', () => {
    const results = rankedChoice([], noms)
    expect(results.every(r => r.score === 0)).toBe(true)
    expect(results.every(r => r.percentage === 0)).toBe(true)
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
