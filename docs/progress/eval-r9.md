# 評価の 9 回目（r9、本物の AI）と使う側の模擬の 3 回目（persona r3）

2026-11-07 06:05〜 JST、eval/r9（origin/integrate/t11-t12 の 9de6fb03。T166〜T172 の入った木）。アプリのコードと台は直していない（測るだけ）。

記録はリポジトリの外（care72-qa/eval/ の下）。

- 訓練: `drill\r9\20261107-060522-real\`
- 書類: `forms\r9\20261107-060526-real\`
- 使う側の模擬: `persona\r3\`（回している途中）

## 回し方

- 訓練: r8 と同じ（`--real --runs 5 --seed 6d83d034 --review --judge 3 --answer-calls --talk-rounds 8`、10 人全員）。`--max-usd 10`
- 書類: r8 と同じ 17 様式 × 入力 55、紙は all、`--catalog-fetch --review --reread-max=2`、照合は r8 と同じ 12 枚。入力の絵と一覧の様式の写しは r8 の物を使う。`--max-usd=12`
- 使う側の模擬: 手元の localhost（next dev、手元の D1 は db:fresh）に 5 筋全部、`--max-usd 4`。回す前に、偽の使う人（Claude を呼ばない）で 5 筋を 2 回通し、ケアマネ・医療班・一括印刷の頁を開いて組み立てを済ませる。パスワードは使い捨ての値をその場で作り、どこにも書いていない

（結果は回が終わってから足す）
