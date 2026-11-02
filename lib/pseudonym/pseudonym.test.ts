import { describe, expect, it } from "vitest";
import { SEED_PEOPLE, seedConsents, type SeedPerson } from "../../seed/people.ts";
import type { Ledger } from "../db/types.ts";
import {
  aliasFor,
  aliasLetters,
  assertForClaude,
  contactRoles,
  findLeaks,
  isForClaude,
  PseudonymLeakError,
  pseudonymize,
  pseudonymizeText,
  restoreText,
  type ClaudeClock,
  type ClaudePerson,
  type PseudonymInput,
} from "./index.ts";

const ON = "2026-11-02";

function input(p: SeedPerson): PseudonymInput {
  return { person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks, consents: seedConsents(p) };
}

const ALL = SEED_PEOPLE.map(input);
const byId = (id: string) => input(SEED_PEOPLE.find((p) => p.person.id === id)!);

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
  for (const p of SEED_PEOPLE) {
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
    expect(contactRoles(byId("p-03").contacts)).toEqual(["本人", "妻", "長男", "長女", "透析施設"]);
    expect(contactRoles(byId("p-02").contacts)).toEqual(["本人", "夫", "訪問看護"]);
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
    expect(SEED_PEOPLE[3].person.self_report_unreliable).toBe(1);
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
    expect(out.text).toBe("A さんは （町名） で独居。娘の娘（（電話））が市内にいて車がある。隣の支援者 1は 82 歳。");
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
    expect(pseudonymizeText("小林さんは夫の小林 健一さんと暮らす", key).text).toBe("A さんは夫の夫と暮らす");
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
