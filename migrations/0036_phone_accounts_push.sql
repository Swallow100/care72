-- 本人・家族のスマホの ID とパスワードと、「大丈夫ですか」の通知の購読（docs/tasks/T149.md）。表を 2 つ足すだけ（前の表は変えない）。
--
-- phone_accounts: スマホ入口のリンク（T69a）で開いた本人・家族が、その場で作る ID とパスワード。accounts とは別の表
--   （accounts.role の CHECK に本人・家族が無く、広げるには表の建て直しが要るため。書き手の author_id も accounts を指すので混ぜない）。
--   1 本人・1 連絡先に 1 つ（本人用は contact_id が NULL。下の索引で重ならない）。login_id は accounts.login_id とも重ならない
--   （作る時に両方の表を見る。lib/phone/account.ts と lib/office/staff.ts）。password_hash は lib/auth/password.ts の形（平文は持たない）。
--   link_generation・link_issued_at は作った時のリンクの版と時刻（people.phone_link_generation・phone_link_issued_at）。
--   ログインとセッションは、本人の行の今の版・時刻と同じときだけ通す（再発行・一覧から外すと、リンクと一緒に通らなくなる。
--   リンクの期限〔180 日〕が過ぎても版が同じなら通る）。本人・連絡先の行を消すと一緒に消える。
-- push_subscriptions: Web Push の購読（ブラウザの PushSubscription の endpoint と鍵 2 つ）。本人・家族の頁で通知を許可した端末ごとに 1 行。
--   endpoint は Web Push の事業者の https の宛先だけ（lib/push/subscription.ts が確かめる）。同じ endpoint は 1 行（後勝ち）。
--   link_generation・link_issued_at はリンク・ID で開いた端末の版と時刻（送る時に今の版と比べる）。審査員の本人・家族の役は NULL。
--   last_sent_at は最後に送った時刻（安否確認の送り過ぎの確かめ）。送り先が 404・410 を返したら行を消す。
--   名前・病名は持たない（通知の文は固定。lib/push/message.ts）。
CREATE TABLE phone_accounts (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  contact_id TEXT REFERENCES contacts (id) ON DELETE CASCADE,
  login_id TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  link_generation INTEGER NOT NULL CHECK (link_generation >= 1),
  link_issued_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX phone_accounts_target ON phone_accounts (person_id, ifnull(contact_id, ''));

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  contact_id TEXT REFERENCES contacts (id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  link_generation INTEGER CHECK (link_generation IS NULL OR link_generation >= 1),
  link_issued_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_sent_at TEXT
);

CREATE INDEX push_subscriptions_person ON push_subscriptions (person_id);
