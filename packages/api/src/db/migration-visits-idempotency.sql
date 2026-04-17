ALTER TABLE visits ADD COLUMN idempotency_key TEXT;
CREATE INDEX IF NOT EXISTS idx_visits_idem ON visits(idempotency_key);
