-- 経過の撤回（docs/tasks/T63.md）。行は消さず、誰が・いつ・理由を行に持つ（取り消し線で残す）。0007 と同じ ADD COLUMN だけ。
-- 新しい kind は足さない（0001 の CHECK を建て直すと配信済みの D1 の表を作り直すため）。
-- retracted_at: 撤回した時刻（ISO 8601）。NULL は撤回していない行
-- retracted_by: 撤回したアカウント（アカウントを消したら NULL。撤回した事実は retracted_at で残る）
-- retracted_note: 理由（40 字まで、任意）。D1 に入れるだけで Claude にも声にも渡さない
-- 撤回できる行の集合と、誰が撤回できるかは lib/timeline/retract.ts（kind と payload と書き手で決める）。
ALTER TABLE timeline_entries ADD COLUMN retracted_at TEXT;
ALTER TABLE timeline_entries ADD COLUMN retracted_by TEXT REFERENCES accounts (id) ON DELETE SET NULL;
ALTER TABLE timeline_entries ADD COLUMN retracted_note TEXT CHECK (retracted_note IS NULL OR length(retracted_note) <= 40);

-- 通話で聞いた安否（T58、出どころ care_manager の信号）の撤回。電話の記録（called の行）を撤回すると、結んだ信号もここに時刻が入り、
-- ルールの表を読む所（lib/disaster/triage.ts・lib/caseload.ts・lib/custody/board.ts・lib/forms/form9-db.ts）が
-- retracted_at IS NULL で外す。本人・家族・支援者・訓練の信号には入れない（lib/timeline/retract.ts の UPDATE の条件）
ALTER TABLE signals ADD COLUMN retracted_at TEXT;
