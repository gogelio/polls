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
  is_public: boolean
  is_paused: boolean
  nomination_closes_at: number | null
  nominations: PollNomination[] | null
  has_voted: boolean
  draft_ranking: string[] | null
  own_vote: string[] | null
  participant_count: number
  created_at: number
}

export interface PublicPollSummary {
  id: string
  title: string
  category: Category
  phase: Phase
  participant_count: number
  nomination_closes_at: number | null
  created_at: number
}

export interface RankedResult {
  nomination_id: string
  title: string
  metadata: string | null
  nominated_by?: string
  score: number
  percentage: number
}

export interface VoterLuck {
  participant_id: string
  participant_name: string
  nomination_id: string
  title: string
  placement: number
  total: number
  score: number
}

export interface EventVoterStat {
  name: string
  average_score: number
  categories_counted: number
}

export interface PollResults {
  poll_id: string
  voting_method: VotingMethod
  results: RankedResult[]
  total_voters: number
  tied: boolean
  voter_stats?: { luckiest: VoterLuck[]; unluckiest: VoterLuck[] }
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

export interface EventCategory {
  category: string
  sort_order: number
  poll: Poll
}

export interface EventSlotMovie {
  nomination_id: string
  title: string
}

export interface EventSlot {
  slot_order: number
  category: string
  placement: 1 | 2
  status: 'awaiting_votes' | 'resolved' | 'unresolved' | 'hidden'
  movies: EventSlotMovie[]
}

export interface EventDay {
  day: string
  slots: EventSlot[]
}

export interface EventPayload {
  id: string
  title: string
  is_public: boolean
  phase: Phase
  categories: EventCategory[]
  schedule: EventDay[]
  voter_count: number
  voter_stats?: { luckiest: EventVoterStat[]; unluckiest: EventVoterStat[] }
  created_at: number
}
