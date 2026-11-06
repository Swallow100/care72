// T159: 普通の言い方が（氏名）に伏せられる件。評価の 6 回目で、本人役の「続柄＋の＋語尾まで含めたかな」（母のことです）が
// 名前と見なされ、画面に（氏名）が出た。名前の形の見張り（./forms.ts）で、語尾・物の名前・行頭の言葉・敬称の付く普通の呼び名を
// 名前と見ないこと、本物の名前（台帳の名前・電話・かなの名前の文脈・敬称つきの作った名前）は今までどおり伏せることを確かめる。
// 文は全部この作業で作った物（評価の記録から写していない）。名前は架空か種の人の物。

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE, seedConsents, type SeedPerson } from "../../seed/people.ts";
import { findLeaks, maskReply, NAME_MARK, pseudonymize, pseudonymizeText, type PseudonymInput } from "./index.ts";

const ON = "2026-11-06";
const input = (p: SeedPerson): PseudonymInput => ({ person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks, consents: seedConsents(p) });
const byId = (id: string) => input(SEED_PEOPLE.find((p) => p.person.id === id)!);
const { key } = pseudonymize([byId("p-01")], { on: ON });
/** Claude に送る前の伏せ（ケアマネの文） */
const sent = (s: string) => pseudonymizeText(s, key).text;
/** Claude の返事の伏せ（本人役の言葉。画面に出る前） */
const reply = (s: string) => maskReply(s, key);

/** 誤って伏せていた言い方（T159 の前はどれも（氏名）を含んだ） */
const KEPT: ReadonlyArray<string> = [
  // 続柄＋の＋語尾まで含めたかな（評価の 6 回目の形）
  "母のことです。栄養剤があと少しで心配です",
  "母のことですが、薬はまだあります",
  "夫のことだ、きっと大丈夫",
  "母のことだよ、心配なのは",
  "母のことでした",
  "娘のうちです",
  "娘のうちだから安心して",
  "娘のとこです",
  "母のぶんです",
  "母のためです",
  // 続柄＋の＋物の名前
  "母のめがねがない",
  "父のつえを探している",
  "母のおむつが足りない",
  "孫のおむかえに行く",
  "夫のふとんを二階に上げた",
  "母のいればを持ってきて",
  // 行頭の言葉（述語・あいさつ・時）
  "そうです、ここにいます",
  "いきます！",
  "こわいよ！",
  "いいよ、大丈夫",
  "はいはい、聞こえてます",
  "うれしい！来てくれて",
  "だめだよ、出られない",
  "けさ、地震があった",
  "ゆうべ、眠れなかった",
  "おととい、病院に行った",
  "いまから、行きます",
  "このあと、避難します",
  "母：ねてます",
  // 敬称の付く普通の呼び名（ペット・役所・続柄・物）
  "うちのワンちゃんが心配",
  "ねこちゃんも一緒です",
  "民生さんが来てくれた",
  "自衛隊さんが来た",
  "保健所さんから電話",
  "お手伝いさんが来る",
  "ご両親様へ",
  "ご担当者様",
  "お日様が出てきた",
  "向こうさんの家",
  "お寺さんに避難した",
  "お姑さんと二人",
];

/** 伏せるべき物（作った名前・かなの名前の文脈）→ 伏せたあと */
const MASKED: ReadonlyArray<[string, string]> = [
  ["孫のみつきが来る", "孫の（氏名）が来る"],
  ["孫のみつきです", "孫の（氏名）です"],
  ["孫のみつきだよ", "孫の（氏名）だよ"],
  ["孫のみつきでした", "孫の（氏名）でした"],
  ["孫のゆうです", "孫の（氏名）です"],
  ["孫のゆうですが、", "孫の（氏名）ですが、"],
  ["孫のはるなが来る", "孫の（氏名）が来る"],
  ["孫のあかねが来た", "孫の（氏名）が来た"],
  ["孫のあさよが来る", "孫の（氏名）が来る"],
  ["孫のれいなが来る", "孫の（氏名）が来る"],
  ["あやね、こっち", "（氏名）、こっち"],
  ["ことね、ありがとう", "（氏名）、ありがとう"],
  ["はるな！早く", "（氏名）！早く"],
  ["ひでき、薬を持ってきて", "（氏名）、薬を持ってきて"],
  ["長男：ひでき", "長男：（氏名）"],
  ["孫のみつきが来る。みつきだよ", "孫の（氏名）が来る。（氏名）だよ"],
  ["孫のゆうちゃんと暮らしている", "孫の（氏名）と暮らしている"],
  ["隣の佐藤さんが来た", "隣の（氏名）が来た"],
  ["小野寺さんと春日さん", "（氏名）と（氏名）"],
  ["土屋さんが来た", "（氏名）が来た"],
];

describe("普通の言い方を（氏名）にしない（T159）", () => {
  it("誤って伏せていた言い方が 30 以上ある", () => {
    expect(KEPT.length).toBeGreaterThanOrEqual(30);
  });

  it.each(KEPT)("Claude の返事で伏せない: %s", (s) => {
    expect(reply(s)).toBe(s);
  });

  it.each(KEPT)("Claude に送る前も伏せない: %s", (s) => {
    expect(sent(s)).toBe(s);
  });
});

describe("伏せるべき物は今までどおり伏せる（T159）", () => {
  it.each(MASKED)("伏せる: %s", (src, out) => {
    expect(sent(src)).toBe(out);
    expect(reply(src)).toBe(out);
  });

  it("伏せたあとは門の確かめを通る", () => {
    for (const [src] of MASKED) expect(findLeaks(pseudonymizeText(src, key), key), src).toEqual([]);
  });

  it("台帳の本人・家族・隣人の名前と電話は、普通の言い方の中でも伏せる", () => {
    const p = SEED_PEOPLE.find((x) => x.person.id === "p-01")!;
    const daughter = p.contacts.find((c) => c.relation === "娘")!;
    const phone = daughter.phone!;
    const lines = [
      `母の${p.person.name}のことです`,
      `${p.person.name}さんのことです。ねてます`,
      `娘の${daughter.name}です。母のめがねがない`,
      `いいよ、${daughter.name}に電話する（${phone}）`,
      `娘のうちです。${phone} にかけて`,
    ];
    for (const s of lines) {
      const out = sent(s);
      expect(findLeaks(out, key), s).toEqual([]);
      for (const secret of [p.person.name, daughter.name!, phone, ...p.person.name.split(" "), ...daughter.name!.split(" ")]) expect(out.includes(secret), s).toBe(false);
    }
    // 返事に台帳の名前・電話が残れば捨てる（今までどおり）
    expect(reply(`娘の${daughter.name}です`)).toBeNull();
    expect(reply(`ここに電話して ${phone}`)).toBeNull();
  });

  it("伏せない言い方と名前が同じ文にあっても、名前だけを伏せる", () => {
    expect(reply("母のことです。孫のみつきが来る")).toBe("母のことです。孫の（氏名）が来る");
    expect(reply("いいよ、隣の佐藤さんに頼む")).toBe("いいよ、隣の（氏名）に頼む");
    expect(reply("うちのワンちゃんと佐藤さん")?.split(NAME_MARK).length).toBe(2);
  });
});
