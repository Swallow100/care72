# 発災時の画面の言葉の進み（Opus）

worktree care72-wording、branch task/wording（integrate/t11-t12 の 61ea903 から）、11/3 未明。設計の側が Gemini の校正を受けて決めた 7 件を入れた。決めた中身と理由は docs/DECISIONS.md の「119 の案内と画面の言葉」。

## できた物

| # | 物 | 場所 | commit |
| --- | --- | --- | --- |
| 1 | 灰の状態「未知」→「不明」。担当一覧・本人のページ・地図のピン・様式 9・報告の下書き（「不明の N 人は安否を確かめています」）が同じ言葉になる。ルールの表の入力・読み方も「不明」に、docs/TRIAGE.md・docs/SOURCES.md を npm run docs:triage で作り直した。CLAUDE.md の「灰 未知」2 か所も | lib/labels.ts、lib/triage/index.ts、lib/forms/form9-report.ts、CLAUDE.md、docs/TRIAGE.md・SOURCES.md | 383255c |
| 2 | 理由の「未確認 N 時間」→「連絡なし N 時間」（発災から連絡が取れていない時間）。表の例も。「透析先 未確認」と時計の「未確認」はそのまま | lib/triage/index.ts、lib/triage/heavy-rain.fixture.ts | 383255c |
| 3 | 行の詳細の見出し「時計」→「残り時間」、「信号」→「安否」、「優先修正」→「優先変更」（見出し・aria-label・表の下の行）、「切れ」→「失効」 | lib/list/labels.ts | 1e1161b |
| 4 | 本人のページの経過の種類「信号」→「安否」、「優先修正」→「優先変更」（様式 9 の経過も同じ表を読む） | lib/labels.ts の TIMELINE_KIND_LABELS | 1e1161b |
| 5 | 列の見出し「計画」→「避難計画」: 担当一覧の列、本人のページの上の段、事業所の利用者の表、担当一覧の右の面の見出し | lib/list/labels.ts、lib/labels.ts、lib/office/labels.ts、components/list/SidePane.tsx | 0047ac3 |
| 6 | 言葉のテスト: 決めた言葉と、採らなかった案の言葉（優先・支援者・で開始・分類修正）を留める | lib/labels.test.ts | 0259b4b |

テストは 961 件（960 から。期待の文字列を直したほかに 1 件足した）。`npm run typecheck` も通る。

## 確かめた所

- 担当一覧の発災時の表を手元で静的に描いた（大雨・停電 6 時間、小林を要確認→不明に下げたあと電池を超えた形。一時のテストで描き、commit していない）: 列の見出しの最後が「避難計画」、状態の印「不明」、理由「連絡なし 8 時間」「透析先 未確認、連絡なし 8 時間」、小林の名前の下に「優先変更 要確認→不明 失効」

## 未確認

- `npm run dev` で開いての確かめ（ログインが要る。1280px・1024px、ライト・ダーク）。行の詳細（RowDetail）は app router が無いと描けないので静的にも描いていない。見出しが 2 字 → 4 字（残り時間・避難計画）になったので、列の幅と行の詳細の見出しの折り返しを見る

## 迷った所

- 同じ字が別の意味で並ぶ所: ルールの表（docs/TRIAGE.md）で「不明 ＋ …」（安否）と「赤だけ（録音の水が来た・機器が止まった・不明を含む）」（録音の分類）。報告の下書きで【安否】の「不明 N 人」と【所在】の「不明 N 人」。どちらも見出しの中で分かれるので、そのままにした
- 「連絡なし」は行の最終連絡が無いときの言葉（DETAIL_LABELS.noContact）と同じ字になった。同じ行に理由「連絡なし 8 時間」と最終連絡「連絡なし」が並ぶ。意味は合っている
- 本人の報告を当てにしない人（docs/DECISIONS.md「色と連絡順」）で本人の緑だけが来ているときも、理由は「連絡なし N 時間、本人の緑は参考」になる（本人からは連絡がある）。表の読み方のまま
- コメントは、直したファイルの中で画面の言葉を並べている所だけ直した。直していないファイルのコメントに前の言葉が残る: 「未知」app/page.tsx・app/globals.css・components/disaster/ColorCounts.tsx・components/list/DisasterSummary.tsx・lib/map/side.ts・lib/person.ts・lib/forms/form9.ts、「優先修正」app/api/caseload/override/route.ts・components/list/OverrideForm.tsx・components/list/RowDetail.tsx・lib/signals/family.ts。信号の色 unknown の意味で「未知」と書いたコメント（lib/db/types.ts・lib/signals・lib/triage/from-ledger.ts など）とテストの名前も前のまま
- 頼まれた範囲の外なので直していない文書: .claude/agents/screen-checker.md（「COLOR_LABELS は 至急・要確認・未知・無事」。このままだと画面の確かめで「不明」を外れと見るおそれ）、.claude/skills/triage-rule/SKILL.md、docs/CLAUDE_CODE.md、docs/tasks、docs/PROGRESS.md、docs/SPEC.md（書き換えない決まり）
- docs/DECISIONS.md の理由は、2・7 と採らなかった 4 件は頼まれた文のまま、1・3〜6 は Opus が短く書いた
