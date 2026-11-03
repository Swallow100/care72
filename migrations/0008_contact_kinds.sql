-- 連絡先の種類を足す（docs/tasks/T57.md）: 酸素業者・電力会社・病院・その他。
-- SQLite は CHECK を変えられないので表を建て直す。0002 と同じく、今の表を退けてから同じ名前で作る
-- （seed/seed.test.ts が migrations の CREATE TABLE の名前を全部、種の入れ直しの消す順に求めるため）。
-- contacts を外部キーで指す表は無い（REFERENCES contacts は無い）ので、退けて消しても外部キーは壊れない。
-- 列・外部キー・ほかの CHECK は 0001 と同じ。索引 contacts_person は退けた表と一緒に消えるので作り直す。

ALTER TABLE contacts RENAME TO contacts_old;

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN (
    'self', 'family', 'supporter', 'welfare_commissioner', 'visiting_nurse', 'care_service',
    'home_doctor', 'pharmacy', 'dialysis_center', 'city_office',
    'oxygen_supplier', 'power_company', 'hospital', 'other'
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

INSERT INTO contacts (
  id, person_id, kind, relation, name, phone, reach, emergency_order, supporter_order,
  night_ok, has_car, has_smartphone, note, sort, created_at
)
  SELECT id, person_id, kind, relation, name, phone, reach, emergency_order, supporter_order,
         night_ok, has_car, has_smartphone, note, sort, created_at
    FROM contacts_old;

DROP TABLE contacts_old;

CREATE INDEX contacts_person ON contacts (person_id, sort);
