-- WebAuthn / biometric credentials for passwordless sign-in on mobile devices.
-- One user may enroll multiple devices (each row = one platform authenticator).
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id TEXT PRIMARY KEY,                  -- credential ID (base64url)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,             -- COSE-encoded public key (base64url)
  counter INTEGER NOT NULL DEFAULT 0,   -- WebAuthn signCount
  transports TEXT,                      -- JSON array, e.g. ["internal","hybrid"]
  device_label TEXT,                    -- user-supplied or UA-derived label
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user_id
  ON webauthn_credentials(user_id);
