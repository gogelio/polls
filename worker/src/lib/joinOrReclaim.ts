import { nanoid } from 'nanoid'
import type { Env, Participant } from '../types'

export interface JoinResult {
  participant_id: string
  token: string
  name: string
  rejoined: boolean
  created: boolean
}

export interface JoinError {
  error: string
  status: 400 | 404
}

export async function joinOrReclaim(
  env: Env,
  pollId: string,
  name: string,
  existingToken: string | null
): Promise<JoinResult | JoinError> {
  if (existingToken) {
    const existing = await env.DB.prepare(
      'SELECT * FROM participants WHERE token = ? AND poll_id = ?'
    ).bind(existingToken, pollId).first<Participant>()
    if (existing) {
      return { participant_id: existing.id, token: existing.token, name: existing.name, rejoined: false, created: false }
    }
    // Token not found for this poll — fall through to name-based reclaim
  }

  const trimmedName = name.trim()

  if (trimmedName) {
    const byName = await env.DB.prepare(
      'SELECT * FROM participants WHERE poll_id = ? AND LOWER(name) = LOWER(?)'
    ).bind(pollId, trimmedName).first<Participant>()
    if (byName) {
      return { participant_id: byName.id, token: byName.token, name: byName.name, rejoined: true, created: false }
    }
  }

  if (!trimmedName) return { error: 'name is required', status: 400 }

  const poll = await env.DB.prepare('SELECT id FROM polls WHERE id = ?').bind(pollId).first()
  if (!poll) return { error: 'Poll not found', status: 404 }

  const id = nanoid(8)
  const token = nanoid(24)
  await env.DB.prepare(
    'INSERT INTO participants (id, poll_id, name, token, joined_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, pollId, trimmedName, token, Date.now()).run()

  return { participant_id: id, token, name: trimmedName, rejoined: false, created: true }
}
