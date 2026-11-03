-- ログインの回数の制限（docs/tasks/T41.md）。試したたびに 1 行（成否つき）。パスワードは残さない。
-- 同じ ID か同じ送信元（CF-Connecting-IP）で 15 分に 10 回失敗したら、その後 15 分は止める（lib/auth/lockout.ts）。
-- 成功したらその ID の行を消す。1 日より古い行はログインのついでに消す。
-- login_id は打たれたままの文字（前後の空白を落とし 128 字まで）。無い ID も数える（ID が有るかを分からせない）ので外部キーは付けない。
-- ip は CF-Connecting-IP。無いとき（手元の dev）は 'unknown'。at は UNIX 秒。
CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login_id TEXT NOT NULL,
  ip TEXT NOT NULL,
  at INTEGER NOT NULL,
  ok INTEGER NOT NULL CHECK (ok IN (0, 1))
);
CREATE INDEX login_attempts_login_id_at ON login_attempts (login_id, at);
CREATE INDEX login_attempts_ip_at ON login_attempts (ip, at);
CREATE INDEX login_attempts_at ON login_attempts (at);
