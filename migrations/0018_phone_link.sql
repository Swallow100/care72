-- 本人・家族のスマホ入口（docs/tasks/T69a.md）。本人ごとのリンクの版と、作った時刻。
-- 版は作るたびに 1 つ上がり、リンク（lib/qr/phone-link.ts）は今の版のときだけ通る。本人用と家族用の全部のリンクが同じ版を使うので、
-- 作り直すと全部のリンクと、そのリンクで開いたセッションが一度に無効になる。0 はまだ作っていない。
-- 作った時刻から期限（180 日）を数える。リンクそのものは表に持たない（署名で作り直せる）。
-- QR の版（qr_generation）とは別の列: QR を作り直してもスマホの入口は消えず、その逆も。
-- 台帳の version・updated_at は変えない（台帳の中身は変わらない）。前からある行は 0（未発行）
ALTER TABLE people ADD COLUMN phone_link_generation INTEGER NOT NULL DEFAULT 0 CHECK (phone_link_generation >= 0);
ALTER TABLE people ADD COLUMN phone_link_issued_at TEXT;
