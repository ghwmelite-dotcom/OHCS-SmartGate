-- Clock-in re-auth + liveness prompt (companion spec: 2026-04-29-clockin-reauth-and-liveness-design.md)
-- Adds prompt_value + reauth_method columns to clock_records, plus three new
-- app_settings columns: enforcement flag, PIN attempt cap, prompt TTL seconds.

ALTER TABLE clock_records ADD COLUMN prompt_value TEXT;
ALTER TABLE clock_records ADD COLUMN reauth_method TEXT
  CHECK (reauth_method IN ('webauthn','pin') OR reauth_method IS NULL);

-- New columns on app_settings (singleton row id=1).
-- D1/SQLite ALTER TABLE ADD COLUMN cannot have non-constant DEFAULTs, so we
-- add nullable columns and backfill with UPDATE.
ALTER TABLE app_settings ADD COLUMN clockin_reauth_enforce INTEGER;
ALTER TABLE app_settings ADD COLUMN clockin_pin_attempt_cap INTEGER;
ALTER TABLE app_settings ADD COLUMN clockin_prompt_ttl_seconds INTEGER;

UPDATE app_settings
   SET clockin_reauth_enforce      = COALESCE(clockin_reauth_enforce, 0),
       clockin_pin_attempt_cap     = COALESCE(clockin_pin_attempt_cap, 5),
       clockin_prompt_ttl_seconds  = COALESCE(clockin_prompt_ttl_seconds, 90)
 WHERE id = 1;
