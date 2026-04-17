-- Staff Attendance / Clock System

CREATE TABLE IF NOT EXISTS clock_records (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id     TEXT NOT NULL REFERENCES users(id),
    type        TEXT NOT NULL CHECK(type IN ('clock_in', 'clock_out')),
    timestamp   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    latitude    REAL,
    longitude   REAL,
    within_geofence INTEGER NOT NULL DEFAULT 0 CHECK(within_geofence IN (0, 1)),
    photo_url       TEXT,
    device_info     TEXT,
    idempotency_key TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_clock_user_date ON clock_records(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_clock_date ON clock_records(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_clock_records_user_idem ON clock_records(user_id, idempotency_key);

CREATE TABLE IF NOT EXISTS leave_requests (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id     TEXT NOT NULL REFERENCES users(id),
    type        TEXT NOT NULL CHECK(type IN ('annual', 'sick', 'permission', 'compassionate', 'maternity', 'study')),
    start_date  TEXT NOT NULL,
    end_date    TEXT NOT NULL,
    reason      TEXT,
    status      TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    approved_by TEXT REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_leave_user ON leave_requests(user_id, start_date DESC);

-- Add streak and attendance fields to users
ALTER TABLE users ADD COLUMN current_streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN longest_streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN directorate_id TEXT REFERENCES directorates(id);
