-- 同意の種類に「AI 提供」（ai_overseas）を足す（docs/tasks/T74.md）。Claude（海外の事業者）に仮名化した台帳の内容を渡すことの同意。
-- SQLite は CHECK を変えられないので表を建て直す。0008 と同じく、今の表を退けてから同じ名前で作る
-- （seed/seed.test.ts が migrations の CREATE TABLE の名前を全部、種の入れ直しの消す順に求めるため。新しい名前の表を作ってから
-- 名前を変える形にすると、その名前も消す順に要る）。
-- consents を外部キーで指す表は無い（REFERENCES consents は無い）ので、退けて消しても外部キーは壊れない。
-- 列・主キー (person_id, kind)・外部キー・ほかの CHECK は 0001 と同じ。索引は持たない（主キーだけ）。
-- 今ある行はそのまま写す。今ある人に AI 提供の行は足さない（行なしは「未確認」と読む。T69a の新しい人の行と同じ考え）。
-- 種の 10 人は種の入れ直し（seed/people.ts の seedConsents が CONSENT_KINDS から作る）で「同意」の行が入る。

ALTER TABLE consents RENAME TO consents_old;

CREATE TABLE consents (
  person_id TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('registry', 'plan_share', 'supporters', 'medical', 'ai_overseas')),
  status TEXT NOT NULL CHECK (status IN ('granted', 'refused', 'unconfirmed')),
  scope TEXT CHECK (scope IS NULL OR json_valid(scope)),
  recorded_by TEXT REFERENCES accounts (id),
  recorded_at TEXT NOT NULL,
  expires_at TEXT,
  note TEXT,
  PRIMARY KEY (person_id, kind)
);

INSERT INTO consents (person_id, kind, status, scope, recorded_by, recorded_at, expires_at, note)
  SELECT person_id, kind, status, scope, recorded_by, recorded_at, expires_at, note
    FROM consents_old;

DROP TABLE consents_old;
