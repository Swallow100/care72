// T156 使う側の模擬の本物の面（ChromeSurface、puppeteer）を、手元の小さな HTTP の頁で通す（next dev も Claude も使わない）。
// 読み（押せる物の番号・名前・窓の中だけ・パスワードの値を持たない）、書く・押す・戻る、印刷の旗、HTTP の失敗、写真、偽の使う人で筋を最後まで。
// Chrome・Edge の無い端末では飛ばす（lib/forms/t135.test.ts と同じ守り）。

import { mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordClaude, runLog } from "../drill/record.ts";
import { fakeActor } from "./fake.ts";
import type { Persona } from "./personas.ts";
import { ChromeSurface, VIEWPORTS } from "./surface.ts";
import { walkPersona } from "./walk.ts";

const PASSWORD = "local-test-only";

const page = (title: string, body: string) =>
  `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${title}</title></head><body><header><nav aria-label="画面"><a href="/home">担当一覧</a> <a href="/forms">書類</a></nav><span>デモ事業所（確認用）</span></header><main>${body}</main></body></html>`;

const PAGES: Record<string, string> = {
  "/login": page(
    "ログイン",
    `<h1>ログイン</h1><form id="f"><label for="login-id">ID</label><input id="login-id" name="id"><label for="login-password">パスワード</label><input id="login-password" type="password" name="password"><button type="submit">ログイン</button></form>
     <script>document.getElementById("f").addEventListener("submit",(e)=>{e.preventDefault();const ok=document.getElementById("login-id").value==="yamamoto"&&document.getElementById("login-password").value===${JSON.stringify(PASSWORD)};location.href=ok?"/home":"/login?e=1";});</script>`,
  ),
  "/home": page(
    "担当一覧",
    `<h1>担当一覧</h1><p>連絡先 090-0000-0011</p><button id="open">窓</button><button id="broken">壊れ</button>
     <div id="dlg" role="dialog" aria-modal="true" aria-label="確認" hidden><h2>確認</h2><button id="close">閉じる</button></div>
     <script>document.getElementById("open").onclick=()=>{document.getElementById("dlg").hidden=false};document.getElementById("close").onclick=()=>{document.getElementById("dlg").hidden=true};document.getElementById("broken").onclick=()=>fetch("/api/broken");</script>`,
  ),
  "/forms": page("書類", `<h1>書類</h1><a href="/people/p-01">山田 ハナ</a> <button onclick="window.print()">印刷</button>`),
  "/people/p-01": page("本人", `<h1>山田 ハナ</h1><a href="/forms">戻る</a>`),
};

let server: Server;
let base = "";
const dirs: string[] = [];
const skip = !ChromeSurface.available();

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/api/broken") {
      res.writeHead(500).end();
      return;
    }
    const body = PAGES[path];
    if (!body) {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" }).end(page("無い", "<h1>無い</h1>"));
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const TEST_PERSONA: Persona = {
  id: "first",
  label: "試しの人",
  profile: "試しの人",
  info: ["ID は yamamoto、パスワードは {{password}}"],
  prelogin: false,
  start: "/login",
  goals: [
    {
      id: "login",
      text: "ログインする",
      done: { path: "^/home" },
      route: [{ type: "ID", text: "yamamoto" }, { type: "パスワード", text: "{{password}}" }, { click: "ログイン" }],
    },
    { id: "print", text: "書類を印刷する（印刷の画面が開くところまで）", done: { printed: true }, route: [{ click: "書類" }, { click: "印刷" }] },
  ],
};

describe.skipIf(skip)("ChromeSurface（手元の HTTP の頁）", () => {
  it("読み: 押せる物に番号と名前、パスワードの値は持たない、窓が開いたら窓の中だけ、HTTP の失敗を数える", async () => {
    const s = new ChromeSurface({ base, viewport: VIEWPORTS["1280"], navTimeout: 20_000 });
    try {
      await s.open("/login");
      let snap = await s.snapshot();
      const id = snap.items.find((i) => i.name === "ID")!;
      const pw = snap.items.find((i) => i.name === "パスワード")!;
      expect(pw.role).toBe("password");
      await s.act({ action: "type", ref: id.ref, text: "yamamoto", thought: "", expect: "", surprised: false }, { password: PASSWORD });
      await s.act({ action: "type", ref: pw.ref, text: "{{password}}", thought: "", expect: "", surprised: false }, { password: PASSWORD });
      snap = await s.snapshot();
      expect(snap.items.find((i) => i.name === "ID")?.value).toBe("yamamoto");
      expect(JSON.stringify(snap)).not.toContain(PASSWORD);
      const login = snap.items.find((i) => i.name === "ログイン")!;
      await s.act({ action: "click", ref: login.ref, text: null, thought: "", expect: "", surprised: false }, { password: PASSWORD });
      snap = await s.snapshot();
      expect(snap.path).toBe("/home");
      expect(snap.header).toContain("デモ事業所（確認用）");
      expect(snap.items.find((i) => i.name === "担当一覧")?.zone).toBe("切替:画面");

      const open = snap.items.find((i) => i.name === "窓")!;
      await s.act({ action: "click", ref: open.ref, text: null, thought: "", expect: "", surprised: false }, { password: PASSWORD });
      snap = await s.snapshot();
      expect(snap.items.map((i) => i.name)).toEqual(["閉じる"]);
      await s.act({ action: "click", ref: snap.items[0].ref, text: null, thought: "", expect: "", surprised: false }, { password: PASSWORD });
      snap = await s.snapshot();
      expect(snap.items.some((i) => i.name === "壊れ")).toBe(true);

      const broken = snap.items.find((i) => i.name === "壊れ")!;
      await s.act({ action: "click", ref: broken.ref, text: null, thought: "", expect: "", surprised: false }, { password: PASSWORD });
      snap = await s.snapshot();
      expect(snap.errors).toContain("HTTP 500 /api/broken");
      // 次の読みでは消える（前の読みからの物だけ）
      expect((await s.snapshot()).errors).toEqual([]);

      const back = await s.act({ action: "back", ref: null, text: null, thought: "", expect: "", surprised: false }, { password: PASSWORD });
      expect(back.ok).toBe(true);
      expect((await s.snapshot()).path).toBe("/login");
      // 無い番号は押せない
      expect((await s.act({ action: "click", ref: 999, text: null, thought: "", expect: "", surprised: false }, { password: PASSWORD })).ok).toBe(false);
    } finally {
      await s.close();
    }
  }, 120_000);

  it("偽の使う人で筋を最後まで（ログイン → 書類 → 印刷の旗）、手ごとの写真", async () => {
    const shots = mkdtempSync(join(tmpdir(), "t156-chrome-"));
    dirs.push(shots);
    const s = new ChromeSurface({ base, viewport: VIEWPORTS["1536"], navTimeout: 20_000 });
    const log = runLog();
    try {
      const o = await walkPersona(TEST_PERSONA, {
        surface: s,
        client: recordClaude(fakeActor([TEST_PERSONA]), log),
        secrets: { password: PASSWORD },
        loginId: "yamamoto",
        limits: { maxSteps: 10, goalSteps: 5, maxMs: 120_000 },
        shots,
        budgetOk: () => true,
      });
      expect(o.stop).toBe("all");
      expect(o.goals.every((g) => g.reached)).toBe(true);
      expect(o.steps.map((x) => x.target?.name)).toEqual(["ID", "パスワード", "ログイン", "書類", "印刷"]);
      expect(o.lost.filter((e) => e.kind === "error")).toEqual([]);
      expect(statSync(o.steps[0].shot!).size).toBeGreaterThan(1000);
      // AI に送った中身にパスワードの値が無い
      expect(JSON.stringify(log.records)).not.toContain(PASSWORD);
    } finally {
      await s.close();
    }
  }, 120_000);

  it("手元のほかの host は開かない", () => {
    expect(() => new ChromeSurface({ base: "https://care72.app", viewport: VIEWPORTS["1536"] })).toThrow();
  });
});
