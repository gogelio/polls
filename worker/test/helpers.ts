import { env } from 'cloudflare:test'
import { nanoid } from 'nanoid'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS polls (
  id TEXT PRIMARY KEY, admin_token TEXT NOT NULL, title TEXT NOT NULL,
  category TEXT NOT NULL, voting_method TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'nominating', max_nominations INTEGER NOT NULL DEFAULT 3,
  nominations_visible INTEGER NOT NULL DEFAULT 1, votes_visible INTEGER NOT NULL DEFAULT 0,
  is_public INTEGER NOT NULL DEFAULT 1,
  nomination_closes_at INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY, poll_id TEXT NOT NULL, name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE, joined_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS nominations (
  id TEXT PRIMARY KEY, poll_id TEXT NOT NULL, participant_id TEXT NOT NULL,
  title TEXT NOT NULL, metadata TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS votes (
  id TEXT PRIMARY KEY, poll_id TEXT NOT NULL, participant_id TEXT NOT NULL,
  nomination_id TEXT NOT NULL, rank INTEGER, created_at INTEGER NOT NULL,
  UNIQUE(poll_id, participant_id, nomination_id),
  UNIQUE(poll_id, participant_id, rank)
);`

export async function applySchema() {
  const statements = SCHEMA.split(';').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean)
  for (const sql of statements) {
    await env.DB.exec(sql + ';')
  }
}

export async function seedPoll(overrides: Record<string, unknown> = {}) {
  const id = nanoid(8)
  const adminToken = nanoid(24)
  await env.DB.prepare(
    `INSERT INTO polls (id, admin_token, title, category, voting_method, max_nominations, nomination_closes_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    overrides.id ?? id,
    overrides.admin_token ?? adminToken,
    overrides.title ?? 'Test Poll',
    overrides.category ?? 'general',
    overrides.voting_method ?? 'plurality',
    overrides.max_nominations ?? 3,
    overrides.nomination_closes_at ?? null,
    Date.now()
  ).run()
  return { id: (overrides.id ?? id) as string, adminToken: (overrides.admin_token ?? adminToken) as string }
}

export async function seedParticipant(pollId: string, name = 'Alice') {
  const id = nanoid(8)
  const token = nanoid(24)
  await env.DB.prepare(
    'INSERT INTO participants (id, poll_id, name, token, joined_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, pollId, name, token, Date.now()).run()
  return { id, token }
}

export async function seedNomination(pollId: string, participantId: string, title = 'Item A') {
  const id = nanoid(8)
  await env.DB.prepare(
    'INSERT INTO nominations (id, poll_id, participant_id, title, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, pollId, participantId, title, Date.now()).run()
  return { id }
}
