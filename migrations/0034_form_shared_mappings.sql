-- 様式の対応表の共有（docs/progress/t134.md、docs/DECISIONS.md「書類」の案（T134））。
-- 一覧（lib/forms/municipal-forms.ts）の公式の様式は、版（ファイルの SHA-256）と送った頁の組が同じなら、欄の位置と台帳の項目の当て
-- （AI が読んだ対応表）が事業所をまたいで同じになる。人の値は入らない（白紙の公式の様式を読んだ物）。最初の 1 回だけ AI で読み、
-- 2 回目からはこの行を写して事業所の下書きにする（lib/forms/shared-mapping.ts）。事業所の確かめ・手直しは form_mappings の側だけで、ここは変えない。
-- 入れるのはサーバーだけ（サーバーが公式の URL から取ったときの版を記録した事業所の、AI の読み取りが全部の頁で通った物）。
-- 事業所のデータでないので、デモの戻し・試用事業所の掃除・種の入れ直し（seed/sql.ts の CLEAR_ORDER）では消さない。
CREATE TABLE form_shared_mappings (
  catalog_id TEXT NOT NULL CHECK (length(catalog_id) BETWEEN 1 AND 40),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  -- 送った頁（元のファイルの頁の番号を , で。例 "1,2"）
  pages TEXT NOT NULL CHECK (length(pages) BETWEEN 1 AND 40 AND pages NOT GLOB '*[^0-9,]*'),
  mapping TEXT NOT NULL CHECK (json_valid(mapping)),
  ai_model TEXT NOT NULL,
  -- 最初に読んだ事業所（調べるときのため。外部キーにしない＝事業所が消えても残す）
  source_office TEXT,
  created_at TEXT NOT NULL,
  -- 写した回数
  uses INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0),
  PRIMARY KEY (catalog_id, sha256, pages)
);

-- 事業所の対応表が一覧のどの様式のどの版から作った物か（一覧の様式を選んで読んだときだけ。ほかは両方 NULL）
ALTER TABLE form_mappings ADD COLUMN catalog_id TEXT CHECK (catalog_id IS NULL OR length(catalog_id) BETWEEN 1 AND 40);
ALTER TABLE form_mappings ADD COLUMN catalog_sha256 TEXT CHECK (catalog_sha256 IS NULL OR (length(catalog_sha256) = 64 AND catalog_sha256 NOT GLOB '*[^0-9a-f]*'));
CREATE INDEX form_mappings_catalog ON form_mappings (office_id, catalog_id) WHERE catalog_id IS NOT NULL;
