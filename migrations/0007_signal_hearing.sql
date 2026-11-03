-- 赤のあとの聞き取り（docs/tasks/T49.md）。信号の行に 3 つの JSON の欄を足す。
-- answers: 本人・家族が押した（声の言葉の一致で取れた）問いの答え { 問いの id: { choice, via } }。今の 4 問の列（injured・at_home・
--   can_move・has_medicine）にも同じ値を書く（ルールの表と採点が読むのは 4 つの列だけ。answers は表に渡さない）
-- ai_memo: Claude（Haiku、分類と同じ 1 回）が文字起こしから写した聞き取りメモ { 欄: 30 字まで | null }。人が直しても残す
-- memo: ケアマネが直した欄 { 欄: 文 | null }。画面は 直した欄 → 押した答え → Claude の欄 の順に出す。
-- どれも色と連絡の順に使わない（lib/triage の入力に無い）
ALTER TABLE signals ADD COLUMN answers TEXT CHECK (answers IS NULL OR json_valid(answers));
ALTER TABLE signals ADD COLUMN ai_memo TEXT CHECK (ai_memo IS NULL OR json_valid(ai_memo));
ALTER TABLE signals ADD COLUMN memo TEXT CHECK (memo IS NULL OR json_valid(memo));
