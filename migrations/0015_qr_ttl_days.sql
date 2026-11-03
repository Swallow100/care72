-- QR の期限の日数（docs/tasks/T64.md）。本人の行に 30・90・180 日を持つ。前からある行は既定の 90 日（今までの固定の期限と同じ）。
-- トークンは表に持たず、版（qr_generation）・作った時刻（qr_issued_at）・この日数から署名で作り直す（lib/qr/token.ts）。
-- 確かめる側（lib/qr/store.ts の resolveQrToken）は、トークンの期限がこの日数と合うかを見る。期限なしは作らない、上限は 180 日。
-- 並びは lib/qr/token.ts の QR_TTL_CHOICES と同じ（lib/qr/t64.test.ts で確かめる）
ALTER TABLE people ADD COLUMN qr_ttl_days INTEGER NOT NULL DEFAULT 90 CHECK (qr_ttl_days IN (30, 90, 180));
