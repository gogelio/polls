import type { RankedResult } from './voting'

export type SlotStatus = 'awaiting_votes' | 'resolved' | 'unresolved'

export interface SlotMovie {
  nomination_id: string
  title: string
}

export interface ResolvedSlot {
  status: SlotStatus
  movies: SlotMovie[]
}

export function resolveSlot(results: RankedResult[], placement: 1 | 2): ResolvedSlot {
  if (results.length === 0 || results.every(r => r.score === 0)) {
    return { status: 'awaiting_votes', movies: [] }
  }

  const tiers: RankedResult[][] = []
  for (const r of results) {
    const lastTier = tiers[tiers.length - 1]
    if (lastTier && lastTier[0]!.score === r.score) {
      lastTier.push(r)
    } else {
      tiers.push([r])
    }
  }

  const tier = tiers[placement - 1]
  if (!tier) return { status: 'unresolved', movies: [] }

  return {
    status: 'resolved',
    movies: tier.map(r => ({ nomination_id: r.nomination_id, title: r.title })),
  }
}
