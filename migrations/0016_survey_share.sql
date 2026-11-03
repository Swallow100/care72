-- アンケートを共有の 1 本のリンク（紙に刷る QR 1 つ）と 9 問に（docs/tasks/T65.md、DECISIONS 11/3 23:1x）。
-- 0004 の表（survey_links・survey_answers・survey_attempts）は DROP・建て直し・ALTER をしない（T42 の行はそのまま残す）。
-- ALTER TABLE ADD COLUMN も使わない: 配信の作り直し（tools/deploy/rebuild-remote.sh）は survey_ の表を落とさずに d1_migrations を落とし、
-- migrations を 0001 から流し直す。そのとき ALTER は「列がもうある」で止まる。新しい表を IF NOT EXISTS で足すだけにする。
-- 送信の数え（survey_attempts。1 時間 20 回）は 0004 の表をそのまま使う。
-- 毎朝 4 時のデモの戻し（lib/seed/reset.ts）では、審査員が作ったリンクと答えだけを消す（本物の答えは残す）。

-- 共有のリンク。1 本の token で何人でも答えられる。受付は expires_at の前まで、答えは max_answers 件まで（T65: 30 件）。
-- token は推測できない乱数（43 文字。lib/survey/token.ts）。QR と URL をもう一度出せるよう、そのまま持つ（読めるのは事業所の画面だけ）。
-- memo は控え（配った先など。本名を書かない）。created_role は作った人が審査員か（審査員の答えは本物と分けて扱う）。
-- created_by はアカウントの id（デモの戻しでアカウントの行が消えても残るよう、外部キーにしない）
CREATE TABLE IF NOT EXISTS survey_shares (
  token TEXT PRIMARY KEY CHECK (length(token) >= 32),
  office_id TEXT NOT NULL REFERENCES offices (id),
  memo TEXT NOT NULL DEFAULT '' CHECK (length(memo) <= 40),
  created_by TEXT,
  created_role TEXT NOT NULL CHECK (created_role IN ('care_manager', 'judge')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  max_answers INTEGER NOT NULL CHECK (max_answers BETWEEN 1 AND 1000)
);
CREATE INDEX IF NOT EXISTS survey_shares_office ON survey_shares (office_id, created_at);

-- 答え（9 問＋ご意見＋引用。記号は tools/survey/questions.ts）。1 人 1 行。問 4・問 6 だけ複数で "bcf" のように並べる。答えなしは NULL。
-- *_other は「その他」を選んだときの記入（60 字まで）。記入欄は 400 字まで。
-- source_hash は送信元（CF-Connecting-IP）を SESSION_SECRET で鍵を付けて HMAC にした物。生の IP は持たない
CREATE TABLE IF NOT EXISTS survey_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL REFERENCES survey_shares (token),
  role TEXT CHECK (role IS NULL OR role IN ('a', 'b', 'c', 'd')),
  role_other TEXT CHECK (role_other IS NULL OR length(role_other) <= 60),
  experience TEXT CHECK (experience IS NULL OR experience IN ('a', 'b', 'c')),
  q1 TEXT CHECK (q1 IS NULL OR q1 IN ('a', 'b', 'c', 'd', 'e', 'f')),
  q2 TEXT CHECK (q2 IS NULL OR q2 IN ('a', 'b', 'c', 'd', 'e', 'f', 'g')),
  q3 TEXT CHECK (q3 IS NULL OR q3 IN ('a', 'b', 'c', 'd', 'e')),
  q3_other TEXT CHECK (q3_other IS NULL OR length(q3_other) <= 60),
  q4 TEXT CHECK (q4 IS NULL OR (length(q4) BETWEEN 1 AND 7 AND q4 NOT GLOB '*[^a-g]*')),
  q4_other TEXT CHECK (q4_other IS NULL OR length(q4_other) <= 60),
  q5 TEXT CHECK (q5 IS NULL OR length(q5) <= 400),
  q6 TEXT CHECK (q6 IS NULL OR (length(q6) BETWEEN 1 AND 7 AND q6 NOT GLOB '*[^a-g]*')),
  q6_other TEXT CHECK (q6_other IS NULL OR length(q6_other) <= 60),
  q7 TEXT CHECK (q7 IS NULL OR q7 IN ('a', 'b', 'c')),
  q8 TEXT CHECK (q8 IS NULL OR q8 IN ('a', 'b', 'c')),
  q9 TEXT CHECK (q9 IS NULL OR q9 IN ('a', 'b', 'c')),
  q9_reason TEXT CHECK (q9_reason IS NULL OR length(q9_reason) <= 400),
  comment TEXT CHECK (comment IS NULL OR length(comment) <= 400),
  quote TEXT CHECK (quote IS NULL OR quote IN ('a', 'b')),
  source_hash TEXT NOT NULL,
  submitted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS survey_responses_token ON survey_responses (token, submitted_at);
