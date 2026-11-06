// 絵コンテ表を作る。絵（shot）ごとに静止画を 1 枚書き出し、秒・何を映すか・声の文・録画の状態と並べた 1 枚のページにする。
// node scripts/storyboard.mjs <出す場所>     例: node scripts/storyboard.mjs out/storyboard
// 出す物: <出す場所>/index.html（scripts/storyboard-page.html に表の中身を入れた物）と img/<絵の鍵>.jpg（幅 960）。
// 作者はこのページを Artifact で見て、絵ごとの欄に直しを書く（Artifact の db の notes に入り、動画の作業が読む）。
// 撮り直したら流し直して、同じ Artifact に出し直す。直しの鍵は絵の始まりの秒なので、秒を動かした絵の直しは前の秒の鍵に残る。
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { LINES, RECORDINGS, SCENES } from "../src/timeline.ts";
import { sayAt } from "../src/voice.ts";
import { ROOT, capture, ffmpeg, tmpEnv } from "./lib.mjs";

Object.assign(process.env, tmpEnv());
const { bundle } = await import("@remotion/bundler");
const { renderStill, selectComposition } = await import("@remotion/renderer");

const out = resolve(process.argv[2] ?? join(ROOT, "out", "storyboard"));
const imgDir = join(out, "img");
rmSync(imgDir, { recursive: true, force: true });
mkdirSync(imgDir, { recursive: true });

const assets = JSON.parse(readFileSync(join(ROOT, "public", "assets.json"), "utf8"));
/** 本番の Claude で撮る録画（docs/video/SHOOTING.md。手元の dev には鍵が無い）と、端末の録画 */
const PRODUCTION = new Set(["R02", "R06", "R07", "R08", "R09", "R12"]);

/** 絵の鍵（直しの db の文書の名前にも使う）。始まりの秒 */
const keyOf = (shot) => `t${String(shot.at).replace(".", "_")}`;

/** 静止画を撮る秒。出る動き・声の拍・囲みが出そろったあと、切り替えの前 */
function stillAt(shot) {
  const len = shot.end - shot.at;
  let t = len * 0.7;
  for (const c of shot.callouts ?? []) if (c.at !== undefined) t = Math.max(t, Math.min(c.end ?? len, c.at + 0.6));
  for (const b of shot.beats ?? []) t = Math.max(t, b + 0.8);
  // 声に合わせて出す言葉は、全部が出たあと
  for (const c of shot.cues ?? []) {
    const line = LINES.find((l) => l.id === c.line);
    const at = line ? sayAt(line, assets.voice?.[c.line], c.say ?? c.text) : null;
    if (at !== null) t = Math.max(t, at + (c.shift ?? 0) - shot.at + 0.8);
  }
  return shot.at + Math.min(Math.max(t, 0.5), len - 0.35);
}

/** 録画の状態。撮れている録画は「録画済」、使う所まで撮れていなければ「撮影待ち」と誰が撮るか */
function recordingState(id, from) {
  const count = assets.footage?.[id] ?? 0;
  if (count > 0 && (from ?? 0) * 30 < count) return { id, name: RECORDINGS[id] ?? "", state: "done" };
  const who = PRODUCTION.has(id) ? "本番" : /^R2\d$/.test(id) ? "端末" : "手元";
  return { id, name: RECORDINGS[id] ?? "", state: "wait", who };
}

const GRAPHIC = { title: "題名", text: "文字", plate: "名札", ring: "72 時間の輪", number: "数字", bars: "棒", memo: "メモの線画", rules: "ルールの表", quote: "一言", end: "終わりの画面" };

const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

// 束は 1 つ 0.7 GB（public の録画を写す）。終わったら消す（.tmp に残すと C: が埋まる）
const serveUrl = await bundle({ entryPoint: join(ROOT, "src/index.ts"), publicDir: join(ROOT, "public") });
const scenes = [];
try {
  const composition = await selectComposition({ serveUrl, id: "Care72Ja", inputProps: { showEn: false } });
  const ff = ffmpeg();

  for (const scene of SCENES) {
    const shots = [];
    for (const shot of scene.shots) {
      const key = keyOf(shot);
      const at = stillAt(shot);
      const png = join(imgDir, `${key}.png`);
      await renderStill({ serveUrl, composition, frame: Math.round(at * composition.fps), output: png, inputProps: { showEn: false }, imageFormat: "png" });
      const jpg = join(imgDir, `${key}.jpg`);
      const r = capture(ff.cmd, [...ff.pre, "-hide_banner", "-loglevel", "error", "-y", "-i", png, "-vf", "scale=960:-1:flags=lanczos", "-q:v", "3", jpg]);
      if (r.status !== 0) throw new Error(`縮める所で失敗: ${r.stderr}`);
      rmSync(png);
      const ids = [shot.footage, ...(shot.footages ?? [])].filter(Boolean);
      const recordings = ids.map((id, i) => recordingState(id, shot.froms?.[i] ?? shot.from));
      const text = [shot.value, ...(shot.lines ?? []), ...(shot.cues ?? []).map((c) => c.text), shot.sub].filter(Boolean).join(" ");
      const lines = LINES.filter((l) => l.at < shot.end && l.end > shot.at).map((l) => ({ id: l.id, ja: l.ja }));
      shots.push({
        key,
        at: shot.at,
        end: shot.end,
        time: `${fmt(shot.at)}–${fmt(shot.end)}`,
        still: fmt(at),
        kind: shot.kind,
        graphic: GRAPHIC[shot.kind] ?? null,
        label: shot.label,
        recordings,
        waitNumber: /［/.test(text) || lines.some((l) => /［/.test(l.ja)),
        chip: shot.chip ?? null,
        source: shot.source ?? null,
        rate: shot.rate ?? null,
        emphasis: !!shot.emphasis,
        callouts: (shot.callouts ?? []).map((c) => c.label),
        lines,
      });
      console.log(`${scene.id} ${fmt(shot.at)} ${shot.label}`);
    }
    scenes.push({ id: scene.id, title: scene.title, ground: scene.ground, at: scene.at, end: scene.end, time: `${fmt(scene.at)}–${fmt(scene.end)}`, shots });
  }
} finally {
  rmSync(serveUrl, { recursive: true, force: true });
}

const head = capture("git", ["rev-parse", "--short", "HEAD"]).stdout.trim();
const data = { made: new Date().toISOString(), commit: head, scenes };
const page = readFileSync(join(ROOT, "scripts", "storyboard-page.html"), "utf8").replace("/*DATA*/null", JSON.stringify(data));
writeFileSync(join(out, "index.html"), page);
console.log(`→ ${join(out, "index.html")}（絵 ${scenes.reduce((n, s) => n + s.shots.length, 0)} 枚）`);
