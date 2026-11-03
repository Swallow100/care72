-- 仮想モード（docs/tasks/T50.md）。訓練の種類「仮想」と、世界の部屋（Managed Agents）の ID。
--
-- 種類: drills.scenario の CHECK を建て直さず、列 mode を足す（仮想は mode = 'virtual'、scenario は種の heavy_rain）。
-- drills は drill_events・signals が ON DELETE CASCADE で指す親なので、建て直しの DROP TABLE drills は
-- 外部キーの動き（子の行の削除）を起こし、配信の訓練記録が消える（SQLite の DROP TABLE は暗黙の DELETE を流す。
-- defer_foreign_keys は検査を後回しにするだけで CASCADE は止めない）。読む側（lib/drill/db.ts の rowScenario）が mode から virtual に戻す。
-- 部屋: 訓練ごとの session の ID（drills.world_session_id）と、1 回だけ作る Agent・Environment の ID（ai_agents）。
-- session は訓練が終わっても archive・delete しない。ai_agents は事業所ごとでないので、種の入れ直し・毎日 4 時の戻しで消さない。
ALTER TABLE drills ADD COLUMN mode TEXT CHECK (mode IS NULL OR mode = 'virtual');
ALTER TABLE drills ADD COLUMN world_session_id TEXT;

CREATE TABLE ai_agents (
  purpose TEXT PRIMARY KEY CHECK (purpose IN ('drill_world')),
  -- コードの版（lib/drill/world-room.ts の WORLD_AGENT_VERSION）。違えば agents.update で版を上げる
  version INTEGER NOT NULL CHECK (version >= 1),
  agent_id TEXT NOT NULL,
  -- API の Agent の版（sessions.create で固定する）
  agent_version INTEGER NOT NULL CHECK (agent_version >= 1),
  environment_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
