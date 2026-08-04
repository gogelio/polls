CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  admin_token TEXT NOT NULL,
  title TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS event_polls (
  event_id TEXT NOT NULL REFERENCES events(id),
  poll_id TEXT NOT NULL REFERENCES polls(id),
  category TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (event_id, poll_id)
);

CREATE TABLE IF NOT EXISTS event_slots (
  event_id TEXT NOT NULL REFERENCES events(id),
  day TEXT NOT NULL,
  slot_order INTEGER NOT NULL,
  category TEXT NOT NULL,
  placement INTEGER NOT NULL CHECK(placement IN (1, 2)),
  PRIMARY KEY (event_id, day, slot_order)
);
