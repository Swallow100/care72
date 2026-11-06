import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MedicalSummaryBasis } from "../../components/forms/MedicalSummaryBasis.tsx";
import { MedicalSummarySheet } from "../../components/forms/MedicalSummarySheet.tsx";
import { MedicalWithheld } from "../../components/forms/MedicalWithheld.tsx";
import { SEED_AT, seedConsents, type SeedPerson } from "../../seed/people.ts";
import type { ConsentStatus, Ledger } from "../db/types.ts";
import { parseLedger } from "../db/ledger.ts";
import type { PersonPageRows } from "../person.ts";
import { assertSourceIds, sourceById } from "../sources/index.ts";
import { TIERS, tierBasis } from "../triage/index.ts";
import { cellText } from "./matsuyama.ts";
import {
  buildMedicalSummary,
  buildOwnSheetMedical,
  deviceMark,
  DOCTOR_KEYS,
  FORM_ORDER_BASIS,
  interruptionMark,
  MEDICAL_FIELDS,
  medicalId,
  medicalIdKana,
  SAIGAI_KIROKU_SOURCE,
  type MedicalKey,
  type MedicalSummary,
  type MedicalSummaryResult,
} from "./medical-summary.ts";
// T142 で種の台帳を埋めた。このテストは空いた欄を前提にするので、T142 より前の空きの多い形（seed/sparse.ts）を使う
import { SPARSE_PEOPLE } from "../../seed/sparse.ts";

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

const seed = (id: string) => SPARSE_PEOPLE.find((p) => p.person.id === id)!;
const build = (rows: PersonPageRows): MedicalSummaryResult => buildMedicalSummary(rows, { today: TODAY, officeName: "デモ事業所" });
const resultOf = (id: string) => build(seedRows(seed(id)));
function sheetOf(id: string): MedicalSummary {
  const r = resultOf(id);
  if (r.kind !== "sheet") throw new Error(`${id} は要約が出ない: ${r.kind}`);
  return r.sheet;
}
const text = (s: MedicalSummary, k: MedicalKey) => cellText(s.cells[k]);
const html = (s: MedicalSummary) => renderToStaticMarkup(createElement(MedicalSummarySheet, { sheet: s }));
const basisHtml = (s: MedicalSummary) => renderToStaticMarkup(createElement(MedicalSummaryBasis, { sheet: s }));

/** 種の 1 人の行を、医療班提供の同意だけ差し替えて作る */
function withMedicalConsent(id: string, status: ConsentStatus, ledgerPatch?: (l: Ledger) => Ledger): PersonPageRows {
  const p = seed(id);
  const rows = seedRows(ledgerPatch ? { ...p, ledger: ledgerPatch(structuredClone(p.ledger)) } : p);
  return { ...rows, consents: rows.consents.map((c) => (c.kind === "medical" ? { ...c, status } : c)) };
}

const ALL_IDS = SPARSE_PEOPLE.map((p) => p.person.id);
const SHEET_IDS = ALL_IDS.filter((id) => id !== "p-09");
const ASSERTING_WORDS = ["危険", "診断", "判定", "重症", "病気がわかる", "べき"];

describe("欄の一覧", () => {
  it("名前は重ならず、様式の順（1 頁の欄の最後にメディカル ID、そのあとに 2 頁の既往症・予防接種）", () => {
    const keys = MEDICAL_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const f of MEDICAL_FIELDS) {
      expect(f.label, f.key).not.toBe("");
      expect(f.source, f.key).not.toBe("");
    }
    // 依頼の順: 氏名カナ・生年月日・家の状態・避難先・連絡先・アレルギー・常用薬のチェック・薬の一覧・要配慮者・既往症・予防接種・ID
    const at = (k: MedicalKey) => keys.indexOf(k);
    const order: MedicalKey[] = [
      "patient.kana",
      "patient.birth",
      "patient.house",
      "shelter.first",
      "contact.kinds",
      "contra.allergy",
      "drug.antiplatelet",
      "drug.anticoagulant",
      "drug.diabetes",
      "drug.steroid",
      "drug.antiepileptic",
      "drug.other",
      "drug.dialysis",
      "drug.hot",
      "meds.list",
      "care.vulnerable",
      "care.protect",
      "id.medical",
      "history.disease",
      "history.vaccination",
    ];
    for (let i = 1; i < order.length; i++) expect(at(order[i - 1]), order[i]).toBeLessThan(at(order[i]));
  });

  it("出典は災害診療記録 2018（登録簿にある）", () => {
    expect(sourceById(SAIGAI_KIROKU_SOURCE).title).toContain("災害診療記録");
    expect(FORM_ORDER_BASIS.sourceIds).toEqual([SAIGAI_KIROKU_SOURCE]);
  });
});

describe("メディカル ID（西暦生年月日 8 桁＋性別＋氏名カナ上位 7 桁）", () => {
  it("種の 9 人（医療班提供の同意のある人）は機械的に作る", () => {
    const ids = Object.fromEntries(SHEET_IDS.map((id) => [id, sheetOf(id).medicalId.id]));
    expect(ids).toEqual({
      "p-01": "19420418Fヤマダハナ",
      "p-02": "19400209Fコバヤシトシ",
      "p-03": "19470621Mタナカシゲル",
      "p-04": "19380305Fサトウキミ",
      "p-05": "19370127Fイトウフミ",
      "p-06": "19350730Fタカハシユキ",
      "p-07": "19480914Mカトウタダシ",
      "p-08": "19500503Mイノウエマコト",
      "p-10": "19461002Mナカムライサム",
    });
  });

  it("カナは上から 7 字。空白と中黒を除き、半角カナ・ひらがなは全角カタカナにそろえる。濁点・長音・小書きは 1 字", () => {
    expect(medicalIdKana("ヤマモト ジュウタロウ")).toBe("ヤマモトジュウ");
    expect(medicalIdKana("ﾔﾏﾓﾄ ｼﾞｭｳﾀﾛｳ")).toBe("ヤマモトジュウ");
    expect(medicalIdKana("やまもと　じゅうたろう")).toBe("ヤマモトジュウ");
    expect(medicalIdKana("アーノルド・ハナコ")).toBe("アーノルドハナ");
    expect(medicalIdKana("ヤマダ ハナ")).toBe("ヤマダハナ"); // 7 字に満たなければ足さない
    expect(medicalIdKana("山田 ハナ")).toBeNull(); // 漢字が残れば作らない
    expect(medicalIdKana("  ")).toBeNull();
  });

  it("生年月日・性別・カナのどれかが無ければ作らず、欠けた物を返す", () => {
    expect(medicalId({ birthDate: "1950-09-08", sex: "male", kana: "ヤマモト ジュウタロウ" })).toEqual({
      birth8: "19500908",
      sex: "M",
      kana7: "ヤマモトジュウ",
      id: "19500908Mヤマモトジュウ",
      missing: [],
    });
    expect(medicalId({ birthDate: null, sex: "female", kana: "ヤマダ ハナ" }).id).toBeNull();
    expect(medicalId({ birthDate: null, sex: "female", kana: "ヤマダ ハナ" }).missing).toEqual(["birth"]);
    expect(medicalId({ birthDate: "1942-04-18", sex: "other", kana: "ヤマダ ハナ" }).missing).toEqual(["sex"]);
    expect(medicalId({ birthDate: "1942-04-18", sex: undefined, kana: null }).missing).toEqual(["sex", "kana"]);
  });

  it("紙面には 8 桁・M か F・カナ 7 字の枠で出る", () => {
    const markup = html(sheetOf("p-01"));
    expect(markup).toContain('data-medical-id="19420418Fヤマダハナ"');
    expect(markup.split('class="mid-box"').length - 1).toBe(15);
    expect(markup).toContain('<span class="on">F</span>');
  });
});

describe("医療班提供の同意", () => {
  it("9 渡辺 清（医療班提供なし）は要約を作らず「同意なし」。名前と同意の記録のほかは何も持たない", () => {
    const r = resultOf("p-09");
    expect(r.kind).toBe("refused");
    if (r.kind === "sheet") return;
    expect(r.consent).toMatchObject({ status: "refused", recordedBy: "山本" });
    const all = JSON.stringify(r);
    for (const w of ["降圧薬", "090-0000", "そらみ台", "1944", "石川", "藤田"]) expect(all, w).not.toContain(w);
    const markup = renderToStaticMarkup(createElement(MedicalWithheld, { kind: r.kind, consent: r.consent }));
    expect(markup).toContain("同意なし");
    expect(markup).not.toContain("降圧薬");
  });

  it("同意が未確認（保留）なら「未確認」。台帳の pending の理由を添える", () => {
    const r = build(
      withMedicalConsent("p-01", "unconfirmed", (l) => ({
        ...l,
        pending: [...l.pending, { field: "consent.medical", status: "not_asked" }],
      })),
    );
    expect(r.kind).toBe("unconfirmed");
    if (r.kind === "sheet") return;
    expect(r.consent.reason).toBe("not_asked");
    expect(JSON.stringify(r)).not.toContain("ワーファリン");
    const markup = renderToStaticMarkup(createElement(MedicalWithheld, { kind: r.kind, consent: r.consent }));
    expect(markup).toContain("未確認");
    expect(markup).toContain("未聴取");
  });

  it("保留（未確認）の人は 10 人のだれでも要約を作らない。医療班の範囲（T24）で開いても、本人の 1 枚の裏でも同じ", () => {
    for (const id of ALL_IDS) {
      const rows = withMedicalConsent(id, "unconfirmed");
      const plain = build(rows);
      const scoped = buildMedicalSummary(rows, {
        today: TODAY,
        officeName: "デモ事業所",
        view: { partialPeople: true, hide: ["patient.address", "patient.phone"] },
      });
      const own = buildOwnSheetMedical(rows, { today: TODAY, officeName: "デモ事業所" });
      for (const r of [plain, scoped, own]) {
        expect(r.kind, id).toBe("unconfirmed");
        expect(Object.keys(r).sort(), id).toEqual(["consent", "kind", "name", "personId"]);
      }
    }
  });

  it("同意の行が無ければ未確認", () => {
    const rows = seedRows(seed("p-01"));
    expect(build({ ...rows, consents: rows.consents.filter((c) => c.kind !== "medical") }).kind).toBe("unconfirmed");
  });

  it("医療班提供に同意していれば、ほかの同意（7 加藤の支援者提供なし）にかかわらず要約を作り、連絡先も載せる", () => {
    const s = sheetOf("p-07");
    expect(text(s, "contact.people")).toContain("加藤 実");
    expect(text(s, "contact.people")).toContain("前田 和夫");
    expect(s.consent.status).toBe("granted");
  });

  it("10 人のうち要約が出るのは 9 人（渡辺のほか全員）", () => {
    expect(ALL_IDS.filter((id) => resultOf(id).kind === "sheet")).toEqual(SHEET_IDS);
  });
});

describe("種の 9 人から欄が埋まる", () => {
  it("全部の欄に値（未確認・なしを含む）があり、紙面に全部の欄が出る。断定の言葉と「べき」が無い", () => {
    for (const id of SHEET_IDS) {
      const s = sheetOf(id);
      const markup = html(s);
      for (const f of MEDICAL_FIELDS) {
        expect(s.cells[f.key], `${id} ${f.key}`).toBeDefined();
        expect(markup.includes(`data-field="${f.key}"`), `${id} ${f.key}`).toBe(true);
      }
      expect(markup.split('data-page="').length - 1, id).toBe(1);
      for (const w of ASSERTING_WORDS) expect(markup, `${id} ${w}`).not.toContain(w);
      // 脇の文（出典の題名は文書の名前なので除く。透析医会の題名に「すべきこと」がある）
      let side = basisHtml(s);
      for (const b of s.basis) for (const sid of b.sourceIds) side = side.split(sourceById(sid).title).join("");
      for (const w of ASSERTING_WORDS) expect(side, `${id} 脇 ${w}`).not.toContain(w);
    }
  });

  it("台帳の pending は全部、要約の未確認に出る", () => {
    for (const id of SHEET_IDS) {
      const s = sheetOf(id);
      const ledger = parseLedger(JSON.stringify(seed(id).ledger));
      expect(s.pending.map((p) => p.field).sort(), id).toEqual(ledger.pending.map((p) => p.field).sort());
      const markup = html(s);
      for (const p of s.pending) expect(markup, `${id} ${p.field}`).toContain(p.label);
    }
  });

  it("「なぜこの行があるか」と出典の名前は紙に出さず、画面の脇にだけ出る", () => {
    for (const id of SHEET_IDS) {
      const s = sheetOf(id);
      const paper = html(s);
      const side = basisHtml(s);
      for (const b of [FORM_ORDER_BASIS, ...s.basis]) {
        expect(paper, `${id} ${b.label}`).not.toContain(b.why);
        expect(side, `${id} ${b.label}`).toContain(b.why);
        for (const sid of b.sourceIds) {
          // 紙の下の注は従った様式（災害診療記録 2018）の名前だけを持つ
          if (sid !== SAIGAI_KIROKU_SOURCE) expect(paper, `${id} ${sid}`).not.toContain(sourceById(sid).title);
          expect(side, `${id} ${sid}`).toContain(sourceById(sid).title);
        }
      }
      expect(side).toContain("screen-only");
    }
  });

  it("出典の確認（作者が 11/7 までに）が済むまで、画面の脇の出典ごとに小さな「未確認」の印を出す。隠さない", () => {
    for (const id of SHEET_IDS) {
      const side = basisHtml(sheetOf(id));
      const items = [...side.matchAll(/data-source="([^"]+)"(.*?)<\/li>/g)];
      expect(items.length, id).toBeGreaterThan(0);
      for (const m of items) {
        const checked = sourceById(m[1]).checkedOn !== null;
        expect(m[2], `${id} ${m[1]}`).toContain(checked ? "確認済" : "未確認");
      }
      // 出典の行は text-xs の小さな字の中
      expect(side).toMatch(/<ul class="[^"]*text-xs[^"]*"><li[^>]*data-source=/);
    }
  });
});

describe("1 山田 ハナ（T07 の終わりの形）", () => {
  const s = sheetOf("p-01");

  it("抗凝固薬（ワーファリン）にチェック。中断注意の印は様式の欄に出さない（補足の常用薬の表だけ）", () => {
    expect(text(s, "drug.anticoagulant")).toBe("■抗凝固薬 ■ワーファリン ワーファリン 1 日 1 回");
    expect(s.medications[0].mark?.label).toBe("中断注意");
    expect(text(s, "drug.antiplatelet")).toBe("□抗血小板薬");
    expect(text(s, "drug.diabetes")).toBe("□糖尿病治療薬 □インスリン □経口薬");
    expect(text(s, "drug.dialysis")).toBe("□透析");
  });

  it("在宅酸素 1 L/分、内蔵電池 2 時間、予備ボンベ 8 時間", () => {
    const hot = text(s, "drug.hot");
    expect(hot.startsWith("■在宅酸素療法（HOT）")).toBe(true);
    for (const w of ["1 L/分", "内蔵電池 2 時間", "予備ボンベ 8 時間", "停電から"]) expect(hot).toContain(w);
  });

  it("薬の名前・回数・残り（台帳で不明）と中断注意の印", () => {
    expect(s.medications).toHaveLength(1);
    const m = s.medications[0];
    expect(m.name).toBe("ワーファリン");
    expect(cellText(m.schedule)).toBe("1 日 1 回");
    expect(cellText(m.remaining)).toBe("未確認（不明） 残りの日数は未確認");
    expect(m.mark).toEqual({ label: "中断注意", tier: 5, sourceIds: tierBasis(5).sourceIds });
  });

  it("要配慮者（高齢者・要介護3・独居）、支援者がいるので要保護者の印は付かない", () => {
    const v = text(s, "care.vulnerable");
    expect(v.startsWith("■災害時要配慮者 ■高齢者 □障害者")).toBe(true);
    expect(v).toContain("要介護3");
    expect(v).toContain("独居");
    expect(text(s, "care.protect")).toBe("□支援者のいない要配慮者等 実施者 森 恵子 娘 ／ 木村 ヨシ 隣人");
  });

  it("氏名カナ・生年月日（西暦と和暦）・性別・家・避難先・連絡先", () => {
    expect(text(s, "patient.kana")).toBe("ヤマダ ハナ");
    expect(text(s, "patient.birth")).toBe("1942 年 4 月 18 日 昭和 17 年 4 月 18 日 84 歳");
    expect(text(s, "patient.sex")).toBe("□男 ■女");
    expect(text(s, "patient.house")).toBe("□健存 □半壊 □全壊 未確認");
    expect(text(s, "patient.dwelling")).toBe("木造・2 階建・1 階に住む ハザード 浸水 3 m");
    expect(text(s, "shelter.first")).toBe("かわなぎ小学校 移動 娘の車");
    expect(text(s, "shelter.second")).toBe("未確認（不明）");
    expect(text(s, "contact.kinds")).toBe("■家族 ■知人 □その他 □連絡先なし");
    expect(text(s, "contact.people")).toContain("森 恵子 娘 市内 緊急連絡 1 実施者 1 TEL 090-0000-0011");
    expect(text(s, "contra.allergy")).toBe("未確認");
    expect(text(s, "meds.carry")).toBe("予備ボンベ 薬 お薬手帳");
    expect(text(s, "meds.notes")).toBe("薬は 2 階の箪笥");
  });

  it("未確認 3 か所（ワーファリンの残り・避難先2・夜間支援）", () => {
    expect(s.pending.map((p) => [p.field, p.key, p.status])).toEqual([
      ["medical.medications.warfarin.remaining", "meds.list", "unknown"],
      ["evacuation.destination2", "shelter.second", "unknown"],
      ["people.night_supporter", null, "not_asked"],
    ]);
  });

  it("脇の根拠: 在宅酸素（段 2）とワーファリン（段 5）", () => {
    expect(s.basis.map((b) => [b.key, b.label, b.tier])).toEqual([
      ["drug.hot", "在宅酸素療法（HOT）", 2],
      ["meds.list", "ワーファリン", 5],
    ]);
  });

  it("紙面は A4 1 枚（data-page は 1 つ）で、大事な欄は太い枠", () => {
    const markup = html(s);
    for (const b of ["contra", "special", "id", "extra"]) expect(markup).toContain(`class="blk key" data-block="${b}"`);
  });
});

describe("中断注意の印（優先の骨格から機械的に、出典の id を添える）", () => {
  it("段 4（インスリン）と段 5（抗血小板薬・抗凝固薬・ステロイド・抗てんかん薬）に付き、段の根拠の出典を持つ", () => {
    expect(interruptionMark({ category: "insulin" })).toEqual({ label: "中断注意", tier: 4, sourceIds: tierBasis(4).sourceIds });
    for (const c of ["antiplatelet", "anticoagulant", "steroid", "antiepileptic"] as const) {
      expect(interruptionMark({ category: c })?.tier, c).toBe(5);
    }
  });

  it("抗血小板薬: 段 5 の印で、出典は循環器の指針（jcs-disaster-2014）を含む", () => {
    expect(interruptionMark({ category: "antiplatelet" })).toEqual({ label: "中断注意", tier: 5, sourceIds: tierBasis(5).sourceIds });
    expect(tierBasis(5).sourceIds).toContain("jcs-disaster-2014");
    expect(tierBasis(5).why).toContain("抗血小板薬");
  });

  it("骨格に段の無い区分（経口糖尿病薬・その他）は付かない。台帳の印だけなら出典なしで付く", () => {
    for (const c of ["oral_diabetes", "other"] as const) expect(interruptionMark({ category: c }), c).toBeNull();
    expect(interruptionMark({ category: "oral_diabetes", interruptionRisk: true })).toEqual({
      label: "中断注意",
      tier: null,
      sourceIds: [],
    });
  });

  it("種の薬: 機械的な印と台帳の印（interruptionRisk）が食い違わない。出典の id は全部登録簿にある", () => {
    for (const id of SHEET_IDS) {
      const s = sheetOf(id);
      const meds = seed(id).ledger.medical.medications;
      s.medications.forEach((m, i) => {
        expect(Boolean(m.mark), `${id} ${m.name}`).toBe(Boolean(meds[i].interruptionRisk));
        if (m.mark) {
          assertSourceIds(m.mark.sourceIds);
          expect(m.mark.sourceIds.length, `${id} ${m.name}`).toBeGreaterThan(0);
        }
      });
      for (const b of s.basis) assertSourceIds(b.sourceIds);
    }
    const marks = SHEET_IDS.flatMap((id) => sheetOf(id).medications.map((m) => [m.name, m.mark?.tier ?? null]));
    expect(marks).toEqual([
      ["ワーファリン", 5],
      ["抗認知症薬", null],
      ["ステロイド", 5],
      ["抗凝固薬（DOAC）", 5],
      ["インスリン", 4],
    ]);
  });

  it("骨格の段の根拠（why）は lib/triage の TIERS の文のまま", () => {
    for (const id of SHEET_IDS) {
      for (const b of sheetOf(id).basis) {
        const t = TIERS.find((x) => x.tier === b.tier)!;
        expect(b.why).toBe(t.why);
        expect(b.sourceIds).toEqual(t.sourceIds);
      }
    }
  });
});

describe("ほかの人", () => {
  it("2 小林 トシ: 人工呼吸器（内蔵電池 3 時間）と吸引（内蔵電池 未確認）を機器の欄に。根拠は段 1", () => {
    const s = sheetOf("p-02");
    const d = text(s, "drug.devices");
    expect(d).toContain("人工呼吸器 気管切開");
    expect(d).toContain("内蔵電池 3 時間");
    expect(d).toContain("吸引 1 日 6 回");
    expect(d).toContain("内蔵電池 未確認");
    expect(text(s, "drug.hot")).toBe("□在宅酸素療法（HOT）");
    expect(s.basis.map((b) => [b.label, b.tier])).toEqual([["人工呼吸器・吸引", 1]]);
  });

  it("3 田中 茂: 透析にチェック、次の回まで 2 日、透析先 未確認、透析施設の電話", () => {
    const d = text(sheetOf("p-03"), "drug.dialysis");
    expect(d.startsWith("■透析 血液透析 月水金")).toBe(true);
    for (const w of ["次の回まで 2 日", "透析先 未確認", "みずほし透析クリニック", "090-0000-0018"]) expect(d).toContain(w);
  });

  it("4 佐藤 キミ: 抗認知症薬は「その他」、中断注意なし。認知症で独居の根拠は段 6。本人の状態の時計は載せない", () => {
    const s = sheetOf("p-04");
    expect(text(s, "drug.other")).toBe("■その他 抗認知症薬 1 日 1 回");
    expect(text(s, "care.vulnerable")).toContain("認知症");
    expect(text(s, "meds.notes")).toBe("なし");
    expect(html(s)).not.toContain("当てにならない");
    expect(s.basis.map((b) => b.tier)).toEqual([6]);
  });

  it("5 伊藤 フミ: ステロイド（残り 5 日、中断注意は補足の表）、支援者のいない要配慮者等に印", () => {
    const s = sheetOf("p-05");
    expect(text(s, "drug.steroid")).toBe("■ステロイド ステロイド 1 日 1 回");
    expect(s.medications[0].mark?.tier).toBe(5);
    expect(cellText(s.medications[0].remaining)).toBe("5 日 発災から・薬局");
    expect(text(s, "care.protect")).toBe("■支援者のいない要配慮者等 実施者 なし");
    expect(s.basis.map((b) => b.tier)).toEqual([5, 7]);
  });

  it("6 高橋 ユキ: 胃ろう 経管栄養と栄養剤 3 日を機器の欄に。経管栄養（段 4）の行に中断注意", () => {
    const d = text(sheetOf("p-06"), "drug.devices");
    expect(d).toContain("胃ろう 経管栄養");
    expect(d).toContain("栄養剤 3 日");
    // 経管栄養の行の終わりに中断注意。その後ろは「その他」の機器の行（T57 で種に足した）
    expect(d.endsWith("中断注意 その他 電動ベッド（エアマット）")).toBe(true);
    expect(deviceMark("tube_feeding")).toEqual({ label: "中断注意", tier: 4, sourceIds: tierBasis(4).sourceIds });
    // 電気の機器（段 1・2）と透析（段 3）には付けない
    for (const k of ["ventilator", "suction", "oxygen", "dialysis"] as const) expect(deviceMark(k), k).toBeNull();
    expect(text(sheetOf("p-02"), "drug.devices")).not.toContain("中断注意");
  });

  it("8 井上 誠: 糖尿病治療薬・インスリンにチェック、残り 4 日（発災から）・要冷蔵・中断注意（段 4、補足の表）", () => {
    const s = sheetOf("p-08");
    expect(text(s, "drug.diabetes")).toBe("■糖尿病治療薬 ■インスリン □経口薬 インスリン 朝夕");
    const m = s.medications[0];
    expect(cellText(m.remaining)).toBe("4 日 発災から・薬局");
    expect(cellText(m.storage)).toBe("冷蔵庫 要冷蔵");
    expect(m.mark?.tier).toBe(4);
  });

  it("10 中村 勇: 薬・機器なし。常用薬のチェックは全部 □、根拠の行は欄の順だけ", () => {
    const s = sheetOf("p-10");
    expect(text(s, "meds.list")).toBe("なし");
    for (const k of ["drug.antiplatelet", "drug.anticoagulant", "drug.diabetes", "drug.steroid", "drug.dialysis", "drug.hot"] as const) {
      expect(text(s, k), k).not.toContain("■");
    }
    expect(s.basis).toEqual([]);
  });
});

describe("推し量らない", () => {
  it("既往症・予防接種は台帳の言葉のまま。様式と同じ言葉だけ印、ほかは「その他」に", () => {
    const s = sheetOf(
      "p-01",
    );
    expect(text(s, "history.disease")).toBe("未確認");
    const rows = seedRows({
      ...seed("p-01"),
      ledger: {
        ...seed("p-01").ledger,
        medical: { ...seed("p-01").ledger.medical, history: ["高血圧", "心房細動"], vaccinations: ["肺炎球菌", "インフルエンザ"] },
      },
    });
    const r = build(rows);
    if (r.kind !== "sheet") throw new Error("sheet");
    expect(text(r.sheet, "history.disease")).toBe("■高血圧 □糖尿病 □喘息 ■その他（心房細動）");
    expect(text(r.sheet, "history.vaccination")).toBe("□麻疹 □破傷風 □今期インフルエンザ ■肺炎球菌 □風疹 ■その他（インフルエンザ）");
  });

  it("降圧薬だけの人に高血圧の印を付けない（9 渡辺の台帳を、同意ありに差し替えて確かめる）", () => {
    const r = build(withMedicalConsent("p-09", "granted"));
    if (r.kind !== "sheet") throw new Error("sheet");
    expect(text(r.sheet, "history.disease")).toBe("未確認");
    expect(text(r.sheet, "drug.other")).toBe("■その他 降圧薬 1 日 1 回");
    expect(r.sheet.medications[0].mark).toBeNull();
  });
});

describe("医療要約の線（T48）: 並べ替えだけ・医師が書く欄は空欄", () => {
  it("医師が書く欄（初診日・初診医師氏名・傷病名・トリアージタグ）は空欄で、紙面に「医師記入」を添えて出す", () => {
    expect(DOCTOR_KEYS).toEqual(["doctor.firstVisit", "doctor.physician", "doctor.disease", "doctor.triage"]);
    for (const id of SHEET_IDS) {
      const s = sheetOf(id);
      for (const k of DOCTOR_KEYS) expect(s.cells[k], `${id} ${k}`).toEqual({ kind: "handwrite" });
      const markup = html(s);
      for (const k of DOCTOR_KEYS) expect(markup, `${id} ${k}`).toMatch(new RegExp(`data-field="${k}" data-doctor[^>]*>.*?医師記入.*?class="hand"`));
    }
  });

  it("様式の欄（特記事項の □ の後ろ）には中断注意の印を出さず、補足の常用薬の表と機器にだけ出す", () => {
    let marked = 0;
    for (const id of SHEET_IDS) {
      const s = sheetOf(id);
      for (const f of MEDICAL_FIELDS) {
        if ("extra" in f && f.extra) continue;
        expect(text(s, f.key), `${id} ${f.key}`).not.toContain("中断注意");
      }
      marked += s.medications.filter((m) => m.mark).length;
    }
    // 補足の表には残る（山田 ワーファリン・伊藤 ステロイド・井上 インスリン など）
    expect(marked).toBeGreaterThanOrEqual(3);
  });
});
