-- アカウントの停止（退職）と、ケアマネの変更の経過（docs/tasks/T61.md）。
-- accounts.disabled_at: 停止した時刻。NULL は使える。停止した人はログインできず、今あるセッションも次の要求で切れる
--   （lib/auth/principal.ts の accountPrincipal）。割当の候補にも出ない（lib/office/people.ts）。消さないので戻せる（再開）。
-- office_timeline_entries.kind に care_manager_changed を足す（改名・管理者・管理者解除・停止・再開・再発行・パスワード変更。
--   payload は { accountId, change }。平文のパスワードは書かない）。
-- SQLite は CHECK を変えられないので office_timeline_entries を建て直す。この表はほかの表から外部キーで指されていない。
-- 新しい表を別の名前で作らず、今の表を退けてから同じ名前で作る（0011 と同じ。seed/seed.test.ts が migrations の CREATE TABLE の
-- 名前を全部、種の入れ直しの消す順に求めるため）。列・既定値・外部キー・ほかの CHECK は 0001 と同じ。
-- 索引 office_timeline_office_time は退けた表と一緒に消えるので作り直す（0008 の contacts_person と同じ）。

ALTER TABLE accounts ADD COLUMN disabled_at TEXT;

ALTER TABLE office_timeline_entries RENAME TO office_timeline_entries_old;

CREATE TABLE office_timeline_entries (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES offices (id) ON DELETE CASCADE,
  author_id TEXT REFERENCES accounts (id) ON DELETE SET NULL,
  author_role TEXT NOT NULL CHECK (author_role IN (
    'self', 'family', 'supporter', 'care_manager', 'medical', 'government', 'system'
  )),
  kind TEXT NOT NULL CHECK (kind IN (
    'disaster_on', 'disaster_off', 'disaster_info',
    'person_added', 'person_assigned', 'person_unlisted', 'person_relisted', 'care_manager_added', 'person_taken',
    'care_manager_changed'
  )),
  body TEXT,
  payload TEXT CHECK (payload IS NULL OR json_valid(payload)),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO office_timeline_entries (id, office_id, author_id, author_role, kind, body, payload, occurred_at, created_at)
  SELECT id, office_id, author_id, author_role, kind, body, payload, occurred_at, created_at
    FROM office_timeline_entries_old;

DROP TABLE office_timeline_entries_old;

CREATE INDEX office_timeline_office_time ON office_timeline_entries (office_id, occurred_at);
