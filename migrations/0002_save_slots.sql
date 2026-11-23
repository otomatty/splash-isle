-- A は旧クライアントと同じ saves に残す。B・C の追加は、既存データのコピーや書き換えを伴わない。
CREATE TABLE save_slots (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot TEXT NOT NULL CHECK (slot IN ('B', 'C')),
  data TEXT NOT NULL,
  gems INTEGER NOT NULL DEFAULT 0,
  best_time_ms INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, slot)
);
CREATE INDEX idx_save_slots_best ON save_slots(best_time_ms) WHERE best_time_ms IS NOT NULL;
