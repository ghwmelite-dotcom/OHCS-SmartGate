-- OHCS SmartGate Schema — Phase 1

CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name        TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE,
    staff_id    TEXT UNIQUE,
    pin_hash    TEXT,
    role        TEXT NOT NULL DEFAULT 'staff' CHECK(role IN ('superadmin','admin','receptionist','it','director','staff')),
    grade       TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    last_login_at TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS directorates (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name            TEXT NOT NULL,
    abbreviation    TEXT NOT NULL UNIQUE,
    type            TEXT NOT NULL DEFAULT 'directorate' CHECK(type IN ('directorate','secretariat','unit')),
    floor           TEXT,
    wing            TEXT,
    rooms           TEXT,
    head_officer_id TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS officers (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name            TEXT NOT NULL,
    title           TEXT,
    directorate_id  TEXT NOT NULL REFERENCES directorates(id),
    email           TEXT,
    phone           TEXT,
    office_number   TEXT,
    is_available    INTEGER NOT NULL DEFAULT 1 CHECK(is_available IN (0, 1)),
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_officers_directorate ON officers(directorate_id);

CREATE TABLE IF NOT EXISTS visitors (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    first_name    TEXT NOT NULL,
    last_name     TEXT NOT NULL,
    phone         TEXT,
    email         TEXT,
    organisation  TEXT,
    id_type       TEXT CHECK(id_type IN ('ghana_card','passport','drivers_license','staff_id','other')),
    id_number     TEXT,
    photo_url     TEXT,
    total_visits  INTEGER NOT NULL DEFAULT 0,
    last_visit_at TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_visitors_name ON visitors(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_visitors_phone ON visitors(phone);

CREATE TABLE IF NOT EXISTS visit_categories (
    id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name                TEXT NOT NULL,
    slug                TEXT NOT NULL UNIQUE,
    directorate_hint_id TEXT REFERENCES directorates(id),
    is_active           INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS visits (
    id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    visitor_id       TEXT NOT NULL REFERENCES visitors(id),
    host_officer_id  TEXT REFERENCES officers(id),
    host_name_manual TEXT,
    directorate_id   TEXT REFERENCES directorates(id),
    purpose_raw      TEXT,
    purpose_category TEXT,
    check_in_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    check_out_at     TEXT,
    duration_minutes INTEGER,
    badge_code       TEXT UNIQUE,
    status           TEXT NOT NULL DEFAULT 'checked_in' CHECK(status IN ('checked_in','checked_out','cancelled')),
    notes            TEXT,
    created_by       TEXT REFERENCES users(id),
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_visits_visitor ON visits(visitor_id);
CREATE INDEX IF NOT EXISTS idx_visits_date ON visits(check_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_visits_status ON visits(status, check_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_visits_host ON visits(host_officer_id, check_in_at DESC);
