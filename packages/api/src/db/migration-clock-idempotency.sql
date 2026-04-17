ALTER TABLE clock_records ADD COLUMN idempotency_key TEXT;
CREATE INDEX IF NOT EXISTS idx_clock_records_user_idem ON clock_records(user_id, idempotency_key);
