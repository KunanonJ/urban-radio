-- App login users (username + PBKDF2 password hash).

CREATE TABLE IF NOT EXISTS auth_users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Demo user: username `demo` / password `demo` (change in production).
INSERT OR IGNORE INTO auth_users (id, username, password_hash) VALUES (
  'user-demo',
  'demo',
  'pbkdf2:100000:0123456789abcdef0123456789abcdef:f8de82344dd7c0631fa40d52a0348ece4e9b5ee5cb326c4d4a30af3172c7a8ac'
);
