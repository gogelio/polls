import { env } from 'cloudflare:test'
import { nanoid } from 'nanoid'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS polls (
  id TEXT PRIMARY KEY, admin_token TEXT NOT NULL, title TEXT NOT NULL,
  category TEXT NOT NULL, voting_method TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'nominating', max_nominations INTEGER NOT NULL DEFAULT 3,
  nominations_visible INTEGER NOT NULL DEFAULT 1, votes_visible INTEGER NOT NULL DEFAULT 0,
  is_public INTEGER NOT NULL DEFAULT 1, is_paused INTEGER NOT NULL DEFAULT 0,
  nomination_closes_at INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY, poll_id TEXT NOT NULL, name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE, joined_at INTEGER NOT NULL, draft_ranking TEXT
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
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, admin_token TEXT NOT NULL, title TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS event_polls (
  event_id TEXT NOT NULL, poll_id TEXT NOT NULL, category TEXT NOT NULL,
  sort_order INTEGER NOT NULL, PRIMARY KEY (event_id, poll_id)
);
CREATE TABLE IF NOT EXISTS event_slots (
  event_id TEXT NOT NULL, day TEXT NOT NULL, slot_order INTEGER NOT NULL,
  category TEXT NOT NULL, placement INTEGER NOT NULL,
  PRIMARY KEY (event_id, day, slot_order)
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

export async function seedEvent(overrides: Record<string, unknown> = {}) {
  const id = (overrides.id as string) ?? nanoid(8)
  const adminToken = (overrides.admin_token as string) ?? nanoid(24)
  await env.DB.prepare(
    'INSERT INTO events (id, admin_token, title, is_public, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(
    id,
    adminToken,
    overrides.title ?? 'Test Event',
    overrides.is_public ?? 0,
    Date.now()
  ).run()
  return { id, adminToken }
}

export async function seedEventPoll(eventId: string, pollId: string, category: string, sortOrder = 0) {
  await env.DB.prepare(
    'INSERT INTO event_polls (event_id, poll_id, category, sort_order) VALUES (?, ?, ?, ?)'
  ).bind(eventId, pollId, category, sortOrder).run()
}

export async function seedEventSlot(eventId: string, day: string, slotOrder: number, category: string, placement: number) {
  await env.DB.prepare(
    'INSERT INTO event_slots (event_id, day, slot_order, category, placement) VALUES (?, ?, ?, ?, ?)'
  ).bind(eventId, day, slotOrder, category, placement).run()
}
