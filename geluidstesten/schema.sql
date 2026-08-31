CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  m_naam TEXT DEFAULT '', m_adres TEXT DEFAULT '', m_plaats TEXT DEFAULT '',
  v_naam TEXT DEFAULT '', v_adres TEXT DEFAULT '', v_plaats TEXT DEFAULT '',
  richting TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  datum TEXT NOT NULL,
  start TEXT DEFAULT '',
  stop TEXT DEFAULT '',
  omschrijving TEXT DEFAULT '',
  afwezig INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entries_report ON entries(report_id, datum, start);
