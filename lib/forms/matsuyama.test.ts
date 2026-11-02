import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatsuyamaSheet } from "../../components/forms/MatsuyamaSheet.tsx";
import { SEED_AT, SEED_PEOPLE, seedConsents, type SeedPerson } from "../../seed/people.ts";
import { parseLedger } from "../db/ledger.ts";
import { toPersonView, type PersonPageRows } from "../person.ts";
import {
  buildMatsuyamaSheet,
  cellText,
  MATSUYAMA_FIELDS,
  withheldText,
  type MatsuyamaKey,
  type MatsuyamaSheet as Sheet,
} from "./matsuyama.ts";
import { wareki, warekiText } from "./wareki.ts";

const TODAY = "2026-11-02";

/** 種の 1 人を、D1 から読んだのと同じ形にする（lib/person.test.ts と同じ） */
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
const sheetOf = (id: string): Sheet => buildMatsuyamaSheet(seedRows(seed(id)), { today: TODAY, officeName: "デモ事業所" });
const text = (s: Sheet, k: MatsuyamaKey) => cellText(s.cells[k]);
const html = (s: Sheet) => renderToStaticMarkup(createElement(MatsuyamaSheet, { sheet: s }));
/** 紙面の段（data-block）の中の HTML */
function blockHtml(markup: string, block: string): string {
  const start = markup.indexOf(`data-block="${block}"`);
  expect(start, block).toBeGreaterThanOrEqual(0);
  const next = markup.indexOf('data-block="', start + 1);
  return markup.slice(start, next < 0 ? undefined : next);
}
/** 欄が紙面に出ているか（data-field、まとめて出した欄は data-fields） */
function shows(markup: string, key: string): boolean {
  if (markup.includes(`data-field="${key}"`)) return true;
  return [...markup.matchAll(/data-fields="([^"]*)"/g)].some((m) => m[1].split(" ").includes(key));
}

const ALL_IDS = SEED_PEOPLE.map((p) => p.person.id);
const ASSERTING_WORDS = ["危険", "診断", "判定", "重症", "病気がわかる"];

describe("和暦", () => {
  it("元号の始まりの日で切り替わり、1 年目は元年", () => {
    expect(wareki("1942-04-18")).toEqual({ era: "昭和", year: 17, month: 4, day: 18 });
    expect(wareki("1926-12-24")?.era).toBe("大正");
    expect(wareki("1926-12-25")).toMatchObject({ era: "昭和", year: 1 });
    expect(wareki("1989-01-07")).toMatchObject({ era: "昭和", year: 64 });
    expect(wareki("1989-01-08")).toMatchObject({ era: "平成", year: 1 });
    expect(wareki("2019-05-01")).toMatchObject({ era: "令和", year: 1 });
    expect(wareki("1900-01-01")).toBeNull();
    expect(warekiText("2026-11-02")).toBe("令和 8 年 11 月 2 日");
    expect(warekiText("2019-05-01")).toBe("令和 元年 5 月 1 日");
  });
});

describe("欄の一覧", () => {
  it("名前は重ならず、1 ページの欄が先、選ぶ欄は選択肢を持つ", () => {
    const keys = MATSUYAMA_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    const pages = MATSUYAMA_FIELDS.map((f) => f.page);
    expect(pages).toEqual([...pages].sort());
    for (const f of MATSUYAMA_FIELDS) {
      expect(f.label, f.key).not.toBe("");
      expect(f.source, f.key).not.toBe("");
      if (f.shape === "choice" || f.shape === "consent") expect("options" in f && f.options.length, f.key).toBeGreaterThan(1);
    }
  });

  it("様式の同意 4 つの出どころ: 名簿登録・計画共有・実施者ごと（支援者提供）・組織（計画共有）", () => {
    const src = (k: string) => MATSUYAMA_FIELDS.find((f) => f.key === k)!.source;
    expect(src("consent.registry")).toContain("consents.registry");
    expect(src("consent.planShare")).toContain("consents.plan_share");
    expect(src("supporter1.consent")).toContain("consents.supporters");
    expect(src("supporter2.consent")).toContain("consents.supporters");
    expect(src("org.consent")).toContain("consents.plan_share");
  });

  it("避難のタイミングに「レベル３高齢者等避難」、医療は かかりつけ医・薬局 と 医薬品情報、特記と別紙", () => {
    const labels = MATSUYAMA_FIELDS.map((f) => f.label);
    for (const l of ["かかりつけ医・薬局", "医薬品情報", "避難のタイミング", "別紙", "避難経路", "市受付印"]) expect(labels).toContain(l);
    const timing = MATSUYAMA_FIELDS.find((f) => f.key === "risk.timing")!;
    expect("options" in timing && timing.options).toContain("レベル３高齢者等避難");
  });
});

describe("種の 10 人から欄が埋まる", () => {
  it("10 人全員、全部の欄に値（未確認・なし・省略・手書きを含む）があり、紙面に全部の欄が出る", () => {
    for (const id of ALL_IDS) {
      const s = sheetOf(id);
      const markup = html(s);
      for (const f of MATSUYAMA_FIELDS) {
        expect(s.cells[f.key], `${id} ${f.key}`).toBeDefined();
        expect(shows(markup, f.key), `${id} ${f.key}`).toBe(true);
      }
      expect(markup).toContain('data-page="1"');
      expect(markup).toContain('data-page="2"');
      for (const w of ASSERTING_WORDS) expect(markup, `${id} ${w}`).not.toContain(w);
    }
  });

  it("10 人全員、台帳の pending は全部どこかの欄に「未確認」と理由で出る", () => {
    for (const id of ALL_IDS) {
      const s = sheetOf(id);
      const ledger = parseLedger(JSON.stringify(seed(id).ledger));
      expect(s.pending.map((p) => p.field).sort(), id).toEqual(ledger.pending.map((p) => p.field).sort());
      const markup = html(s);
      expect(markup.split("data-pending=").length - 1, id).toBeGreaterThanOrEqual(ledger.pending.length);
    }
  });

  it("山田 ハナ: 台帳の値が差し込まれる", () => {
    const s = sheetOf("p-01");
    expect(text(s, "head.date")).toBe("令和 8 年 11 月 2 日");
    expect(text(s, "target.kana")).toBe("ヤマダ ハナ");
    expect(text(s, "target.name")).toBe("山田 ハナ");
    expect(text(s, "target.sex")).toBe("□男 ■女");
    expect(text(s, "target.birth")).toBe("□大正 ■昭和 □平成 □令和 17 年 4 月 18 日");
    expect(text(s, "target.address")).toBe("松山市 かわなぎ町");
    expect(text(s, "target.phone")).toBe("090-0000-0001");
    expect(text(s, "target.category")).toContain("■高齢者（■独居 ■要介護（要介護3））");
    expect(text(s, "target.household")).toContain("■ひとり暮らし");
    expect(text(s, "consent.registry")).toBe("■同意する □同意しない 記録 2026-11-02 山本");
    expect(text(s, "consent.planShare")).toBe("■同意する □同意しない 記録 2026-11-02 山本");

    expect(text(s, "kin.name")).toBe("森 恵子");
    expect(text(s, "kin.relation")).toBe("娘");
    expect(text(s, "kin.phone")).toBe("090-0000-0011");
    // 実施者は役割・名前・連絡の順番
    expect(text(s, "supporter1.name")).toBe("森 恵子");
    expect(text(s, "supporter1.relation")).toContain("娘");
    expect(text(s, "supporter1.relation")).toContain("連絡順 1");
    expect(text(s, "supporter1.consent")).toBe("■同意 □不同意");
    expect(text(s, "supporter2.name")).toBe("木村 ヨシ");
    expect(text(s, "supporter2.relation")).toContain("隣人");
    expect(text(s, "supporter2.relation")).toContain("82 歳");
    expect(text(s, "supporter2.relation")).toContain("車なし");
    expect(text(s, "supporter2.relation")).toContain("スマホなし");
    expect(text(s, "org.consent")).toBe("■同意 □不同意");

    expect(text(s, "plan.author")).toContain("デモ事業所");
    expect(text(s, "plan.author")).toContain("山本");
    // 薬は名前・用量・残り日数
    const drugs = text(s, "medical.drugs");
    for (const w of ["ワーファリン", "抗凝固薬", "1 日 1 回", "用量 未確認", "残り 未確認（不明）", "中断注意"]) expect(drugs).toContain(w);
    // 機器は名前・電池・予備
    const med = text(s, "notes.medical");
    for (const w of ["在宅酸素", "酸素濃縮器 1 L/分", "酸素 内蔵電池 2 時間", "酸素 予備ボンベ 8 時間", "説明書"]) expect(med).toContain(w);
    expect(text(s, "risk.home")).toContain("■洪水（浸水 3 m）");
    expect(text(s, "risk.timing")).toBe("□自主避難 ■レベル３高齢者等避難");
    expect(text(s, "risk.issues")).toContain("歩行 一部");
    expect(text(s, "shelter.city.place")).toBe("かわなぎ小学校");
    expect(text(s, "shelter.city.means")).toBe("□徒歩 ■その他（娘の車）");
    expect(text(s, "housing.structure")).toContain("■木造");
    expect(text(s, "housing.floors")).toBe("□平屋 ■２階建 □３階建以上");
    expect(text(s, "housing.room")).toBe("1 階");
    // 特記は本人の言葉のまま
    expect(text(s, "notes.words")).toBe("薬は 2 階の箪笥");
    expect(text(s, "notes.other")).toContain("予備ボンベ・薬・お薬手帳");
    expect(text(s, "notes.annex")).toBe("■あり（医療要約） □なし");
    expect(s.withheld).toEqual([]);
  });

  it("山田 ハナの未確認 3 か所（ワーファリンの残り・夜間支援・避難先2）が「未確認」と理由で出る", () => {
    const s = sheetOf("p-01");
    expect(s.pending.map((p) => [p.field, p.key, p.status])).toEqual([
      ["people.night_supporter", "supporter.night", "not_asked"],
      ["medical.medications.warfarin.remaining", "medical.drugs", "unknown"],
      ["evacuation.destination2", "shelter.pre.place", "unknown"],
    ]);
    expect(text(s, "supporter.night")).toBe("未確認（未聴取）");
    expect(text(s, "shelter.pre.place")).toBe("未確認（不明）");
    const markup = html(s);
    expect(markup.split("未確認（不明）").length - 1).toBe(2);
    expect(markup.split("未確認（未聴取）").length - 1).toBe(1);
  });

  it("空欄は「未確認」と出し、手で書く欄（番号・自署・代理人・市受付印）だけ空ける", () => {
    const s = sheetOf("p-01");
    for (const k of ["local.watcher", "shelter.near.place", "housing.bedroom", "route.text", "org.name"] as const) {
      expect(text(s, k), k).toBe("未確認");
    }
    for (const k of ["head.number", "sign.self", "sign.proxy", "city.stamp"] as const) {
      expect(s.cells[k].kind, k).toBe("handwrite");
    }
  });

  it("ほかの人も台帳の値が出る（透析の頼り先、インスリンの残り、緊急連絡先の 3 人目）", () => {
    const tanaka = sheetOf("p-03");
    expect(text(tanaka, "notes.medical")).toContain("透析 次の回まで 2 日");
    expect(text(tanaka, "notes.medical")).toContain("透析先 未確認");
    expect(text(tanaka, "notes.medical")).toContain("みずほし透析クリニック");
    expect(text(tanaka, "notes.other")).toContain("岡田 由美");
    expect(text(tanaka, "notes.other")).toContain("緊急連絡 3");

    const inoue = sheetOf("p-08");
    expect(text(inoue, "medical.drugs")).toContain("残り 4 日");
    expect(text(inoue, "medical.drugs")).toContain("要冷蔵");
    expect(text(inoue, "target.mobile")).toBe("090-0000-0008");
    expect(text(inoue, "risk.home")).toContain("■津波");

    const kobayashi = sheetOf("p-02");
    expect(text(kobayashi, "notes.medical")).toContain("人工呼吸器 内蔵電池 3 時間");
    expect(text(kobayashi, "supporter.night")).toContain("小林 健一");

    const sato = sheetOf("p-04");
    expect(text(sato, "notes.other")).toContain("本人報告 参考扱い");
    expect(text(sato, "local.welfare")).toContain("清水 正子");

    const ito = sheetOf("p-05");
    expect(text(ito, "supporter1.name")).toBe("なし");
    expect(text(ito, "target.category")).toContain("■要介護（要介護4）");

    const nakamura = sheetOf("p-10");
    expect(text(nakamura, "medical.drugs")).toBe("なし");
    expect(text(nakamura, "notes.annex")).toBe("□あり ■なし");
    expect(text(nakamura, "target.category")).toContain("■その他（要支援1）");
    expect(text(nakamura, "risk.home")).toContain("なし");
  });
});

describe("同意のない範囲は落とす", () => {
  it("7 加藤 正: 支援者提供なし → 実施者 1・2 は省略、同意※は不同意。地域の支援者・近親者は残る", () => {
    const s = sheetOf("p-07");
    expect(s.withheld).toEqual(["supporters"]);
    for (const n of [1, 2] as const) {
      for (const part of ["kana", "name", "address", "phone", "mobile", "relation"] as const) {
        expect(s.cells[`supporter${n}.${part}`], `${n} ${part}`).toEqual({ kind: "withheld", consent: "supporters" });
      }
      expect(text(s, `supporter${n}.consent`)).toBe("□同意 ■不同意");
    }
    const markup = html(s);
    const supporters = blockHtml(markup, "supporters");
    for (const w of ["前田 和夫", "加藤 実", "090-0000-0026", "090-0000-0025"]) expect(supporters).not.toContain(w);
    expect(supporters.split(withheldText("supporters")).length - 1).toBe(2);
    // 名簿登録・計画共有は同意のまま、組織の同意※は計画共有から
    expect(text(s, "consent.registry")).toContain("■同意する □同意しない");
    expect(text(s, "org.consent")).toBe("■同意 □不同意");
    expect(text(s, "local.welfare")).toContain("前田 和夫");
    expect(text(s, "kin.name")).toBe("加藤 実");
    // 医療は同意あり
    expect(text(s, "medical.drugs")).toContain("抗凝固薬（DOAC）");
    expect(text(s, "medical.drugs")).toContain("残り 7 日");
  });

  it("9 渡辺 清: 医療班提供なしでも様式の医療の欄は出る（医療の欄は計画共有に従う。医療班提供は要約と QR だけ）", () => {
    const s = sheetOf("p-09");
    expect(s.withheld).toEqual([]);
    for (const k of ["medical.doctor", "medical.drugs", "notes.medical", "notes.annex"] as const) {
      expect(s.cells[k].kind, k).not.toBe("withheld");
    }
    expect(text(s, "medical.drugs")).toContain("降圧薬");
    expect(text(s, "medical.drugs")).toContain("1 日 1 回");
    expect(text(s, "medical.doctor")).toBe("未確認");
    expect(text(s, "notes.annex")).toBe("■あり（医療要約） □なし");
    const markup = html(s);
    expect(markup).toContain("降圧薬");
    expect(markup).not.toContain(withheldText("medical"));
    expect(markup).not.toContain("p-withheld");
    // 支援者は同意あり
    expect(text(s, "supporter1.name")).toBe("藤田 ミチ");
  });

  it("計画共有なし → 実施組織と医療の欄（かかりつけ・医薬品情報・特記の医療）は省略、別紙なし。紙面に薬の名前が出ない", () => {
    const p = seed("p-01");
    const rows = seedRows(p);
    const refused = {
      ...rows,
      consents: rows.consents.map((c) => (c.kind === "plan_share" ? { ...c, status: "refused" as const } : c)),
    };
    const s = buildMatsuyamaSheet(refused, { today: TODAY, officeName: "デモ事業所" });
    expect(s.withheld).toEqual(["plan_share"]);
    for (const k of ["medical.doctor", "medical.drugs", "notes.medical", "org.name", "org.phone"] as const) {
      expect(s.cells[k], k).toEqual({ kind: "withheld", consent: "plan_share" });
    }
    expect(text(s, "notes.annex")).toBe("□あり ■なし");
    expect(text(s, "consent.planShare")).toContain("■同意しない");
    expect(text(s, "org.consent")).toBe("□同意 ■不同意");
    const markup = html(s);
    for (const w of ["ワーファリン", "在宅酸素"]) expect(markup).not.toContain(w);
    expect(markup).toContain(withheldText("plan_share"));
    // 実施者（支援者提供）と医療班提供は同意のまま
    expect(text(s, "supporter1.consent")).toBe("■同意 □不同意");
  });

  it("ほかの 9 人は省略が無い", () => {
    for (const id of ALL_IDS.filter((x) => x !== "p-07")) {
      const s = sheetOf(id);
      expect(s.withheld, id).toEqual([]);
      expect(Object.values(s.cells).some((c) => c.kind === "withheld"), id).toBe(false);
    }
  });
});

describe("本人のページの書類の入口", () => {
  it("計画書と医療要約（T07）は紙面へのリンク、ほかは準備中", () => {
    const v = toPersonView(seedRows(seed("p-01")), { today: TODAY });
    const docs = v.sections.find((x) => x.id === "documents")!.blocks.flatMap((b) => (b.type === "documents" ? b.documents : []));
    expect(docs.map((d) => [d.key, d.status, d.href ?? null])).toEqual([
      ["matsuyama", "表示", "/people/p-01/forms/matsuyama"],
      ["medical", "表示", "/people/p-01/forms/medical"],
      ["own", "準備中", null],
    ]);
  });
});
