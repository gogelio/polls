import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import type { Env, Poll, Vote, Nomination } from '../types'
import { participantAuth } from '../middleware/auth'
import { plurality, rankedChoice, rankedPairs } from '../lib/voting'

type Variables = { participantId: string }
export const votesRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

votesRouter.post('/:id/votes', participantAuth, async (c) => {
  const pollId = c.req.param('id')
  const participantId = c.get('participantId')

  const poll = await c.env.DB.prepare(
    'SELECT id, phase, voting_method FROM polls WHERE id = ?'
  ).bind(pollId).first<Pick<Poll, 'id' | 'phase' | 'voting_method'>>()
  if (!poll) return c.json({ error: 'Poll not found' }, 404)
  if (poll.phase !== 'voting') return c.json({ error: 'Poll is not in voting phase' }, 400)

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
    ...voteItems.map(item =>
      c.env.DB.prepare(
        'INSERT INTO votes (id, poll_id, participant_id, nomination_id, rank, created_at) VALUES (?,?,?,?,?,?)'
      ).bind(nanoid(8), pollId, participantId, item.nomination_id, item.rank ?? null, Date.now())
    ),
  ]
  await c.env.DB.batch(statements)

  return c.json({ success: true })
})

votesRouter.get('/:id/results', async (c) => {
  const pollId = c.req.param('id')
  const poll = await c.env.DB.prepare(
    'SELECT id, phase, voting_method, votes_visible FROM polls WHERE id = ?'
  ).bind(pollId).first<Pick<Poll, 'id' | 'phase' | 'voting_method' | 'votes_visible'>>()
  if (!poll) return c.json({ error: 'Poll not found' }, 404)

  if (poll.phase === 'voting' && poll.votes_visible === 0) {
    return c.json({ error: 'Results not yet visible' }, 403)
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

  return c.json({ poll_id: pollId, voting_method: poll.voting_method, results, total_voters: voterCount, tied })
})
