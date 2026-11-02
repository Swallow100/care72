-- QR の頁（docs/tasks/T16.md）。本人ごとの QR の版と、作った時刻。
-- 版は作るたびに 1 つ上がり、トークン（lib/qr/token.ts）は今の版のときだけ通る。作り直すと前の版の QR は無効になる。
-- 0 はまだ作っていない。作った時刻からトークンの期限（90 日）を数える。トークンそのものは表に持たない（署名で作り直せる）。
-- 列を足すだけ（表を建て直さない）。
ALTER TABLE people ADD COLUMN qr_generation INTEGER NOT NULL DEFAULT 0 CHECK (qr_generation >= 0);
ALTER TABLE people ADD COLUMN qr_issued_at TEXT;
