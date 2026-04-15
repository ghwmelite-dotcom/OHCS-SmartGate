-- Phase 2 Migration: Notifications + Telegram linking

ALTER TABLE officers ADD COLUMN telegram_chat_id TEXT;

CREATE TABLE IF NOT EXISTS notifications (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id     TEXT NOT NULL REFERENCES users(id),
    type        TEXT NOT NULL DEFAULT 'visitor_arrival',
    title       TEXT NOT NULL,
    body        TEXT,
    visit_id    TEXT REFERENCES visits(id),
    is_read     INTEGER NOT NULL DEFAULT 0 CHECK(is_read IN (0, 1)),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
