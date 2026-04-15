-- PIN-based auth migration
ALTER TABLE users ADD COLUMN staff_id TEXT;
ALTER TABLE users ADD COLUMN pin_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_staff_id ON users(staff_id);

-- Superadmin: Staff ID 1334685, PIN 1118
INSERT OR IGNORE INTO users (id, name, email, staff_id, pin_hash, role) VALUES
('user_superadmin', 'System Administrator', 'admin@ohcs.gov.gh', '1334685', '63ecbfa3a1ad34a1fdd5e3dd3aeaec31456d1d676552c654d5ecf7dab0b2f4f8', 'superadmin');

-- Update existing reception user
UPDATE users SET staff_id = 'OHCS-001', pin_hash = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4' WHERE id = 'user_admin';
