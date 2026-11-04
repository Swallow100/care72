-- 審査員の試用事業所の印（docs/progress/t115.md）。審査員が役の一覧の「新規事業所」を押すと、そのセッションだけの空の事業所を作り、
-- 審査員がその管理者になる（lib/office/sandbox.ts）。1 は審査員の試用事業所、0 はそれ以外（デモ・本物・所属なし）。
-- kind は regular のまま（本物の事業所が最初にする流れを同じ画面で試すため。kind の CHECK を変えると offices の建て直しが要る）。
-- 毎朝 4 時の掃除（lib/seed/sandbox.ts）が印の付いた事業所を、人・台帳・訓練・アンケート・R2 の録音と原本ごと消す。
-- 作り直しの守り（tools/deploy/guard.ts）は印の付いた事業所を本物のデータに数えない。
-- offices を指す表が多いので建て直さず、列を足すだけ（0017 と同じ）。前からある行は 0。
-- 番号: 11/5 03 時の時点で全部の branch に 0027 以上は無い。ほかの作業（T114 など）と重なったら、integrate に後から入る側が振り直す。
ALTER TABLE offices ADD COLUMN judge_sandbox INTEGER NOT NULL DEFAULT 0 CHECK (judge_sandbox IN (0, 1));
