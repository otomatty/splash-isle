-- スプラッシュ・アイル: ユーザー・セッション・セーブデータ
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  picture TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- セッショントークンは SHA-256 ハッシュだけを保存する（DB が漏れてもなりすましできない）
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE saves (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  gems INTEGER NOT NULL DEFAULT 0,
  best_time_ms INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_saves_best ON saves(best_time_ms) WHERE best_time_ms IS NOT NULL;
