-- 着信の応答・拒否を訓練の出来事に残す（docs/tasks/T22.md、docs/DECISIONS.md 11/3 08:1x の確定 2）。
-- drill_events の kind に call_answer（応答）と call_decline（拒否）を足す。採点（lib/drill/score.ts）が読み、赤の着信の拒否は順番の誤りに数える。
-- SQLite は CHECK を変えられないので表を建て直す。新しい表を別の名前で作らず、今の表を退けてから同じ名前で作る
-- （seed/seed.test.ts が migrations の CREATE TABLE の名前を全部、種の入れ直しの消す順に求めるため）。
-- drill_events を外部キーで指す表は無いので、退けて消しても外部キーは壊れない。列・UNIQUE・外部キーは 0001 と同じ。

ALTER TABLE drill_events RENAME TO drill_events_old;

CREATE TABLE drill_events (
  id TEXT PRIMARY KEY,
  drill_id TEXT NOT NULL REFERENCES drills (id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  step INTEGER NOT NULL CHECK (step >= 0),
  sim_hour REAL NOT NULL CHECK (sim_hour >= 0),
  person_id TEXT REFERENCES people (id) ON DELETE CASCADE,
  actor TEXT NOT NULL CHECK (actor IN ('director', 'persona', 'care_manager', 'world')),
  kind TEXT NOT NULL CHECK (kind IN (
    'incident', 'persona_turn', 'call_in', 'red_button', 'recording', 'action', 'result', 'score',
    'call_answer', 'call_decline'
  )),
  payload TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (drill_id, seq)
);

INSERT INTO drill_events (id, drill_id, seq, step, sim_hour, person_id, actor, kind, payload, created_at)
  SELECT id, drill_id, seq, step, sim_hour, person_id, actor, kind, payload, created_at FROM drill_events_old;

DROP TABLE drill_events_old;
