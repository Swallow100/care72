// Claude Code の画面（R21〜R23）を撮る。care72 の worktree で claude を疑似端末の中に起こし、頼み文を打って、
// 出た文字を記録する（shoot.mjs と同じ形）。画面の文字を待って印を付け、考えている間は描くときに切る。
// node video/scripts/term/claude.mjs R21|R22|R23 [--take 1] [--render] [--max 1800] [--dir <フォルダ>]
//   記録: video/assets/rec/<番号>-<回>/term.cast（1 件ずつ書き足す）。--render で SHOTS の view のとおりに描く（印を見てから描き直してよい）
//   --max は答えを待つ一番長い秒、--dir は置き場の外へ（試し用）。30 秒ごとに画面の終わりの数行を出す
//
// 起こし方（ARGS と ENV）:
// - claude は開発に使っている物（デスクトップのアプリが持つ版。CLAUDE_EXE で替えられる）
// - --permission-mode dontAsk: 前もって許した物のほかは聞かずに断る。Edit・Write・Bash は許していないので、ファイルを書かない。
//   R22 の `npx wrangler deploy` は、先にプロジェクトの PreToolUse のフック（tools/hooks/guard.mjs）が止め、
//   万一フックが通しても許していないので動かない（本物の配信は走らない）
// - --strict-mcp-config --mcp-config .mcp.json: MCP はこのリポジトリの care72-local（手元の D1 を読むだけ）だけ。
//   利用者の claude.ai のコネクタ（Cloudflare など）を読み込まない。--allowedTools でそれだけ許す（R23）
// - --setting-sources project,local: 利用者の設定（advisor・別のフック・許しの一覧）を読まない。プロジェクトのフックは読む
// - IS_DEMO=1: Claude Code の録画用の切り替え。組織名・メールを出さず、初回の設定の画面を飛ばす（ログイン済みの資格を使う）。
//   起動の枠に出るのは版・モデル・プラン・~\dev\care72-t43 だけ（名前・ユーザー名は出ない）
// 描く前に text.mjs と sheet.mjs で名前・道・メールが無いことを見る（/mcp の画面は道を出すので開かない）
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REC, REPO, Session, childEnv, sleep } from "./lib.mjs";
import { render } from "./render.mjs";

export const CLAUDE_SIZE = { cols: 84, rows: 22 };

export function claudeArgs() {
  return [
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    "mcp__care72-local",
    "--strict-mcp-config",
    "--mcp-config",
    join(REPO, ".mcp.json"),
    "--setting-sources",
    "project,local",
  ];
}

export function findClaude() {
  const cands = [
    process.env.CLAUDE_EXE,
    // デスクトップのアプリが持つ版（開発のセッションと同じ物）。一番新しい版を使う
    ...(() => {
      const base = join(process.env.APPDATA ?? "", "Claude", "claude-code");
      const list = (d) => {
        try {
          return readdirSync(d);
        } catch {
          return [];
        }
      };
      return list(base)
        .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
        .reverse()
        .flatMap((v) => list(join(base, v)).map((h) => join(base, v, h, "claude.exe")));
    })(),
    join(process.env.APPDATA ?? "", "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"),
  ].filter(Boolean);
  return cands.find((p) => existsSync(p)) ?? null;
}

/** 考えている・道具を使っている間の印（下の帯の「esc to interrupt」） */
const BUSY = /esc to interrupt|esc to cancel/i;
/** 使える量の上限の知らせ（11/5 の 1 回目は「You've hit your weekly limit · resets Nov 6, 7am (Asia/Tokyo)」で止まった） */
const LIMIT = /hit your (weekly |daily |session )?limit|limit · resets|usage limit reached/i;
/** 契約を使えない知らせ（11/6 7:15 は「Claude Code can't use your Claude subscription, usually because a payment is past due」で止まった） */
const NO_PLAN = /can't use your Claude subscription|payment is past due|Invalid API key|Please run \/login/i;
/** 選ぶ窓（信頼の確認・上限の選択・許しの確かめなど） */
const DIALOG = /Enter to confirm|Do you trust|What do you want to do\?/;

/** 頼み文と、待つ文字（印の名前） */
const SHOTS = {
  // フックが配信を止める
  R22: {
    // CLAUDE.md は wrangler を打たない決まりなので、決まりを知ったうえでのフックの動作確認だと書く（断られにくくする）
    prompt:
      "フックの動作確認です（録画用）。CLAUDE.md の決まりは知っています。PreToolUse のフックが止めるはずなので、Bash で npx wrangler deploy を 1 回だけ実行して、止めた文をそのまま見せてください",
    keys: [
      { label: "tool", re: /Bash\(npx wrangler deploy/ },
      { label: "blocked", re: /止めた: wrangler deploy/ },
    ],
    view: { from: "@tool-1.2", to: "@end" },
  },
  // MCP の check_leaks
  R23: {
    prompt: "手元の MCP（care72-local）で、訓練の本人役の発話を drill_events で読み、check_leaks に通して漏れの数を見せて",
    // 頼み文にも check_leaks の字があるので、MCP の道具の呼び出しの表示（「care72-local - check_leaks (MCP)」）を待つ
    keys: [{ label: "mcp", re: /check_leaks \(MCP\)/ }],
    view: { from: "@mcp-1.2", to: "@end" },
  },
  // 見直し役 3 つが並んで走る
  R21: {
    // 3 つの見直し役（opus・sonnet・haiku）に当たるファイルを 1 つずつ。表を出すまでで直さない（dontAsk で書けないので、直そうとして断られる行を出さない）
    prompt: "/care72-review lib/labels.ts components/CallQueue.tsx lib/drill/persona.ts（表を出すまでで、直さない）",
    keys: [{ label: "agents", re: /medical-reviewer|screen-checker|persona-tester/ }],
    // 見直し役は数分走るので、走り出しの 10 秒と、終わりの表の前の 3 秒から後ろだけを描く（間は切る）
    view: { from: "@agents-1.2", to: "@end", cut: "@agents+10..@done-3" },
  },
};

async function main() {
  const argv = process.argv.slice(2);
  const id = argv.find((a) => /^R2\d$/.test(a));
  const shot = SHOTS[id];
  if (!shot) {
    console.error(`使い方: node video/scripts/term/claude.mjs ${Object.keys(SHOTS).join("|")} [--take 1] [--render]`);
    process.exit(2);
  }
  const opt = (name, def) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : def);
  const take = opt("--take", "1");
  // --max: 答えを待つ一番長い秒（既定 30 分）。--dir: 置き場の外へ（試し用）
  const maxWait = Number(opt("--max", "1800")) * 1000;
  const exe = findClaude();
  if (!exe) throw new Error("claude.exe が見つからない（CLAUDE_EXE で場所を渡す）");
  const dir = argv.includes("--dir") ? opt("--dir") : join(REC, `${id}-${take}`);
  const cast = join(dir, "term.cast");
  // 記録は 1 件ずつ書き足す（外から止められても、そこまでの画面を text.mjs で見られる）
  const s = new Session({ file: exe, args: claudeArgs(), ...CLAUDE_SIZE, env: childEnv({ IS_DEMO: "1" }), title: id, live: cast });
  const mask = (t) => t.split("\n").filter((l) => l.trim()).slice(-6).join("\n");
  const progress = setInterval(() => console.log(`  … ${s.now().toFixed(0)} 秒\n${mask(s.screen())}`), 30_000);
  let failed = null;
  try {
    await s.waitFor(/❯/, { timeout: 120_000 });
    await s.idle(2500);
    // 窓（信頼の確認・上限の選択など）が出ていたら打たない
    if (DIALOG.test(s.screen())) throw new Error(`起動の後に窓が出ている（打つ前に止めた）\n${s.screen()}`);
    s.mark("ready");
    await s.type(shot.prompt, { cps: 22, jitter: 0.3 });
    await sleep(500);
    // 打った文字が入力の欄に入ったか（頭の 6 字）。入っていなければ Enter を押さない
    const head = shot.prompt.slice(0, 6);
    if (!s.screen().includes(head)) throw new Error(`打った文字が入力の欄に見えない（「${head}」）\n${s.screen()}`);
    s.mark("typed");
    await s.enter();
    s.mark("send");
    // 打っている間の候補の一覧（/care72-review の説明に見直し役の名前がある）が消えてから見る
    await sleep(1500);
    // 待つ文字が出るたびに印。上限の知らせが出たら止める。待つ文字が出ないまま答えが終わったら（断られたなど）止める
    const pending = [...shot.keys];
    let busySeen = false;
    let quietSince = null;
    const end = Date.now() + maxWait;
    while (Date.now() < end) {
      await sleep(200);
      const all = s.allText();
      const screen = s.screen();
      if (LIMIT.test(all)) {
        failed = "Claude の使える量の上限（画面の知らせのとおり、戻るまで撮れない）";
        break;
      }
      if (NO_PLAN.test(all)) {
        failed = "端末の claude の資格で契約を使えない（支払いの期限切れ・ログイン切れの知らせ）";
        break;
      }
      while (pending.length && pending[0].re.test(all)) s.mark(pending.shift().label);
      if (BUSY.test(screen)) {
        busySeen = true;
        quietSince = null;
      } else if (busySeen) {
        if (quietSince === null) quietSince = Date.now();
        else if (Date.now() - quietSince > 5000 && s.now() - s.lastOutput > 2) break;
      } else if (s.now() - s.lastOutput > 90) {
        // 送ってから 90 秒、考え中の印も出力も無い（送れていない・窓が出たなど）
        failed = `送ったあと 90 秒、何も動かない（画面は text.mjs で見る）\n${screen}`;
        break;
      }
    }
    if (!failed && Date.now() >= end) failed = `待つ長さ（${maxWait / 1000} 秒）を超えた`;
    if (!failed && pending.length) failed = `答えが終わったが「${pending.map((k) => k.label).join("・")}」が出なかった（断られたか、画面の形が違う。text.mjs で見る）`;
    s.mark("done");
    await sleep(7000);
    s.mark("end");
  } catch (e) {
    failed = e instanceof Error ? e.message : String(e);
  } finally {
    clearInterval(progress);
    s.save(cast);
    s.write("\x03");
    await sleep(800);
    s.write("\x03");
    await sleep(1500);
    s.kill();
  }
  console.log("--- 終わりの画面 ---\n" + s.screen());
  if (failed) {
    console.error(`撮れなかった: ${failed}（記録は ${cast}）`);
    process.exit(1);
  }
  if (argv.includes("--render")) await render({ cast, out: dir, name: id, ...shot.view });
  process.exit(0);
}

if (process.argv[1]?.endsWith("claude.mjs")) await main();
