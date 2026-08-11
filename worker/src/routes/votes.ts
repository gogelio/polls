import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import type { Env, Poll, Vote, Nomination } from '../types'
import { participantAuth, isValidAdminToken } from '../middleware/auth'
import { plurality, rankedChoice, rankedPairs, computeVoterLuck, type VoterLuck } from '../lib/voting'

type Variables = { participantId: string }
export const votesRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

votesRouter.post('/:id/votes', participantAuth, async (c) => {
  const pollId = c.req.param('id')
  const participantId = c.get('participantId')

  const poll = await c.env.DB.prepare(
    'SELECT id, phase, voting_method, is_paused FROM polls WHERE id = ?'
  ).bind(pollId).first<Pick<Poll, 'id' | 'phase' | 'voting_method' | 'is_paused'>>()
  if (!poll) return c.json({ error: 'Poll not found' }, 404)
  if (poll.phase !== 'voting') return c.json({ error: 'Poll is not in voting phase' }, 400)
  if (poll.is_paused) return c.json({ error: 'Poll is paused' }, 403)

  const voteItems = await c.req.json<Array<{ nomination_id: string; rank: number | null }>>()
  if (!Array.isArray(voteItems) || voteItems.length === 0) {
    return c.json({ error: 'votes must be a non-empty array' }, 400)
  }

  // Verify all nominations belong to this poll
  const { results: nomResults } = await c.env.DB.prepare(
    'SELECT id FROM nominations WHERE poll_id = ?'
  ).bind(pollId).all<{ id: string }>()
  const validNomIds = new Set(nomResults.map(n => n.id))
  for (const item of voteItems) {
    if (!validNomIds.has(item.nomination_id)) {
      return c.json({ error: `Nomination ${item.nomination_id} not found in this poll` }, 400)
    }
  }

  // Replace prior votes atomically via D1 batch
  const statements = [
    c.env.DB.prepare('DELETE FROM votes WHERE poll_id = ? AND participant_id = ?').bind(pollId, participantId),
    c.env.DB.prepare('UPDATE participants SET draft_ranking = NULL WHERE id = ?').bind(participantId),
    ...voteItems.map(item =>
      c.env.DB.prepare(
        'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
      ).bind(nanoid(8), pollId, participantId, item.nomination_id, item.rank ?? null, Date.now())
    ),
  ]
  await c.env.DB.batch(statements)

  return c.json({ success: true })
})

votesRouter.patch('/:id/vote-draft', participantAuth, async (c) => {
  const pollId = c.req.param('id')
  const participantId = c.get('participantId')

  const poll = await c.env.DB.prepare(
    'SELECT id, phase, voting_method, is_paused FROM polls WHERE id = ?'
  ).bind(pollId).first<Pick<Poll, 'id' | 'phase' | 'voting_method' | 'is_paused'>>()
  if (!poll) return c.json({ error: 'Poll not found' }, 404)
  if (poll.phase !== 'voting') return c.json({ error: 'Poll is not in voting phase' }, 400)
  if (poll.is_paused) return c.json({ error: 'Poll is paused' }, 403)
  if (poll.voting_method === 'plurality') {
    return c.json({ error: 'Drafts are not supported for plurality polls' }, 400)
  }

  const existingVote = await c.env.DB.prepare(
    'SELECT id FROM votes WHERE poll_id = ? AND participant_id = ? LIMIT 1'
  ).bind(pollId, participantId).first()
  if (existingVote) return c.json({ error: 'You have already voted' }, 400)

  const body = await c.req.json<{ ranking?: string[] }>()
  const ranking = body.ranking
  if (!Array.isArray(ranking) || ranking.length === 0) {
    return c.json({ error: 'ranking must be a non-empty array' }, 400)
  }

  const { results: nomResults } = await c.env.DB.prepare(
    'SELECT id FROM nominations WHERE poll_id = ?'
  ).bind(pollId).all<{ id: string }>()
  const validNomIds = new Set(nomResults.map(n => n.id))
  for (const nomId of ranking) {
    if (!validNomIds.has(nomId)) {
      return c.json({ error: `Nomination ${nomId} not found in this poll` }, 400)
    }
  }
  if (ranking.length > validNomIds.size || new Set(ranking).size !== ranking.length) {
    return c.json({ error: 'ranking must not exceed the nomination count or contain duplicates' }, 400)
  }

  await c.env.DB.prepare(
    'UPDATE participants SET draft_ranking = ? WHERE id = ?'
  ).bind(JSON.stringify(ranking), participantId).run()

  return c.json({ success: true })
})

votesRouter.get('/:id/results', async (c) => {
  const pollId = c.req.param('id')
  const poll = await c.env.DB.prepare(
    'SELECT id, phase, voting_method, votes_visible FROM polls WHERE id = ?'
  ).bind(pollId).first<Pick<Poll, 'id' | 'phase' | 'voting_method' | 'votes_visible'>>()
  if (!poll) return c.json({ error: 'Poll not found' }, 404)

  if (poll.phase === 'voting' && poll.votes_visible === 0) {
    // An event's admin can still preview live results for its category polls
    // while voting is in progress, even with votes hidden from the public —
    // scoped to event-linked polls only, so a standalone poll's admin sees
    // the same "not yet visible" behavior as everyone else.
    const link = await c.env.DB.prepare(
      'SELECT 1 FROM event_polls WHERE poll_id = ?'
    ).bind(pollId).first()
    const adminToken = c.req.query('admin')
    const isEventAdmin = !!link && await isValidAdminToken(c.env, pollId, adminToken)
    if (!isEventAdmin) return c.json({ error: 'Results not yet visible' }, 403)
  }
  if (poll.phase === 'nominating') {
    return c.json({ error: 'Voting has not started' }, 403)
  }

  const { results: nominations } = await c.env.DB.prepare(
    'SELECT n.id, n.title, n.metadata, p.name AS nominated_by FROM nominations n JOIN participants p ON n.participant_id = p.id WHERE n.poll_id = ?'
  ).bind(pollId).all<Nomination & { nominated_by: string }>()

  const { results: votes } = await c.env.DB.prepare(
    'SELECT participant_id, nomination_id, rank FROM votes WHERE poll_id = ?'
  ).bind(pollId).all<Vote>()

  const voterCount = new Set(votes.map(v => v.participant_id)).size

  let results
  if (poll.voting_method === 'plurality') results = plurality(votes, nominations)
  else if (poll.voting_method === 'ranked_choice') results = rankedChoice(votes, nominations)
  else results = rankedPairs(votes, nominations)

  const tied = results.length > 1 && results[0]?.score === results[1]?.score

  const isAuthorizedForVoterStats = poll.phase === 'closed'
    || (poll.phase === 'voting' && await isValidAdminToken(c.env, pollId, c.req.query('admin')))

  let voterStats: { luckiest: VoterLuck[]; unluckiest: VoterLuck[] } | undefined
  if (isAuthorizedForVoterStats) {
    const { results: participants } = await c.env.DB.prepare(
      'SELECT id, name FROM participants WHERE poll_id = ?'
    ).bind(pollId).all<{ id: string; name: string }>()
    const nameById = new Map(participants.map(p => [p.id, p.name]))
    const luck = computeVoterLuck(votes, results, nameById)
    // Split into non-overlapping halves (each capped at 3) rather than raw
    // slice(0,3)/slice(-3) — with few voters those windows overlap and the
    // same person shows up as both luckiest and unluckiest.
    const luckyCount = Math.min(3, Math.ceil(luck.length / 2))
    const unluckyCount = Math.min(3, luck.length - luckyCount)
    voterStats = {
      luckiest: luck.slice(0, luckyCount),
      unluckiest: luck.slice(luck.length - unluckyCount).reverse(),
    }
  }

  return c.json({
    poll_id: pollId,
    voting_method: poll.voting_method,
    results,
    total_voters: voterCount,
    tied,
    voter_stats: voterStats,
  })
})
