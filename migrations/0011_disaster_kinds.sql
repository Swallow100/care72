-- 災害の種類に台風・土砂・津波・その他を足す（docs/tasks/T60.md）。disaster_state.kind の CHECK を広げる。
-- 並びは lib/db/types.ts の DISASTER_KINDS（平時 → 大雨 → 台風 → 土砂 → 地震 → 津波 → その他）と同じ。
-- ルールの表（lib/triage）は種類を見ない（入力は 今・発災・停電の始まり だけ）。地図の場面への写しは lib/disaster/state.ts の DISASTER_SCENE。
-- SQLite は CHECK を変えられないので表を建て直す。disaster_state は事業所ごとに 1 行で、ほかの表から外部キーで指されていない
-- （0006 が drills の建て直しを避けた理由〔子の表の外部キー〕は当たらない）。
-- 新しい表を別の名前で作らず、今の表を退けてから同じ名前で作る（0002 と同じ。seed/seed.test.ts が migrations の CREATE TABLE の
-- 名前を全部、種の入れ直しの消す順に求めるため）。列・既定値・外部キー・ほかの CHECK は 0001 と同じ。

ALTER TABLE disaster_state RENAME TO disaster_state_old;

CREATE TABLE disaster_state (
  office_id TEXT PRIMARY KEY REFERENCES offices (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('normal', 'heavy_rain', 'typhoon', 'landslide', 'earthquake', 'tsunami', 'other')),
  started_at TEXT,
  started_by TEXT REFERENCES accounts (id) ON DELETE SET NULL,
  outage_scope TEXT NOT NULL DEFAULT 'none' CHECK (outage_scope IN ('none', 'office', 'area')),
  -- 停電の地区（町名の JSON の配列）
  outage_towns TEXT CHECK (outage_towns IS NULL OR (json_valid(outage_towns) AND json_type(outage_towns) = 'array')),
  outage_started_at TEXT,
  alert_level INTEGER CHECK (alert_level IS NULL OR alert_level IN (3, 4, 5)),
  water TEXT,
  road TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by TEXT REFERENCES accounts (id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  CHECK ((kind = 'normal') = (started_at IS NULL)),
  CHECK (kind <> 'normal' OR (outage_scope = 'none' AND alert_level IS NULL AND water IS NULL AND road IS NULL)),
  CHECK ((outage_scope = 'none') = (outage_started_at IS NULL)),
  CHECK ((outage_scope = 'area') = (outage_towns IS NOT NULL))
);

INSERT INTO disaster_state (office_id, kind, started_at, started_by, outage_scope, outage_towns, outage_started_at, alert_level, water, road, version, updated_by, updated_at)
  SELECT office_id, kind, started_at, started_by, outage_scope, outage_towns, outage_started_at, alert_level, water, road, version, updated_by, updated_at
    FROM disaster_state_old;

DROP TABLE disaster_state_old;
