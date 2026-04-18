CREATE TABLE IF NOT EXISTS applied_migrations (
  filename   TEXT PRIMARY KEY,
  hash       TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
