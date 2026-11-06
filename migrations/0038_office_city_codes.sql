-- 事業所の地域を全国の市区町村の表の団体コードで持つ（docs/tasks/T154.md）。事業所の画面の「地域」で都道府県 → 市区町村から選ぶ。
-- offices を指す表が多いので建て直さず、列を足すだけ（0017・0030・0036 と同じ）。前からある行はみな NULL。
--   city_code: 主な市の全国地方公共団体コード（6 桁、検査数字つき。表は lib/municipality）。NULL は未選択
--   region_city_codes: 周りの市の団体コードの JSON の配列（["382159"]。主な市は入れない）。NULL は周りの市なし
-- 前からの文字の列（city・region_cities、0036）は残し、選んだときに表の名前で書き直す（文字を読む所〔本人の住所の市の既定・様式の既定・
-- 気象庁の写しの市〕が前のまま動くように）。T148 の文字の値は、読むときに表で当て（lib/office/area.ts）、当たらなければ「未選択」で
-- 選び直しを促す。保存すると団体コードが入る。D1 の行を一括で書き換える文はここに置かない（表を SQL に重ねて 2 か所に持たないため）。
-- 番号: 0037 は T149 が先に使ったので 0038。
ALTER TABLE offices ADD COLUMN city_code TEXT CHECK (city_code IS NULL OR (length(city_code) = 6 AND city_code NOT GLOB '*[^0-9]*'));
ALTER TABLE offices ADD COLUMN region_city_codes TEXT CHECK (region_city_codes IS NULL OR (json_valid(region_city_codes) AND json_type(region_city_codes) = 'array'));
