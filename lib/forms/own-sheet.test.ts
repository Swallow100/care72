import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OwnSheetFront, OwnSheetPaper } from "../../components/forms/OwnSheet.tsx";
import { SEED_AT, SEED_PEOPLE, seedConsents, type SeedPerson } from "../../seed/people.ts";
import type { ConsentStatus } from "../db/types.ts";
import type { PersonPageRows } from "../person.ts";
import { easy, hiragana, kanjiWithoutRuby, nameWithKana, plainText, yomi, YOMI } from "./easy-words.ts";
import { buildMedicalSummary } from "./medical-summary.ts";
import {
  allWords,
  blockText,
  buildOwnSheet,
  lineText,
  OWN_BLOCK_HEADINGS,
  OWN_PHRASES,
  sheetKanjiWithoutRuby,
  type OwnBlockId,
  type OwnSheet,
} from "./own-sheet.ts";

const TODAY = "2026-11-02";
const OPTS = { today: TODAY, officeName: "デモ事業所" };

/** 種の 1 人を、D1 から読んだのと同じ形にする（lib/forms/medical-summary.test.ts と同じ） */
function seedRows(p: SeedPerson): PersonPageRows {
  return {
    person: { ...p.person, ledger: JSON.stringify(p.ledger), created_at: SEED_AT, updated_at: SEED_AT },
    careManagerName: "山本",
    contacts: p.contacts.map((c, i) => ({ ...c, person_id: p.person.id, sort: i })),
    consents: seedConsents(p).map((c) => ({ ...c, recorded_by_name: "山本", recorded_by_role: "care_manager" as const })),
    clocks: p.clocks.map((k, i) => ({ ...k, person_id: p.person.id, sort: i })),
    timeline: [],
  };
}

const seed = (id: string) => SEED_PEOPLE.find((p) => p.person.id === id)!;
const rowsOf = (id: string) => seedRows(seed(id));
const sheetOf = (id: string): OwnSheet => buildOwnSheet(rowsOf(id), OPTS);
/** 種の 1 人の行を、1 つの同意だけ差し替えて作る */
function withConsent(id: string, kind: "supporters" | "medical", status: ConsentStatus): PersonPageRows {
  const rows = rowsOf(id);
  return { ...rows, consents: rows.consents.map((c) => (c.kind === kind ? { ...c, status } : c)) };
}
const front = (s: OwnSheet) => renderToStaticMarkup(createElement(OwnSheetFront, { sheet: s }));
function paper(rows: PersonPageRows): { html: string; back: string } {
  const html = renderToStaticMarkup(
    createElement(OwnSheetPaper, { sheet: buildOwnSheet(rows, OPTS), medical: buildMedicalSummary(rows, OPTS) }),
  );
  const at = html.indexOf('data-page="2"');
  return { html, back: html.slice(html.lastIndexOf("<section", at)) };
}
const lineOf = (s: OwnSheet, key: string) => s.blocks.flatMap((b) => b.lines).find((l) => l.key === key);
/** 漢字だけ取り出す（ふりがなを落とした文字から、ruby の付いた字を数えるため） */
const stripTags = (html: string) => html.replace(/<rt>[^<]*<\/rt>|<rp>[^<]*<\/rp>/g, "").replace(/<[^>]+>/g, "");

const ALL_IDS = SEED_PEOPLE.map((p) => p.person.id);

describe("ふりがなの道具（lib/forms/easy-words.ts）", () => {
  it("決まった文の書き方 {漢字|よみ} を言葉にする", () => {
    expect(easy("{逃|に}げる ところ")).toEqual([{ text: "逃", ruby: "に" }, { text: "げる ところ" }]);
    expect(easy("{車|くるま}で", { strong: true })).toEqual([
      { text: "車", ruby: "くるま", strong: true },
      { text: "で", strong: true },
    ]);
  });

  it("台帳の値は読みの表の長い言葉から当て、表に無い漢字は付けずに返す", () => {
    expect(yomi("かわなぎ総合病院").words).toEqual([{ text: "かわなぎ" }, { text: "総合病院", ruby: "そうごうびょういん" }]);
    expect(yomi("お薬手帳").words).toEqual([{ text: "お" }, { text: "薬", ruby: "くすり" }, { text: "手帳", ruby: "てちょう" }]);
    // 送り仮名の入る言葉は書き方で
    expect(yomi("入れ歯").words).toEqual([{ text: "入", ruby: "い" }, { text: "れ" }, { text: "歯", ruby: "ば" }]);
    // 地名の字は推し量らない
    const r = yomi("くぬぎ谷集会所");
    expect(r.missing).toEqual(["谷"]);
    expect(r.words).toEqual([{ text: "くぬぎ谷" }, { text: "集会所", ruby: "しゅうかいじょ" }]);
  });

  it("読みの表の読みは全部ひらがな（書き方の物は {漢字|よみ}）", () => {
    for (const [k, v] of Object.entries(YOMI)) {
      const words = v.includes("{") ? easy(v) : [{ text: k, ruby: v }];
      expect(plainText(words), k).toBe(k);
      for (const w of words) if (w.ruby) expect(w.ruby, k).toMatch(/^[ぁ-ゖー]+$/);
    }
  });

  it("本人の名前はカナから（塊ごと）。カタカナの塊には付けない", () => {
    expect(hiragana("ヤマダ ハナ")).toBe("やまだ はな");
    expect(nameWithKana("山田 ハナ", "ヤマダ ハナ")).toEqual([
      { text: "山田", ruby: "やまだ", name: true },
      { text: " ", name: true },
      { text: "ハナ", name: true },
    ]);
    expect(nameWithKana("田中 茂", "タナカ シゲル").filter((w) => w.ruby).map((w) => w.ruby)).toEqual(["たなか", "しげる"]);
    expect(nameWithKana("田中茂", "タナカ シゲル")).toEqual([{ text: "田中茂", ruby: "たなかしげる", name: true }]);
    expect(nameWithKana("田中 茂", null)).toEqual([{ text: "田中 茂", name: true }]);
  });

  it("決まった文と段の見出しは、漢字に全部ふりがなが付く", () => {
    for (const m of [...Object.values(OWN_PHRASES), ...Object.values(OWN_BLOCK_HEADINGS)]) {
      expect(kanjiWithoutRuby(easy(m)), m).toEqual([]);
    }
  });
});

describe("10 人分の文", () => {
  it("全員の 1 枚が組め、段は上から 逃げるところ・逃げるとき・来てくれる人・持っていく物・電話", () => {
    for (const id of ALL_IDS) {
      const s = sheetOf(id);
      const ids = s.blocks.map((b) => b.id);
      expect(ids.slice(0, 5), id).toEqual(["where", "when", "who", "carry", "call"] satisfies OwnBlockId[]);
      for (const b of s.blocks) expect(b.lines.length, `${id} ${b.id}`).toBeGreaterThan(0);
      expect(plainText(s.title), id).toBe(`${seed(id).person.name}さんの 避難の 紙`);
      // 持ち物の最後はこの紙そのもの
      expect(s.blocks.find((b) => b.id === "carry")!.lines.at(-1)!.key, id).toBe("carry.paper");
    }
  });

  it("山田 ハナ: 避難先・行き方・来てくれる人・持ち物・電話・本人の言葉", () => {
    const s = sheetOf("p-01");
    expect(lineOf(s, "where.place")).toMatchObject({ tone: "lead" });
    expect(lineText(lineOf(s, "where.place")!)).toBe("かわなぎ小学校");
    expect(lineOf(s, "where.place")!.words.every((w) => w.strong)).toBe(true);
    expect(lineText(lineOf(s, "where.means")!)).toBe("娘の車で 行きます");
    expect(blockText(s, "who")).toBe(
      "娘の 森 恵子さんが 車で 迎えに 来ます 090-0000-0011 / 隣人の 木村 ヨシさんが 迎えに 来ます 090-0000-0012",
    );
    // 薬は台帳の言葉のまま。持出品の「薬」は薬の名前と重ねない
    expect(blockText(s, "carry")).toBe("薬 ワーファリン / 酸素の 機械 / 予備ボンベ / お薬手帳 / この 紙");
    // ケアマネの電話は台帳に無いので手で書く線。娘は来てくれる人に電話を出したので重ねない
    expect(blockText(s, "call")).toBe("ケアマネジャー 山本さん（デモ事業所） ＿ / かかりつけの 病院 ＿");
    expect(blockText(s, "words")).toBe("薬は 2 階の箪笥");
    expect(s.open.map((o) => `${o.kind}:${o.label}`)).toEqual(["write:ケアマネの電話", "write:かかりつけの電話"]);
    expect(s.withheld).toEqual([]);
    expect(s.noReading).toEqual([]);
  });

  it("大雨と地震の両方を載せる（ハザードのある人は警戒レベル 3、津波のある人は揺れたら すぐ）", () => {
    for (const id of ALL_IDS) {
      const s = sheetOf(id);
      const when = s.blocks.find((b) => b.id === "when")!.lines.map(lineText);
      const hazards = seed(id).ledger.evacuation.hazards;
      expect(when[0], id).toBe(
        hazards.length > 0 ? "大雨の とき 警戒レベル 3 が 出たら 逃げます" : "大雨の とき ケアマネジャーと 決めます",
      );
      expect(when[1], id).toBe(
        hazards.some((h) => h.kind === "tsunami")
          ? "地震の とき 揺れたら すぐ 逃げます"
          : "地震の とき 揺れが おさまったら 逃げます",
      );
    }
    expect(sheetOf("p-08").blocks.find((b) => b.id === "when")!.lines[1].key).toBe("when.quake");
  });

  it("空いた所は「ケアマネジャーと 決めます」で、画面の上の未確認に数える（伊藤 フミ）", () => {
    const s = sheetOf("p-05");
    expect(blockText(s, "where")).toBe("ケアマネジャーと 決めます");
    expect(blockText(s, "who")).toBe("ケアマネジャーと 決めます");
    expect(s.open.filter((o) => o.kind === "decide").map((o) => o.label)).toEqual(["逃げるところ", "来てくれる人", "持出品"]);
  });

  it("ほかの人の値: 夜も来る人、機関、行き方の徒歩、透析の病院、冷蔵庫の薬", () => {
    expect(blockText(sheetOf("p-02"), "who")).toBe(
      "夫の 小林 健一さんが 車で 迎えに 来ます 090-0000-0013 / 夜も 来ます / かわなぎ訪問看護が 迎えに 来ます 090-0000-0014",
    );
    expect(blockText(sheetOf("p-02"), "carry")).toBe("人工呼吸器 / 吸引器 / 予備の回路 / バッテリー / この 紙");
    expect(blockText(sheetOf("p-08"), "where")).toBe("うみなり高台の集会所 / 歩いて 行きます");
    expect(blockText(sheetOf("p-08"), "carry")).toBe("薬 インスリン（冷蔵庫） / 保冷バッグ / 血糖の測定器 / この 紙");
    expect(blockText(sheetOf("p-03"), "call")).toContain("透析の 病院 みずほし透析クリニック 090-0000-0018");
    expect(blockText(sheetOf("p-03"), "call")).toContain("長女の 岡田 由美さん 090-0000-0017");
    expect(blockText(sheetOf("p-04"), "who")).toBe("民生委員の 清水 正子さんが 迎えに 来ます 090-0000-0019");
  });

  it("医学の説明・用量・回数・時計の値・言い切りの言葉を載せない", () => {
    const banned = ["診断", "判定", "重症", "中断注意", "要冷蔵", "用量", "1 日 1 回", "1 日 2 回", "朝夕", "時間", "残り", "L/分", "なぜ"];
    for (const id of ALL_IDS) {
      const text = allWords(sheetOf(id)).map((w) => w.text).join("");
      for (const w of banned) expect(text, `${id} ${w}`).not.toContain(w);
    }
  });

  it("否定形を使わない（ない・ません・なし）", () => {
    for (const id of ALL_IDS) {
      const text = allWords(sheetOf(id)).map((w) => w.text).join("");
      for (const w of ["ない", "ません", "なし", "不可"]) expect(text, `${id} ${w}`).not.toContain(w);
    }
  });

  it("いのちの危険があるときは 119 の行がある（119 は太く）", () => {
    for (const id of ALL_IDS) {
      const s = sheetOf(id);
      expect(plainText(s.emergency), id).toBe("いのちの 危険が あるときは 119");
      expect(s.emergency.at(-1), id).toEqual({ text: "119", strong: true });
      expect(front(s), id).toMatch(/data-block="emergency"[^>]*>.*<strong>119<\/strong>/);
    }
  });
});

describe("ふりがな", () => {
  it("10 人とも、人の名前のほかの漢字に全部ふりがなが付く（読みの表に無い地名の字だけ「読み未登録」）", () => {
    for (const id of ALL_IDS) {
      const s = sheetOf(id);
      if (id === "p-07") {
        expect(s.noReading).toEqual(["谷"]);
        expect(sheetKanjiWithoutRuby(s)).toEqual(["くぬぎ谷"]);
      } else {
        expect(s.noReading, id).toEqual([]);
        expect(sheetKanjiWithoutRuby(s), id).toEqual([]);
      }
    }
  });

  it("本人の名前はカナから、連絡先の名前は読みを推し量らない", () => {
    const s = sheetOf("p-01");
    expect(s.title.filter((w) => w.ruby).map((w) => [w.text, w.ruby])).toEqual([
      ["山田", "やまだ"],
      ["避難", "ひなん"],
      ["紙", "かみ"],
    ]);
    const names = allWords(s).filter((w) => w.name && w.text.trim() !== "");
    expect(names.filter((w) => w.ruby).map((w) => w.text)).toEqual(["山田"]);
    expect(names.map((w) => w.text)).toEqual(expect.arrayContaining(["森 恵子", "木村 ヨシ", "山本"]));
  });

  it("紙面の表は <ruby> と <rt> で出し、名前と読み未登録のほかの漢字は全部 rt の付いた ruby の中", () => {
    for (const id of ALL_IDS) {
      const s = sheetOf(id);
      const html = front(s);
      expect(html, id).toContain("<ruby>逃<rp>（</rp><rt>に</rt><rp>）</rp></ruby>");
      // ruby の外に残る漢字 = 人の名前と読み未登録の字だけ
      const outside = stripTags(html.replace(/<ruby>.*?<\/ruby>/g, ""));
      const names = allWords(s)
        .filter((w) => w.name && w.text.trim() !== "")
        .map((w) => w.text)
        .sort((a, b) => b.length - a.length);
      let rest = outside;
      for (const n of names) rest = rest.split(n).join("");
      for (const m of s.noReading) rest = rest.split(m).join("");
      expect(rest.match(/[一-鿿]/g) ?? [], id).toEqual([]);
    }
    expect(front(sheetOf("p-01"))).toContain("<ruby>小学校<rp>（</rp><rt>しょうがっこう</rt><rp>）</rp></ruby>");
  });
});

describe("同意の範囲", () => {
  it("支援者提供に同意していない加藤 正: 来てくれる人は「計画で 決めた 人」で、名前と電話を出さない", () => {
    const s = sheetOf("p-07");
    expect(s.withheld).toEqual(["supporters"]);
    expect(blockText(s, "who")).toBe("計画で 決めた 人が 来ます");
    const who = s.blocks.find((b) => b.id === "who")!;
    expect(who.lines.every((l) => l.phone === undefined)).toBe(true);
    const whoText = who.lines.map(lineText).join(" ");
    for (const w of ["前田 和夫", "加藤 実", "090-0000-0026", "090-0000-0025"]) expect(whoText).not.toContain(w);
    // 支援者 1 の民生委員は 1 枚のどこにも出ない
    const html = front(s);
    expect(html).not.toContain("前田 和夫");
    expect(html).not.toContain("090-0000-0026");
    // 家族の弟は電話の段に（計画書の近親者と同じ。来てくれる人とは書かない）
    expect(blockText(s, "call")).toContain("弟の 加藤 実さん 090-0000-0025");
    expect(html.indexOf("加藤 実")).toBeGreaterThan(html.indexOf('data-block="call"'));
  });

  it("支援者提供が未確認でも同じ。同意に変えると名前が出る", () => {
    const unconfirmed = buildOwnSheet(withConsent("p-07", "supporters", "unconfirmed"), OPTS);
    expect(blockText(unconfirmed, "who")).toBe("計画で 決めた 人が 来ます");
    const granted = buildOwnSheet(withConsent("p-07", "supporters", "granted"), OPTS);
    expect(granted.withheld).toEqual([]);
    expect(blockText(granted, "who")).toBe(
      "民生委員の 前田 和夫さんが 迎えに 来ます 090-0000-0026 / 弟の 加藤 実さんが 車で 迎えに 来ます 090-0000-0025",
    );
  });

  it("支援者のいない人は同意にかかわらず「ケアマネジャーと 決めます」（計画で決めた人はいない）", () => {
    const s = buildOwnSheet(withConsent("p-05", "supporters", "refused"), OPTS);
    expect(blockText(s, "who")).toBe("ケアマネジャーと 決めます");
    expect(s.withheld).toEqual([]);
  });

  it("医療班提供に同意していない渡辺 清: 裏は「同意なし」だけで、要約の中身と QR の頁の値を出さない", () => {
    const { html, back } = paper(rowsOf("p-09"));
    expect(back).toContain('data-withheld="refused"');
    expect(back).toContain("同意なし");
    expect(back).toContain('data-qr="placeholder"');
    for (const w of ["降圧薬", "090-", "ワタナベ", "そらみ台", "メディカル ID"]) expect(back, w).not.toContain(w);
    // 表はふだんどおり（医療班提供は表に効かない）
    expect(html).toContain("降圧薬");
    expect(html.match(/<section class="paper/g)).toHaveLength(2);
  });

  it("医療班提供が未確認なら裏は「未確認」", () => {
    const { back } = paper(withConsent("p-01", "medical", "unconfirmed"));
    expect(back).toContain('data-withheld="unconfirmed"');
    expect(back).toContain("未確認");
    expect(back).not.toContain("ワーファリン");
  });
});

describe("紙面（表と裏の 2 頁）", () => {
  it("表は本人の 1 枚、裏は医療要約の頁をそのまま（2 頁目）と QR の枠", () => {
    for (const id of ALL_IDS.filter((x) => x !== "p-09")) {
      const { html, back } = paper(rowsOf(id));
      const pages = [...html.matchAll(/<section class="paper[^"]*" aria-label="([^"]+)" data-page="(\d)"/g)].map((m) => [m[1], m[2]]);
      expect(pages, id).toEqual([
        ["本人の1枚", "1"],
        ["医療要約", "2"],
      ]);
      expect(back, id).toContain('class="paper med-paper"');
      expect(back, id).toContain('data-field="id.medical"');
      // QR の枠は題名の段の中
      const head = back.slice(back.indexOf('class="head-row"'), back.indexOf('data-block="patient"'));
      expect(head, id).toContain('data-qr="placeholder"');
    }
  });

  it("山田 ハナの表: 大きな避難先、手で書く電話の線、段の印", () => {
    const html = front(sheetOf("p-01"));
    for (const b of ["where", "when", "who", "carry", "call", "words", "emergency"]) expect(html).toContain(`data-block="${b}"`);
    expect(html).toMatch(/class="own-ln lead" data-line="where.place"/);
    expect(html).toContain('data-tel="090-0000-0011"');
    expect((html.match(/class="own-tel blank"/g) ?? []).length).toBe(2);
    expect(html).toContain('class="own-lines cols"');
    // 作った日
    expect(stripTags(html)).toContain("作った 日 2026年11月2日 デモ事業所");
  });
});
