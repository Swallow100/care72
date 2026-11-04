-- 様式の頁の画像（docs/progress/t86.md）。様式の読み取り（app/api/forms/read）で受けた頁の画像（黒塗りの画面を通した JPEG）を
-- R2（RECORDINGS の forms/<事業所>/<対応表>/<頁>.jpg）に置き、その頁の数と大きさを持つ。元の様式の頁の上に台帳の値を置いた紙
-- （lib/forms/overlay-sheet.ts）で、頁の画像を下に敷くのに使う。白紙の様式か、記入済みなら書いた値を人が塗った後の画像で、人の値は入らない。
-- 形は [{"page":1,"width":1414,"height":2000,"bytes":123456}, ...]（頁の順）。サーバーだけが書く（画面から保存する対応表の JSON には入れない）。
-- NULL は画像なし（T86 の前に読んだ対応表・手で作った対応表・R2 に置けなかった物）。そのときは前からの「欄名｜値」の 2 列の紙で出す。
-- 表を建て直さずに列を足すだけ（form_mappings を外部キーで指す表は無いが、種の入れ直しの消す順も変えずに済む）。
ALTER TABLE form_mappings ADD COLUMN page_images TEXT CHECK (page_images IS NULL OR json_valid(page_images));
