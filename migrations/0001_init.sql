-- ケア72 の最初の表。
-- 台帳（本人のこと）は people.ledger の JSON に持ち、探す列（氏名・カナ・生年月日・事業所）と担当だけ列にする。
-- 時刻は UTC の ISO 8601 の文字列。値の形が決まっている列は CHECK で縛る（型は lib/db/types.ts と同じ）。

-- 事業所
CREATE TABLE offices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('demo', 'regular')),
  city TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- アカウント。行政・医療班は事業所をまたぐので office_id が無くてもよい
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  office_id TEXT REFERENCES offices (id),
  role TEXT NOT NULL CHECK (role IN ('care_manager', 'government', 'medical', 'judge')),
  is_office_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_office_admin IN (0, 1)),
  display_name TEXT NOT NULL,
  login_id TEXT UNIQUE,
  password_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (role <> 'care_manager' OR office_id IS NOT NULL)
);

-- 本人（台帳）
CREATE TABLE people (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES offices (id),
  care_manager_id TEXT REFERENCES accounts (id),
  name TEXT NOT NULL,
  kana TEXT NOT NULL,
  birth_date TEXT CHECK (birth_date IS NULL OR birth_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  plan_status TEXT NOT NULL DEFAULT 'none' CHECK (plan_status IN ('none', 'draft', 'consented', 'trained')),
  origin TEXT NOT NULL DEFAULT 'care_manager' CHECK (origin IN ('care_manager', 'on_site')),
  -- 本人の報告を当てにしない印（認知症など）。人が付ける。Claude は付けない。付けた・外したは経過に残す
  self_report_unreliable INTEGER NOT NULL DEFAULT 0 CHECK (self_report_unreliable IN (0, 1)),
  ledger TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(ledger)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX people_office ON people (office_id);
CREATE INDEX people_care_manager ON people (care_manager_id);
CREATE INDEX people_kana_birth ON people (kana, birth_date);
CREATE INDEX people_name ON people (name);

-- 連絡先。本人の電話（kind = self）も、家族・支援者・機関もここ
CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN (
    'self', 'family', 'supporter', 'welfare_commissioner', 'visiting_nurse', 'care_service',
    'home_doctor', 'pharmacy', 'dialysis_center', 'city_office'
  )),
  relation TEXT,
  name TEXT,
  phone TEXT,
  reach TEXT CHECK (reach IS NULL OR reach IN ('together', 'nearby', 'in_city', 'out_of_pref', 'far')),
  emergency_order INTEGER CHECK (emergency_order IS NULL OR emergency_order >= 1),
  supporter_order INTEGER CHECK (supporter_order IS NULL OR supporter_order >= 1),
  night_ok INTEGER CHECK (night_ok IS NULL OR night_ok IN (0, 1)),
  has_car INTEGER CHECK (has_car IS NULL OR has_car IN (0, 1)),
  has_smartphone INTEGER CHECK (has_smartphone IS NULL OR has_smartphone IN (0, 1)),
  note TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX contacts_person ON contacts (person_id, sort);

-- 同意 4 つ（名簿登録・計画の共有・支援者への提供・医療班への提供）。今の状態を 1 行ずつ。変えた記録は経過に残す
CREATE TABLE consents (
  person_id TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('registry', 'plan_share', 'supporters', 'medical')),
  status TEXT NOT NULL CHECK (status IN ('granted', 'refused', 'unconfirmed')),
  scope TEXT CHECK (scope IS NULL OR json_valid(scope)),
  recorded_by TEXT REFERENCES accounts (id),
  recorded_at TEXT NOT NULL,
  expires_at TEXT,
  note TEXT,
  PRIMARY KEY (person_id, kind)
);

-- 時計。人が入れる値で、出典の欄を持つ。A 機器・B 物・C 薬・D 本人の状態
CREATE TABLE clocks (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('device', 'supply', 'medication', 'condition')),
  category TEXT NOT NULL CHECK (category IN (
    'ventilator', 'suction', 'oxygen', 'dialysis', 'insulin', 'tube_feeding',
    'anticoagulant', 'steroid', 'antiepileptic', 'dementia', 'other'
  )),
  label TEXT NOT NULL,
  value REAL CHECK (value IS NULL OR value >= 0),
  unit TEXT CHECK (unit IS NULL OR unit IN ('minute', 'hour', 'day', 'week')),
  starts_on TEXT NOT NULL CHECK (starts_on IN ('outage', 'disaster', 'none')),
  source TEXT CHECK (source IS NULL OR source IN (
    'doctor', 'device_manual', 'pharmacy', 'facility', 'family', 'self', 'care_manager'
  )),
  source_note TEXT,
  confirmed_at TEXT,
  -- 外の物に頼る時計の頼り先（透析先・冷蔵・配達）と、その確認（確認済・未確認）。人が付ける。Claude は付けない
  depends_on TEXT CHECK (depends_on IS NULL OR depends_on IN ('dialysis_center', 'refrigeration', 'delivery')),
  depends_check TEXT CHECK (depends_check IS NULL OR depends_check IN ('confirmed', 'unconfirmed')),
  note TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  CHECK (value IS NULL OR unit IS NOT NULL),
  CHECK (kind <> 'condition' OR (value IS NULL AND starts_on = 'none')),
  CHECK ((depends_on IS NULL) = (depends_check IS NULL))
);
CREATE INDEX clocks_person ON clocks (person_id, sort);

-- 訓練。世界の状態（道路・停電・電話・職員・避難所）は監督が持ち、world の JSON に置く
CREATE TABLE drills (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES offices (id),
  scenario TEXT NOT NULL CHECK (scenario IN ('earthquake', 'heavy_rain', 'short')),
  status TEXT NOT NULL CHECK (status IN ('running', 'finished', 'abandoned')),
  step INTEGER NOT NULL DEFAULT 0 CHECK (step >= 0),
  sim_hour REAL NOT NULL DEFAULT 0 CHECK (sim_hour >= 0),
  world TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(world)),
  score TEXT CHECK (score IS NULL OR json_valid(score)),
  started_by TEXT REFERENCES accounts (id),
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX drills_office ON drills (office_id, started_at);

-- 訓練の出来事。監督の差し込み、ペルソナの 1 刻み、着信、ケアマネの手、その結果
CREATE TABLE drill_events (
  id TEXT PRIMARY KEY,
  drill_id TEXT NOT NULL REFERENCES drills (id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  step INTEGER NOT NULL CHECK (step >= 0),
  sim_hour REAL NOT NULL CHECK (sim_hour >= 0),
  person_id TEXT REFERENCES people (id) ON DELETE CASCADE,
  actor TEXT NOT NULL CHECK (actor IN ('director', 'persona', 'care_manager', 'world')),
  kind TEXT NOT NULL CHECK (kind IN (
    'incident', 'persona_turn', 'call_in', 'red_button', 'recording', 'action', 'result', 'score'
  )),
  payload TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (drill_id, seq)
);

-- 信号。本人・家族の赤緑と 4 問、録音とその分類。drill_id があれば訓練の信号
CREATE TABLE signals (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  drill_id TEXT REFERENCES drills (id) ON DELETE CASCADE,
  color TEXT NOT NULL CHECK (color IN ('green', 'red', 'unknown')),
  source TEXT NOT NULL CHECK (source IN ('self', 'family', 'supporter', 'care_manager', 'agent')),
  where_now TEXT CHECK (where_now IS NULL OR where_now IN ('home', 'shelter', 'other')),
  injured INTEGER CHECK (injured IS NULL OR injured IN (0, 1)),
  at_home INTEGER CHECK (at_home IS NULL OR at_home IN (0, 1)),
  can_move INTEGER CHECK (can_move IS NULL OR can_move IN (0, 1)),
  has_medicine INTEGER CHECK (has_medicine IS NULL OR has_medicine IN (0, 1)),
  recording_key TEXT,
  transcript TEXT,
  classes TEXT CHECK (classes IS NULL OR json_valid(classes)),
  classified_by TEXT CHECK (classified_by IS NULL OR classified_by IN ('claude', 'care_manager')),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX signals_person_time ON signals (person_id, occurred_at);
CREATE INDEX signals_drill ON signals (drill_id);

-- 経過。誰が・いつ・何を。医療班・行政も書き足す。訓練の記録はここに入れない
CREATE TABLE timeline_entries (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  author_id TEXT REFERENCES accounts (id),
  author_role TEXT NOT NULL CHECK (author_role IN (
    'self', 'family', 'supporter', 'care_manager', 'medical', 'government', 'system'
  )),
  kind TEXT NOT NULL CHECK (kind IN (
    'signal', 'called', 'pickup', 'safety_check', 'examined', 'medication_given', 'transported',
    'arrived_shelter', 'received', 'released', 'override', 'consent', 'clock_check', 'self_report_mark', 'note'
  )),
  body TEXT,
  payload TEXT CHECK (payload IS NULL OR json_valid(payload)),
  signal_id TEXT REFERENCES signals (id) ON DELETE SET NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX timeline_person_time ON timeline_entries (person_id, occurred_at);

-- AI の呼び出し（Claude と Gemini TTS）。1 回 1 行。入れた物・返った物（本文）は入れない。
-- 事業所ごとの 1 日の上限はこの表を day（JST の日付）で数える（lib/claude/usage.ts）。呼ぶ前に 1 行足し、終わったら状態と token を書く
CREATE TABLE ai_calls (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES offices (id),
  purpose TEXT NOT NULL CHECK (purpose IN (
    'form_read', 'director', 'scoring', 'ledger_input', 'summary', 'persona', 'classify', 'voice'
  )),
  model TEXT NOT NULL,
  day TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL CHECK (status IN ('pending', 'ok', 'failed')),
  error TEXT CHECK (error IS NULL OR error IN ('refused', 'bad_output', 'timeout', 'api_error')),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  CHECK ((status = 'failed') = (error IS NOT NULL))
);
CREATE INDEX ai_calls_office_day ON ai_calls (office_id, day);

-- 様式 9（災害時利用者一覧表）の優先順位の手直し。直すたびに 1 行足し、消さない（理由を残す）。
-- 今の順位は本人ごと・平時と発災時ごとにいちばん新しい行。rank が NULL の行は「自動に戻す」。
-- 自動の順位は平時は優先の骨格、発災時はルールの表（lib/triage）。手直しは並べ替えるだけで、色は変えない。
-- 本人・事業所を消すと一緒に消える（種を入れ直すと空になる）。
CREATE TABLE form9_rank_edits (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES offices (id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('normal', 'disaster')),
  rank INTEGER CHECK (rank IS NULL OR rank >= 1),
  -- 直したときの自動の順位（後で見て、どこから動かしたか分かるように）
  auto_rank INTEGER NOT NULL CHECK (auto_rank >= 1),
  reason TEXT NOT NULL,
  set_by TEXT REFERENCES accounts (id) ON DELETE SET NULL,
  set_at TEXT NOT NULL,
  CHECK (rank IS NULL OR length(trim(reason)) > 0)
);
CREATE INDEX form9_rank_edits_person ON form9_rank_edits (office_id, mode, person_id, set_at);

-- 事業所の災害の状態（災害モード）。事業所ごとに 1 行。行が無ければ平時。
-- 人が切り替え、人が入れる（気象庁の情報からの自動の切替は作っていない）。発災と停電の始まりはルールの表（lib/triage）の入力になる。
-- 平時に戻すと発災・停電・レベル・断水・道路を全部 NULL に戻す。変えるたびに office_timeline_entries に 1 行足す。
-- 事業所を消すと一緒に消える（種を入れ直すと平時になる）。
CREATE TABLE disaster_state (
  office_id TEXT PRIMARY KEY REFERENCES offices (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('normal', 'heavy_rain', 'earthquake')),
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

-- 事業所の経過。本人の経過（timeline_entries）とは別に、事業所の行を持つ。誰が・いつ・何を。
-- body は画面に出す 1 行（大雨・停電 事業所全体 など）、payload は変えたあとの状態の写し。人の名前・住所は入れない
CREATE TABLE office_timeline_entries (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES offices (id) ON DELETE CASCADE,
  author_id TEXT REFERENCES accounts (id) ON DELETE SET NULL,
  author_role TEXT NOT NULL CHECK (author_role IN (
    'self', 'family', 'supporter', 'care_manager', 'medical', 'government', 'system'
  )),
  kind TEXT NOT NULL CHECK (kind IN ('disaster_on', 'disaster_off', 'disaster_info')),
  body TEXT,
  payload TEXT CHECK (payload IS NULL OR json_valid(payload)),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX office_timeline_office_time ON office_timeline_entries (office_id, occurred_at);
