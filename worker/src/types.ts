export type Category = 'book' | 'movie' | 'general'
export type VotingMethod = 'plurality' | 'ranked_choice' | 'ranked_pairs'
export type Phase = 'nominating' | 'voting' | 'closed'

export interface Env {
  DB: D1Database
  TMDB_API_KEY: string
  GOOGLE_BOOKS_API_KEY: string
}

export interface Poll {
  id: string
  admin_token: string
  title: string
  category: Category
  voting_method: VotingMethod
  phase: Phase
  max_nominations: number
  nominations_visible: number
  votes_visible: number
  nomination_closes_at: number | null
  created_at: number
}

export interface Participant {
  id: string
  poll_id: string
  name: string
  token: string
  joined_at: number
}

export interface Nomination {
  id: string
  poll_id: string
  participant_id: string
  title: string
  metadata: string | null
  created_at: number
}

export interface NominationMetadata {
  external_id?: string
  cover_url?: string
  poster_url?: string
  author?: string
  director?: string
  year?: number
}

export interface Vote {
  id: string
  poll_id: string
  participant_id: string
  nomination_id: string
  rank: number | null
  created_at: number
}

export interface RankedResult {
  nomination_id: string
  title: string
  metadata: string | null
  score: number
  percentage: number
}
