-- 見本のケアマネ（山本）の確認用の事業所と、審査員のアカウント 3 つ（docs/tasks/T144.md、docs/progress/t144.md、docs/DECISIONS.md の案（T144））。
-- 表の形は変えない。種の行（seed/people.ts の SEED_OFFICES・SEED_ACCOUNTS）と同じ行を、デモ事業所のある D1（本番）にだけ足す。
-- 作ったばかりの D1（デモ事業所の行が無い）では何もしない（手元の db:fresh と種は seed/sql.ts が入れる）。何度流しても同じ。
--
-- 1. 確認用の事業所（office-demo-check、kind demo）。山本のログインが入る、デモ事業所と同じ種の事業所。中の 10 人・災害モード・訓練は
--    この migration では入れず、配信のあとの最初の戻し（山本の「最初に戻す」か毎朝 4 時。lib/seed/reset.ts の resetCheckOffice）が種から入れる。
-- 2. ログインの ID yamamoto をデモ事業所の acct-yamamoto（審査員の担当一覧の持ち主）から外し、確認用の事業所の chk-acct-yamamoto（管理者）に付ける。
--    login_id は一意なので外してから付ける。パスワードのハッシュ（種のハッシュ）は acct-yamamoto の行から写す（env の
--    CAREMANAGER_DEMO_PASSWORD_HASH・CAREMANAGER_DEMO_PASSWORD があればそちらが先。lib/auth/credential.ts）。acct-yamamoto の行のハッシュは
--    消さない（ログインの ID が無く、固定のアカウントのうちログインに使わない物はサーバーがログインもセッションも断る。lib/auth/principal.ts）。
-- 3. 確認用の事業所の 2 人目のケアマネ（西村の写し、chk-acct-nishimura）。
-- 4. 審査員の書き手 acct-judge-2・acct-judge-3 と、acct-judge の名前を「審査員 1」に（ID とパスワードは提出書類。パスワードは env の審査員の物を共有）。
-- 時刻は種の時刻（seed/people.ts の SEED_AT）。

INSERT OR IGNORE INTO offices (id, name, kind, city, plan_form, center_lat, center_lng, created_at)
SELECT 'office-demo-check', 'デモ事業所（確認用）', 'demo', '松山市', 'matsuyama', 33.84, 132.765, '2026-11-02T03:00:00.000Z'
 WHERE EXISTS (SELECT 1 FROM offices WHERE id = 'office-demo');

UPDATE accounts SET login_id = NULL
 WHERE id = 'acct-yamamoto' AND login_id = 'yamamoto'
   AND EXISTS (SELECT 1 FROM offices WHERE id = 'office-demo-check');

INSERT OR IGNORE INTO accounts (id, office_id, role, is_office_admin, display_name, login_id, password_hash, created_at)
SELECT 'chk-acct-yamamoto', 'office-demo-check', 'care_manager', 1, '山本', 'yamamoto',
       (SELECT password_hash FROM accounts WHERE id = 'acct-yamamoto'), '2026-11-02T03:00:00.000Z'
 WHERE EXISTS (SELECT 1 FROM offices WHERE id = 'office-demo-check')
   AND NOT EXISTS (SELECT 1 FROM accounts WHERE login_id = 'yamamoto');

INSERT OR IGNORE INTO accounts (id, office_id, role, is_office_admin, display_name, login_id, password_hash, created_at)
SELECT 'chk-acct-nishimura', 'office-demo-check', 'care_manager', 0, '西村', NULL, NULL, '2026-11-02T03:00:00.000Z'
 WHERE EXISTS (SELECT 1 FROM offices WHERE id = 'office-demo-check');

INSERT OR IGNORE INTO accounts (id, office_id, role, is_office_admin, display_name, login_id, password_hash, created_at)
SELECT 'acct-judge-2', 'office-demo', 'judge', 0, '審査員 2', NULL, NULL, '2026-11-02T03:00:00.000Z'
 WHERE EXISTS (SELECT 1 FROM offices WHERE id = 'office-demo');

INSERT OR IGNORE INTO accounts (id, office_id, role, is_office_admin, display_name, login_id, password_hash, created_at)
SELECT 'acct-judge-3', 'office-demo', 'judge', 0, '審査員 3', NULL, NULL, '2026-11-02T03:00:00.000Z'
 WHERE EXISTS (SELECT 1 FROM offices WHERE id = 'office-demo');

UPDATE accounts SET display_name = '審査員 1' WHERE id = 'acct-judge';
