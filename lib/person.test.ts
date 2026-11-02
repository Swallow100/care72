import type { D1Database } from "@cloudflare/workers-types";
import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { PersonView } from "../components/person/PersonView.tsx";
import { SEED_AT, SEED_PEOPLE, seedConsents, type SeedPerson } from "../seed/people.ts";
import { seedStatements } from "../seed/sql.ts";
import type { Principal } from "./auth/principal.ts";
import { d1FromSqlite, migratedSqlite } from "./db/test-d1.ts";
import { SECTION_LABELS } from "./labels.ts";
import {
  clockTone,
  formatJst,
  loadPersonPage,
  priorityOf,
  sectionOfField,
  sectionOrder,
  telHref,
  timelineItems,
  toPersonView,
  type Block,
  type ClockView,
  type PersonPageRows,
  type PersonView as View,
  type Row,
  type SectionId,
} from "./person.ts";
import { triage } from "./triage/index.ts";
import { toTriagePerson } from "./triage/from-ledger.ts";
import { parseLedger } from "./db/ledger.ts";

const TODAY = "2026-11-02";

/** 種の 1 人を、D1 から読んだのと同じ形にする */
function seedRows(p: SeedPerson, timeline: PersonPageRows["timeline"] = []): PersonPageRows {
  return {
    person: { ...p.person, ledger: JSON.stringify(p.ledger), created_at: SEED_AT, updated_at: SEED_AT },
    careManagerName: "山本",
    contacts: p.contacts.map((c, i) => ({ ...c, person_id: p.person.id, sort: i })),
    consents: seedConsents(p).map((c) => ({ ...c, recorded_by_name: "山本", recorded_by_role: "care_manager" as const })),
    clocks: p.clocks.map((k, i) => ({ ...k, person_id: p.person.id, sort: i })),
    timeline,
  };
}

const seed = (id: string) => SEED_PEOPLE.find((p) => p.person.id === id)!;
const viewOf = (id: string, mode: "normal" | "disaster" = "normal") => toPersonView(seedRows(seed(id)), { today: TODAY, mode });

const section = (v: View, id: SectionId) => v.sections.find((s) => s.id === id)!;
const rowsOf = (blocks: Block[]): Row[] => blocks.flatMap((b) => (b.type === "row" ? [b.row] : []));
const rowOf = (v: View, key: string): Row | undefined => v.sections.flatMap((s) => rowsOf(s.blocks)).find((r) => r.key === key);
const clocksOf = (v: View): ClockView[] =>
  section(v, "medical").blocks.flatMap((b) => (b.type === "clocks" ? b.clocks : []));

/** 区分の中の言葉を全部つなぐ（値・ラベル・時計・書類・経過） */
function textOf(v: View, id: SectionId): string {
  const parts: string[] = [];
  for (const b of section(v, id).blocks) {
    if (b.type === "row") {
      parts.push(b.row.label);
      if (b.row.field.kind === "lines") for (const l of b.row.field.lines) for (const s of l) parts.push(s.text);
      else parts.push(b.row.field.kind === "none" ? "なし" : "未確認");
    } else if (b.type === "clocks") {
      for (const k of b.clocks) {
        parts.push(k.label, k.kind, k.value ?? "未確認", k.start, k.source ?? "", k.sourceNote ?? "", k.note ?? "");
        if (k.depends) parts.push(`${k.depends.on} ${k.depends.check}`);
      }
    } else if (b.type === "documents") {
      for (const d of b.documents) parts.push(d.label, d.status);
    } else {
      for (const t of b.items) parts.push(t.kind, t.body ?? "", t.who);
    }
  }
  return parts.join(" ");
}

const ALL_IDS = SEED_PEOPLE.map((p) => p.person.id);
const ASSERTING_WORDS = ["危険", "診断", "判定", "重症", "病気がわかる"];

describe("本人のページ（種の 10 人）", () => {
  it("10 人全員、区分が 医療・避難・人・基本・同意・書類・経過 の順で出る", () => {
    for (const id of ALL_IDS) {
      const v = viewOf(id);
      expect(v.sections.map((s) => s.label), id).toEqual(["医療", "避難", "人", "基本", "同意", "書類", "経過"]);
      expect(v.head.name).toBe(seed(id).person.name);
    }
  });

  it("山田 ハナ: 種の値が区分ごとに出る", () => {
    const v = viewOf("p-01");
    expect(v.head).toMatchObject({ name: "山田 ハナ", age: 84, careLevel: "要介護3", plan: "下書き", unconfirmed: 3 });
    expect(v.head.marks.map((m) => m.label)).toEqual(["酸素", "抗凝固"]);
    expect(v.head.priority).toMatchObject({ kind: "tier", tier: 2, label: "在宅酸素" });

    const medical = textOf(v, "medical");
    for (const w of ["ワーファリン", "抗凝固薬", "1 日 1 回", "中断注意", "在宅酸素", "酸素濃縮器 1 L/分"]) expect(medical).toContain(w);
    for (const w of ["酸素 内蔵電池", "2 時間", "酸素 予備ボンベ", "8 時間", "説明書", "停電"]) expect(medical).toContain(w);

    const evacuation = textOf(v, "evacuation");
    for (const w of ["浸水 3 m", "かわなぎ小学校", "娘の車", "1 階・2 階建・木造", "予備ボンベ・薬・お薬手帳"]) {
      expect(evacuation).toContain(w);
    }

    const people = textOf(v, "people");
    for (const w of ["森 恵子", "娘", "市内", "木村 ヨシ", "隣人", "090-0000-0011", "090-0000-0012"]) expect(people).toContain(w);
    expect(rowOf(v, "people.supporter1")?.field).toMatchObject({ kind: "lines" });
    expect(textOf(v, "people")).toContain("民生委員 なし");

    const basic = textOf(v, "basic");
    for (const w of ["松山市 かわなぎ町", "1942-04-18", "女", "090-0000-0001", "固定電話", "独居", "通常", "薬は 2 階の箪笥"]) {
      expect(basic).toContain(w);
    }

    expect(textOf(v, "consent")).toBe(
      "名簿登録 同意 2026-11-02 山本 計画共有 同意 2026-11-02 山本 支援者提供 同意 2026-11-02 山本 医療班提供 同意 2026-11-02 山本",
    );
    expect(textOf(v, "documents")).toBe("計画書 表示 医療要約 表示 本人の1枚 表示 QR 表示");
  });

  it("電話は tel: のリンク（ハイフンを落とす）", () => {
    const v = viewOf("p-01");
    const field = rowOf(v, "people.supporter1")!.field;
    const tels = field.kind === "lines" ? field.lines.flat().filter((s) => s.tel) : [];
    expect(tels).toEqual([{ text: "090-0000-0011", tel: "09000000011" }]);
    expect(telHref("090-0000-0011")).toBe("09000000011");
    const html = renderToStaticMarkup(createElement(PersonView, { view: v, level: 1 }));
    expect(html).toContain('href="tel:09000000011"');
    expect(html).toContain('href="tel:09000000001"');
  });

  it("山田 ハナの未確認 3 は、医療（ワーファリンの時計）・避難（避難先2）・人（夜間支援）の中に出る", () => {
    const v = viewOf("p-01");
    expect(v.unconfirmed).toEqual([
      { section: "medical", field: "medical.medications.warfarin.remaining", status: "unknown", label: "ワーファリン" },
      { section: "people", field: "people.night_supporter", status: "not_asked", label: "夜間支援" },
      { section: "evacuation", field: "evacuation.destination2", status: "unknown", label: "避難先2" },
    ]);
    expect(Object.fromEntries(v.sections.map((s) => [s.id, s.unconfirmed]))).toEqual({
      medical: 1,
      evacuation: 1,
      people: 1,
      basic: 0,
      consent: 0,
      documents: 0,
      timeline: 0,
    });
    expect(clocksOf(v).find((k) => k.id === "k-01-3")).toMatchObject({ value: null, pending: [{ status: "unknown" }] });
    expect(rowOf(v, "evacuation.destination2")?.pending).toHaveLength(1);
    expect(rowOf(v, "people.night_supporter")?.pending).toHaveLength(1);

    // 画面にも 3 つの「未確認」の印が出る（数えない空欄は印にしない）
    const html = renderToStaticMarkup(createElement(PersonView, { view: v, level: 1 }));
    expect(html.match(/data-pending="/g)).toHaveLength(3);
  });

  it("未確認の数は 10 人とも台帳の pending の数と同じで、区分の数を足すと合う", () => {
    for (const id of ALL_IDS) {
      const v = viewOf(id);
      const pending = seed(id).ledger.pending.length;
      expect(v.head.unconfirmed, id).toBe(pending);
      expect(v.unconfirmed, id).toHaveLength(pending);
      expect(v.sections.reduce((n, s) => n + s.unconfirmed, 0), id).toBe(pending);
    }
    expect(viewOf("p-07").unconfirmed).toEqual([
      { section: "people", field: "people.night_supporter", status: "not_asked", label: "夜間支援" },
    ]);
  });

  it("pending に無い空の欄も「未確認」と出すが数えない（山田さんのアレルギー・かかりつけ）", () => {
    const v = viewOf("p-01");
    expect(rowOf(v, "medical.allergies")).toMatchObject({ field: { kind: "unconfirmed" }, pending: [] });
    expect(rowOf(v, "medical.doctor")).toMatchObject({ field: { kind: "unconfirmed" }, pending: [] });
  });

  it("田中 茂: 透析の時計に頼り先「透析先 未確認」、透析施設の電話は医療の区分", () => {
    const v = viewOf("p-03");
    expect(clocksOf(v)[0]).toMatchObject({
      label: "透析 次の回まで",
      value: "2 日",
      tone: "check",
      depends: { on: "透析先", check: "未確認", unchecked: true },
    });
    expect(textOf(v, "medical")).toContain("みずほし透析クリニック");
    expect(textOf(v, "people")).not.toContain("みずほし透析クリニック");
    expect(textOf(v, "people")).toContain("岡田 由美");
  });

  it("佐藤 キミ: 本人報告は参考扱い、民生委員が支援者1、認知症の時計は走らない", () => {
    const v = viewOf("p-04");
    expect(textOf(v, "basic")).toContain("本人報告 参考扱い");
    expect(textOf(v, "basic")).toContain("判断 困難");
    expect(textOf(v, "people")).toContain("支援者1 清水 正子 民生委員");
    expect(clocksOf(v)[0]).toMatchObject({ kind: "状態", value: null, runs: false, tone: null, start: "なし" });
  });

  it("伊藤 フミ: 支援者なし（支援者1 は注意の色）", () => {
    const v = viewOf("p-05");
    expect(rowOf(v, "people.supporter1")?.field).toEqual({ kind: "none", tone: "check" });
    expect(rowOf(v, "people.supporter2")?.field).toEqual({ kind: "none" });
  });

  it("同意なしは注意の色: 加藤は支援者提供、渡辺は医療班提供", () => {
    const status = (id: string, key: string) => {
      const f = rowOf(viewOf(id), key)!.field;
      return f.kind === "lines" ? f.lines[0][0] : null;
    };
    expect(status("p-07", "consent.supporters")).toEqual({ text: "不同意", tone: "check", tag: true });
    expect(status("p-07", "consent.medical")).toEqual({ text: "同意", tone: "ok", tag: true });
    expect(status("p-09", "consent.medical")).toEqual({ text: "不同意", tone: "check", tag: true });
    expect(textOf(viewOf("p-09"), "consent")).toContain("医療班への提供に同意していない");
  });

  it("中村 勇: 薬・機器・ハザードの無い人は「なし」、時計も無い", () => {
    const v = viewOf("p-10");
    expect(rowOf(v, "medical.medications")?.field).toEqual({ kind: "none" });
    expect(rowOf(v, "medical.devices")?.field).toEqual({ kind: "none" });
    expect(rowOf(v, "evacuation.hazards")?.field).toEqual({ kind: "none" });
    expect(clocksOf(v)).toEqual([]);
    expect(v.head.marks).toEqual([]);
  });

  it("10 人とも描け、言い切る言葉が入らない", () => {
    for (const id of ALL_IDS) {
      const v = viewOf(id);
      const html = renderToStaticMarkup(createElement(PersonView, { view: v, level: 1 }));
      expect(html, id).toContain(v.head.name);
      for (const label of Object.values(SECTION_LABELS)) expect(html, id).toContain(`>${label}</h2>`);
      for (const bad of ASSERTING_WORDS) expect(html, `${id} ${bad}`).not.toContain(bad);
      // 右の面では見出しが 1 段下がる
      const panel = renderToStaticMarkup(createElement(PersonView, { view: v, level: 2 }));
      expect(panel).toContain(`>${v.head.name}</h2>`);
      expect(panel).not.toContain("<h1");
    }
  });
});

describe("意味の色", () => {
  it("時計: 1 日以内は赤、7 日より短ければ黄、それ以上は色なし、値が無ければ黄、走らない時計は色なし", () => {
    expect(clockTone(2)).toBe("urgent");
    expect(clockTone(24)).toBe("urgent");
    expect(clockTone(48)).toBe("check");
    expect(clockTone(167)).toBe("check");
    expect(clockTone(168)).toBeNull();
    expect(clockTone(null)).toBe("check");
    expect(clockTone(null, false)).toBeNull();
  });

  it("医療の印と優先の段は、その時計の色（同じ意味は同じ色）", () => {
    expect(viewOf("p-01").head.marks).toEqual([
      { label: "酸素", tone: "urgent" },
      { label: "抗凝固", tone: "check" },
    ]);
    expect(viewOf("p-01").head.priority).toMatchObject({ tier: 2, tone: "urgent" });
    expect(viewOf("p-02").head.marks).toEqual([{ label: "呼吸器", tone: "urgent" }]);
    expect(viewOf("p-03").head.marks).toEqual([{ label: "透析", tone: "check" }]);
    expect(viewOf("p-07").head.marks).toEqual([{ label: "抗凝固", tone: null }]);
    expect(viewOf("p-04").head.marks).toEqual([{ label: "認知症", tone: null }]);
    expect(viewOf("p-10").head.priority).toMatchObject({ tier: 8, tone: null });
  });

  it("描いた印は色と文字の両方を持つ（色だけの印にしない）", () => {
    for (const id of ALL_IDS) {
      const html = renderToStaticMarkup(createElement(PersonView, { view: viewOf(id), level: 1 }));
      for (const m of html.matchAll(/data-tone="[a-z]+">([^<]*)</g)) expect(m[1].trim(), id).not.toBe("");
    }
  });
});

describe("並びと優先", () => {
  it("平時の順と、発災時は経過が一番上", () => {
    expect(sectionOrder("normal")).toEqual(["medical", "evacuation", "people", "basic", "consent", "documents", "timeline"]);
    expect(sectionOrder("disaster")).toEqual(["timeline", "medical", "evacuation", "people", "basic", "consent", "documents"]);
    expect(viewOf("p-01", "disaster").sections.map((s) => s.id)[0]).toBe("timeline");
  });

  it("平時は骨格の段、発災時はルールの表の色と理由（T09・T13 が渡す口）", () => {
    expect(priorityOf(2)).toEqual({ kind: "tier", tier: 2, label: "在宅酸素", tone: null });
    const p = seed("p-02");
    const ledger = parseLedger(JSON.stringify(p.ledger));
    const result = triage(
      {
        person: toTriagePerson({
          person: p.person,
          ledger,
          contacts: p.contacts,
          clocks: p.clocks,
        }),
        signals: [],
      },
      { now: "2026-11-02T07:00:00.000Z", disasterAt: "2026-11-02T03:00:00.000Z", outageAt: "2026-11-02T03:00:00.000Z" },
    );
    expect(priorityOf(1, result)).toEqual({
      kind: "triage",
      color: "red",
      tone: "urgent",
      label: "至急",
      reason: result.reason,
    });
    const v = toPersonView(seedRows(p), { today: TODAY, mode: "disaster", triage: result });
    const html = renderToStaticMarkup(createElement(PersonView, { view: v, level: 1 }));
    expect(html).toContain("至急");
    expect(html).toContain(result.reason);
  });

  it("pending の場所: 住居は避難、夜間支援は人、心身は基本、知らない場所は基本", () => {
    expect(sectionOfField("basic.housing.floor")).toBe("evacuation");
    expect(sectionOfField("people.night_supporter")).toBe("people");
    expect(sectionOfField("care.walking")).toBe("basic");
    expect(sectionOfField("basic.contactMeans.smartphone")).toBe("basic");
    expect(sectionOfField("medical.medications.warfarin.remaining")).toBe("medical");
    expect(sectionOfField("something.else")).toBe("basic");
  });

  it("値のある欄に pending が付いても数える。欄の無い場所は区分の終わりに「その他」", () => {
    const p = seed("p-10");
    const ledger = {
      ...p.ledger,
      pending: [
        { field: "evacuation.destination1", status: "declined" as const },
        { field: "people.unknown_slot", status: "unknown" as const },
      ],
    };
    const v = toPersonView(seedRows({ ...p, ledger }), { today: TODAY });
    expect(rowOf(v, "evacuation.destination1")).toMatchObject({ field: { kind: "lines" }, pending: [{ status: "declined" }] });
    expect(rowOf(v, "people.unknown_slot")).toMatchObject({ label: "その他", pending: [{ status: "unknown" }] });
    expect(v.head.unconfirmed).toBe(2);
    expect(section(v, "people").unconfirmed).toBe(1);
  });
});

describe("経過", () => {
  it("種に経過が無ければ「入力」と「同意」を種の表から作る", () => {
    const items = timelineItems(seedRows(seed("p-07")));
    expect(items.map((t) => [t.when, t.kind, t.body, t.who, t.tone])).toEqual([
      ["2026-11-02 12:00", "入力", "台帳作成", "ケアマネ 山本", null],
      ["2026-11-02 12:00", "同意", "名簿登録 同意・計画共有 同意・支援者提供 不同意・医療班提供 同意", "ケアマネ 山本", "check"],
    ]);
    expect(timelineItems(seedRows(seed("p-01")))[1].tone).toBe("ok");
  });

  it("経過の表の行と時刻の順に並び、同じ時刻の同意の行があれば作った同意は出さない", () => {
    const p = seed("p-01");
    const entry = (over: Partial<PersonPageRows["timeline"][number]>): PersonPageRows["timeline"][number] => ({
      id: "t-1",
      person_id: p.person.id,
      author_id: "acct-yamamoto",
      author_role: "care_manager",
      kind: "note",
      body: "訪問",
      payload: null,
      signal_id: null,
      occurred_at: "2026-11-03T01:00:00.000Z",
      created_at: "2026-11-03T01:00:00.000Z",
      author_name: "山本",
      signal_color: null,
      ...over,
    });
    const items = timelineItems(
      seedRows(p, [
        entry({ id: "t-2", kind: "signal", body: "赤ボタン", signal_color: "red", author_role: "self", author_name: null, occurred_at: "2026-11-04T01:00:00.000Z" }),
        entry({ id: "t-1" }),
        entry({ id: "t-0", kind: "consent", body: "同意 4 つ", occurred_at: SEED_AT }),
        entry({ id: "t-3", kind: "received", body: "みどり小学校", author_role: "medical", author_name: "医療班 1", occurred_at: "2026-11-05T01:00:00.000Z" }),
      ]),
    );
    expect(items.map((t) => [t.kind, t.who, t.tone, t.derived])).toEqual([
      ["入力", "ケアマネ 山本", null, true],
      ["同意", "ケアマネ 山本", null, false],
      ["記録", "ケアマネ 山本", null, false],
      ["安否", "本人", "urgent", false],
      ["受入", "医療班 医療班 1", "ok", false],
    ]);
  });

  it("時刻は日本の時刻で出す", () => {
    expect(formatJst("2026-11-02T03:00:00.000Z")).toBe("2026-11-02 12:00");
    expect(formatJst("2026-11-02T15:30:00.000Z")).toBe("2026-11-03 00:30");
  });
});

describe("D1 から読む（事業所の壁）", () => {
  let sqlite: DatabaseSync;
  let db: D1Database;
  const PARTNER_PERSON = "p-partner-1";

  beforeEach(() => {
    sqlite = migratedSqlite();
    for (const s of seedStatements()) sqlite.exec(s);
    sqlite
      .prepare(
        `INSERT INTO people (id, office_id, care_manager_id, name, kana, birth_date)
         VALUES (?, 'office-partner', 'acct-partner-cm', '架空 太郎', 'カクウ タロウ', '1940-01-01')`,
      )
      .run(PARTNER_PERSON);
    db = d1FromSqlite(sqlite);
  });

  const partnerCm: Principal = {
    role: "care_manager",
    judge: false,
    admin: true,
    accountId: "acct-partner-cm",
    displayName: null,
    office: { id: "office-partner", name: "協力事業所", kind: "regular" },
    caseloadOf: "acct-partner-cm",
    personId: null,
    contactId: null,
  };
  /** デモ事業所の山本（ログインした形。ゲストは無い） */
  const demoCm: Principal = {
    ...partnerCm,
    accountId: "acct-yamamoto",
    displayName: "山本",
    office: { id: "office-demo", name: "デモ事業所", kind: "demo" },
    caseloadOf: "acct-yamamoto",
  };
  const medical: Principal = { ...partnerCm, role: "medical", admin: false, accountId: "acct-med", office: null, caseloadOf: null };

  it("デモ事業所の 10 人全員が読め、種の値が区分ごとに出る", async () => {
    for (const id of ALL_IDS) {
      const rows = await loadPersonPage(db, demoCm, id);
      expect(rows, id).not.toBeNull();
      const v = toPersonView(rows!, { today: TODAY });
      const expected = toPersonView(seedRows(seed(id)), { today: TODAY });
      expect(v.sections, id).toEqual(expected.sections);
      expect(v.head, id).toEqual(expected.head);
      expect(renderToStaticMarkup(createElement(PersonView, { view: v, level: 1 }))).toContain(seed(id).person.name);
    }
  });

  it("違う事業所の本人・無い id は null（画面は 404）。協力事業所のケアマネはデモの本人を読めない", async () => {
    expect(await loadPersonPage(db, demoCm, PARTNER_PERSON)).toBeNull();
    expect(await loadPersonPage(db, demoCm, "p-nothing")).toBeNull();
    for (const id of ALL_IDS) expect(await loadPersonPage(db, partnerCm, id), id).toBeNull();
    expect((await loadPersonPage(db, partnerCm, PARTNER_PERSON))?.person.name).toBe("架空 太郎");
  });

  it("医療班・行政は受け持ち（T23）ができるまで誰も読めない", async () => {
    expect(await loadPersonPage(db, medical, "p-01")).toBeNull();
    expect(await loadPersonPage(db, { ...medical, role: "government" }, "p-01")).toBeNull();
  });

  it("経過の表の行と信号の色を読む", async () => {
    sqlite.exec(
      `INSERT INTO signals (id, person_id, color, source, occurred_at) VALUES ('s-1', 'p-01', 'red', 'self', '2026-11-04T01:00:00.000Z');
       INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, body, signal_id, occurred_at)
         VALUES ('t-1', 'p-01', NULL, 'self', 'signal', '赤ボタン', 's-1', '2026-11-04T01:00:00.000Z'),
                ('t-2', 'p-01', 'acct-yamamoto', 'care_manager', 'called', '本人に電話', NULL, '2026-11-04T01:05:00.000Z');`,
    );
    const rows = await loadPersonPage(db, demoCm, "p-01");
    const items = timelineItems(rows!);
    expect(items.slice(-2).map((t) => [t.kind, t.body, t.who, t.tone])).toEqual([
      ["安否", "赤ボタン", "本人", "urgent"],
      ["電話", "本人に電話", "ケアマネ 山本", null],
    ]);
  });
});

describe("情報を多く出す（作者 16:3x）", () => {
  it("上に大きく: 時計の残り（短い順、値の無い物は後ろ）と緊急連絡先（順番・電話）", () => {
    const v = viewOf("p-01");
    expect(v.head.clocks).toEqual([
      { id: "k-01-1", label: "酸素 内蔵電池", value: "2 時間", tone: "urgent" },
      { id: "k-01-2", label: "酸素 予備ボンベ", value: "8 時間", tone: "urgent" },
      { id: "k-01-3", label: "ワーファリン", value: null, tone: "check" },
    ]);
    expect(v.head.emergency.map((l) => l.map((s) => s.text).join(" "))).toEqual([
      "1 森 恵子 娘 090-0000-0011",
      "2 木村 ヨシ 隣人 090-0000-0012",
    ]);
    expect(viewOf("p-04").head.clocks).toEqual([]);
  });

  it("薬は 名前・回数・用量・残り（薬の時計）・保管、機器は 名前と電池・予備（同じ区分の時計）", () => {
    const meds = (id: string) => {
      const f = rowOf(viewOf(id), "medical.medications")!.field;
      return f.kind === "lines" ? f.lines.map((l) => l.map((s) => s.text).join(" ")) : [];
    };
    expect(meds("p-01")).toEqual(["ワーファリン 抗凝固薬 1 日 1 回 用量 未確認 残り 未確認 保管 未確認 中断注意"]);
    expect(meds("p-05")).toEqual(["ステロイド ステロイド 1 日 1 回 用量 未確認 残り 5 日 保管 未確認 中断注意"]);
    expect(meds("p-08")).toEqual(["インスリン インスリン 朝夕 用量 未確認 残り 4 日 保管 冷蔵庫 要冷蔵 中断注意"]);
    expect(meds("p-07")[0]).toContain("残り 7 日");

    const devices = (id: string) => {
      const f = rowOf(viewOf(id), "medical.devices")!.field;
      return f.kind === "lines" ? f.lines.map((l) => l.map((s) => s.text).join(" ")) : [];
    };
    expect(devices("p-01")).toEqual(["在宅酸素 酸素濃縮器 1 L/分 酸素 内蔵電池 2 時間 酸素 予備ボンベ 8 時間"]);
    expect(devices("p-02")).toEqual(["人工呼吸器 気管切開 人工呼吸器 内蔵電池 3 時間", "吸引 1 日 6 回 電池 未確認"]);
  });

  it("時計は 値・単位・起点・出典・確認の日", () => {
    expect(clocksOf(viewOf("p-01"))[0]).toMatchObject({
      label: "酸素 内蔵電池",
      value: "2 時間",
      start: "停電",
      source: "説明書",
      confirmed: "2026-11-02",
    });
    expect(clocksOf(viewOf("p-01"))[2]).toMatchObject({ label: "ワーファリン", confirmed: null, source: null });
  });

  it("連絡先は 役割・名前・電話と来られる時間（夜間）", () => {
    const people = textOf(viewOf("p-03"), "people");
    expect(people).toContain("田中 和子 妻 同居 夜間可");
    expect(people).toContain("田中 浩 長男 市内 車 夜間未確認 スマホ 090-0000-0016");
    expect(textOf(viewOf("p-01"), "people")).toContain("森 恵子 娘 市内 車 夜間未確認 スマホ 090-0000-0011");
  });

  it("台帳の項目は空でも行を出す（細かい物は小さく）", () => {
    for (const id of ALL_IDS) {
      const v = viewOf(id);
      for (const key of [
        "medical.history",
        "medical.vaccinations",
        "evacuation.route",
        "evacuation.barriers",
        "evacuation.pets",
        "care",
        "care.handbook",
        "care.intractableDisease",
        "notes",
      ]) {
        expect(rowOf(v, key), `${id} ${key}`).toBeDefined();
      }
      expect(rowOf(v, "medical.history")?.small).toBe(true);
      expect(rowOf(v, "basic.housing")?.small).toBeUndefined();
    }
    expect(textOf(viewOf("p-01"), "basic")).toContain("寝たきり なし 認知症 なし");
    expect(textOf(viewOf("p-02"), "basic")).toContain("聴覚 未確認");
  });
});

describe("入れる欄（T03）で足した欄と経過", () => {
  const rowText = (r: Row | undefined) =>
    r && r.field.kind === "lines" ? r.field.lines.map((l) => l.map((s) => s.text).join(" ")).join(" / ") : r?.field.kind;

  it("寝室・支援内容・タイムラインは避難、みまもり員は人の区分に出る。空なら未確認", () => {
    const p = seed("p-04");
    const ledger = {
      ...p.ledger,
      basic: { ...p.ledger.basic, housing: { ...p.ledger.basic.housing, bedroom: "1 階 奥の和室" } },
      evacuation: { ...p.ledger.evacuation, myTimeline: "app" as const, support: ["call" as const, "assist" as const], supportNote: "夜は娘" },
      local: { watcher: "春日 葉子" },
    };
    const v = toPersonView(seedRows({ ...p, ledger }), { today: TODAY });
    expect(rowText(rowOf(v, "basic.housing.bedroom"))).toBe("1 階 奥の和室");
    expect(rowText(rowOf(v, "evacuation.support"))).toBe("声掛け・移動介助 夜は娘");
    expect(rowText(rowOf(v, "evacuation.myTimeline"))).toBe("あり（アプリ）");
    expect(rowText(rowOf(v, "local.watcher"))).toBe("春日 葉子");
    expect(sectionOfField("local.watcher")).toBe("people");
    expect(sectionOfField("basic.housing.bedroom")).toBe("evacuation");
    const plain = viewOf("p-04");
    for (const k of ["basic.housing.bedroom", "evacuation.support", "evacuation.myTimeline", "local.watcher"]) {
      expect(rowOf(plain, k)?.field.kind, k).toBe("unconfirmed");
    }
  });

  it("入れる欄の保存（kind は note、payload の source が intake）は経過に「入力」と AI の印", () => {
    const entry = (ai: boolean) => ({
      id: `t-${ai}`,
      person_id: "p-04",
      author_id: "acct-yamamoto",
      author_role: "care_manager" as const,
      kind: "note" as const,
      body: "世帯・ハザード",
      payload: JSON.stringify({ source: "intake", ai, model: ai ? "claude-sonnet-5-5" : null, fields: ["basic.household"] }),
      signal_id: null,
      occurred_at: "2026-11-03T01:00:00.000Z",
      created_at: "2026-11-03T01:00:00.000Z",
      author_name: "山本",
      signal_color: null,
    });
    const items = timelineItems(seedRows(seed("p-04"), [entry(true), entry(false)])).filter((t) => !t.derived);
    expect(items.map((t) => [t.kind, t.ai ?? false])).toEqual([
      ["入力", true],
      ["入力", false],
    ]);
    const html = renderToStaticMarkup(createElement(PersonView, { view: toPersonView(seedRows(seed("p-04"), [entry(true)]), { today: TODAY }), level: 1 }));
    expect(html).toContain("data-ai");
  });
});
