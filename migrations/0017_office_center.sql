-- 事業所の地図の中心（docs/tasks/T68.md の 4）。事業所の画面（/office）の「地域」で管理者が置く。NULL は未設定。
-- 本人のページの位置を置く地図（components/person/LocationPick.tsx）は、本人の位置が無いときこの中心から開く。
-- offices を指す表が多いので建て直さず、列を足すだけ。前からある行は NULL（読む側が松山市の市街〔lib/map/center.ts〕に戻す）。
-- 緯度は -90〜90、経度は -180〜180。両方ある か 両方ない（片方だけは保存しない。lib/office/place.ts も同じ物を断る）
ALTER TABLE offices ADD COLUMN center_lat REAL CHECK (center_lat IS NULL OR center_lat BETWEEN -90 AND 90);
ALTER TABLE offices ADD COLUMN center_lng REAL CHECK (
  (center_lng IS NULL OR center_lng BETWEEN -180 AND 180) AND ((center_lng IS NULL) = (center_lat IS NULL))
);
