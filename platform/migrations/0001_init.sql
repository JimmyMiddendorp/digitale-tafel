-- NeighborNoise fase 1 schema
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('eigenaar','controle','plaatser','facturatie')),
  phone TEXT,
  werkgebied TEXT,
  iban TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  password_hash TEXT,
  password_salt TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('invite','reset')),
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE regions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE places (
  name TEXT PRIMARY KEY COLLATE NOCASE,
  region_id INTEGER NOT NULL REFERENCES regions(id)
);

CREATE TABLE corporations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  region_id INTEGER REFERENCES regions(id),
  contact_email TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE meters (
  id INTEGER PRIMARY KEY,
  active INTEGER NOT NULL DEFAULT 1,
  note TEXT
);

CREATE TABLE measurements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  corporation_id INTEGER NOT NULL REFERENCES corporations(id),
  order_no TEXT,
  address TEXT NOT NULL,
  postcode TEXT,
  city TEXT NOT NULL,
  resident_name TEXT,
  resident_phone TEXT,
  duration_weeks INTEGER NOT NULL DEFAULT 1 CHECK (duration_weeks IN (1,2)),
  plaatser_id TEXT REFERENCES users(id),
  planned_place_date TEXT NOT NULL,
  planned_pickup_date TEXT,
  meter_id INTEGER REFERENCES meters(id),
  stage INTEGER NOT NULL DEFAULT 0,
  placed_at TEXT, placed_by TEXT,
  place_checklist TEXT,
  place_checked_at TEXT, place_checked_by TEXT,
  picked_up_at TEXT, picked_up_by TEXT,
  pickup_checklist TEXT,
  diary TEXT CHECK (diary IN ('ja','nee')),
  noise_heard INTEGER,
  diary_processed_at TEXT, data_checked_at TEXT,
  report_key TEXT, report_name TEXT, report_ready_at TEXT, outcome TEXT,
  report_sent_at TEXT, closed_at TEXT,
  remark TEXT,
  is_new INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_meas_plaatser ON measurements(plaatser_id, stage);
CREATE INDEX idx_meas_stage ON measurements(stage);

CREATE TABLE photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  measurement_id INTEGER NOT NULL REFERENCES measurements(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  content_type TEXT,
  uploaded_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  measurement_id INTEGER REFERENCES measurements(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  actor_id TEXT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_events_meas ON events(measurement_id);

CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  measurement_id INTEGER NOT NULL REFERENCES measurements(id) ON DELETE CASCADE,
  user_id TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dedupe_key TEXT,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warn','red')),
  title TEXT NOT NULL,
  body TEXT,
  measurement_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  read_at TEXT,
  UNIQUE(user_id, dedupe_key)
);
CREATE INDEX idx_notif_user ON notifications(user_id, read_at);

CREATE TABLE emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE payouts (
  plaatser_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('concept','goedgekeurd','betaald')),
  updated_at TEXT,
  PRIMARY KEY (plaatser_id, month)
);

INSERT INTO settings(key,value) VALUES
 ('control_hours','24'),('report_days','14'),
 ('tariff_z1','42.5'),('tariff_z2','55'),('tariff_z3','65');

INSERT INTO regions(name,sort) VALUES ('Den Haag',1),('Rotterdam',2),('Amsterdam',3);
INSERT INTO places(name,region_id) VALUES
 ('Den Haag',1),('Rijswijk',1),('Leidschendam',1),('Voorburg',1),('Wateringen',1),('Delft',1),('Zoetermeer',1),
 ('Rotterdam',2),('Vlaardingen',2),('Schiedam',2),('Hoek van Holland',2),('Maassluis',2),
 ('Amsterdam',3),('Amstelveen',3),('Diemen',3);
