-- 事業所のハザード（区域）。docs/tasks/T125.md の 6（区域の出来事が事業所に効くか）。
-- offices.hazards: 事業所の建物がある所の区域の JSON の配列（[{"kind":"tsunami"},{"kind":"flood","depthM":0.5}]。kind は flood・landslide・tsunami）。
--   訓練の開始の時に写し（drills.world の officeZones）、区域の出来事（津波警報・避難指示・土砂の警戒）の間の職員の退避（空き職員・訪問の可否）に使う。
--   NULL は「まだ無い」（区域なしと同じに読む）。デモ事業所は架空の街の高台で NULL のまま（区域なし。seed/people.ts の種の行に列を足さない）。
-- 足すだけで今の行と読む所は変わらない（ALTER TABLE ADD COLUMN、既定は NULL）。
ALTER TABLE offices ADD COLUMN hazards TEXT;
