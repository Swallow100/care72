// T106 避難経路の地図を計画書の欄に（原本の枠の紙と前からの紙面）、一括印刷も原本の枠の紙に、自動の印刷は地図のタイルを待つ。
// 印刷の頁の寸法（地図が欄の枠に収まる・前からの紙面の頁数）は t106-print.test.ts。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FillToggle } from "../../components/forms/FillToggle.tsx";
import { MatsuyamaSheet } from "../../components/forms/MatsuyamaSheet.tsx";
import { OverlaySheet } from "../../components/forms/OverlaySheet.tsx";
import { PaperBatch } from "../../components/forms/PaperBatch.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { parseLedger } from "../db/ledger.ts";
import type { GeoPoint, Ledger, RouteMap } from "../db/types.ts";
import { fitRoute } from "../map/route-edit.ts";
import { GSI_ROUTE_CREDIT } from "../map/route-image.ts";
import { hasFillablePaper, matsuyamaBatchPaper, medicalBatchPaper } from "./batch.ts";
import { matsuyamaFrameSheet, ROUTE_MAP_ANNEX_MM, ROUTE_MAP_BOX_MM, ROUTE_MAP_SLOT, routeMapFor } from "./frame-build.ts";
import { MATSUYAMA_FRAME } from "./frame-matsuyama.ts";
import { buildMatsuyamaSheet, t, value, type MatsuyamaSheet as Sheet } from "./matsuyama.ts";
import { buildMedicalSummary, type MedicalSummary } from "./medical-summary.ts";
import { ORIGINALS, type OriginalManifest } from "./originals.ts";
import type { OverlaySheet as Overlay } from "./overlay-sheet.ts";
import { seedRows } from "./print-harness.ts";
import { autoPrint, SVG_IMAGE_SELECTOR, waitSvgImages, type PrintWindow } from "./print.ts";
import { matsuyamaUnconfirmed, medicalUnconfirmed } from "./unconfirmed.ts";

const OPTS = { today: "2026-11-05", officeName: "デモ事業所" };
const manifestOf = (id: "matsuyama" | "kiroku"): OriginalManifest => ({
  id,
  sha256: ORIGINALS[id].sha256,
  pages: ORIGINALS[id].usePages.map((page) => ({ page, width: 3307, height: 4677, bytes: 1 })),
  importedAt: "2026-11-05T00:00:00.000Z",
});

const DEST: GeoPoint = { lat: 33.805, lng: 132.756 };

/** 種の 1 人の台帳に、家から避難先 1 への経路地図を足す（手で引いた線か、openrouteservice の線） */
function withRoute(i: number, source: "hand" | "ors" = "hand"): Ledger {
  const base = parseLedger(seedRows(SEED_PEOPLE[i]).person.ledger);
  const home = base.basic.location!;
  const mid = { lat: (home.lat + DEST.lat) / 2, lng: (home.lng + DEST.lng) / 2 };
  const map: RouteMap = {
    to: 1,
    mode: "foot",
    source,
    line: source === "ors" ? [{ lat: home.lat + 0.0004, lng: home.lng }, mid, DEST] : [home, mid, DEST],
    via: source === "hand" ? [mid] : [],
    distanceM: 1500,
    ...(source === "ors" ? { durationS: 1200 } : {}),
    view: fitRoute([home, DEST], home),
  };
  return { ...base, evacuation: { ...base.evacuation, destination1Location: DEST, routeMap: map } };
}
const sheetOf = (i: number): Sheet => buildMatsuyamaSheet(seedRows(SEED_PEOPLE[i]), OPTS);
const medicalOf = (i: number): MedicalSummary => {
  const r = buildMedicalSummary(seedRows(SEED_PEOPLE[i]), OPTS);
  if (r.kind !== "sheet") throw new Error("医療要約が無い");
  return r.sheet;
};
const images = (s: Overlay) => s.pages.flatMap((p) => p.items.filter((it) => it.kind === "image").map((it) => ({ ...it, page: p.page })));
/** SVG の viewBox の縦横の比 */
const viewRatio = (svg: string) => {
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!m) throw new Error("viewBox が無い");
  return Number(m[1]) / Number(m[2]);
};
const TILE = /<image href="https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/pale\/\d+\/\d+\/\d+\.png"/;

describe("台帳の経路地図 → 避難経路の欄の地図（routeMapFor）", () => {
  it("経路地図が無い人・家の位置が無い人は null（欄を空け、文字の経路だけ）", () => {
    for (const p of SEED_PEOPLE) expect(routeMapFor(parseLedger(seedRows(p).person.ledger)), p.person.id).toBeNull();
    const noHome = withRoute(0);
    delete noHome.basic.location;
    expect(routeMapFor(noHome)).toBeNull();
  });

  it("箱の大きさ（mm）で描いた SVG。地理院タイルを <image href> で読み、縦横の比は箱と同じ（保存した範囲を切らずに広げる）", () => {
    const make = routeMapFor(withRoute(0))!;
    const pic = make({ w: 173.25, h: 61.26 })!;
    expect(pic.alt).toBe("経路地図");
    expect(pic.svg.startsWith("<svg ")).toBe(true);
    expect(pic.svg).toContain('width="173.25mm" height="61.26mm"');
    expect(pic.svg).toMatch(TILE);
    expect(pic.svg).toContain("data-route-line");
    expect(pic.svg).toContain(GSI_ROUTE_CREDIT.text);
    expect(viewRatio(pic.svg)).toBeCloseTo(173.25 / 61.26, 2);
    // 紙はタイルを 1 段細かく（ROUTE_MAP_DETAIL）: 同じ範囲で画面の段より多くのタイルを敷く
    const tiles = (s: string) => s.match(/<image /g)?.length ?? 0;
    expect(tiles(pic.svg)).toBeGreaterThan(4);
  });

  it("名前・カナ・町名・避難先の名前・電話は SVG に入らない（座標から計算した数と固定の言葉だけ）", () => {
    for (let i = 0; i < SEED_PEOPLE.length; i++) {
      const p = SEED_PEOPLE[i];
      const l = withRoute(i, i % 2 === 0 ? "hand" : "ors");
      const svg = routeMapFor(l)!({ w: ROUTE_MAP_BOX_MM.w, h: ROUTE_MAP_BOX_MM.h })!.svg;
      const words = [p.person.name, p.person.kana, l.basic.address?.town, l.evacuation.destination1, l.evacuation.destination2, ...p.contacts.flatMap((c) => [c.name, c.phone])];
      for (const w of words.filter((x): x is string => typeof x === "string" && x.trim().length >= 2)) expect(svg, `${p.person.id} ${w}`).not.toContain(w);
      // 埋め込む文字列に script・on〜 の属性・外の SVG の参照が無い
      expect(svg).not.toMatch(/<script|\son[a-z]+=|<foreignObject|xlink:href|<use /i);
    }
  });
});

describe("経路地図のある人の避難経路の欄は埋まった扱い（様式の注「地図上または箇条書き等で」）", () => {
  it("文が無くても未確認に数えず、色付けで塗らない（地図が塗りで黄色くならない）。文があれば文を書く", () => {
    const seed = SEED_PEOPLE[1];
    const rowsWith = (l: Ledger) => ({ ...seedRows(seed), person: { ...seedRows(seed).person, ledger: JSON.stringify(l) } });
    const noText = withRoute(1);
    delete noText.evacuation.route;
    const plain = parseLedger(seedRows(seed).person.ledger);
    delete plain.evacuation.route;
    const without = buildMatsuyamaSheet(rowsWith(plain), OPTS);
    const withMap = buildMatsuyamaSheet(rowsWith(noText), OPTS);
    expect(without.cells["route.text"].kind).toBe("unconfirmed");
    expect(withMap.cells["route.text"]).toEqual({ kind: "value", lines: [] });
    const names = (s: Sheet) => matsuyamaUnconfirmed(s).fields.map((f) => f.name);
    expect(names(without)).toContain("避難経路");
    expect(names(withMap)).not.toContain("避難経路");
    expect(matsuyamaUnconfirmed(withMap).count).toBe(matsuyamaUnconfirmed(without).count - 1);
    const framed = matsuyamaFrameSheet(withMap, manifestOf("matsuyama"), { routeMap: routeMapFor(noText) });
    expect(framed.pages.flatMap((p) => p.fills).some((f) => f.keys.includes("route.text"))).toBe(false);
    expect(images(framed)[0].box.h * MATSUYAMA_FRAME.pages[1].h).toBeCloseTo(ROUTE_MAP_BOX_MM.h, 2);
    const textToo = withRoute(1);
    textToo.evacuation.route = "南の道から公民館へ";
    expect(buildMatsuyamaSheet(rowsWith(textToo), OPTS).cells["route.text"]).toEqual(value([t("南の道から公民館へ")]));
  });
});

describe("原本の枠の紙（OverlaySheet）の避難経路の欄", () => {
  it("経路地図があれば 2 頁の避難経路の欄に SVG。文が無ければ欄いっぱい、あれば欄の上 12.2mm を文に", () => {
    const sheet = sheetOf(0);
    const slot = MATSUYAMA_FRAME.slots.find((s) => s.kind === "image")!;
    const page = MATSUYAMA_FRAME.pages.find((p) => p.page === 2)!;
    const noText: Sheet = { ...sheet, cells: { ...sheet.cells, "route.text": { kind: "unconfirmed" } } };
    const withText: Sheet = { ...sheet, cells: { ...sheet.cells, "route.text": value([t("南へ 200m、公民館")]) } };
    for (const [s, h] of [
      [noText, ROUTE_MAP_BOX_MM.h],
      [withText, ROUTE_MAP_BOX_MM.withTextH],
    ] as const) {
      const framed = matsuyamaFrameSheet(s, manifestOf("matsuyama"), { routeMap: routeMapFor(withRoute(0)) });
      const [pic] = images(framed);
      expect(pic.page).toBe(2);
      expect(pic.slot).toBe(ROUTE_MAP_SLOT);
      expect(pic.box.x * page.w).toBeCloseTo(slot.box.x, 2);
      expect(pic.box.w * page.w).toBeCloseTo(ROUTE_MAP_BOX_MM.w, 2);
      expect(pic.box.h * page.h).toBeCloseTo(h, 2);
      expect((pic.box.y + pic.box.h) * page.h).toBeCloseTo(slot.box.y + slot.box.h, 2);
      expect(pic.svg).toContain(`width="${ROUTE_MAP_BOX_MM.w}mm" height="${h}mm"`);
      expect(viewRatio(pic.svg)).toBeCloseTo(ROUTE_MAP_BOX_MM.w / h, 2);
    }
    // 文は欄の上の 12mm に（地図に重ならない）
    const framed = matsuyamaFrameSheet(withText, manifestOf("matsuyama"), { routeMap: routeMapFor(withRoute(0)) });
    const text = framed.pages.flatMap((p) => p.items).find((it) => it.kind === "text" && it.fieldId === "route.text")!;
    expect(text.box.h * page.h).toBeCloseTo(12, 2);
  });

  it("紙は SVG を欄の中にそのまま置く（<img> の data: にしない。タイルが画面と印刷で読まれる形）", () => {
    const framed = matsuyamaFrameSheet(sheetOf(1), manifestOf("matsuyama"), { routeMap: routeMapFor(withRoute(1, "ors")) });
    const html = renderToStaticMarkup(createElement(OverlaySheet, { sheet: framed, imageSrc: (p) => `/o/${p}.png`, checked: "", kind: "matsuyama" }));
    const at = html.indexOf('data-slot="route-map"');
    expect(at).toBeGreaterThan(0);
    const div = html.slice(html.lastIndexOf("<div", at), html.indexOf("</svg>", at) + 6);
    expect(div).toContain('class="ov-pic"');
    expect(div).toContain('role="img"');
    expect(div).toContain('aria-label="経路地図"');
    expect(div).toMatch(/<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(div).toMatch(TILE);
    expect(div).toContain("経路 目安");
    expect(html).not.toContain("data:image/svg");
    expect(html).not.toMatch(/<img[^>]*route-map/);
  });

  it("経路地図の無い人は地図を置かず、避難経路の文は欄いっぱい", () => {
    const sheet = sheetOf(2);
    const withText: Sheet = { ...sheet, cells: { ...sheet.cells, "route.text": value([t("南へ 200m、公民館")]) } };
    const framed = matsuyamaFrameSheet(withText, manifestOf("matsuyama"), { routeMap: routeMapFor(parseLedger(seedRows(SEED_PEOPLE[2]).person.ledger)) });
    expect(images(framed)).toEqual([]);
    const page = MATSUYAMA_FRAME.pages.find((p) => p.page === 2)!;
    const text = framed.pages.flatMap((p) => p.items).find((it) => it.kind === "text" && it.fieldId === "route.text")!;
    expect(text.box.h * page.h).toBeCloseTo(ROUTE_MAP_BOX_MM.h, 2);
    const html = renderToStaticMarkup(createElement(OverlaySheet, { sheet: framed, imageSrc: () => "/o.png", checked: "" }));
    expect(html).not.toContain('data-slot="route-map"');
  });
});

describe("前からの紙面（MatsuyamaSheet）の避難経路", () => {
  it("経路地図があれば段の文の後に「地図 別紙」、地図は最後の別紙の頁に 173.25 × 86.6mm の SVG。無ければどちらも無い", () => {
    const sheet = sheetOf(0);
    const html = renderToStaticMarkup(createElement(MatsuyamaSheet, { sheet, routeMap: routeMapFor(withRoute(0)) }));
    const pageTwo = html.slice(html.indexOf('data-page="2"'), html.indexOf('data-annex="route-map"'));
    const block = pageTwo.slice(pageTwo.indexOf('data-block="route"'));
    expect(block).toMatch(/data-annex-mark="route-map">地図 別紙<\/span>/);
    expect(block).not.toContain("<svg xmlns");
    const annex = html.slice(html.indexOf('data-annex="route-map"'));
    expect(annex).toContain("別紙　避難経路");
    expect(annex).toContain(`対象者 <span data-field="target.name">${sheet.name}</span>`);
    expect(annex).toContain('class="route-map"');
    expect(annex).toContain(`width="${ROUTE_MAP_ANNEX_MM.w}mm" height="${ROUTE_MAP_ANNEX_MM.h}mm"`);
    expect(annex).toMatch(TILE);
    expect(annex).toContain('data-paper-foot="1/1"');
    expect(viewRatio(annex.slice(annex.indexOf("<svg")))).toBeCloseTo(ROUTE_MAP_ANNEX_MM.w / ROUTE_MAP_ANNEX_MM.h, 2);
    // 2 頁の下は 2/2 のまま
    expect(pageTwo).toContain('data-paper-foot="2/2"');
    const none = renderToStaticMarkup(createElement(MatsuyamaSheet, { sheet, routeMap: routeMapFor(parseLedger(seedRows(SEED_PEOPLE[0]).person.ledger)) }));
    expect(none).not.toContain('data-slot="route-map"');
    expect(none).not.toContain("data-annex");
    expect(none).not.toContain("<svg xmlns");
  });
});

describe("一括印刷の 1 人分（lib/forms/batch.ts）", () => {
  it("計画書: 原本を取り込んでいれば原本の枠の紙（色付けの版も）、無ければ前からの紙面。どちらも経路地図を欄に", () => {
    const sheet = sheetOf(0);
    const ledger = withRoute(0);
    const framed = matsuyamaBatchPaper({ personId: "p-01", sheet, ledger, manifest: manifestOf("matsuyama"), fill: true });
    if (framed.kind !== "frame") throw new Error(framed.kind);
    expect(framed.original).toBe("matsuyama");
    expect(framed.fill).toBe(true);
    expect(images(framed.sheet)).toHaveLength(1);
    const plain = matsuyamaBatchPaper({ personId: "p-01", sheet, ledger, manifest: null, fill: true });
    if (plain.kind !== "matsuyama") throw new Error(plain.kind);
    expect(plain.routeMap).not.toBeNull();
    const noRoute = matsuyamaBatchPaper({ personId: "p-01", sheet, ledger: parseLedger(seedRows(SEED_PEOPLE[0]).person.ledger), manifest: null, fill: false });
    expect(noRoute.kind === "matsuyama" && noRoute.routeMap).toBeNull();
  });

  it("医療要約: 原本を取り込んでいれば災害診療記録2018 の枠の紙。未入力の数は 1 人ずつの紙の帯と同じ数え方", () => {
    const sheet = medicalOf(0);
    const framed = medicalBatchPaper({ personId: "p-01", sheet, manifest: manifestOf("kiroku"), fill: false });
    expect(framed.paper.kind).toBe("frame");
    if (framed.paper.kind === "frame") expect(framed.paper.original).toBe("kiroku");
    expect(framed.blank).toBe(medicalUnconfirmed(sheet).fields.filter((f) => !f.noSource).length);
    const plain = medicalBatchPaper({ personId: "p-01", sheet, manifest: null, fill: false });
    expect(plain.paper.kind).toBe("medical");
    expect(plain.blank).toBe(sheet.pending.length);
  });

  it("紙面: 原本の枠の紙は原本の頁を敷き（1 人ずつの紙と同じ道・data-sheet）、色付けは切替のときだけ。色付けの切替は原本か添付の様式の紙があるときだけ", () => {
    const papers = [0, 1, 2].map((i) =>
      matsuyamaBatchPaper({ personId: SEED_PEOPLE[i].person.id, sheet: sheetOf(i), ledger: i === 2 ? parseLedger(seedRows(SEED_PEOPLE[i]).person.ledger) : withRoute(i), manifest: manifestOf("matsuyama"), fill: true }),
    );
    const html = renderToStaticMarkup(createElement(PaperBatch, { papers }));
    expect(html.match(/data-sheet="matsuyama"/g)).toHaveLength(3);
    expect(html.match(/data-fill="1"/g)).toHaveLength(3);
    expect(html).toContain('src="/api/forms/originals/matsuyama/pages/1"');
    expect(html).toContain('src="/api/forms/originals/matsuyama/pages/2"');
    expect(html.match(/data-slot="route-map"/g)).toHaveLength(2);
    expect(hasFillablePaper(papers)).toBe(true);
    const off = renderToStaticMarkup(
      createElement(PaperBatch, { papers: [matsuyamaBatchPaper({ personId: "p-01", sheet: sheetOf(0), ledger: withRoute(0), manifest: manifestOf("matsuyama"), fill: false })] }),
    );
    expect(off).not.toContain("data-fill=");
    const kiroku = renderToStaticMarkup(createElement(PaperBatch, { papers: [medicalBatchPaper({ personId: "p-01", sheet: medicalOf(0), manifest: manifestOf("kiroku"), fill: true }).paper] }));
    expect(kiroku).toContain('data-sheet="kiroku"');
    expect(kiroku).toContain('src="/api/forms/originals/kiroku/pages/1"');
    const plain = [matsuyamaBatchPaper({ personId: "p-01", sheet: sheetOf(0), ledger: withRoute(0), manifest: null, fill: true })];
    expect(hasFillablePaper(plain)).toBe(false);
    const plainHtml = renderToStaticMarkup(createElement(PaperBatch, { papers: plain }));
    expect(plainHtml).toContain('class="route-map"');
    expect(plainHtml).not.toContain("/api/forms/originals/");
  });

  it("一括の色付けの切替は様式の選びを残したまま ?fill=1 を足す・外す", () => {
    const on = renderToStaticMarkup(createElement(FillToggle, { here: "/forms/batch", fill: false, keep: { form: "matsuyama" } }));
    expect(on).toContain('href="/forms/batch?form=matsuyama&amp;fill=1"');
    const off = renderToStaticMarkup(createElement(FillToggle, { here: "/forms/batch", fill: true, keep: { doc: "medical" } }));
    expect(off).toContain('href="/forms/batch?doc=medical"');
  });
});

describe("自動の印刷は地図のタイル（SVG の中の画像）を待つ", () => {
  function fakeWindow(hrefs: string[]) {
    const calls: string[] = [];
    const win: PrintWindow = {
      location: { href: "http://localhost/forms/batch?form=matsuyama&print=1" },
      history: { replaceState: (_d, _u, url) => void (win.location.href = url) },
      document: {
        fonts: { ready: Promise.resolve() },
        images: [],
        querySelectorAll: (sel) => {
          calls.push(`query ${sel}`);
          return hrefs.map((h) => ({ getAttribute: (n: string) => (n === "href" ? h : null) }));
        },
      },
      print: () => calls.push("print"),
    };
    return { win, calls };
  }

  it("同じ URL は 1 回だけ読み、読み終えてから印刷の窓", async () => {
    const tile = "https://cyberjapandata.gsi.go.jp/xyz/pale/16/57000/26000.png";
    const { win, calls } = fakeWindow([tile, tile, "https://cyberjapandata.gsi.go.jp/xyz/pale/16/57001/26000.png"]);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const done = autoPrint(win, async (href) => {
      calls.push(`load ${href.slice(-15)}`);
      await gate;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toEqual([`query ${SVG_IMAGE_SELECTOR}`, "load 57000/26000.png", "load 57001/26000.png"]);
    release();
    expect(await done).toBe(true);
    expect(calls.at(-1)).toBe("print");
  });

  it("読めないタイル・遅いタイルで印刷を止めない（上限で打ち切る）", async () => {
    const { win } = fakeWindow(["https://cyberjapandata.gsi.go.jp/xyz/pale/16/1/1.png"]);
    const started = Date.now();
    expect(await waitSvgImages(win.document, () => new Promise(() => {}), 30)).toBe(1);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(await waitSvgImages(win.document, () => Promise.reject(new Error("x")), 1000)).toBe(1);
    expect(await waitSvgImages({ images: [] }, () => Promise.reject(new Error("呼ばない")))).toBe(0);
  });
});
