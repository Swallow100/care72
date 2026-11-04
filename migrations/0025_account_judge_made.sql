-- 審査員が足したアカウントの印（docs/progress/t81.md、朝の見直し 11/4 の安全 高 2）。
-- 審査員（ケアマネの役）はデモ事業所の管理者としてケアマネを足し、初期パスワードを受け取れる（T79）。そのアカウントで入り直すと
-- 審査員の印（judge）が外れ、本物のアンケートが見えていた。足した時に印を付け、そのアカウントのログインも審査員と同じ壁にする
-- （lib/auth/principal.ts の judgeMade と lib/auth/wall.ts）。1 は審査員が足した・審査員が再発行した、0 はそれ以外。
-- 前からある行は、事業所の経過（審査員が書いたケアマネ追加・再発行）から印を付ける（配信から次の 4 時の戻しまでの間の分）。
-- 毎朝 4 時の戻し（lib/seed/reset.ts）は、種に無いデモ事業所のアカウントを消す（印の付いた物も）。
ALTER TABLE accounts ADD COLUMN judge_made INTEGER NOT NULL DEFAULT 0 CHECK (judge_made IN (0, 1));

UPDATE accounts SET judge_made = 1
 WHERE id IN (
   SELECT json_extract(e.payload, '$.accountId') FROM office_timeline_entries e
    WHERE e.author_id = 'acct-judge' AND e.payload IS NOT NULL
      AND (e.kind = 'care_manager_added'
        OR (e.kind = 'care_manager_changed' AND json_extract(e.payload, '$.change') = 'reset_password')));
