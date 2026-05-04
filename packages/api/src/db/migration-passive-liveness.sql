-- Passive liveness (Plan 1.5) — companion spec: 2026-05-04-passive-liveness-design.md
-- Adds liveness_challenge / liveness_decision / liveness_signature columns to clock_records,
-- plus three new app_settings keys: enforcement flag, manual-review weekly cap, model version.
--
-- IMPORTANT: prompt_value is intentionally NOT dropped here. Two-phase migration —
-- column drop happens 30+ days later in a separate follow-up migration once the
-- historical-row review horizon has passed.

ALTER TABLE clock_records ADD COLUMN liveness_challenge TEXT
  CHECK (liveness_challenge IN ('blink','turn_left','turn_right','smile') OR liveness_challenge IS NULL);
ALTER TABLE clock_records ADD COLUMN liveness_decision TEXT
  CHECK (liveness_decision IN ('pass','fail','manual_review','skipped') OR liveness_decision IS NULL);
ALTER TABLE clock_records ADD COLUMN liveness_signature TEXT;

-- New columns on app_settings (singleton row id=1).
-- D1/SQLite ALTER TABLE ADD COLUMN cannot have non-constant DEFAULTs, so we
-- add nullable columns and backfill with UPDATE.
ALTER TABLE app_settings ADD COLUMN clockin_passive_liveness_enforce INTEGER;
ALTER TABLE app_settings ADD COLUMN clockin_liveness_review_cap_per_week INTEGER;
ALTER TABLE app_settings ADD COLUMN clockin_liveness_model_version TEXT;

UPDATE app_settings
   SET clockin_passive_liveness_enforce      = COALESCE(clockin_passive_liveness_enforce, 0),
       clockin_liveness_review_cap_per_week  = COALESCE(clockin_liveness_review_cap_per_week, 2),
       clockin_liveness_model_version        = COALESCE(clockin_liveness_model_version, 'buffalo_s_v1')
 WHERE id = 1;
