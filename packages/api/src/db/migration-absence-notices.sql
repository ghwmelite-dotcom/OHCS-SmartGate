CREATE TABLE IF NOT EXISTS absence_notices (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id               TEXT NOT NULL REFERENCES users(id),
  reason                TEXT NOT NULL CHECK(reason IN ('sick','family_emergency','transport','other')),
  note                  TEXT,
  notice_date           TEXT NOT NULL,
  expected_return_date  TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_absence_notices_user_date ON absence_notices(user_id, notice_date);
