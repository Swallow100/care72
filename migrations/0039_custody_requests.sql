-- 医療班への受入依頼（docs/tasks/T163.md）。ケアマネ（事業所）が本人を医療班へ受け入れを頼む 1 回が 1 行。消さない（返事も行に残す）。
-- 宛先は医療班の役（アカウントを決めない）。どの医療班のアカウントでも受入一覧の上の「受入依頼」に出る（審査員は壁の中の人だけ。lib/auth/wall.ts）。
-- 送れるのは医療班への提供に同意のある人だけ（未確認・不同意はサーバーが断る。lib/custody/requests.ts）。
-- state: open 依頼中・accepted 受入（受け入れた医療班の受け持ち custody_id を結ぶ）・declined 受入不可・withdrawn 取消（事業所が下げた）。
-- 受け入れは今の受け入れ（custody・third_party_provisions・経過の received）を通すので、提供の記録は受け入れたときに 1 行。
-- 返事に自由文の欄は持たない（医療の助言の入口にしない）。shelter は行き先（受け入れたときの受け持ちの避難所）。
-- seed は種の事業所の「発災開始」で入れた行（1）。もう一度押したときに消して入れ直す（lib/seed/start.ts）。
-- 同じ人の依頼中は 1 つ（部分の一意の索引）。
CREATE TABLE custody_requests (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  office_id TEXT NOT NULL REFERENCES offices (id) ON DELETE CASCADE,
  requested_by TEXT REFERENCES accounts (id) ON DELETE SET NULL,
  shelter TEXT NOT NULL CHECK (length(trim(shelter)) > 0),
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'accepted', 'declined', 'withdrawn')),
  requested_at TEXT NOT NULL,
  replied_by TEXT REFERENCES accounts (id) ON DELETE SET NULL,
  replied_role TEXT CHECK (replied_role IS NULL OR replied_role IN ('medical', 'government', 'care_manager')),
  -- 返事をした人の名前の写し（審査員は「審査員」）
  replied_name TEXT,
  replied_at TEXT,
  custody_id TEXT REFERENCES custody (id) ON DELETE SET NULL,
  seed INTEGER NOT NULL DEFAULT 0 CHECK (seed IN (0, 1)),
  CHECK ((state = 'open') = (replied_at IS NULL))
);
CREATE UNIQUE INDEX custody_requests_open ON custody_requests (person_id) WHERE state = 'open';
CREATE INDEX custody_requests_state ON custody_requests (state, requested_at);
CREATE INDEX custody_requests_person ON custody_requests (person_id, requested_at);
