-- 書類の紙の見直し（docs/tasks/T136.md、docs/progress/t136.md）。0030 は T125、0031 は T134・T135 が使うので 0032。
-- 1 回 1 行で足すだけ（直さない・消さない）。今の状態は form_key ごとにいちばん新しい行から読む（lib/forms/review-db.ts）。
-- kind:
--   run     AI の見直しを回した記録（人・紙の版 sheet_hash）。body は回ごとの前と後（見つけた所・再考した欄・再考のあとに残った所）
--   fix     再考で読み直した欄（対応表の欄の場所・項目）。対応表と版（mapping_version）に付き、同じ対応表の紙の全部に効く。
--           body は欄ごとの前と後と理由。戻した欄は body の undo
--   confirm ケアマネが見直しを全部見て「確認済」にした印（人・紙の版）。body は見た所の id
-- form_key: matsuyama・kiroku・mapped:<対応表の id>
-- 中身（body）に氏名・住所・電話は入れない（欄の id・種類・場所の数・AI の短い理由だけ。理由は仮名のまま）
CREATE TABLE form_reviews (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES offices (id),
  person_id TEXT REFERENCES people (id) ON DELETE CASCADE,
  form_key TEXT NOT NULL CHECK (length(form_key) BETWEEN 1 AND 80),
  kind TEXT NOT NULL CHECK (kind IN ('run', 'fix', 'confirm')),
  sheet_hash TEXT,
  mapping_version INTEGER,
  body TEXT NOT NULL,
  created_by TEXT REFERENCES accounts (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  CHECK (kind = 'fix' OR (person_id IS NOT NULL AND sheet_hash IS NOT NULL)),
  CHECK (kind <> 'fix' OR mapping_version IS NOT NULL)
);
CREATE INDEX form_reviews_person ON form_reviews (person_id, form_key, created_at);
CREATE INDEX form_reviews_fix ON form_reviews (office_id, form_key, mapping_version, created_at);
