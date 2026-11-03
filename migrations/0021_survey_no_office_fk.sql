-- アンケートの 4 表（survey_links・survey_answers・survey_shares・survey_responses）から、offices への外部キーを外す（docs/progress/t73a.md、DECISIONS 11/4 案）。
-- 配信の作り直し（tools/deploy/rebuild-remote.sh）は survey_ 以外の表を全部 DROP する。survey_shares・survey_links が offices を指していると、
-- リンクが 1 本でもあれば offices の DROP が取引の終わりに FOREIGN KEY constraint failed で落ち、配信が止まる（defer_foreign_keys でも行が残るので落ちる）。
-- office_id は TEXT NOT NULL のまま。事業所の id は種の固定（office-demo など）なので、作り直しのあとも同じ事業所を指す。
-- survey_answers → survey_links、survey_responses → survey_shares の外部キー（survey_ どうし）は残す。行は全部そのまま写す（本物の答え）。
--
-- 流し直しても同じになる形: rebuild-remote.sh は d1_migrations も落として 0001 から流すので、この migration は配信のたびに走る。
-- 0004・0016 の CREATE TABLE IF NOT EXISTS は既にある表では何もしないので、外部キーが外れたままの表をここでもう一度同じ形に建て直す。
-- 行は列の名前で全部写すので、何度流しても中身は同じ（二重にならない）。rebuild-remote.sh は drop の前にもこの文を流す（外部キーが残る本番のため）。
--
-- 建て直しの順（0008・0011・0012 と同じく、今の表を退けてから同じ名前で作る。seed/seed.test.ts が CREATE TABLE の名前を消す順と比べるため）:
-- 子（答え）→ 親（リンク）の順に _old へ退ける → 親・子の順に作って写す → 子・親の順に _old を消す → 索引を作り直す。
-- どの文も 1 文ずつで外部キーを満たす（親を消す時、その親を指す行はもう無い）。取引の中なら途中で落ちても全部巻き戻る。
-- survey_responses の AUTOINCREMENT の数えは写した行の最大の id になる（消えた行の id がまた使われうる。id は画面にも写しにも出ない）。

PRAGMA defer_foreign_keys = true;

ALTER TABLE survey_answers RENAME TO survey_answers_old;
ALTER TABLE survey_links RENAME TO survey_links_old;
ALTER TABLE survey_responses RENAME TO survey_responses_old;
ALTER TABLE survey_shares RENAME TO survey_shares_old;

-- T42 の 1 人 1 本のリンク（列・CHECK は 0004 と同じ。office_id の外部キーだけ外す）
CREATE TABLE survey_links (
  token TEXT PRIMARY KEY CHECK (length(token) >= 32),
  office_id TEXT NOT NULL,
  memo TEXT NOT NULL DEFAULT '' CHECK (length(memo) <= 40),
  created_by TEXT,
  created_role TEXT NOT NULL CHECK (created_role IN ('care_manager', 'judge')),
  created_at TEXT NOT NULL,
  opened_at TEXT,
  used_at TEXT,
  expires_at TEXT NOT NULL
);
INSERT INTO survey_links (token, office_id, memo, created_by, created_role, created_at, opened_at, used_at, expires_at)
  SELECT token, office_id, memo, created_by, created_role, created_at, opened_at, used_at, expires_at FROM survey_links_old;

CREATE TABLE survey_answers (
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
INSERT INTO survey_answers (token, role, experience, q1, q2, q3, q4, q5, q6, q7, q7_reason, quote, source_hash, submitted_at)
  SELECT token, role, experience, q1, q2, q3, q4, q5, q6, q7, q7_reason, quote, source_hash, submitted_at FROM survey_answers_old;

-- T65 の共有のリンク（列・CHECK は 0016 と同じ。office_id の外部キーだけ外す）
CREATE TABLE survey_shares (
  token TEXT PRIMARY KEY CHECK (length(token) >= 32),
  office_id TEXT NOT NULL,
  memo TEXT NOT NULL DEFAULT '' CHECK (length(memo) <= 40),
  created_by TEXT,
  created_role TEXT NOT NULL CHECK (created_role IN ('care_manager', 'judge')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  max_answers INTEGER NOT NULL CHECK (max_answers BETWEEN 1 AND 1000)
);
INSERT INTO survey_shares (token, office_id, memo, created_by, created_role, created_at, expires_at, max_answers)
  SELECT token, office_id, memo, created_by, created_role, created_at, expires_at, max_answers FROM survey_shares_old;

CREATE TABLE survey_responses (
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
INSERT INTO survey_responses (id, token, role, role_other, experience, q1, q2, q3, q3_other, q4, q4_other, q5, q6, q6_other, q7, q8, q9, q9_reason, comment, quote, source_hash, submitted_at)
  SELECT id, token, role, role_other, experience, q1, q2, q3, q3_other, q4, q4_other, q5, q6, q6_other, q7, q8, q9, q9_reason, comment, quote, source_hash, submitted_at FROM survey_responses_old;

DROP TABLE survey_answers_old;
DROP TABLE survey_links_old;
DROP TABLE survey_responses_old;
DROP TABLE survey_shares_old;

-- 索引は退けた表と一緒に消えたので作り直す（名前と列は 0004・0016 と同じ）
CREATE INDEX survey_links_office ON survey_links (office_id, created_at);
CREATE INDEX survey_shares_office ON survey_shares (office_id, created_at);
CREATE INDEX survey_responses_token ON survey_responses (token, submitted_at);
