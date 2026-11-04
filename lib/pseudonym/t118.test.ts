// T118（docs/tasks/T118.md）: 和暦・略記・漢数字の生年月日を仮名化の門で伏せる。
// 入力の形は評価の台（T107、tools/eval/forms/inputs.ts の頭の行）が使った物を写した: 自由文・書き起こし・箇条書きに、
// 和暦の生年月日（lib/forms/wareki.ts の warekiText から空きを抜いた「昭和17年4月18日」）を氏名・住所・電話と一緒に書く。
// 人は種の架空の 10 人だけ。

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE, type SeedPerson } from "../../seed/people.ts";
import { warekiText } from "../forms/wareki.ts";
import { BIRTH_FORM_WHAT, birthSpans, numberOf } from "./birth.ts";
import {
  BIRTH_MARK,
  findLeaks,
  hasMaskMark,
  maskedCount,
  maskReply,
  pseudonymize,
  pseudonymizeText,
  sourceRestorer,
  type PseudonymInput,
} from "./index.ts";

const seedInput = (p: SeedPerson): PseudonymInput => ({ person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks });
const P01 = SEED_PEOPLE.find((p) => p.person.id === "p-01")!;
const P02 = SEED_PEOPLE.find((p) => p.person.id === "p-02")!;
const keyOf = (p: SeedPerson) => pseudonymize([seedInput(p)], { on: "2026-11-05" }).key;

/** T107 の入力の頭の行と同じ形（inputs.ts の headLine。style は plain・voice・list） */
function headLine(p: SeedPerson, style: "plain" | "voice" | "list"): string {
  const birth = warekiText(p.person.birth_date!).replace(/ /g, "");
  const addr = p.ledger.basic.address!;
  const phone = p.contacts.find((c) => c.kind === "self")?.phone ?? "";
  if (style === "voice") return `えー、${p.person.name}さん、${birth}生まれで、${addr.city}${addr.town}にお住まいです。電話は${phone}。`;
  if (style === "list") return `・氏名：${p.person.name}（${p.person.kana}）　${birth}生　${addr.city}${addr.town}　TEL ${phone}`;
  return `${p.person.name}さん（${birth}生）、${addr.city}${addr.town}在住。TEL ${phone}。`;
}

describe("和暦・略記・漢数字の生年月日を伏せる", () => {
  it("前提: 種の p-01 の生年月日は昭和 17 年 4 月 18 日（台帳は 1942-04-18）", () => {
    expect(P01.person.birth_date).toBe("1942-04-18");
    expect(warekiText(P01.person.birth_date!)).toBe("昭和 17 年 4 月 18 日");
  });

  it("T107 の台の自由文・書き起こし・箇条書きの形: 送る文に生年月日が残らず、漏れの見張りも 0", () => {
    const key = keyOf(P01);
    for (const style of ["plain", "voice", "list"] as const) {
      const src = headLine(P01, style);
      const sent = pseudonymizeText(src, key).text;
      expect(sent, style).not.toContain("昭和17年4月18日");
      expect(sent, style).not.toMatch(/17年4月18日/);
      expect(sent, style).toContain(BIRTH_MARK);
      expect(findLeaks(sent, key), style).toEqual([]);
    }
  });

  it("台帳の生年月日と同じ日は、どの書き方でも（生年月日）に。数えにも入る", () => {
    const key = keyOf(P01);
    const forms = [
      "昭和17年4月18日",
      "昭和 17 年 4 月 18 日",
      "昭和１７年４月１８日",
      "昭和十七年四月十八日",
      "昭和一七年四月一八日",
      "S17.4.18",
      "S.17.4.18",
      "S17/4/18",
      "Ｓ１７．４．１８",
      "昭17.4.18",
      "S17年4月18日",
      "1942年4月18日",
      "1942 年 4 月 18 日",
      "一九四二年四月十八日",
      "1942/4/18",
      "1942-04-18",
      "1942.4.18",
    ];
    for (const f of forms) {
      const src = `本人は${f}の人です`;
      const sent = pseudonymizeText(src, key).text;
      expect(sent, f).toBe(`本人は${BIRTH_MARK}の人です`);
      expect(maskedCount(src, key), f).toBe(1);
    }
    // 年月だけ・年だけも、台帳と同じ年月・年なら伏せる（「昭和十七年」）
    expect(pseudonymizeText("昭和十七年の生まれ", key).text).toBe(`${BIRTH_MARK}の生まれ`);
    expect(pseudonymizeText("昭和17年4月に生まれた", key).text).toBe(`${BIRTH_MARK}に生まれた`);
  });

  it("台帳に無い日でも生年月日らしい形は伏せる（明治・大正・昭和の年月日、生・生まれ・生年月日の前後）", () => {
    const key = keyOf(P01);
    for (const src of ["夫は昭和 15 年 4 月 18 日", "妻は S15.4.18", "大正3年5月6日", "生年月日：1950年1月2日", "平成2年3月4日生まれの孫", "昭和十五年生"]) {
      const sent = pseudonymizeText(src, key).text;
      expect(sent, src).toContain(BIRTH_MARK);
      expect(sent, src).not.toMatch(/[0-9０-９]+年|[0-9]+\.[0-9]+\.[0-9]+|十五年/);
    }
  });

  it("生年月日でない日付・数は伏せない（訪問の日・時刻・平成令和の日・年数・電話の形は今まで通り）", () => {
    const key = keyOf(P01);
    for (const src of [
      "令和8年11月5日に訪問した",
      "2026年11月5日 10時",
      "平成30年に手術",
      "昭和の終わりに家を建てた",
      "1日3回飲む",
      "築40年の家",
      "生活が変わった 2026年11月5日",
      "S字の道",
    ]) {
      expect(pseudonymizeText(src, key).text, src).toBe(src);
      expect(birthSpans(src, key.births ?? []), src).toEqual([]);
    }
  });

  it("戻すときは元の書き方に戻す（sourceRestorer）", () => {
    const key = keyOf(P01);
    for (const f of ["昭和十七年四月十八日", "S17.4.18", "昭和 17 年 4 月 18 日"]) {
      const src = `本人（${f}生）は 2 階に寝ている。`;
      const restore = sourceRestorer([src], key);
      const sent = pseudonymizeText(src, key).text;
      // Claude が特記に写した文（伏せたまま）が、元の書き方に戻る
      expect(restore(sent), f).toBe(src);
      expect(restore(`（${BIRTH_MARK}生）`), f).toBe(`（${f}生）`);
    }
  });

  it("仮名化の層（本人の台帳）にも残らない: 特記・世帯の書き足しに和暦の生年月日", () => {
    const input = seedInput(P02);
    const ledger = structuredClone(input.ledger);
    ledger.notes = [...ledger.notes, "昭和15年2月9日生まれ、戦中の生まれで話好き"];
    const { payload, key } = pseudonymize([{ ...input, ledger }], { on: "2026-11-05" });
    const json = JSON.stringify(payload);
    expect(json).not.toContain("昭和15年2月9日");
    expect(json).toContain(BIRTH_MARK);
    expect(findLeaks(json, key)).toEqual([]);
  });

  it("漏れの見張り: 伏せずに渡すと、台帳の生年月日（どの書き方でも）と生年月日らしい形を見つける", () => {
    const key = keyOf(P01);
    expect(findLeaks("S17.4.18", key)).toContain("A さんの生年月日");
    expect(findLeaks("昭和十七年四月十八日", key)).toContain("A さんの生年月日");
    expect(findLeaks("夫は昭和 15 年 4 月 18 日", key)).toContain(BIRTH_FORM_WHAT);
    expect(findLeaks("令和8年11月5日", key)).toEqual([]);
  });

  it("Claude の返事（maskReply）: 生年月日らしい形は伏せ字、台帳と同じ日でも伏せ字（画面に日付を出さない）", () => {
    const key = keyOf(P01);
    expect(maskReply("昭和 15 年 4 月 18 日生まれの夫がいる", key)).toBe(`${BIRTH_MARK}生まれの夫がいる`);
    expect(maskReply("S17.4.18", key)).toBe(BIRTH_MARK);
    expect(maskReply("令和8年11月5日に来た", key)).toBe("令和8年11月5日に来た");
  });

  it("伏せ字の一覧に（生年月日）があり、残っているかを見られる", () => {
    expect(hasMaskMark(`本人は${BIRTH_MARK}`)).toBe(true);
    expect(hasMaskMark("本人は昭和の生まれ")).toBe(false);
  });

  it("数の読み方（半角・全角・漢数字・元）", () => {
    expect(numberOf("17")).toBe(17);
    expect(numberOf("１７")).toBe(17);
    expect(numberOf("十七")).toBe(17);
    expect(numberOf("二十")).toBe(20);
    expect(numberOf("一七")).toBe(17);
    expect(numberOf("一九四二")).toBe(1942);
    expect(numberOf("元")).toBe(1);
    expect(numberOf("x")).toBeNull();
  });
});
