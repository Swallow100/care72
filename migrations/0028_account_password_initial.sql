-- 初期パスワードのままの印（docs/tasks/T114.md の問い 1、docs/progress/t114.md）。0027 は T115 の試用事業所（本番に当て済み）なので 0028。
-- accounts.password_initial: 1 は人が作ったでたらめのパスワード（ケアマネ追加・再発行の初期パスワード、作者の道具 tools/office の
--   new-office.ts の管理者・new-staff.ts の医療班と行政）を、本人がまだ変えていない。0 は本人が自分で変えた（lib/auth/password-change.ts）。
--   1 の人にはヘッダーの下に「初期パスワード」の印と変更の入口を出す（変えるまでほかの画面へ行けない、にはしない）。
--   種の固定のアカウント・審査員・審査員が足したアカウントには出さない（lib/auth/principal.ts の accountPrincipal）。
-- 既定は 1: 初期パスワードを渡す道が増えても、どの道も列を書き忘れずに印が付く。消すのは本人の変更だけ。再発行は 1 に戻す。
-- 前からある行: 事業所のある行は、事業所の経過で本人の変更（care_manager_changed の change が password）が最後の再発行より後にあれば 0、
--   無ければ 1 のまま（追加・再発行のあと変えていない）。事業所の無い行（医療班・行政）は本人の変更を経過に残さないので分からず、
--   印を誤って出さないよう 0（前と同じ。今後の作成・再発行からは印が付く）。
ALTER TABLE accounts ADD COLUMN password_initial INTEGER NOT NULL DEFAULT 1 CHECK (password_initial IN (0, 1));

UPDATE accounts SET password_initial = 0
 WHERE office_id IS NULL
    OR EXISTS (
      SELECT 1 FROM office_timeline_entries e
       WHERE e.kind = 'care_manager_changed' AND e.payload IS NOT NULL
         AND json_extract(e.payload, '$.accountId') = accounts.id
         AND json_extract(e.payload, '$.change') = 'password'
         AND NOT EXISTS (
           SELECT 1 FROM office_timeline_entries r
            WHERE r.kind = 'care_manager_changed' AND r.payload IS NOT NULL
              AND json_extract(r.payload, '$.accountId') = accounts.id
              AND json_extract(r.payload, '$.change') = 'reset_password'
              AND r.occurred_at > e.occurred_at));
