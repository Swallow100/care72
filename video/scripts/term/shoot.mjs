// 端末だけの録画を撮る（Claude Code を使わない R20・R24）。本物の命令を疑似端末で流し、記録を描いて連番にする。
// node video/scripts/term/shoot.mjs R20|R24 [--take 1] [--no-render]
//   記録: video/assets/rec/<番号>-<回>/term.cast（描き直すときの元。commit しない）
//   連番: 同じフォルダの 00001.jpg …（30fps、1920×1080）と markers.json
// 始まりは見せたい所の少し前（S7 の Cycle は録画の頭から 2.3〜3 秒だけ使う）。始まりを変えるときは render.mjs を --from で流し直す
import { join } from "node:path";
import { REC, Session, sleep } from "./lib.mjs";
import { render } from "./render.mjs";

const args = process.argv.slice(2);
const id = args.find((a) => /^R2\d$/.test(a));
const take = args.includes("--take") ? args[args.indexOf("--take") + 1] : "1";
const noRender = args.includes("--no-render");

/** 撮る物。run が命令を流して印を付け、view が描く間を返す */
const SHOTS = {
  // worktree の一覧（並行の作業の数）と、main に branch が merge される線
  R20: {
    async run(s) {
      // worktree の道は C:/Users/<名前>/dev/ から始まるので、画面に出す前に sed で dev/ までを落とす（ユーザー名を映さない）
      await s.type("git worktree list | sed 's#.*/dev/##'");
      await s.enter();
      await s.prompt();
      s.mark("worktrees");
      await sleep(1200);
      await s.type("git log --graph --format='%h %<(44,trunc)%s' -n 28 origin/main");
      s.mark("graph-typed");
      await sleep(250);
      await s.enter();
      s.mark("graph");
      await s.prompt();
      await sleep(7000);
      s.mark("end");
    },
    view: { from: "@graph-1.4", to: "@end" },
  },
  // テストの件数（vitest の終わりの数）
  // vitest は 1 行目に「RUN v5 C:/Users/<名前>/dev/…」と道を出す。dot の報告は 1 件 1 点で 3000 点ほど並び、
  // 終わりの数が出るころには 1 行目が画面の上へ流れている。@summary より前から描くと道が映るので使わない
  R24: {
    async run(s) {
      await s.type("npm test -- --reporter=dot --silent --maxWorkers=4");
      await sleep(300);
      await s.enter();
      s.mark("enter");
      // 「Tests  1406 passed (1406)」。落ちたテストがあっても止まらずに印を付ける（落ちた数は終わりの画面で見る）
      await s.waitFor(/^\s*Tests\s+.*\(\d+\)\s*$/m, { timeout: 900_000 });
      s.mark("summary");
      await s.prompt({ timeout: 120_000 });
      s.mark("prompt");
      await sleep(7000);
      s.mark("end");
    },
    view: { from: "@summary-0.6", to: "@end" },
  },
};

const shot = SHOTS[id];
if (!shot) {
  console.error(`使い方: node video/scripts/term/shoot.mjs ${Object.keys(SHOTS).join("|")} [--take 1] [--no-render]`);
  process.exit(2);
}
const dir = join(REC, `${id}-${take}`);
const cast = join(dir, "term.cast");
const s = new Session({ title: id });
try {
  await s.prompt({ timeout: 20_000 });
  await sleep(600);
  s.mark("ready");
  await shot.run(s);
} finally {
  s.save(cast);
  s.kill();
}
console.log("--- 終わりの画面 ---\n" + s.screen());
if (!noRender) await render({ cast, out: dir, name: id, ...shot.view });
process.exit(0);
