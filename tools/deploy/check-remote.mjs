// 配信後の確かめ。使い方: node tools/deploy/check-remote.mjs [URL]（既定 https://care72.app）
// 中身は tools/deploy/checks.ts（node が型を外してそのまま読む）。全部 PASS なら終了コード 0、FAIL があれば 1。
//
// 環境変数（どれも任意。値はファイルに書かない）:
//   CHECK_COMMIT            出した commit（短い hash）。/api/health の commit と比べる（tools/deploy/rebuild-remote.sh が渡す）
//   CHECK_WORKERS_DEV_HOST  workers.dev のホスト名。あれば閉じているか（404 か 1042）を見る。無ければ飛ばす
//   CHECK_LOGIN_ID          ログインが要る確かめの ID（審査員か山本）
//   CHECK_LOGIN_PASSWORD    そのパスワード。ID と両方あるときだけ、ログイン → 役選択 → 担当一覧・本人のスマホ →
//                           訓練 大雨想定を 2 回進めて中断（AI を少し使う）→ 最初に戻す（デモ事業所を種に戻す）。作者が自分の端末で流す
//
// 手元（http://localhost:<port>）では、鍵の無い ai は SKIP、workers.dev は CHECK_WORKERS_DEV_HOST が無ければ SKIP。

import { DEFAULT_URL, formatResults, runChecks, summarize } from "./checks.ts";

const base = (process.argv[2] ?? DEFAULT_URL).replace(/\/+$/, "");
try {
  new URL(base);
} catch {
  console.error(`URL が読めない: ${base}`);
  process.exit(2);
}

const env = {
  CHECK_COMMIT: process.env.CHECK_COMMIT,
  CHECK_WORKERS_DEV_HOST: process.env.CHECK_WORKERS_DEV_HOST,
  CHECK_LOGIN_ID: process.env.CHECK_LOGIN_ID,
  CHECK_LOGIN_PASSWORD: process.env.CHECK_LOGIN_PASSWORD,
};

console.log(`== check ${base}`);
if (env.CHECK_LOGIN_ID && env.CHECK_LOGIN_PASSWORD) {
  console.log("ログインありの確かめも流す（訓練 大雨想定を 2 回進めて AI を少し使い、最後にデモ事業所を最初に戻す）");
}
const results = await runChecks(base, env, (input, init) => fetch(input, init));
for (const line of formatResults(results)) console.log(line);
process.exit(summarize(results).ok ? 0 : 1);
