import { describe, expect, it } from "vitest";
import { seedConsents, type SeedPerson } from "../../seed/people.ts";
import type { Ledger } from "../db/types.ts";
import { RELATION_CALLS } from "../signals/phrases.ts";
import {
  aliasFor,
  aliasLetters,
  assertForClaude,
  contactRoles,
  findLeaks,
  isForClaude,
  KIND_ROLE,
  maskedCount,
  NOT_NAME_WORDS,
  PseudonymLeakError,
  pseudonymize,
  pseudonymizeText,
  restoreText,
  type ClaudeClock,
  type ClaudePerson,
  type PseudonymInput,
} from "./index.ts";
// T142 で種の台帳を埋めた。このテストは空いた欄を前提にするので、T142 より前の空きの多い形（seed/sparse.ts）を使う
import { SPARSE_PEOPLE } from "../../seed/sparse.ts";

const ON = "2026-11-02";

function input(p: SeedPerson): PseudonymInput {
  return { person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks, consents: seedConsents(p) };
}

const ALL = SPARSE_PEOPLE.map(input);
const byId = (id: string) => input(SPARSE_PEOPLE.find((p) => p.person.id === id)!);

/**
 * 人が付ける欄の名前（列の名前と、Claude に渡す形にしたときの名前）。
 * Claude に渡す型と台帳の JSON の型に、この名前の欄を作らない。作ると下の型の検査（npm run typecheck）で止まる。
 */
const HUMAN_ONLY_KEYS = [
  "self_report_unreliable",
  "selfReportUnreliable",
  "depends_on",
  "dependsOn",
  "depends_check",
  "dependsCheck",
] as const;
type HumanOnlyKey = (typeof HUMAN_ONLY_KEYS)[number];
type NoHumanOnlyKey<T extends never> = T;
export type HumanOnlyKeysAbsent = [
  NoHumanOnlyKey<Extract<keyof ClaudePerson, HumanOnlyKey>>,
  NoHumanOnlyKey<Extract<keyof ClaudePerson["care"], HumanOnlyKey>>,
  NoHumanOnlyKey<Extract<keyof ClaudeClock, HumanOnlyKey>>,
  NoHumanOnlyKey<Extract<keyof PseudonymInput["person"], HumanOnlyKey>>,
  NoHumanOnlyKey<Extract<keyof PseudonymInput["clocks"][number], HumanOnlyKey>>,
  NoHumanOnlyKey<Extract<keyof Ledger, HumanOnlyKey>>,
  NoHumanOnlyKey<Extract<keyof Ledger["basic"], HumanOnlyKey>>,
  NoHumanOnlyKey<Extract<keyof Ledger["care"], HumanOnlyKey>>,
  NoHumanOnlyKey<Extract<keyof Ledger["medical"], HumanOnlyKey>>,
];

/** 種のデータにある、Claude に渡してはいけない文字列（2 字以上） */
function forbiddenStrings(): string[] {
  const out = new Set<string>();
  for (const p of SPARSE_PEOPLE) {
    for (const n of [p.person.name, p.person.kana]) {
      out.add(n);
      out.add(n.replace(/ /g, ""));
      for (const part of n.split(" ")) if (part.length >= 2) out.add(part);
    }
    out.add(p.person.birth_date!);
    out.add(p.ledger.basic.address!.town);
    for (const c of p.contacts) {
      if (c.phone) {
        out.add(c.phone);
        out.add(c.phone.replace(/-/g, ""));
      }
      if (c.name && c.kind !== "self") {
        out.add(c.name);
        for (const part of c.name.split(" ")) if (part.length >= 2) out.add(part);
      }
    }
  }
  return [...out];
}

describe("仮名", () => {
  it("A から Z のあとは AA・AB と続く（事業所 150 人でも尽きない）", () => {
    expect(aliasLetters(0)).toBe("A");
    expect(aliasLetters(25)).toBe("Z");
    expect(aliasLetters(26)).toBe("AA");
    expect(aliasLetters(27)).toBe("AB");
    expect(aliasLetters(26 + 26 * 26)).toBe("AAA");
    expect(aliasFor(1)).toBe("B さん");
    const many = Array.from({ length: 150 }, (_, i) => aliasLetters(i));
    expect(new Set(many).size).toBe(150);
  });

  it("連絡先は役割名。支援者は番号付き、重なる続柄も番号付き", () => {
    expect(contactRoles(byId("p-01").contacts)).toEqual(["本人", "娘", "支援者 1"]);
    expect(contactRoles(byId("p-03").contacts)).toEqual(["本人", "妻", "長男", "長女", "透析施設", "病院"]); // 病院は T57 で種に足した
    expect(contactRoles(byId("p-02").contacts)).toEqual(["本人", "夫", "訪問看護", "酸素業者"]); // 酸素業者は T57 で種に足した
    expect(
      contactRoles([
        { kind: "family", relation: "娘" },
        { kind: "family", relation: "娘" },
        { kind: "supporter", relation: "隣人" },
        { kind: "supporter", relation: null },
      ]),
    ).toEqual(["娘 1", "娘 2", "支援者 1", "支援者 2"]);
  });
});

describe("pseudonymize", () => {
  const { payload, key } = pseudonymize(ALL, { on: ON });

  it("10 人が A〜J さんになり、年齢は残り、氏名・生年月日・住所は渡らない", () => {
    expect(payload.map((p) => p.alias)).toEqual("ABCDEFGHIJ".split("").map((c) => `${c} さん`));
    expect(payload[0].age).toBe(84);
    expect(payload[0]).not.toHaveProperty("name");
    expect(payload[0]).not.toHaveProperty("address");
    expect(payload[0]).not.toHaveProperty("birthDate");
  });

  it("10 人ぶんの中に、氏名・カナ・生年月日・町名・電話・連絡先の名前が 1 つも残らない", () => {
    const json = JSON.stringify(payload);
    for (const s of forbiddenStrings()) expect(json, s).not.toContain(s);
    expect(json).not.toMatch(/090-?0000-?00\d\d/);
    expect(findLeaks(payload, key)).toEqual([]);
  });

  it("連絡先は役割名だけで、本人の電話は連絡先に入れない", () => {
    expect(payload[0].contacts.map((c) => c.role)).toEqual(["娘", "支援者 1"]);
    expect(payload[0].contacts[1].relation).toBe("隣人");
    expect(payload[0].contacts[0]).not.toHaveProperty("phone");
    expect(payload[0].contacts[0]).not.toHaveProperty("name");
  });

  it("本人の言葉は言い換えない（名前を含まない特記はそのまま）", () => {
    expect(payload[0].notes).toEqual(["薬は 2 階の箪笥"]);
  });

  it("避難先の名前の中の町名も伏せる", () => {
    expect(payload[0].evacuation.destination1).toBe("（町名）小学校");
    expect(payload[7].evacuation.destination1).toBe("（町名）高台の集会所");
  });

  it("訪問看護の事業所の名前（町名入り）は役割名になる", () => {
    expect(payload[1].contacts[1]).toMatchObject({ role: "訪問看護", kind: "visiting_nurse" });
  });

  it("時計と同意は値のまま渡る", () => {
    expect(payload[0].clocks[0]).toMatchObject({ kind: "device", category: "oxygen", value: 2, unit: "hour", startsOn: "outage" });
    expect(payload[6].consents.supporters).toBe("refused");
    expect(payload[8].consents.medical).toBe("refused");
  });

  it("人が付ける欄（時計の頼り先の確認・本人の報告を当てにしない印）は渡らない。入れる物に値があっても", () => {
    expect(byId("p-03").clocks[0]).toMatchObject({ depends_on: "dialysis_center", depends_check: "unconfirmed" });
    expect(SPARSE_PEOPLE[3].person.self_report_unreliable).toBe(1);
    const json = JSON.stringify(payload);
    for (const k of HUMAN_ONLY_KEYS) expect(json).not.toContain(k);
    expect(Object.keys(payload[2].clocks[0]).sort()).toEqual(
      ["category", "kind", "label", "note", "source", "startsOn", "unit", "value"].sort(),
    );
  });

  it("この層が作った物だけに印があり、凍っていて書き換えられない", () => {
    expect(isForClaude(payload)).toBe(true);
    expect(() => assertForClaude(payload)).not.toThrow();
    expect(isForClaude({ ...payload })).toBe(false);
    expect(isForClaude(JSON.parse(JSON.stringify(payload)))).toBe(false);
    expect(() => assertForClaude([{ alias: "A さん" }])).toThrow();
    expect(() => {
      (payload[0] as { alias: string }).alias = "山田 ハナ";
    }).toThrow(TypeError);
    expect(() => {
      (payload[0].notes as string[]).push("山田 ハナ");
    }).toThrow(TypeError);
  });

  it("鍵は元に戻すための物で、氏名を持つ（Claude には渡さない）", () => {
    expect(key.people[0]).toEqual({ alias: "A さん", personId: "p-01", name: "山田 ハナ" });
    expect(key.contacts.find((c) => c.alias === "A さん" && c.role === "娘")?.contactId).toBe("c-01-1");
  });
});

describe("自由文の置き換え", () => {
  it("1 人のとき: 本人は A さん、連絡先の名前は役割名、町名と電話は伏せる", () => {
    const { key } = pseudonymize([byId("p-01")], { on: ON });
    const out = pseudonymizeText(
      "山田さんは かわなぎ町 で独居。娘の森 恵子さん（090-0000-0011）が市内にいて車がある。隣の木村ヨシさんは 82 歳。",
      key,
    );
    // 続柄の後ろの名前は続柄と一緒に役割名 1 つに（「娘の娘」にしない。T88）
    expect(out.text).toBe("A さんは （町名） で独居。娘（（電話））が市内にいて車がある。隣の支援者 1は 82 歳。");
    expect(isForClaude(out)).toBe(true);
  });

  it("何人かのとき: 連絡先は「A さんの娘」の形", () => {
    const { key } = pseudonymize(ALL, { on: ON });
    const out = pseudonymizeText("森恵子さんから電話。ヤマダハナさんの様子を聞いた", key);
    expect(out.text).toBe("A さんの娘から電話。A さんの様子を聞いた");
  });

  it("1 字の名は敬称付きのときだけ置き換える（「正」を普通の言葉で残す）", () => {
    const { key } = pseudonymize([byId("p-07")], { on: ON });
    expect(pseudonymizeText("正さんは正しく薬を飲んでいる", key).text).toBe("A さんは正しく薬を飲んでいる");
  });

  it("同じ姓の家族がいるときの姓だけは本人を指す", () => {
    const { key } = pseudonymize([byId("p-02")], { on: ON });
    expect(pseudonymizeText("小林さんは夫の小林 健一さんと暮らす", key).text).toBe("A さんは夫と暮らす");
  });

  it("台帳に無い電話番号らしい並びも伏せる", () => {
    const { key } = pseudonymize([byId("p-10")], { on: ON });
    expect(pseudonymizeText("新しい番号は 089-000-0000", key).text).toBe("新しい番号は （電話）");
  });

  it("Claude の返事の仮名を氏名に戻せる（AA さんを A さんと取り違えない）", () => {
    const { key } = pseudonymize(ALL, { on: ON });
    expect(restoreText("A さんを先に。J さんは後で", key)).toBe("山田 ハナさんを先に。中村 勇さんは後で");
    expect(restoreText("AA さんは居ない", key)).toBe("AA さんは居ない");
  });
});

describe("入れる欄（T03）で足した欄", () => {
  const withNew = (): PseudonymInput => {
    const base = byId("p-04");
    const ledger: Ledger = {
      ...base.ledger,
      basic: { ...base.ledger.basic, housing: { ...base.ledger.basic.housing, bedroom: "1 階 くぬぎ谷町 側の和室" } },
      evacuation: { ...base.ledger.evacuation, myTimeline: "paper", support: ["call", "assist"], supportNote: "清水さんが声を掛ける" },
      local: { watcher: "春日 葉子" },
    };
    return { ...base, ledger };
  };

  it("寝室・マイ・タイムライン・支援の内容は渡り、町名と名前は伏せる。みまもり員は有無だけ", () => {
    const { payload } = pseudonymize([withNew()], { on: ON });
    const p = payload[0];
    expect(p.housing.bedroom).toBe("1 階 （町名） 側の和室");
    expect(p.evacuation.myTimeline).toBe("paper");
    expect(p.evacuation.support).toEqual(["call", "assist"]);
    expect(p.evacuation.supportNote).toBe("民生委員が声を掛ける");
    expect(p.watcher).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("春日");
    expect(pseudonymize([byId("p-04")], { on: ON }).payload[0].watcher).toBe(false);
  });

  it("自由文のみまもり員の名前は役割名に。残っていれば漏れとして止まる", () => {
    const { key } = pseudonymize([withNew()], { on: ON });
    expect(pseudonymizeText("春日葉子さんが週 1 回来る。春日さんは近所", key).text).toBe(
      "みまもり員が週 1 回来る。みまもり員は近所",
    );
    expect(findLeaks("春日 葉子", key)).toContain("A さんのみまもり員の名前");
  });
});

describe("漏れの見張り", () => {
  it("元の氏名・電話が残っていれば何が残ったかを返す（値は返さない）", () => {
    const { key } = pseudonymize([byId("p-01")], { on: ON });
    const leaks = findLeaks({ x: "山田 ハナ", y: "090-0000-0011" }, key);
    expect(leaks).toContain("A さんの氏名");
    expect(leaks).toContain("A さんの電話");
    expect(leaks.join("")).not.toContain("山田");
  });

  it("漏れの例外は値を持たない", () => {
    const e = new PseudonymLeakError(["A さんの氏名"]);
    expect(e.message).not.toContain("山田");
    expect(e.findings).toEqual(["A さんの氏名"]);
  });
});

// ---------- T74: 台帳に無くても形で伏せる（敬称つきの名前・住所・郵便番号・メール） ----------

describe("台帳に無い名前・住所の形（T74）", () => {
  const { key } = pseudonymize([byId("p-01")], { on: ON });
  const t = (s: string) => pseudonymizeText(s, key).text;

  // 自然な文の見本。半分は伏せ、半分は伏せない（続柄・役割・職業・言葉）。名前は架空の例
  const MASKED: Array<[string, string]> = [
    ["隣の田中さんが鍵を持っている", "隣の（氏名）が鍵を持っている"],
    ["○○病院の佐藤先生に薬のことを聞く", "○○病院の（氏名）に薬のことを聞く"],
    ["民生委員の山口さんが週 2 回来る", "民生委員の（氏名）が週 2 回来る"],
    ["孫のゆうちゃんと暮らしている", "孫の（氏名）と暮らしている"],
    ["ヘルパーの佐々木さんが朝に来る", "ヘルパーの（氏名）が朝に来る"],
    ["向かいの木下トミエさんと仲が良い", "向かいの（氏名）と仲が良い"],
    ["夜は森 恵美さんが泊まる", "夜は（氏名）が泊まる"],
    ["田中かず子さんが様子を見に来る", "（氏名）が様子を見に来る"],
    ["はなちゃんが毎日電話をくれる", "（氏名）が毎日電話をくれる"],
    ["主治医は中央病院の高橋先生", "主治医は中央病院の（氏名）"],
    ["連絡はケアマネの鈴木さんまで", "連絡はケアマネの（氏名）まで"],
  ];
  const KEPT = [
    "娘さんが来てくれた",
    "お母さんは 2 階で寝ている",
    "お父さんとおばあさんの二人暮らし",
    "ヘルパーさんが週 3 回来る",
    "看護師さんに酸素の業者さんの番号を聞く",
    "先生に聞いてから決める",
    "かかりつけの先生に相談する",
    "毎日ちゃんと薬を飲んでいる",
    "たくさん食べて今の様子は落ち着いている",
    "お隣さんとご近所さんが声をかける",
    "民生委員さんとみまもり員さんが見回る",
    "長男の嫁さんも同様に見ている",
    "ワーファリンを飲む。在宅酸素と人工呼吸器を使う。糖尿病",
  ];

  it.each(MASKED)("伏せる: %s", (src, out) => {
    expect(t(src)).toBe(out);
  });

  it.each(KEPT)("伏せない: %s", (src) => {
    expect(t(src)).toBe(src);
  });

  it("仮名（A さん・AA さん）と役割名に敬称が付いても伏せない", () => {
    expect(t("A さんの娘さんが来る")).toBe("A さんの娘さんが来る");
    expect(t("AA さんと支援者 1さん")).toBe("AA さんと支援者 1さん");
  });

  it("連絡先の役割名・本人の呼び方の続柄は除く語に全部入っていて、敬称が付いても伏せない", () => {
    const words = [...Object.values(KIND_ROLE), ...Object.keys(RELATION_CALLS), "家族", "支援者", "民生委員", "みまもり員"];
    for (const w of words) {
      expect(t(`${w}さんが来る`), w).toBe(`${w}さんが来る`);
    }
    for (const w of [...Object.keys(RELATION_CALLS), "民生委員", "みまもり員", "隣人"]) expect(NOT_NAME_WORDS, w).toContain(w);
  });

  it("職業・役割の語（ヘルパー・看護師・お医者・ケアマネ・業者）と単独の先生は伏せない", () => {
    for (const s of ["ヘルパーさん", "看護師さん", "お医者さん", "ケアマネさん", "業者さん", "訪問看護さん", "院長先生", "先生"]) expect(t(s), s).toBe(s);
  });

  it("言葉の中の敬称の字（様子・様式・氏名・さまざま・ちゃんと）は伏せない", () => {
    for (const s of ["今の様子", "様式 9 の欄", "利用者氏名", "症状はさまざま", "それはちゃんとしている", "おさんぽ"]) expect(t(s), s).toBe(s);
  });

  it("住所（都道府県・市区町村・町名・番地）・郵便番号・メールは（住所）（郵便番号）（メール）", () => {
    expect(t("住所は愛媛県松山市○○町 1-2-3")).toBe("住所は（住所）");
    expect(t("長男は松山市○○町1-2-3に住む")).toBe("長男は（住所）に住む");
    expect(t("道後町2丁目3番4号の家")).toBe("（住所）の家");
    expect(t("〒790-0001")).toBe("（郵便番号）");
    expect(t("〒790-xxxx")).toBe("（郵便番号）");
    expect(t("郵便番号 790-0001")).toBe("郵便番号 （郵便番号）");
    expect(t("連絡は taro@example.jp か x@y に")).toBe("連絡は （メール） か （メール） に");
  });

  it("番地の無い町・回数の 2-3 は住所にしない（市内・県外の分かる言葉は残す）", () => {
    for (const s of ["娘は松山市内に住む", "1 日 2-3 回", "中村は週 2-3 回来る", "血圧 130-80"]) expect(t(s), s).toBe(s);
  });

  it("台帳の名前・電話と一緒でも、それぞれ伏せる。伏せた所の数を返す（何を伏せたかは返さない）", () => {
    const src = "山田さんの隣の田中さん（090-0000-0011）、〒790-0001、x@y";
    expect(t(src)).toBe("A さんの隣の（氏名）（（電話））、（郵便番号）、（メール）");
    expect(maskedCount(src, key)).toBe(5);
    expect(maskedCount("娘さんが来た", key)).toBe(0);
  });

  it("findLeaks は同じ形を見つけ、何が見つかったかだけを返す（値は返さない）", () => {
    const leaks = findLeaks({ a: "隣の田中さん", b: "愛媛県松山市○○町 1-2-3", c: "〒790-0001", d: "x@y" }, key);
    expect(leaks).toEqual(["敬称つきの名前", "住所らしい並び", "郵便番号らしい並び", "メールらしい並び"]);
    expect(leaks.join("")).not.toContain("田中");
    expect(findLeaks("娘さんとお母さんと A さん", key)).toEqual([]);
  });

  it("伏せたあとは門の確かめを通る（伏せた形は漏れと見ない）", () => {
    for (const [src] of MASKED) expect(findLeaks(pseudonymizeText(src, key), key), src).toEqual([]);
    for (const src of KEPT) expect(findLeaks(pseudonymizeText(src, key), key), src).toEqual([]);
  });

  it("伏せた所は restoreText で戻さない（仮名 A さんだけ戻す）", () => {
    expect(restoreText("A さんの隣の（氏名）、（住所）、（郵便番号）、（メール）", key)).toBe(
      "山田 ハナさんの隣の（氏名）、（住所）、（郵便番号）、（メール）",
    );
  });

  it("台帳の特記に書いた台帳に無い名前・住所も Claude に渡る前に伏せる", () => {
    const base = byId("p-01");
    const input: PseudonymInput = {
      ...base,
      ledger: { ...base.ledger, notes: ["隣の田中さんが鍵を持っている", "娘の家は愛媛県松山市○○町 1-2-3", "薬は 2 階の箪笥"] },
    };
    const { payload, key: k } = pseudonymize([input], { on: ON });
    expect(payload[0].notes).toEqual(["隣の（氏名）が鍵を持っている", "娘の家は（住所）", "薬は 2 階の箪笥"]);
    expect(findLeaks(payload, k)).toEqual([]);
  });

  it("種の 10 人の渡す形は前と同じ（形で伏せる物が無い）", () => {
    const { payload } = pseudonymize(ALL, { on: ON });
    const json = JSON.stringify(payload);
    for (const mark of ["（氏名）", "（住所）", "（郵便番号）", "（メール）"]) expect(json).not.toContain(mark);
  });
});
