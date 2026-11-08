// T133 評価の台: 数え直しの道（前の本物の回の返事を返す client）と、紙の見た目の数（重なり・はみ出し・隣の欄・台帳あり空欄・伏字）。
// 本物の API は呼ばない。原本の絵は使わない（架空の頁と種の人）。

import { describe, expect, it } from "vitest";
import { packInk } from "../../../lib/forms/ink.ts";
import { buildMappedSheet } from "../../../lib/forms/mapped-sheet.ts";
import type { FormMapping, MappingField } from "../../../lib/forms/mapping.ts";
import { buildOverlaySheet } from "../../../lib/forms/overlay-sheet.ts";
import type { PageImage } from "../../../lib/forms/page-images.ts";
import { seedRows } from "../../../lib/forms/print-harness.ts";
import { lookOfPaper, MASK_WORDS } from "./look.ts";
import type { CallRecord } from "./record.ts";
import { replayClient, replayText } from "./replay.ts";
// T142 で種の台帳を埋めた。このテストは空いた欄を前提にするので、T142 より前の空きの多い形（seed/sparse.ts）を使う
import { SPARSE_PEOPLE } from "../../../seed/sparse.ts";

const OPTS = { today: "2026-11-05", officeName: "デモ事業所" };

describe("数え直しの道（T133）", () => {
  it("考える分の印を外し、前の答えに無い一覧の表（list）を null で足す", () => {
    expect(JSON.parse(replayText('[thinking]{"title":"t","sections":[]}'))).toEqual({ title: "t", sections: [], list: null });
    expect(replayText('{"title":"t","sections":[{"name":"a"')).toBe('{"title":"t","sections":[{"name":"a"');
  });

  it("同じ入力・段の記録を順に返し、尽きたら失敗", async () => {
    const rec = (seq: number, stage: string, text: string, stop = "end_turn"): CallRecord =>
      ({ seq, input: "f1", stage, response: { model: "m", stopReason: stop, text, usage: { input_tokens: 1, output_tokens: 1 } } }) as unknown as CallRecord;
    let scope = { input: "f1", stage: "form_read" };
    const c = replayClient([rec(2, "form_read", "B", "max_tokens"), rec(1, "form_read", "A")].sort((a, b) => a.seq - b.seq), () => scope, { current: [] });
    const text = async () => {
      const m = await c.beta.messages.create({ model: "m", max_tokens: 1, messages: [] });
      return [m.content.map((b) => (b.type === "text" ? b.text : "")).join(""), m.stop_reason];
    };
    expect(await text()).toEqual(["A", "end_turn"]);
    expect(await text()).toEqual(["B", "max_tokens"]);
    await expect(text()).rejects.toThrow();
    scope = { input: "f2", stage: "form_read" };
    await expect(text()).rejects.toThrow();
  });
});

describe("紙の見た目の数（T133）", () => {
  const rows = seedRows(SPARSE_PEOPLE.find((p) => p.person.id === "p-01")!);
  let n = 0;
  const field = (over: Partial<MappingField>): MappingField => ({ id: `f${++n}`, page: 1, section: "", label: "欄", position: "", shape: "text", options: [], item: null, removed: false, ai: null, ...over });

  it("台帳に値があるのに空いた欄を数える（項目なしの欄は読み取りの補いの見込み、正解の表のある様式は正解の項目）", () => {
    const check = field({ label: "要介護", shape: "check", item: "care.careLevel", box: { x: 0.2, y: 0.2, w: 0.014, h: 0.01 } });
    const paren = field({ label: "要介護（　）", item: null, box: { x: 0.25, y: 0.2, w: 0.06, h: 0.012 } });
    const name = field({ label: "氏名", item: "person.name", box: { x: 0.1, y: 0.1, w: 0.3, h: 0.02 } });
    const mapping: FormMapping = { title: "架空", issuer: "", pages: 1, fields: [check, paren, name] };
    const images: PageImage[] = [{ page: 1, width: 2100, height: 2970, bytes: 1, ink: packInk([]) }];
    const overlay = buildOverlaySheet(buildMappedSheet(rows, mapping, OPTS), images);
    const look = lookOfPaper({ rows, mapping, images, overlay, today: OPTS.today });
    // 括弧の欄は項目なし（補いを通していない対応表）なので紙は空く。補いの見込みでは要介護度に値がある
    expect(look.blanks.map((b) => b.field)).toEqual([paren.id]);
    expect(look.score.outside).toBe(0);
    expect(look.score.overlap).toBe(0);
    // 正解の表で、合わせた欄の正解が項目なし（人が書く欄）なら数えない
    const gold = new Map([[paren.id, { item: null, accept: [] }]]);
    expect(lookOfPaper({ rows, mapping, images, overlay, today: OPTS.today, goldItems: gold }).blanks).toEqual([]);
  });

  it("伏字の跡・仮の言い方の形", () => {
    for (const s of ["（氏名）", "(町名)", "（電話）", "（生年月日）", "（市内）", "(近所)"]) expect(MASK_WORDS.test(s), s).toBe(true);
    for (const s of ["市坪西町", "（連絡順 1・車あり）", "市内の病院"]) expect(MASK_WORDS.test(s), s).toBe(false);
  });

  it("住所の無い連絡先の住所の欄に「（市内）」を刷らない（伏字・仮の言い方 0）", () => {
    const addr = field({ section: "避難支援者", label: "住所", item: "supporter1.address", box: { x: 0.1, y: 0.5, w: 0.3, h: 0.02 } });
    const mapping: FormMapping = { title: "架空", issuer: "", pages: 1, fields: [addr] };
    const images: PageImage[] = [{ page: 1, width: 2100, height: 2970, bytes: 1, ink: packInk([]) }];
    const overlay = buildOverlaySheet(buildMappedSheet(rows, mapping, OPTS), images);
    const look = lookOfPaper({ rows, mapping, images, overlay, today: OPTS.today });
    expect(look.score.masks).toBe(0);
    expect(overlay.pages[0].items).toEqual([]);
    expect(overlay.pages[0].fills.map((f) => f.kind)).toEqual(["ask"]);
  });
});
