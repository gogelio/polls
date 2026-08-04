import type { Env, Poll } from '../types'

export interface PollDetailNomination {
  id: string
  title: string
  metadata: string | null
  participant_name: string
  created_at: number
}

export interface PollDetail {
  id: string
  title: string
  category: Poll['category']
  voting_method: Poll['voting_method']
  phase: Poll['phase']
  max_nominations: number
  nominations_visible: boolean
  votes_visible: boolean
  is_public: boolean
  is_paused: boolean
  nomination_closes_at: number | null
  nominations: PollDetailNomination[] | null
  has_voted: boolean
  draft_ranking: string[] | null
  participant_count: number
  created_at: number
}

export async function buildPollResponse(
  env: Env,
  id: string,
  participantToken: string | null
): Promise<PollDetail | null> {
  let poll = await env.DB.prepare(
    'SELECT id, title, category, voting_method, phase, max_nominations, nominations_visible, votes_visible, is_public, is_paused, nomination_closes_at, created_at FROM polls WHERE id = ?'
  ).bind(id).first<Poll>()
  if (!poll) return null

  // Auto-advance phase if nomination timer has expired
  if (poll.phase === 'nominating' && poll.nomination_closes_at && Date.now() > poll.nomination_closes_at) {
    await env.DB.prepare("UPDATE polls SET phase = 'voting' WHERE id = ? AND phase = 'nominating'").bind(id).run()
    poll = { ...poll, phase: 'voting' }
  }

  const showNominations = poll.phase !== 'nominating' || poll.nominations_visible === 1
  let nominations: PollDetailNomination[] | null = null

  if (showNominations) {
    const { results } = await env.DB.prepare(
      `SELECT n.id, n.title, n.metadata, p.name as participant_name, n.created_at
       FROM nominations n JOIN participants p ON n.participant_id = p.id
       WHERE n.poll_id = ? ORDER BY n.created_at ASC`
    ).bind(id).all<PollDetailNomination>()
    nominations = results
  }

  let hasVoted = false
  let draftRanking: string[] | null = null
  if (participantToken && poll.phase !== 'nominating') {
    const participant = await env.DB.prepare(
      'SELECT id, draft_ranking FROM participants WHERE token = ? AND poll_id = ?'
    ).bind(participantToken, id).first<{ id: string; draft_ranking: string | null }>()
    if (participant) {
      const voteRow = await env.DB.prepare(
        'SELECT id FROM votes WHERE poll_id = ? AND participant_id = ? LIMIT 1'
      ).bind(id, participant.id).first()
      hasVoted = !!voteRow
      if (poll.phase === 'voting' && poll.voting_method !== 'plurality' && !hasVoted && participant.draft_ranking) {
        try {
          const parsed = JSON.parse(participant.draft_ranking)
          draftRanking = Array.isArray(parsed) ? parsed as string[] : null
        } catch {
          draftRanking = null
        }
      }
    }
  }

  const participantCountRow = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM participants WHERE poll_id = ?'
  ).bind(id).first<{ count: number }>()

  return {
    id: poll.id,
    title: poll.title,
    category: poll.category,
    voting_method: poll.voting_method,
    phase: poll.phase,
    max_nominations: poll.max_nominations,
    nominations_visible: poll.nominations_visible === 1,
    votes_visible: poll.votes_visible === 1,
    is_public: poll.is_public === 1,
    is_paused: poll.is_paused === 1,
    nomination_closes_at: poll.nomination_closes_at,
    nominations,
    has_voted: hasVoted,
    draft_ranking: draftRanking,
    participant_count: participantCountRow?.count ?? 0,
    created_at: poll.created_at,
  }
}
