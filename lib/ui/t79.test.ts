// 11/4 の点検の低の残り（T79）: ヘッダーの「平時」は押せない地の印、/favicon.ico は印へ、経過は新しい順、
// 事業所のラジオボタンとチェックボックスの大きさ、書類の注は 1 行（説明の文なし）。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GET as favicon } from "../../app/favicon.ico/route.ts";
import { DisasterBadge } from "../../components/disaster/DisasterBadge.tsx";
import { FormAbout } from "../../components/forms/FormAbout.tsx";
import { Timeline } from "../../components/person/Timeline.tsx";
import { CHOICE_INPUT, CHOICE_LABEL } from "../../components/ui/choice.ts";
import { DOCUMENT_CATALOG, MATSUYAMA_ENTRY } from "../forms/catalog.ts";
import type { TimelineItem } from "../person.ts";

describe("ヘッダーの事業所の状態", () => {
  it("平時は押せない地の印（リンクでも押した灰色の印でもない）", () => {
    const html = renderToStaticMarkup(createElement(DisasterBadge, { mark: { kind: "normal", label: "平時" }, link: true }));
    expect(html).not.toContain("<a");
    expect(html).not.toContain("data-press");
    expect(html).toContain("bg-panel2");
    expect(html).toContain(">平時<");
  });

  it("災害モードは今まで通り事業所の画面へのリンク", () => {
    const html = renderToStaticMarkup(createElement(DisasterBadge, { mark: { kind: "disaster", label: "大雨", details: ["レベル 4"] }, link: true }));
    expect(html).toMatch(/<a [^>]*href="\/office"/);
    expect(html).toContain("大雨");
  });
});

describe("/favicon.ico", () => {
  it("印の正本 /icon.svg へ 308 で送る", () => {
    const r = favicon();
    expect(r.status).toBe(308);
    expect(r.headers.get("Location")).toBe("/icon.svg");
  });
});

describe("経過の並び", () => {
  const item = (id: string, at: string): TimelineItem => ({ id, at, when: at, kind: "メモ", tone: null, body: id, who: "山本", derived: false });

  it("新しい順（上がいちばん新しい）", () => {
    const html = renderToStaticMarkup(
      createElement(Timeline, { items: [item("t-old", "2026-11-04T00:00:00.000Z"), item("t-mid", "2026-11-04T01:00:00.000Z"), item("t-new", "2026-11-04T02:00:00.000Z")] }),
    );
    const order = [...html.matchAll(/data-entry="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["t-new", "t-mid", "t-old"]);
  });
});

describe("ラジオボタンとチェックボックス", () => {
  it("印は 18px、押せる箱は高さ 36px 以上", () => {
    expect(CHOICE_INPUT).toContain("size-[1.125rem]");
    expect(CHOICE_LABEL).toContain("min-h-9");
  });
});

describe("書類の注（中 7）", () => {
  it("正式な名前・誰が誰に・版の 1 行。説明の文は出さない。様式9 の画面は名前を省ける", () => {
    const html = renderToStaticMarkup(createElement(FormAbout, { entry: MATSUYAMA_ENTRY }));
    expect(html).toContain("松山市避難行動要支援者名簿登録申込書 兼 個別避難計画 ／ 本人・家族 → 市 ／ 松山市 様式【2026.9.10】");
    expect(html).not.toContain(MATSUYAMA_ENTRY.what);
    expect(html).toContain("元様式");
    const f9 = renderToStaticMarkup(createElement(FormAbout, { entry: DOCUMENT_CATALOG.form9, official: false }));
    expect(f9).not.toContain(DOCUMENT_CATALOG.form9.official);
    expect(f9).toContain("事業所 → 市町村");
  });
});
