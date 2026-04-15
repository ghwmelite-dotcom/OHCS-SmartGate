-- PIN-based auth migration
ALTER TABLE users ADD COLUMN staff_id TEXT;
ALTER TABLE users ADD COLUMN pin_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_staff_id ON users(staff_id);

-- Default PIN for reception: 1234
UPDATE users SET staff_id = 'OHCS-001', pin_hash = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4' WHERE id = 'user_admin';
