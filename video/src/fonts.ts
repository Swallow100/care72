// 書体を読み込む。Inter（英数字。アプリと同じ）と BIZ UDPGothic（どちらも OFL-1.1）を Google Fonts の CSS から。日本語は端末の書体（Yu Gothic UI など）で、読み込まない。
// 日本語の書体は字の範囲ごとに分かれていて、使う字が出てから読まれる。書き出しで字が欠けないよう、
// 動画で使う字を全部並べて document.fonts.load に渡し、読み終わるまで描くのを待つ（delayRender）。
import { continueRender, delayRender } from "remotion";
import { LINES, MODEL_ROWS, RECORDINGS, RULE_ROWS, SCENES } from "./timeline";

const CSS =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=BIZ+UDPGothic:wght@400;700&display=block";

// 図や部品の中で使う決まった言葉（timeline に無い物）
const FIXED =
  "至急要確認不明無事利用者は架空撮影待ち秒デモイメージ出典生成画像医療の助言はしない色と順位はルールの表AIは決めないcare72.appgithub.com/Swallow100/care720123456789%→×・、。「」（）［］";

function allText(): string {
  const parts: string[] = [FIXED];
  for (const l of LINES) parts.push(l.ja, l.en);
  for (const s of SCENES) {
    parts.push(s.title);
    for (const sh of s.shots) parts.push(sh.label, sh.chip ?? "", sh.source ?? "", sh.value ?? "", sh.sub ?? "", ...(sh.lines ?? []));
  }
  for (const r of RULE_ROWS) parts.push(r.input, r.reason);
  for (const m of MODEL_ROWS) parts.push(m.what, m.who);
  for (const [id, name] of Object.entries(RECORDINGS)) parts.push(id, name);
  // 同じ字は 1 つに
  return Array.from(new Set(parts.join(""))).join("");
}

let started = false;

export function loadFonts(): void {
  if (started || typeof document === "undefined") return;
  started = true;
  const handle = delayRender("書体の読み込み");
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = CSS;
  const done = () => continueRender(handle);
  link.onload = () => {
    const text = allText();
    Promise.all([
      document.fonts.load('400 40px "Inter"', text),
      document.fonts.load('600 40px "Inter"', text),
      document.fonts.load('400 40px "BIZ UDPGothic"', text),
    ])
      .then(done)
      .catch(done);
  };
  // 手元にネットが無いときは端末の書体で描く（書き出しの前に必ずネットのある所で）
  link.onerror = done;
  document.head.appendChild(link);
}
