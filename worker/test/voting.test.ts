import { describe, it, expect } from 'vitest'
import { plurality, rankedChoice, rankedPairs, computeVoterLuck } from '../src/lib/voting'
import type { VoteRow, NominationRow, RankedResult, VoterLuck } from '../src/lib/voting'
import { resolveSlot } from '../src/lib/bracket'

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

describe('resolveSlot', () => {
  it('reports awaiting_votes when nobody has voted yet', () => {
    const results: RankedResult[] = [
      { nomination_id: 'a', title: 'A', metadata: null, score: 0, percentage: 0 },
      { nomination_id: 'b', title: 'B', metadata: null, score: 0, percentage: 0 },
    ]
    expect(resolveSlot(results, 1)).toEqual({ status: 'awaiting_votes', movies: [] })
  })

  it('resolves 1st and 2nd place from distinct score tiers', () => {
    const results: RankedResult[] = [
      { nomination_id: 'a', title: 'A', metadata: null, score: 5, percentage: 100 },
      { nomination_id: 'b', title: 'B', metadata: null, score: 3, percentage: 60 },
      { nomination_id: 'c', title: 'C', metadata: null, score: 1, percentage: 20 },
    ]
    expect(resolveSlot(results, 1)).toEqual({ status: 'resolved', movies: [{ nomination_id: 'a', title: 'A' }] })
    expect(resolveSlot(results, 2)).toEqual({ status: 'resolved', movies: [{ nomination_id: 'b', title: 'B' }] })
  })

  it('groups every tied movie into the same placement', () => {
    const results: RankedResult[] = [
      { nomination_id: 'a', title: 'A', metadata: null, score: 5, percentage: 100 },
      { nomination_id: 'b', title: 'B', metadata: null, score: 5, percentage: 100 },
      { nomination_id: 'c', title: 'C', metadata: null, score: 1, percentage: 20 },
    ]
    const first = resolveSlot(results, 1)
    expect(first.status).toBe('resolved')
    expect(first.movies.map(m => m.nomination_id).sort()).toEqual(['a', 'b'])
    expect(resolveSlot(results, 2)).toEqual({ status: 'resolved', movies: [{ nomination_id: 'c', title: 'C' }] })
  })

  it('reports unresolved for 2nd place when everything is tied for 1st', () => {
    const results: RankedResult[] = [
      { nomination_id: 'a', title: 'A', metadata: null, score: 2, percentage: 100 },
      { nomination_id: 'b', title: 'B', metadata: null, score: 2, percentage: 100 },
    ]
    expect(resolveSlot(results, 2)).toEqual({ status: 'unresolved', movies: [] })
  })
})

describe('computeVoterLuck', () => {
  const results: RankedResult[] = [
    { nomination_id: 'a', title: 'A', metadata: null, score: 10, percentage: 50 },
    { nomination_id: 'b', title: 'B', metadata: null, score: 6, percentage: 30 },
    { nomination_id: 'c', title: 'C', metadata: null, score: 2, percentage: 20 },
  ]
  const names = new Map([['p1', 'Alice'], ['p2', 'Bob'], ['p3', 'Carol']])

  it('uses the single vote for plurality (rank=null)', () => {
    const votes: VoteRow[] = [
      { participant_id: 'p1', nomination_id: 'a', rank: null },
      { participant_id: 'p2', nomination_id: 'c', rank: null },
    ]
    const luck = computeVoterLuck(votes, results, names)
    expect(luck).toHaveLength(2)
    const alice = luck.find(l => l.participant_id === 'p1')!
    expect(alice.placement).toBe(1)
    expect(alice.score).toBe(1)
    expect(alice.participant_name).toBe('Alice')
    expect(alice.title).toBe('A')
    const bob = luck.find(l => l.participant_id === 'p2')!
    expect(bob.placement).toBe(3)
    expect(bob.score).toBe(0)
  })

  it('uses only the rank=1 entry for a ranked ballot, ignoring later ranks', () => {
    const votes: VoteRow[] = [
      { participant_id: 'p1', nomination_id: 'b', rank: 1 },
      { participant_id: 'p1', nomination_id: 'a', rank: 2 },
      { participant_id: 'p1', nomination_id: 'c', rank: 3 },
    ]
    const luck = computeVoterLuck(votes, results, names)
    expect(luck).toHaveLength(1)
    expect(luck[0]!.nomination_id).toBe('b')
    expect(luck[0]!.placement).toBe(2)
  })

  it('skips a voter whose top pick is not in results (e.g. a removed nomination)', () => {
    const votes: VoteRow[] = [{ participant_id: 'p1', nomination_id: 'ghost', rank: null }]
    const luck = computeVoterLuck(votes, results, names)
    expect(luck).toHaveLength(0)
  })

  it('sorts luckiest (lowest placement) first', () => {
    const votes: VoteRow[] = [
      { participant_id: 'p1', nomination_id: 'c', rank: null },
      { participant_id: 'p2', nomination_id: 'a', rank: null },
      { participant_id: 'p3', nomination_id: 'b', rank: null },
    ]
    const luck = computeVoterLuck(votes, results, names)
    expect(luck.map(l => l.participant_id)).toEqual(['p2', 'p3', 'p1'])
  })

  it('gives everyone a score of 1 when there is only one nomination', () => {
    const single: RankedResult[] = [{ nomination_id: 'a', title: 'A', metadata: null, score: 1, percentage: 100 }]
    const votes: VoteRow[] = [{ participant_id: 'p1', nomination_id: 'a', rank: null }]
    const luck = computeVoterLuck(votes, single, names)
    expect(luck[0]!.score).toBe(1)
  })
})
