PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date_label TEXT NOT NULL,
  venue TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 100),
  registration_open INTEGER NOT NULL DEFAULT 0 CHECK(registration_open IN (0,1))
);
INSERT OR IGNORE INTO events VALUES ('first', 'AI时代独立开发者：一人企业的降本增效与商业变现', '日期待确认 · 半天工作坊', '雄安星火科技馆（具体地址待确认）', 20, 0);
CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  contact TEXT NOT NULL,
  city TEXT NOT NULL,
  role TEXT NOT NULL,
  project TEXT NOT NULL,
  project_url TEXT NOT NULL DEFAULT '',
  focus TEXT NOT NULL,
  needs TEXT NOT NULL,
  offers TEXT NOT NULL DEFAULT '',
  laptop INTEGER NOT NULL,
  full_attendance INTEGER NOT NULL,
  share_project INTEGER NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','waitlisted','rejected')),
  confirmed INTEGER NOT NULL DEFAULT 0,
  checked_in INTEGER NOT NULL DEFAULT 0,
  notified INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(event_id, contact)
);
CREATE INDEX IF NOT EXISTS applications_status ON applications(event_id,status);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id TEXT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
