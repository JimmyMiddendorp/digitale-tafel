-- Eén dossier per adres. De sleutel is postcode+huisnummer, genormaliseerd
-- (hoofdletters, geen spaties) zodat "1234 ab 12" en "1234AB12" hetzelfde
-- dossier openen. UNIQUE garandeert dat er nooit twee dossiers per adres komen.
CREATE TABLE IF NOT EXISTS address_reports (
  id TEXT PRIMARY KEY,
  adres_key  TEXT NOT NULL UNIQUE,
  postcode   TEXT NOT NULL,
  huisnummer TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  m_naam TEXT DEFAULT '', m_straat TEXT DEFAULT '', m_plaats TEXT DEFAULT '',
  v_naam TEXT DEFAULT '', v_adres TEXT DEFAULT '', v_plaats TEXT DEFAULT '',
  richting TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS log_entries (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  datum TEXT DEFAULT '',
  start TEXT DEFAULT '',
  stop TEXT DEFAULT '',
  omschrijving TEXT DEFAULT '',
  afwezig INTEGER DEFAULT 0,
  pos INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_log_entries_report ON log_entries(report_id, pos);
