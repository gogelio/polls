CREATE TABLE IF NOT EXISTS polls (
  id TEXT PRIMARY KEY,
  admin_token TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('book','movie','general')),
  voting_method TEXT NOT NULL CHECK(voting_method IN ('plurality','ranked_choice','ranked_pairs')),
  phase TEXT NOT NULL DEFAULT 'nominating' CHECK(phase IN ('nominating','voting','closed')),
  max_nominations INTEGER NOT NULL DEFAULT 3,
  nominations_visible INTEGER NOT NULL DEFAULT 1,
  votes_visible INTEGER NOT NULL DEFAULT 0,
  nomination_closes_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id),
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  joined_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS nominations (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id),
  participant_id TEXT NOT NULL REFERENCES participants(id),
  title TEXT NOT NULL,
  metadata TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS votes (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id),
  participant_id TEXT NOT NULL REFERENCES participants(id),
  nomination_id TEXT NOT NULL REFERENCES nominations(id),
  rank INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(poll_id, participant_id, nomination_id),
  UNIQUE(poll_id, participant_id, rank)
);
