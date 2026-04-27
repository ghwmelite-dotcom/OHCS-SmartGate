ALTER TABLE users ADD COLUMN user_type TEXT NOT NULL DEFAULT 'staff' CHECK(user_type IN ('staff','nss'));
ALTER TABLE users ADD COLUMN nss_number TEXT;
ALTER TABLE users ADD COLUMN nss_start_date TEXT;
ALTER TABLE users ADD COLUMN nss_end_date TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nss_number_unique ON users(nss_number) WHERE nss_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_nss_active ON users(user_type, nss_end_date) WHERE user_type = 'nss';
