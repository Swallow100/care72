-- 事業所の情報と、複数の市にまたがる地域（docs/tasks/T148.md）。事業所の画面（/office）の「事業所」と「地域」の区分で管理者が置く。
-- offices を指す表が多いので建て直さず、列を足すだけ（0017・0027・0030 と同じ）。前からある行はみな NULL（未入力・周りの市なし・広さは自動）。
--
-- 事業所の情報（計画書・様式 9 の事業所の欄。名前は前からの offices.name を同じ区分で直す）
--   address: 所在地（80 字まで）。phone・fax: 電話・FAX（20 字まで。数字・ハイフン・括弧の形は lib/office/profile.ts が確かめる）
--   office_number: 介護保険の事業所番号（数字 10 桁）
-- 地域（主な市は前からの offices.city。気象庁の欄・地図・上の帯・様式の一覧の初めの市にそろって効く。lib/office/region.ts）
--   region_cities: 周りの市の JSON の配列（["東温市","砥部町"]。主な市は入れない）。NULL は周りの市なし
--   region_km: 地図の広さ（中心からの km。5・10・20・40）。NULL は自動（周りの市が無ければ 10、あれば 20）
-- 事業所の区域（洪水・土砂・津波）は前からの offices.hazards（0030）を同じ区分で置く。
-- 番号: 0035 は T144（確認用の事業所と審査員のアカウント）が先に integrate に入ったので 0036（11/6 の取り込みで振り直した）。
ALTER TABLE offices ADD COLUMN address TEXT CHECK (address IS NULL OR length(address) BETWEEN 1 AND 80);
ALTER TABLE offices ADD COLUMN phone TEXT CHECK (phone IS NULL OR length(phone) BETWEEN 1 AND 20);
ALTER TABLE offices ADD COLUMN fax TEXT CHECK (fax IS NULL OR length(fax) BETWEEN 1 AND 20);
ALTER TABLE offices ADD COLUMN office_number TEXT CHECK (office_number IS NULL OR (length(office_number) = 10 AND office_number NOT GLOB '*[^0-9]*'));
ALTER TABLE offices ADD COLUMN region_cities TEXT CHECK (region_cities IS NULL OR (json_valid(region_cities) AND json_type(region_cities) = 'array'));
ALTER TABLE offices ADD COLUMN region_km INTEGER CHECK (region_km IS NULL OR region_km IN (5, 10, 20, 40));
