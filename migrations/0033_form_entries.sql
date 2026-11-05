-- 紙の手入れ（docs/tasks/T135.md）。元の様式の上に値を置いた紙（T86 の添付の様式・T101 の原本の枠の紙）の上で、人が入れた物。
-- 台帳の項目に当たる欄は台帳に入れる（people.ledger・contacts。経過に「ケアマネが直した」）ので、ここには持たない（ledger の行は印だけ）。
--
-- form_entries: 本人ごと・様式ごとの手入れ。
--   kind = field  台帳に項目の無い欄（様式だけの欄）の値。field_key は欄の鍵（計画書は欄の鍵、添付の様式は対応表の欄の id）、
--                 value は JSON（文字・選んだ選択肢の配列・□ の真偽）。同じ欄は 1 行（removed_at の無い物）
--   kind = ledger 紙から台帳に入れた欄の印（画面の「手で入れた所」の印と、誰がいつ。値は台帳が正で、ここの value は入れたときの写しの字）
--   kind = text   紙の上に置いた文字の枠。page・box（頁の画像の上の比 0〜1 の x・y・w・h の JSON）、value は字
--   kind = image  紙の上に置いた画像。page・box、value は form_assets の id
-- form_id は 'matsuyama'・'kiroku'・'mapped:<対応表の id>'。
-- 取り消しは removed_at を付ける（行は消さない。取消のやり直しで removed_at を戻す）。誰がいつは author_id・created_at と updated_by・updated_at。
-- 本人・事業所を消すと一緒に消える（種を入れ直すと空になる）。
CREATE TABLE form_entries (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES offices (id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  form_id TEXT NOT NULL CHECK (length(form_id) BETWEEN 1 AND 80),
  kind TEXT NOT NULL CHECK (kind IN ('field', 'ledger', 'text', 'image')),
  field_key TEXT CHECK (field_key IS NULL OR length(field_key) BETWEEN 1 AND 80),
  page INTEGER CHECK (page IS NULL OR page >= 1),
  box TEXT CHECK (box IS NULL OR json_valid(box)),
  value TEXT NOT NULL DEFAULT '',
  author_id TEXT REFERENCES accounts (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT REFERENCES accounts (id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  removed_at TEXT,
  CHECK ((kind IN ('field', 'ledger')) = (field_key IS NOT NULL)),
  CHECK ((kind IN ('text', 'image')) = (page IS NOT NULL AND box IS NOT NULL))
);
CREATE INDEX form_entries_person ON form_entries (person_id, form_id);
CREATE INDEX form_entries_office ON form_entries (office_id);

-- form_assets: 事業所が紙に置く画像（地図・写真・図）。本体は R2 の RECORDINGS の forms/<事業所>/assets/<id>.<jpg|png>。
-- 画像は紙に置くだけで、Claude に送らない（様式の読み取り・入れる欄の読み取りの道を通らない）。外すと removed_at（置いた紙からも消える）。
-- 事業所を消すと一緒に消える。デモ事業所の戻しでは表の行と R2 の forms/<事業所>/ の下を消す（lib/seed/reset.ts）
CREATE TABLE form_assets (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES offices (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('map', 'photo', 'figure')),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png')),
  width INTEGER NOT NULL CHECK (width >= 1),
  height INTEGER NOT NULL CHECK (height >= 1),
  bytes INTEGER NOT NULL CHECK (bytes >= 1),
  author_id TEXT REFERENCES accounts (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  removed_at TEXT
);
CREATE INDEX form_assets_office ON form_assets (office_id, created_at);
