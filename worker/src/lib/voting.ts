export interface VoteRow {
  participant_id: string
  nomination_id: string
  rank: number | null
}

export interface NominationRow {
  id: string
  title: string
  metadata: string | null
  nominated_by?: string
}

export interface RankedResult {
  nomination_id: string
  title: string
  metadata: string | null
  nominated_by?: string
  score: number
  percentage: number
}

export function plurality(votes: VoteRow[], nominations: NominationRow[]): RankedResult[] {
  const counts = new Map<string, number>()
  for (const nom of nominations) counts.set(nom.id, 0)
  for (const vote of votes) counts.set(vote.nomination_id, (counts.get(vote.nomination_id) ?? 0) + 1)
  const total = votes.length
  return [...nominations]
    .map(nom => ({
      nomination_id: nom.id, title: nom.title, metadata: nom.metadata, nominated_by: nom.nominated_by,
      score: counts.get(nom.id) ?? 0,
      percentage: total > 0 ? Math.round(((counts.get(nom.id) ?? 0) / total) * 100) : 0,
    }))
    .sort((a, b) => b.score - a.score)
}

function buildBallots(votes: VoteRow[]): Map<string, string[]> {
  const map = new Map<string, Array<{ nomination_id: string; rank: number }>>()
  for (const v of votes) {
    if (v.rank === null) continue
    if (!map.has(v.participant_id)) map.set(v.participant_id, [])
    map.get(v.participant_id)!.push({ nomination_id: v.nomination_id, rank: v.rank })
  }
  const result = new Map<string, string[]>()
  for (const [pid, items] of map) {
    result.set(pid, items.sort((a, b) => a.rank - b.rank).map(i => i.nomination_id))
  }
  return result
}

export function rankedChoice(votes: VoteRow[], nominations: NominationRow[]): RankedResult[] {
  const N = nominations.length
  if (N === 0) return []

  const voterIds = new Set(votes.map(v => v.participant_id))
  const voterCount = voterIds.size
  const maxPossible = N * voterCount

  const scores = new Map<string, number>()
  for (const nom of nominations) scores.set(nom.id, 0)

  for (const vote of votes) {
    if (vote.rank === null) continue
    const points = N - vote.rank + 1
    if (points > 0) scores.set(vote.nomination_id, (scores.get(vote.nomination_id) ?? 0) + points)
  }

  return [...nominations]
    .map(nom => ({
      nomination_id: nom.id,
      title: nom.title,
      metadata: nom.metadata,
      nominated_by: nom.nominated_by,
      score: scores.get(nom.id) ?? 0,
      percentage: maxPossible > 0
        ? Math.round(((scores.get(nom.id) ?? 0) / maxPossible) * 100)
        : 0,
    }))
    .sort((a, b) => b.score - a.score)
}

function createsCycle(locked: Map<string, Set<string>>, from: string, to: string): boolean {
  const visited = new Set<string>()
  const queue = [to]
  while (queue.length > 0) {
    const node = queue.shift()!
    if (node === from) return true
    if (visited.has(node)) continue
    visited.add(node)
    const successors = locked.get(node)
    if (successors) for (const s of successors) queue.push(s)
  }
  return false
}

export function rankedPairs(votes: VoteRow[], nominations: NominationRow[]): RankedResult[] {
  const ballots = Array.from(buildBallots(votes).values())
  const ids = nominations.map(n => n.id)
  const prefer = new Map<string, Map<string, number>>()
  for (const id of ids) prefer.set(id, new Map())

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i]!, b = ids[j]!
      let prefAB = 0, prefBA = 0
      for (const ballot of ballots) {
        const posA = ballot.indexOf(a), posB = ballot.indexOf(b)
        const ra = posA === -1 ? Infinity : posA, rb = posB === -1 ? Infinity : posB
        if (ra < rb) prefAB++; else if (rb < ra) prefBA++
      }
      prefer.get(a)!.set(b, prefAB)
      prefer.get(b)!.set(a, prefBA)
    }
  }

  const victories: Array<{ winner: string; loser: string; margin: number }> = []
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i]!, b = ids[j]!
      const ab = prefer.get(a)!.get(b) ?? 0, ba = prefer.get(b)!.get(a) ?? 0
      if (ab > ba) victories.push({ winner: a, loser: b, margin: ab - ba })
      else if (ba > ab) victories.push({ winner: b, loser: a, margin: ba - ab })
    }
  }
  victories.sort((a, b) => b.margin - a.margin)

  const locked = new Map<string, Set<string>>()
  for (const id of ids) locked.set(id, new Set())
  for (const { winner, loser } of victories) {
    if (!createsCycle(locked, winner, loser)) locked.get(winner)!.add(loser)
  }

  const hasLockedDefeat = new Set<string>()
  for (const [, losers] of locked) for (const loser of losers) hasLockedDefeat.add(loser)
  const winner = ids.find(id => !hasLockedDefeat.has(id)) ?? ids[0]!

  const pairwiseWins = new Map<string, number>()
  for (const id of ids) {
    let wins = 0
    for (const other of ids) {
      if (other !== id && (prefer.get(id)!.get(other) ?? 0) > (prefer.get(other)!.get(id) ?? 0)) wins++
    }
    pairwiseWins.set(id, wins)
  }

  return [...nominations]
    .sort((a, b) => {
      if (a.id === winner) return -1
      if (b.id === winner) return 1
      return (pairwiseWins.get(b.id) ?? 0) - (pairwiseWins.get(a.id) ?? 0)
    })
    .map((nom, i) => ({
      nomination_id: nom.id, title: nom.title, metadata: nom.metadata, nominated_by: nom.nominated_by,
      score: pairwiseWins.get(nom.id) ?? 0,
      percentage: i === 0 ? 100 : ids.length > 1
        ? Math.round(((pairwiseWins.get(nom.id) ?? 0) / (ids.length - 1)) * 100)
        : 0,
    }))
}
