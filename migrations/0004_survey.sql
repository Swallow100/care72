-- 本物のケアマネの答えが入る表なので、配信の作り直し（tools/deploy/rebuild-remote.sh）で落とさず、IF NOT EXISTS で作る（11/3 12:0x）。
-- ケアマネ向けアンケートの Web 版（docs/tasks/T42.md）。ログインなしの 1 ページ（/survey/<token>）で答えてもらう。
-- 問いと記号は tools/survey/questions.ts（docs/survey/README.md の写し方と同じ a・b・c…）。
-- 毎朝 4 時のデモの戻し（lib/seed/reset.ts）では、審査員が作ったリンクと答えだけを消す（本物のケアマネの答えは残す）。

-- 招待のリンク。1 つの token で答えられるのは 1 回、有効は作ってから 14 日。
-- token は推測できない乱数（43 文字。lib/survey/token.ts）。リンクをもう一度写せるよう、そのまま持つ（読めるのは事業所の画面だけ）。
-- memo は宛先の控え（ケアマネ A など。本名を書かない）。created_role は作った人が審査員か（審査員の答えは本物と分けて扱う）。
-- created_by はアカウントの id（デモの戻しでアカウントの行が消えても残るよう、外部キーにしない）
CREATE TABLE IF NOT EXISTS survey_links (
  token TEXT PRIMARY KEY CHECK (length(token) >= 32),
  office_id TEXT NOT NULL REFERENCES offices (id),
  memo TEXT NOT NULL DEFAULT '' CHECK (length(memo) <= 40),
  created_by TEXT,
  created_role TEXT NOT NULL CHECK (created_role IN ('care_manager', 'judge')),
  created_at TEXT NOT NULL,
  -- 最初に頁を開いた時刻。送信はここから 15 秒たってから（ボットの守り）
  opened_at TEXT,
  -- 答えを受けた時刻。入ったら、その token はもう使えない
  used_at TEXT,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS survey_links_office ON survey_links (office_id, created_at);

-- 答え。1 つの token に 1 行。選んだ記号（問 3 だけ複数で "bcf" のように並べる）と、自由記述の文。答えなしは NULL。
-- source_hash は送信元（CF-Connecting-IP）を SESSION_SECRET で鍵を付けて SHA-256 にした物。生の IP は持たない
CREATE TABLE IF NOT EXISTS survey_answers (
  token TEXT PRIMARY KEY REFERENCES survey_links (token),
  role TEXT CHECK (role IS NULL OR role IN ('a', 'b')),
  experience TEXT CHECK (experience IS NULL OR experience IN ('a', 'b', 'c')),
  q1 TEXT CHECK (q1 IS NULL OR q1 IN ('a', 'b', 'c', 'd')),
  q2 TEXT CHECK (q2 IS NULL OR q2 IN ('a', 'b', 'c', 'd', 'e')),
  q3 TEXT CHECK (q3 IS NULL OR (length(q3) BETWEEN 1 AND 7 AND q3 NOT GLOB '*[^a-g]*')),
  q4 TEXT CHECK (q4 IS NULL OR length(q4) <= 400),
  q5 TEXT CHECK (q5 IS NULL OR q5 IN ('a', 'b', 'c')),
  q6 TEXT CHECK (q6 IS NULL OR q6 IN ('a', 'b', 'c')),
  q7 TEXT CHECK (q7 IS NULL OR q7 IN ('a', 'b', 'c')),
  q7_reason TEXT CHECK (q7_reason IS NULL OR length(q7_reason) <= 400),
  quote TEXT CHECK (quote IS NULL OR quote IN ('a', 'b')),
  source_hash TEXT NOT NULL,
  submitted_at TEXT NOT NULL
);

-- 送信の試み（同じ送信元は 1 時間に 20 回まで）。断った送信も数える。1 時間より古い行は送信のたびに消す
CREATE TABLE IF NOT EXISTS survey_attempts (
  source_hash TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS survey_attempts_source ON survey_attempts (source_hash, at);
