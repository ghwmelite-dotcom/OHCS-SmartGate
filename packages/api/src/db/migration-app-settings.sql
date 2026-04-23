-- App settings (singleton): work day start, late threshold, closing time
CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  work_start_time TEXT NOT NULL,
  late_threshold_time TEXT NOT NULL,
  work_end_time TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

INSERT OR IGNORE INTO app_settings (id, work_start_time, late_threshold_time, work_end_time)
VALUES (1, '08:00', '08:30', '17:00');
