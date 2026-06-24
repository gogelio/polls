export type Category = 'book' | 'movie' | 'general'
export type VotingMethod = 'plurality' | 'ranked_choice' | 'ranked_pairs'
export type Phase = 'nominating' | 'voting' | 'closed'

export interface NominationMetadata {
  external_id?: string
  cover_url?: string
  poster_url?: string
  author?: string
  director?: string
  year?: number
}

export interface PollNomination {
  id: string
  title: string
  metadata: NominationMetadata | null
  participant_name: string
  created_at: number
}

export interface Poll {
  id: string
  title: string
  category: Category
  voting_method: VotingMethod
  phase: Phase
  max_nominations: number
  nominations_visible: boolean
  votes_visible: boolean
  nomination_closes_at: number | null
  nominations: PollNomination[] | null
  participant_count: number
  created_at: number
}

export interface RankedResult {
  nomination_id: string
  title: string
  metadata: string | null
  score: number
  percentage: number
}

export interface PollResults {
  poll_id: string
  voting_method: VotingMethod
  results: RankedResult[]
  total_voters: number
}

export interface SearchResult {
  external_id: string
  title: string
  author?: string | null
  director?: string | null
  year?: string | null
  cover_url?: string | null
  poster_url?: string | null
}
