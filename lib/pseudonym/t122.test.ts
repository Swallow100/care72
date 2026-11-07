// T122: 伏せ字の印の崩れた形（評価の 2 回目で、自由文の避難先が半角の括弧の「(町名)総合病院」で返り、戻しも捨てもされずに台帳に入った。
// docs/progress/eval-r2-forms-findings.md の 3）。崩れた形を見つけて全角の括弧の形にそろえ、元の文と照らして戻す。

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE, type SeedPerson } from "../../seed/people.ts";
import { canonicalMarks, hasAnyMark, hasBrokenMark, hasMaskMark, inputTexts, markSpans, pseudonymize, sourceRestorer, type PseudonymInput } from "./index.ts";

// T183 で種の避難先は実在の施設の名前（町名を含まない）にした。町名を含む避難先の伏せ字を戻す確かめなので、山田の避難先 1 を前の種の
// 町名の入った名前（実の事業所でも、本人の町名を含む避難先はこの形で渡る）にして使う
const P01: SeedPerson = withTownShelter(SEED_PEOPLE.find((p) => p.person.id === "p-01")!);
function withTownShelter(p: SeedPerson): SeedPerson {
  const { destination1Location: _, ...evacuation } = p.ledger.evacuation;
  return { ...p, ledger: { ...p.ledger, evacuation: { ...evacuation, destination1: "かわなぎ小学校" } } };
}
const input: PseudonymInput = {
  person: P01.person,
  ledger: P01.ledger,
  contacts: P01.contacts.map((c, i) => ({ ...c, person_id: P01.person.id, sort: i })),
  clocks: P01.clocks.map((k, i) => ({ ...k, person_id: P01.person.id, sort: i })),
};

/** 崩れた町名の形（評価の 2 回目の形と、Claude が返しうる形） */
const TOWN_FORMS = ["(町名)", "町名", "【町名】", "［町名］", "[町名]", "（ 町名 ）", "（町名)", "(町名）", "〔町名〕", "＜町名＞", "「町名」", "（町名", "町名）", "(町 名)"];

describe("崩れた伏せ字の形（T122）", () => {
  it("町名はどの崩れた形も全角の括弧の形にそろう", () => {
    for (const f of TOWN_FORMS) {
      expect(canonicalMarks(`${f}総合病院`), f).toBe("（町名）総合病院");
      expect(hasBrokenMark(`${f}総合病院`), f).toBe(true);
    }
    expect(hasBrokenMark("（町名）総合病院")).toBe(false);
    expect(hasAnyMark("（町名）総合病院")).toBe(true);
  });

  it("ほかの 6 つは両側を括弧で囲んだ形だけ（ふつうの言葉の電話・住所・氏名・生年月日はそのまま）", () => {
    for (const [broken, mark] of [
      ["(氏名)さんが来る", "（氏名）さんが来る"],
      ["【電話】に連絡", "（電話）に連絡"],
      ["( 住所 )の棚", "（住所）の棚"],
      ["[郵便番号]", "（郵便番号）"],
      ["＜メール＞で送る", "（メール）で送る"],
      ["(生年月日)生まれ", "（生年月日）生まれ"],
    ]) {
      expect(canonicalMarks(broken), broken).toBe(mark);
      expect(hasMaskMark(canonicalMarks(broken)), broken).toBe(true);
    }
    for (const plain of ["電話で連絡する", "住所変更の届け", "氏名欄は本人が書く", "生年月日の確認", "メールの返事", "郵便番号を調べる", "電話（携帯）"]) {
      expect(canonicalMarks(plain), plain).toBe(plain);
      expect(hasAnyMark(plain), plain).toBe(false);
    }
  });

  it("元の文にそのまま書いてある形（keep）はそろえない", () => {
    const keep = (s: string) => "連絡(電話)で".includes(s);
    expect(canonicalMarks("連絡(電話)で", keep)).toBe("連絡(電話)で");
    expect(hasBrokenMark("連絡(電話)で", keep)).toBe(false);
  });

  it("場所は重ならず、全角の括弧の形も見つける", () => {
    const spans = markSpans("(町名)小学校と（氏名）さんと町名公民館");
    expect(spans.map((s) => [s.word, s.canonical])).toEqual([
      ["町名", false],
      ["氏名", true],
      ["町名", false],
    ]);
  });
});

describe("崩れた伏せ字を元の文から戻す（sourceRestorer、T122）", () => {
  const { key } = pseudonymize([input], { on: "2026-11-05" });
  const text = "第二避難先は かわなぎ総合病院 です。";

  it("ケアマネの文の町名を崩した形で写した値は、元の言葉に戻る", () => {
    const restore = sourceRestorer([text, ...inputTexts(input)], key);
    for (const f of TOWN_FORMS) expect(restore(`${f}総合病院`), f).toBe("かわなぎ総合病院");
    // 台帳の避難先（かわなぎ小学校）も
    expect(restore("(町名)小学校")).toBe("かわなぎ小学校");
  });

  it("戻せない崩れた形は全角の括弧の形で返る（伏せ字の検査が捕まえる）", () => {
    const restore = sourceRestorer([text, ...inputTexts(input)], key);
    for (const v of ["(町名)公民館", "町名公民館", "【氏名】さんの家", "(電話)に連絡"]) {
      const back = restore(v);
      expect(hasMaskMark(back), v).toBe(true);
      expect(hasBrokenMark(back), v).toBe(false);
    }
  });

  it("元の文にそのまま書いてある崩れた形は伏せ字でない（そのまま）", () => {
    const own = "娘への連絡(電話)は夜だけ。";
    const restore = sourceRestorer([own, ...inputTexts(input)], key);
    expect(restore("娘への連絡(電話)は夜だけ。")).toBe(own);
  });

  it("返事の文（replies）に書いてあるだけの崩れた形は、元の文と見ない", () => {
    const reply = "(町名)公民館";
    const restore = sourceRestorer(inputTexts(input), key, { replies: [reply] });
    expect(hasMaskMark(restore(reply))).toBe(true);
    expect(restore("(町名)小学校")).toBe("かわなぎ小学校");
  });
});
