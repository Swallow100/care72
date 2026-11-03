-- 気象庁の防災情報 XML の写し（docs/tasks/T72.md、利用条件は docs/progress/jma-terms-20261104.md）。
-- Workers の cron（5 分ごと、lib/jma/cron.ts）が PULL 型のフィード（extra.xml・eqvol.xml）を 1 か所で取り、ここに写す。
-- 事業所の画面（/office）はここだけを読む（各ブラウザから気象庁を読まない）。色と連絡順（lib/triage）の入力にはしない。
-- 写すのは事業所の市と利用者の住所の市に当たる市町村の行だけ（全国の行を写すと D1 の書き込みが 1 日に数万行になる。docs/progress/t72.md）。
-- 7 日より古い電文は取るたびに消す（jma_entries を消せば子の表も消える）。どの表も事業所ごとでないので、デモの戻し（lib/seed/reset.ts）では消さない。
-- 配信の作り直し（tools/deploy/rebuild-remote.sh）では落ちて空から作り直される（写しなので、次の cron でまた入る）。

-- 取った電文 1 通に 1 行（読めなかった物・写す行の無かった物も。同じ電文を 2 回取らない）。
-- id は Atom の entry の id（電文の URL）。type_code は電文の URL の中の種類（VPWW54・VXSE53 など）。
-- note は読めなかった・飛ばした理由（読めた物は NULL）
CREATE TABLE jma_entries (
  id TEXT PRIMARY KEY,
  feed TEXT NOT NULL CHECK (feed IN ('extra', 'eqvol')),
  type_code TEXT NOT NULL,
  title TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  note TEXT
);
CREATE INDEX jma_entries_updated ON jma_entries (updated_at);

-- 気象警報・注意報（VPWW53・54〔経過措置〕と VPWW55〜61）。市町村ごと・種類ごとに 1 行。名前・状態・発表時刻・発表官署は電文のまま。
-- 同じ市町村の新しい発表で前の行を置き換えず全部残し、今の状態は (area_code, type_code) ごとに一番新しい発表の行で引く（lib/jma/alerts.ts）。
-- 発表された警報・注意報が無い市町村は kind '' の行を 1 つ（前の発表の行を今の状態と読まないため）。sort は電文の中の並び
CREATE TABLE jma_warnings (
  entry_id TEXT NOT NULL REFERENCES jma_entries (id) ON DELETE CASCADE,
  type_code TEXT NOT NULL,
  area_code TEXT NOT NULL,
  area_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  office_name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX jma_warnings_area ON jma_warnings (area_name, issued_at);
CREATE INDEX jma_warnings_entry ON jma_warnings (entry_id);

-- 地震の情報（VXSE51 震度速報・VXSE52 震源・VXSE53 震源・震度）。電文 1 通に 1 行。
-- event_id は気象庁の地震の識別（同じ地震の続報で同じ）。info_type は 発表・訂正・取消（取消の地震は出さない）。
-- 震度は電文の文字のまま（1〜4・5-・5+・6-・6+・7）。推計震度分布は作らない
CREATE TABLE jma_quakes (
  entry_id TEXT PRIMARY KEY REFERENCES jma_entries (id) ON DELETE CASCADE,
  type_code TEXT NOT NULL,
  event_id TEXT NOT NULL,
  info_type TEXT NOT NULL,
  report_at TEXT NOT NULL,
  origin_at TEXT,
  hypocenter TEXT,
  magnitude TEXT,
  max_intensity TEXT
);
CREATE INDEX jma_quakes_event ON jma_quakes (event_id, report_at);

-- 観測点ごとの震度（VXSE53 の市町村の中の観測点）。area_name は電文の市町村の名前のまま。
-- 観測点の緯度経度は持たない（公式の資料が分からないので地図の点にしない。一覧だけ）
CREATE TABLE jma_quake_points (
  entry_id TEXT NOT NULL REFERENCES jma_entries (id) ON DELETE CASCADE,
  area_name TEXT NOT NULL,
  point_name TEXT NOT NULL,
  intensity TEXT NOT NULL
);
CREATE INDEX jma_quake_points_entry ON jma_quake_points (entry_id);

-- フィードごとの取得の状態。last_modified は次に If-Modified-Since に付ける値。
-- fetched_at は最後に試した時刻、ok は最後の成否、ok_at は最後に取れた時刻（304 も取れたに数える）、note は失敗の理由
CREATE TABLE jma_fetch_state (
  feed TEXT PRIMARY KEY CHECK (feed IN ('extra', 'eqvol')),
  last_modified TEXT,
  fetched_at TEXT NOT NULL,
  ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
  ok_at TEXT,
  note TEXT
);
