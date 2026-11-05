// T45 のテスト: 本人のページの面の「編集」の変更の作り方（lib/intake/edit.ts）と、入れる欄・面の画面の形。
// 画面は react-dom/server で描く（マイクの対応の判定は描いたあとなので、サーバーの描画では「話す」が出ない＝対応していないブラウザと同じ）。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

import { Intake, LogBubble, splitSay, type LogEntry } from "../../components/person/Intake.tsx";
import { SectionEdit, SectionForm } from "../../components/person/SectionEdit.tsx";
import { SEED_AT, seedConsents, type SeedPerson } from "../../seed/people.ts";
import type { PersonPageRows } from "../person.ts";
import { speechRecognitionOf } from "../speech/dictation.ts";
import { dropConfirmText, REDACT_LABELS } from "../labels.ts";
import { dropKey, editChanges, editDraft, isEditSection, removalNames, toggled } from "./edit.ts";
import { intakePropsOf } from "./props.ts";
import type { DiffItem } from "./diff.ts";
// T142 で種の台帳を埋めた。このテストは空いた欄を前提にするので、T142 より前の空きの多い形（seed/sparse.ts）を使う
import { SPARSE_PEOPLE } from "../../seed/sparse.ts";

const seed = (id: string) => SPARSE_PEOPLE.find((p) => p.person.id === id)!;

function seedRows(p: SeedPerson): PersonPageRows {
  return {
    person: { ...p.person, ledger: JSON.stringify(p.ledger), created_at: SEED_AT, updated_at: SEED_AT, version: 1 },
    careManagerName: "山本",
    contacts: p.contacts.map((c, i) => ({ ...c, person_id: p.person.id, sort: i })),
    consents: seedConsents(p).map((c) => ({ ...c, recorded_by_name: "山本", recorded_by_role: "care_manager" as const })),
    clocks: p.clocks.map((k, i) => ({ ...k, person_id: p.person.id, sort: i })),
    timeline: [],
  };
}

const editOf = (id: string) => intakePropsOf(seedRows(seed(id)), false).edit;

describe("面の編集の変更（lib/intake/edit.ts）", () => {
  it("何も直さなければ、どの面も変更は 0", () => {
    for (const p of SPARSE_PEOPLE) {
      const d = intakePropsOf(seedRows(p), false).edit;
      for (const s of ["medical", "evacuation", "people", "basic", "consent"] as const) expect(editChanges(s, d, editDraft(d)), `${p.person.id} ${s}`).toEqual([]);
    }
  });

  it("医療: 埋まった欄・薬・機器・時計は上書き、頼り先の確認も。直した面の物だけ", () => {
    const d = editOf("p-01");
    const draft = editDraft(d);
    draft.values["medical.allergies"] = "卵、そば";
    draft.values["evacuation.pets"] = "猫"; // 避難の面の欄 → 医療の面の保存には入らない
    draft.meds[0] = { ...draft.meds[0], amount: "1 錠", schedule: "" };
    draft.devices[0] = { ...draft.devices[0], detail: "酸素濃縮器 2 L/分" };
    draft.clocks = draft.clocks.map((k) => (k.id === "k-01-1" ? { ...k, value: "３" } : k));
    draft.newMeds = [{ name: "降圧薬", category: "other", schedule: "", amount: "", storage: "" }];
    expect(editChanges("medical", d, draft)).toEqual([
      { t: "field", key: "medical.allergies", value: ["卵", "そば"], overwrite: true },
      { t: "medication", index: 0, value: { name: "ワーファリン", category: "anticoagulant", schedule: "", amount: "1 錠", storage: "" }, overwrite: true },
      { t: "medication", value: { name: "降圧薬", category: "other" } },
      { t: "device", value: { kind: "oxygen", detail: "酸素濃縮器 2 L/分", schedule: "" }, overwrite: true },
      { t: "clock", clockId: "k-01-1", medIndex: null, label: "酸素 内蔵電池", value: 3, unit: "hour", overwrite: true },
    ]);
    // 透析先の確認（p-03 の時計は頼り先あり）
    const d3 = editOf("p-03");
    const draft3 = editDraft(d3);
    draft3.checks["k-03-1"] = "confirmed";
    expect(editChanges("medical", d3, draft3)).toEqual([{ t: "clockCheck", clockId: "k-03-1", to: "confirmed" }]);
  });

  it("人: 連絡先は直した所だけ（空にすると消す・夜間は未確認に戻せる）、足す連絡先は書いた所だけ", () => {
    const d = editOf("p-04");
    const draft = editDraft(d);
    expect(draft.contacts.map((c) => c.id)).toEqual(["c-04-0", "c-04-1", "c-04-2"]); // 本人の電話の行も出す（T68。電話と備考だけを直す）
    draft.contacts[2] = { ...draft.contacts[2], phone: "090-0000-0099", note: "", night: "yes" };
    draft.newContacts = [
      { id: null, kind: "supporter", relation: "隣人", name: "", phone: "", night: "no", note: "", emergency: "", supporter: "", reach: "" },
      { id: null, kind: "family", relation: "", name: "", phone: "", night: "", note: "", emergency: "", supporter: "", reach: "" }, // 空 → 送らない
    ];
    expect(editChanges("people", d, draft)).toEqual([
      { t: "contact", id: "c-04-2", value: { kind: "family", phone: "090-0000-0099", nightOk: true }, overwrite: true },
      { t: "contact", id: null, value: { kind: "supporter", relation: "隣人", nightOk: false } },
    ]);
  });

  it("避難・基本・同意: 埋まった欄を空にしたら外す、ハザードの深さ、特記の書き足し、同意の変更", () => {
    const d = editOf("p-01");
    const draft = editDraft(d);
    draft.values["evacuation.destination1"] = " "; // 埋まった欄を空にした → 外す
    draft.values["evacuation.pets"] = ""; // もとから空 → 送らない
    draft.values["evacuation.transport"] = "家族の車";
    draft.hazards[0] = { ...draft.hazards[0], depth: "1.5" };
    draft.newHazards = ["landslide"];
    expect(editChanges("evacuation", d, draft)).toEqual([
      { t: "remove", target: { what: "field", key: "evacuation.destination1" } },
      { t: "field", key: "evacuation.transport", value: "家族の車", overwrite: true },
      { t: "hazard", value: { kind: "flood", depthM: 1.5 }, overwrite: true },
      { t: "hazard", value: { kind: "landslide" } },
    ]);
    draft.note = " 夜は眠れないと言う ";
    draft.values["care.careLevel"] = "care5";
    expect(editChanges("basic", d, draft)).toEqual([
      { t: "field", key: "care.careLevel", value: "care5", overwrite: true },
      { t: "note", value: "夜は眠れないと言う" },
    ]);
    draft.consents.medical = "refused";
    expect(editChanges("consent", d, draft)).toEqual([{ t: "consent", kind: "medical", status: "refused" }]);
  });

  it("外す: 印を付けた行は外す変更だけ（ほかの直しは送らない）。外す薬・機器の時計の直しも送らない。名前は確認の窓の文に", () => {
    const d = editOf("p-01");
    const draft = editDraft(d);
    draft.meds[0] = { ...draft.meds[0], amount: "2 錠" }; // 外す行の直し → 送らない
    draft.clocks = draft.clocks.map((k) => (k.id === "k-01-1" ? { ...k, value: "5" } : k)); // 外す機器の時計 → 送らない
    draft.drops = [dropKey.med(0), dropKey.device("oxygen")];
    const medical = editChanges("medical", d, draft);
    expect(medical).toEqual([
      { t: "remove", target: { what: "medication", index: 0, name: "ワーファリン" } },
      { t: "remove", target: { what: "device", kind: "oxygen" } },
    ]);
    expect(removalNames(medical, d)).toEqual(["ワーファリン", "在宅酸素"]);

    draft.drops = [dropKey.hazard("flood"), dropKey.note(0), dropKey.contact("c-01-2")];
    expect(editChanges("evacuation", d, draft)).toEqual([{ t: "remove", target: { what: "hazard", kind: "flood" } }]);
    expect(editChanges("basic", d, draft)).toEqual([{ t: "remove", target: { what: "note", value: "薬は 2 階の箪笥" } }]);
    const people = editChanges("people", d, draft);
    expect(people).toEqual([{ t: "remove", target: { what: "contact", id: "c-01-2" } }]);
    expect(removalNames(people, d)).toEqual(["隣人"]);
    // 印は付け外しできる
    expect(toggled(toggled([], "note:0"), "note:0")).toEqual([]);
  });

  it("値確認: 値を変えずに確かめた時計だけ clockSeen。値を直した時計は直しの方、値の無い時計は送らない", () => {
    const d = editOf("p-01");
    expect(d.clocks.find((k) => k.id === "k-01-1")?.confirmed_at).toBe("2026-11-02T03:00:00.000Z");
    const draft = editDraft(d);
    draft.seen = ["k-01-1", "k-01-2", "k-01-3"];
    draft.clocks = draft.clocks.map((k) => (k.id === "k-01-2" ? { ...k, value: "6" } : k));
    expect(editChanges("medical", d, draft)).toEqual([
      { t: "clockSeen", clockId: "k-01-1" },
      { t: "clock", clockId: "k-01-2", medIndex: null, label: "酸素 予備ボンベ", value: 6, unit: "hour", overwrite: true },
    ]);
  });

  it("書類と経過の面は編集しない", () => {
    expect(["medical", "evacuation", "people", "basic", "consent"].every(isEditSection)).toBe(true);
    expect(isEditSection("documents")).toBe(false);
    expect(isEditSection("timeline")).toBe(false);
  });
});

describe("入れる欄の画面（components/person/Intake.tsx、T45）", () => {
  const html = (id = "p-04", aiReady = true) => renderToStaticMarkup(createElement(Intake, { ...intakePropsOf(seedRows(seed(id)), aiReady), level: 1 }));

  it("AI 専用の欄: 文字の欄・写真と PDF・分ける。手入力のタブは無い。問いは何を・なぜ・例と残りの数", () => {
    const h = html();
    expect(h).toContain('data-intake="text"');
    expect(h).toContain('data-intake="read"');
    expect(h).toContain("写真・PDF 読取");
    expect(h).toContain('data-intake="split"');
    expect(h).toMatch(/<button[^>]*data-intake="split"[^>]*>(?:(?!<\/button>)[\s\S])*入力<\/button>/);
    expect(h).not.toContain("分ける");
    expect(h).toContain("AI 入力");
    expect(h).not.toContain("手入力");
    expect(h).not.toContain('role="tablist"');
    const q = intakePropsOf(seedRows(seed("p-04")), true).queue[0];
    expect(h).toContain(q.text);
    expect(h).toContain(q.why);
    expect(h).toContain(q.example);
    expect(h).toMatch(/残り \d+ 問/);
    // 内側で送る箱を作らない
    expect(h).not.toMatch(/overflow-(y-)?(auto|scroll)/);
  });

  it("マイクの無いブラウザ（Web Speech が無い）では「話す」を出さない", () => {
    expect(speechRecognitionOf({})).toBeNull();
    expect(html()).not.toContain('data-intake="speak"');
  });

  it("AI の状態（T76）: 未設定・上限到達は中立の地の印（要確認の黄の塗りでない）、使えるときは本日残り。言葉は訓練の画面と同じ", () => {
    const draw = (ai: Parameters<typeof intakePropsOf>[1]) => renderToStaticMarkup(createElement(Intake, { ...intakePropsOf(seedRows(seed("p-04")), ai), level: 1 }));
    const unset = draw({ kind: "unset" });
    expect(unset).toContain("AI 未設定");
    expect(unset).not.toMatch(/data-tone="check"[^<]*>AI 未設定/);
    expect(unset).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*data-intake="split"/);
    const limit = draw({ kind: "limit", limit: 200 });
    expect(limit).toContain("AI 上限到達");
    expect(limit).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*data-intake="split"/);
    expect(limit).toMatch(/<label(?=[^>]*data-intake="read")(?=[^>]*aria-disabled="true")[^>]*>/);
    // 使える: 写真と PDF を押せる（分けるは文字が無いので押せないまま）
    const ready = draw({ kind: "ready", remaining: 37, limit: 200 });
    expect(ready).toContain("AI 本日残り 37 / 200 回");
    expect(ready).not.toMatch(/<label(?=[^>]*data-intake="read")(?=[^>]*aria-disabled="true")[^>]*>/);
  });

  it("AI 未設定: 分ける・写真と PDF は押せず、問いには答えられる", () => {
    const h = html("p-04", false);
    expect(h).toContain("AI 未設定");
    expect(h).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*data-intake="split"/);
    expect(h).toContain('data-intake="question"');
  });

  it("会話の流れ: AI の言った事は AI の印、数は区分ごと。保存は吹き出しの中の「保存済」で、保存の行は作らない（T138）", () => {
    const items = [
      { section: "medical", change: { t: "note", value: "x" } },
      { section: "medical", change: { t: "note", value: "y" } },
      { section: "evacuation", change: { t: "note", value: "z" } },
      { section: "basic", change: null },
    ] as unknown as DiffItem[];
    expect(splitSay(items)).toBe("3 項目を見つけました（医療 2・避難 1）");
    expect(splitSay([])).toBe("本人のページに入る事は見つかりませんでした");
    const props = intakePropsOf(seedRows(seed("p-04")), true);
    const render = (entry: LogEntry) =>
      renderToStaticMarkup(
        createElement(LogBubble, { entry, props, busy: false, aiReady: true, onRows: () => {}, onSave: async () => {}, onDiscard: () => {}, onRetry: () => {} }),
      );
    const split = render({ id: "1", who: "ai", kind: "split", say: splitSay(items), proposal: { model: "claude-sonnet-5-5", dropped: 0, rows: [] }, state: "saved" });
    expect(split).toContain('data-ai=""');
    expect(split).toContain("3 項目を見つけました（医療 2・避難 1）");
    expect(split).toMatch(/data-intake="state"[^>]*>保存済</);
    const q = props.queue[0];
    const asked = render({ id: "2", who: "ask", q });
    expect(asked).toContain(q.text);
    expect(asked).not.toContain('data-ai=""'); // 問いは定型（Claude の出力でない）
    // 問いの答えの保存も、答えの吹き出しの中の小さな状態
    const answered = render({ id: "3", who: "you", text: "1 回 1 錠", state: "saved" });
    expect(answered).toContain("1 回 1 錠");
    expect(answered).toMatch(/data-intake="state"[^>]*>保存済</);
    expect(answered).not.toContain("件を保存しました");
  });
});

describe("面の編集の画面（components/person/SectionEdit.tsx、T45）", () => {
  it("面の右上に「編集」。押す前は読む側の中身をそのまま出す", () => {
    const h = renderToStaticMarkup(
      createElement(SectionEdit, { section: "medical", data: editOf("p-01"), head: createElement("h2", null, "医療"), children: createElement("p", null, "読む側") }),
    );
    expect(h).toContain('data-edit-open="medical"');
    expect(h).toContain("編集");
    expect(h).toContain("読む側");
  });

  it("医療の面の入力欄: 薬・機器・時計の値と単位、頼り先のある時計には確認のボタン", () => {
    const d = editOf("p-03");
    const h = renderToStaticMarkup(createElement(SectionForm, { section: "medical", data: d, draft: editDraft(d), set: () => {} }));
    expect(h).toContain('data-clock="k-03-1"');
    expect(h).toContain('data-clock-check="k-03-1"');
    expect(h).toContain("透析先");
    expect(h).toContain("未確認");
    const consent = renderToStaticMarkup(createElement(SectionForm, { section: "consent", data: d, draft: editDraft(d), set: () => {} }));
    expect(consent).toContain('data-consent="medical"');
  });
});

describe("面の編集の外す・値確認（components/person/SectionEdit.tsx、T45）", () => {
  const form = (section: "medical" | "evacuation" | "people" | "basic", id: string, patch: Partial<ReturnType<typeof editDraft>> = {}) => {
    const d = editOf(id);
    return renderToStaticMarkup(createElement(SectionForm, { section, data: d, draft: { ...editDraft(d), ...patch }, set: () => {} }));
  };

  it("薬・機器・ハザード・連絡先・特記の行に「外す」（本人の行にも。T68 の続き）。印を付けた行は「外す予定」と「戻す」", () => {
    expect(form("medical", "p-01")).toContain('aria-label="ワーファリン 外す"');
    expect(form("medical", "p-01")).toContain('aria-label="在宅酸素 外す"');
    expect(form("evacuation", "p-01")).toMatch(/aria-label="[^"]+ 外す"/);
    const people = form("people", "p-01");
    expect(people.match(/data-drop="true"/g)).toHaveLength(3); // c-01-0（本人、T68 の続きから外せる）・c-01-1・c-01-2
    expect(form("basic", "p-01")).toContain('aria-label="特記 外す"');
    const dropped = form("medical", "p-01", { drops: [dropKey.med(0)] });
    expect(dropped).toContain("data-dropped");
    expect(dropped).toContain("外す予定");
    expect(dropped).toContain("戻す");
    expect(dropped).not.toContain('aria-label="ワーファリン 回数"');
  });

  it("値の入った時計に確認日と「値確認」。押すと「本日確認」。値の無い時計には出さない", () => {
    const h = form("medical", "p-01");
    expect(h).toContain('data-clock-seen="k-01-1"');
    expect(h).toContain("2026-11-02");
    expect(h).toContain("値確認");
    expect(h).not.toContain('data-clock-seen="k-01-3"');
    expect(form("medical", "p-01", { seen: ["k-01-1"] })).toContain("本日確認");
  });

  it("確認の窓の文: 外す物の名前と数。写真・PDF は読む前の注意の窓をやめ、黒塗りの画面（T52）の言葉に", () => {
    expect(dropConfirmText(["ワーファリン", "隣人"])).toBe("ワーファリン・隣人 の 2 件を外します。経過に「ケアマネが外した」と残ります。");
    // 塗る物に生年月日・保険者番号を足した（T52 の問い 4。T54）
    expect(REDACT_LABELS.what).toBe("氏名・住所・電話・町名・生年月日・保険者番号");
    // 塗らずに送る確かめの窓は共通の部品で、題とボタンは 2〜4 字（T83、見直しの安全 中 5）
    expect([REDACT_LABELS.noneTitle, REDACT_LABELS.noneOk, REDACT_LABELS.noneBack]).toEqual(["塗り無し", "送信", "戻る"]);
    for (const w of [REDACT_LABELS.noneTitle, REDACT_LABELS.noneOk, REDACT_LABELS.noneBack]) {
      expect(w.length, w).toBeGreaterThanOrEqual(2);
      expect(w.length, w).toBeLessThanOrEqual(4);
      expect(w).not.toMatch(/[をがのは]/);
    }
    for (const w of ["診断", "判定"]) expect(JSON.stringify(REDACT_LABELS)).not.toContain(w);
  });
});
