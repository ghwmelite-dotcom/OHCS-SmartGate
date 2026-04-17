-- First-login PIN prompt: adds a flag indicating the officer has either
-- changed their admin-set PIN or explicitly chosen to keep it.
ALTER TABLE users ADD COLUMN pin_acknowledged INTEGER NOT NULL DEFAULT 0;
