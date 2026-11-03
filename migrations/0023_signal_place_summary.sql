-- 本人のスマホの場所と録音のまとめ（docs/tasks/T69b.md）。信号の行に列を足すだけ（表は建て直さない）。
-- 申告位置: 本人が赤のあとの「いまの 場所を おくりますか」で「はい」と押したときだけ、端末の位置（Geolocation）を書く。
--   台帳の位置（people の ledger の basic.location）とは別で、本人が今いる所。Claude には渡さない（氏名・住所と同じ扱い）。
--   範囲は緯度 -90〜90・経度 -180〜180、精度は 0 以上（m）。時刻は端末で取った時刻（ISO 8601）
-- 録音のまとめ: Claude（Haiku、用途 summary）が録音の文字起こしを 2 文以内（80 字まで）に言い換えた物。本人の言葉と並べて出す。
--   ai_summary は Claude の文（AI の印）、summary はケアマネが直した文（null は直していない）。ai_summary_error は ai_error と同じ集合。
--   どれも色と連絡の順に使わない（lib/triage の入力に無い）
ALTER TABLE signals ADD COLUMN reported_lat REAL CHECK (reported_lat IS NULL OR (reported_lat >= -90 AND reported_lat <= 90));
ALTER TABLE signals ADD COLUMN reported_lng REAL CHECK (reported_lng IS NULL OR (reported_lng >= -180 AND reported_lng <= 180));
ALTER TABLE signals ADD COLUMN reported_accuracy_m REAL CHECK (reported_accuracy_m IS NULL OR reported_accuracy_m >= 0);
ALTER TABLE signals ADD COLUMN reported_at TEXT;
ALTER TABLE signals ADD COLUMN ai_summary TEXT;
ALTER TABLE signals ADD COLUMN ai_summary_model TEXT;
ALTER TABLE signals ADD COLUMN ai_summary_at TEXT;
ALTER TABLE signals ADD COLUMN ai_summary_error TEXT CHECK (
  ai_summary_error IS NULL OR ai_summary_error IN ('no_text', 'not_configured', 'limit', 'refused', 'bad_output', 'failed', 'leak')
);
ALTER TABLE signals ADD COLUMN summary TEXT;
