// T143: 本人のページの経過を 2 つに分ける（人が書き足す記録と台帳を直した跡）、変更履歴の分かる 1 行、保存で残す前と後の値と見る人の範囲。
// D1 は node:sqlite（lib/db/test-d1.ts）に種の 10 人。この作業は Claude を呼ばない。種の台帳の値には寄らない（T142 が種を埋めている）。

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { scopeOfRows } from "../consent/scope.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import type { IntakePayload, TimelineEntryRow } from "../db/types.ts";
import type { IntakeChange } from "../intake/changes.ts";
import { changeDiff, DIFF_TEXT_MAX, type RecordState } from "../intake/change-diff.ts";
import { saveIntake, timelineBody, type SaveRequest } from "../intake/save.ts";
import { parseLedger } from "../db/ledger.ts";
import { loadPersonPage, timelineItems, toPersonView, type TimelineItem } from "../person.ts";
import { PHONE_LINK_SOURCE } from "../qr/phone-link-store.ts";
import { consentLine, historyLine, intakeLine, isHistoryRow, PHONE_LINK_HISTORY_SOURCE } from "./history.ts";

const SONNET = "claude-sonnet-5-5";
const row = (kind: TimelineEntryRow["kind"], payload: object | null = null) => ({ kind, payload: payload ? JSON.stringify(payload) : null });

describe("経過と変更履歴の分け方（isHistoryRow）", () => {
  it("人が書き足す記録・連絡・安否・医療・受け持ちは経過", () => {
    for (const k of ["signal", "called", "pickup", "safety_check", "examined", "medication_given", "transported", "arrived_shelter", "received", "released", "override"] as const) {
      expect(isHistoryRow(row(k)), k).toBe(false);
    }
    // 自由文の記録・録音の分類とその直し・QR の閲覧・受け持ちの行
    expect(isHistoryRow(row("note"))).toBe(false);
    for (const source of ["classify", "class_edit", "summary_edit", "memo_edit", "qr_view"]) expect(isHistoryRow(row("note", { source })), source).toBe(false);
    expect(isHistoryRow(row("received", { source: "custody", custodyId: "c" }))).toBe(false);
  });

  it("台帳を直した跡（入れる欄の保存・同意・時計の確認・本人の報告の印・事業所の操作・スマホ入口）は変更履歴", () => {
    for (const k of ["consent", "clock_check", "self_report_mark"] as const) expect(isHistoryRow(row(k)), k).toBe(true);
    for (const source of ["intake", "office", "phone_link"]) expect(isHistoryRow(row("note", { source })), source).toBe(true);
  });

  it("スマホ入口の出どころは lib/qr/phone-link-store.ts と同じ字", () => {
    expect(PHONE_LINK_HISTORY_SOURCE).toBe(PHONE_LINK_SOURCE);
  });
});

describe("変更履歴の 1 行（台帳の本文は変えずに言い換える）", () => {
  it("手入力・AI の分け方・手で直した・外した・値を確かめた", () => {
    expect(intakeLine(timelineBody(false, ["medical.history"]), null)).toBe("既往を手で入力");
    expect(intakeLine(timelineBody(true, ["medical.allergies", "clocks.k-1"]), null)).toBe("AI が読んだアレルギー・時計を確かめて保存");
    expect(intakeLine("ケアマネが直した: ペット。ケアマネが外した: 特記", null)).toBe("ペットを手で修正。特記を外した");
    expect(intakeLine("ケアマネが確認した: 時計", null)).toBe("時計の値を確かめた");
    expect(intakeLine(timelineBody(false, [], [{ field: "medical.medications.0.amount", status: "unknown" }]), null)).toBe("薬（不明）を手で入力");
  });

  it("写真・PDF の頭も同じ言い方に", () => {
    const photo = { source: "photo", page: 1, redacted: 3 } as const;
    expect(intakeLine(timelineBody(true, ["medical.history"], [], false, { read: photo }), { read: photo })).toBe(
      "写真から AI が読んだ既往を確かめて保存（隠した所 3 か所）",
    );
    const pdf = { source: "pdf", page: 2, redacted: 0 } as const;
    expect(intakeLine(timelineBody(true, ["basic.household"], [], false, { read: pdf }), { read: pdf })).toBe(
      "PDF の 2 頁目から AI が読んだ世帯を確かめて保存（隠した所 0 か所）",
    );
  });

  it("10 を超える欄は「ほか N 欄」、頭の分からない本文はそのまま", () => {
    const many = Array.from({ length: 12 }, (_, i) => `clocks.k-${i}`).concat(["medical.history", "basic.household"]);
    // 同じ名前（時計）は 1 つにまとまる
    expect(intakeLine(timelineBody(false, many), null)).toBe("時計・既往・世帯を手で入力");
    expect(intakeLine("手入力: 世帯・既往・特記・薬・機器・連絡先・時計・同意・住所・位置 ほか 2", null)).toBe(
      "世帯・既往・特記・薬・機器・連絡先・時計・同意・住所・位置 ほか 2 欄を手で入力",
    );
    expect(intakeLine("前の形の本文", null)).toBe("前の形の本文");
  });

  it("同意は「同意 5 つ（…）」の 1 行、不同意は分けて", () => {
    const all = (["registry", "plan_share", "supporters", "medical", "ai_overseas"] as const).map((kind) => ({ kind, status: "granted" as const }));
    expect(consentLine(all)).toBe("同意 5 つ（名簿登録・計画共有・支援者提供・医療班提供・AI 提供）");
    expect(consentLine(all.map((c) => (c.kind === "supporters" ? { ...c, status: "refused" as const } : c)))).toBe(
      "同意 4 つ（名簿登録・計画共有・医療班提供・AI 提供）、不同意 1 つ（支援者提供）",
    );
  });

  it("ほかの変更履歴の行は種類と本文（本文だけで分かる物は本文）", () => {
    expect(historyLine({ ...row("note", { source: "office", action: "assigned" }), body: "担当 山本 → 佐藤" }, "担当変更").line).toBe("担当変更 担当 山本 → 佐藤");
    expect(historyLine({ ...row("self_report_mark", {}), body: "本人の報告を当てにしない印を付けた" }, "印変更").line).toBe(
      "本人の報告を当てにしない印を付けた",
    );
    expect(historyLine({ ...row("note", { source: "phone_link", generation: 1 }), body: "スマホ入口 発行" }, "記録").line).toBe("スマホ入口 発行");
  });
});

describe("前と後の値（lib/intake/change-diff.ts）", () => {
  const empty = (): RecordState => ({ ledger: parseLedger("{}"), contacts: [], clocks: [], consents: [] });

  it("変わった欄だけ、足した物は前が空、外した物は後が空。位置は値を出さない", () => {
    const a = empty();
    const b = empty();
    b.ledger = { ...b.ledger, medical: { ...b.ledger.medical, history: ["高血圧", "心不全"], allergies: [] } };
    a.ledger = { ...a.ledger, medical: { ...a.ledger.medical, history: ["高血圧"] } };
    b.ledger = { ...b.ledger, basic: { ...b.ledger.basic, location: { lat: 33.8, lng: 132.7 } } };
    b.consents = [{ kind: "medical", status: "refused" }];
    a.consents = [{ kind: "medical", status: "granted" }];
    const d = changeDiff(a, b);
    expect(d).toEqual([
      { key: "medical.allergies", section: "medical", label: "アレルギー", before: null, after: "なし" },
      { key: "medical.history", section: "medical", label: "既往", before: "高血圧", after: "高血圧・心不全" },
      { key: "basic.location", section: "address", label: "位置", before: null, after: null },
      { key: "consent.medical", section: "consent", label: "医療班提供", before: "同意", after: "不同意" },
    ]);
    expect(JSON.stringify(d)).not.toContain("33.8");
  });

  it("長い値は切る", () => {
    const b = empty();
    b.ledger = { ...b.ledger, notes: ["あ".repeat(300)] };
    const [n] = changeDiff(empty(), b);
    expect(n.after!.length).toBe(DIFF_TEXT_MAX + 1);
  });
});

describe("保存で前と後を残し、見る人の範囲で絞って出す", () => {
  let sqlite: DatabaseSync;
  let db: ReturnType<typeof d1FromSqlite>;
  const cm: Principal = {
    role: "care_manager",
    judge: false,
    admin: true,
    accountId: "acct-yamamoto",
    displayName: "山本",
    office: { id: "office-demo", name: "デモ事業所", kind: "demo" },
    caseloadOf: "acct-yamamoto",
    personId: null,
    contactId: null,
  };
  const NOW = new Date("2026-11-06T01:00:00.000Z");
  beforeEach(() => {
    sqlite = migratedSqlite();
    for (const s of seedStatements()) sqlite.exec(s);
    db = d1FromSqlite(sqlite);
  });
  afterEach(() => sqlite.close());

  const version = (id: string) => (sqlite.prepare("SELECT version FROM people WHERE id = ?").get(id) as { version: number }).version;
  const save = (id: string, changes: IntakeChange[], over: Partial<SaveRequest> = {}) =>
    saveIntake(db, cm, { personId: id, version: version(id), ai: null, changes, ...over } as SaveRequest, NOW);
  const lastPayload = (id: string) =>
    JSON.parse(
      (sqlite.prepare("SELECT payload FROM timeline_entries WHERE person_id = ? ORDER BY occurred_at DESC, rowid DESC LIMIT 1").get(id) as { payload: string })
        .payload,
    ) as IntakePayload;
  const historyOf = (items: TimelineItem[]) => items.filter((t) => t.history);

  it("手で直した保存は欄・連絡先・同意の前と後を payload に持つ（D1 の本文は今の形のまま）", async () => {
    const rows = (await loadPersonPage(db, cm, "p-04"))!;
    const was = parseLedger(rows.person.ledger).medical.history;
    const r = await save(
      "p-04",
      [
        { t: "field", key: "medical.history", value: ["高血圧", "心不全"], overwrite: true },
        { t: "field", key: "basic.household", value: "alone", overwrite: true },
        { t: "contact", id: null, value: { kind: "family", relation: "長男", name: "架空 一郎", phone: "090-0000-0099" } },
        { t: "consent", kind: "supporters", status: "refused" },
      ] as IntakeChange[],
      { edit: true },
    );
    expect(r.ok).toBe(true);
    const p = lastPayload("p-04");
    const by = new Map((p.diff ?? []).map((d) => [d.key, d]));
    expect(by.get("medical.history")).toMatchObject({ section: "medical", label: "既往", after: "高血圧・心不全" });
    expect(by.get("medical.history")!.before).toBe(was && was.length > 0 ? was.join("・") : was ? "なし" : null);
    expect([...by.values()].find((d) => d.key.startsWith("contacts."))).toMatchObject({ section: "people", label: "連絡先 長男", before: null });
    expect(by.get("consent.supporters")).toMatchObject({ section: "consent", after: "不同意" });
    // 本文は今の形（「ケアマネが直した: 〜」）。画面の 1 行は言い換える
    const items = timelineItems((await loadPersonPage(db, cm, "p-04"))!);
    const h = historyOf(items).at(-1)!;
    expect(h.body).toMatch(/^ケアマネが直した: /);
    expect(h.history!.line).toMatch(/を手で修正$/);
  });

  it("医療班の範囲では、人（全部）・基本・同意の前と後を出さず、医療・避難は出す", async () => {
    await save(
      "p-04",
      [
        { t: "field", key: "medical.history", value: ["高血圧", "心不全"], overwrite: true },
        { t: "field", key: "evacuation.pets", value: "犬", overwrite: true },
        { t: "field", key: "care.handbook", value: "架空の手帳 2 級", overwrite: true },
        { t: "contact", id: null, value: { kind: "family", relation: "長男", name: "架空 一郎", phone: "090-0000-0099" } },
        { t: "consent", kind: "registry", status: "refused" },
      ] as IntakeChange[],
      { edit: true },
    );
    const rows = (await loadPersonPage(db, cm, "p-04"))!;
    const itemsOf = (role: "care_manager" | "medical") =>
      toPersonView(rows, { today: "2026-11-06", scope: scopeOfRows(role, rows) })
        .sections.find((s) => s.id === "timeline")!
        .blocks.flatMap((b) => (b.type === "timeline" ? b.items : []));
    const sectionsOf = (items: TimelineItem[]) => new Set(historyOf(items).flatMap((t) => (t.history!.diff ?? []).map((d) => d.section)));
    expect([...sectionsOf(itemsOf("care_manager"))].sort()).toEqual(["basic", "consent", "evacuation", "medical", "people"]);
    const med = sectionsOf(itemsOf("medical"));
    expect(med.has("medical")).toBe(true);
    expect(med.has("evacuation")).toBe(true);
    for (const s of ["people", "basic", "consent"] as const) expect(med.has(s), s).toBe(false);
    expect(JSON.stringify(itemsOf("medical"))).not.toContain("架空 一郎");
  });

  it("timelineItems の古い順・全部と kind・body は今どおり（変更履歴の行に history を足すだけ）", async () => {
    await save("p-04", [{ t: "field", key: "medical.history", value: ["高血圧"], overwrite: true }] as IntakeChange[], { edit: true });
    const items = timelineItems((await loadPersonPage(db, cm, "p-04"))!);
    const times = items.map((t) => Date.parse(t.at));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    // 台帳作成・同意（種から作る行）と入れる欄の保存は変更履歴、kind・body は前の言葉のまま
    expect(items.find((t) => t.body === "台帳作成")).toMatchObject({ kind: "入力", history: { line: "台帳作成", diff: null } });
    const consent = items.find((t) => t.kind === "同意" && t.derived);
    if (consent) expect(consent.history!.line).toMatch(/^(同意|不同意) \d つ（/);
    expect(items.filter((t) => !t.history).every((t) => !t.consent)).toBe(true);
  });

  it("AI の分け方の保存の行は AI の印のまま、言い換えた 1 行", async () => {
    await saveIntake(
      db,
      cm,
      { personId: "p-04", version: version("p-04"), ai: { model: SONNET }, changes: [{ t: "note", value: "床ずれに注意" }] } as SaveRequest,
      NOW,
    );
    const items = timelineItems((await loadPersonPage(db, cm, "p-04"))!);
    const h = historyOf(items).at(-1)!;
    expect(h.ai).toBe(true);
    expect(h.history!.line).toBe("AI が読んだ特記を確かめて保存");
    expect(h.history!.diff).toHaveLength(1);
    expect(h.history!.diff![0]).toMatchObject({ key: "notes", section: "basic", label: "特記", after: expect.stringContaining("床ずれに注意") });
  });
});
