// T150: 選ぶ問いに補足の文字。選んだ値と打った文を両方台帳に（書き足しの欄があればそこ、無ければ特記へ欄の名前を頭に）。
// 問いの部品（components/person/IntakeQuestion.tsx）は本人のページの AI 入力と書類の紙の質問の両方で同じ物。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IntakeQuestion } from "../../components/person/IntakeQuestion.tsx";
import { SEED_AT, SEED_PEOPLE, seedConsents, type SeedPerson } from "../../seed/people.ts";
import { applyLedgerChanges, parseLedger } from "../db/ledger.ts";
import type { Ledger } from "../db/types.ts";
import type { PersonPageRows } from "../person.ts";
import { answerChanges, NOTE_MAX, noteChange } from "./answer.ts";
import { questionQueue, type Question } from "./ask.ts";
import { INTAKE_FIELDS } from "./fields.ts";

const seed = (id: string) => SEED_PEOPLE.find((p) => p.person.id === id)!;

function rowsOf(p: SeedPerson, ledger: Ledger = p.ledger): PersonPageRows {
  return {
    person: { ...p.person, ledger: JSON.stringify(ledger), created_at: SEED_AT, updated_at: SEED_AT, version: 1 },
    careManagerName: "山本",
    contacts: p.contacts.map((c, i) => ({ ...c, person_id: p.person.id, sort: i })),
    consents: seedConsents(p).map((c) => ({ ...c, recorded_by_name: "山本", recorded_by_role: "care_manager" as const })),
    clocks: p.clocks.map((k, i) => ({ ...k, person_id: p.person.id, sort: i })),
    timeline: [],
  };
}

/** 種の佐藤 キミ（p-04）の台帳から、選ぶ欄をいくつか空けた物 */
function emptied(over: (l: Ledger) => void = () => undefined): Ledger {
  const l = structuredClone(seed("p-04").ledger);
  delete l.evacuation.transportKind;
  delete l.evacuation.transport;
  delete l.evacuation.support;
  delete l.evacuation.supportNote;
  delete l.basic.household;
  delete l.basic.householdNote;
  delete l.care.walking;
  l.pending = [];
  over(l);
  return l;
}

/** 夜間支援の問いを出すため、佐藤の連絡先の夜間を未確認に戻した種（T142 で種に夜間可が入ったので） */
function noNight(p: ReturnType<typeof seed>): ReturnType<typeof seed> {
  return { ...p, contacts: p.contacts.map((c) => ({ ...c, night_ok: null })) };
}

const ask = (ledger: Ledger, key: string, p = noNight(seed("p-04"))): Question => {
  const q = questionQueue(rowsOf(p, ledger)).find((x) => x.key === key || (x.answer.kind === "choice" && x.answer.field === key));
  if (!q) throw new Error(`問いが無い: ${key}`);
  return q;
};

describe("選ぶ問いの補足の行き先（lib/intake/ask.ts の note）", () => {
  it("書き足しの欄を持つ欄（手段・支援内容・世帯）は、その欄が空ならそこを渡す。ほかの欄は null（特記へ）", () => {
    const l = emptied();
    const note = (key: string) => {
      const a = ask(l, key).answer;
      return a.kind === "choice" ? a.note : "no-choice";
    };
    expect(note("evacuation.transportKind")).toBe("evacuation.transport");
    expect(note("evacuation.support")).toBe("evacuation.supportNote");
    expect(note("basic.household")).toBe("basic.householdNote");
    expect(note("care.walking")).toBeNull();
  });

  it("書き足しの欄がもう埋まっていれば渡さない（上書きしないので特記へ）", () => {
    const l = emptied((x) => {
      x.evacuation.supportNote = "前からの書き足し";
      x.basic.householdNote = "近くに長女";
    });
    const a = ask(l, "evacuation.support").answer;
    const h = ask(l, "basic.household").answer;
    expect(a.kind === "choice" && a.note).toBeNull();
    expect(h.kind === "choice" && h.note).toBeNull();
  });

  it("欄の表の note は全部、表にある文字の欄を指す", () => {
    for (const f of INTAKE_FIELDS.filter((x) => x.note)) {
      const n = INTAKE_FIELDS.find((x) => x.key === f.note);
      expect(n?.shape.type, f.key).toBe("text");
      expect(n?.section, f.key).toBe(f.section);
    }
  });
});

describe("答え → 変更（lib/intake/answer.ts）: 選んだ値と補足を両方", () => {
  it("1 つ選ぶ問い + 補足（書き足しの欄なし）は、欄の値と特記（欄の名前を頭に）", () => {
    const q = ask(emptied(), "care.walking");
    expect(answerChanges(q, { kind: "choice", values: ["some"], note: " 杖で家の中は  歩ける " })).toEqual([
      { t: "field", key: "care.walking", value: "some" },
      { t: "note", value: "歩行: 杖で家の中は 歩ける" },
    ]);
  });

  it("書き足しの欄のある問いは、その欄へ（手段 → 手段補記、いくつでも選ぶ支援内容 → 支援補記）", () => {
    const l = emptied();
    expect(answerChanges(ask(l, "evacuation.transportKind"), { kind: "choice", values: ["other"], note: "長男の軽トラ" })).toEqual([
      { t: "field", key: "evacuation.transportKind", value: "other" },
      { t: "field", key: "evacuation.transport", value: "長男の軽トラ" },
    ]);
    expect(answerChanges(ask(l, "evacuation.support"), { kind: "choice", values: ["call", "other"], note: "薬を持ち出す" })).toEqual([
      { t: "field", key: "evacuation.support", value: ["call", "other"] },
      { t: "field", key: "evacuation.supportNote", value: "薬を持ち出す" },
    ]);
  });

  it("世帯補記は 60 字で切る（欄の上限）。特記は NOTE_MAX で切る", () => {
    const long = "あ".repeat(300);
    const h = answerChanges(ask(emptied(), "basic.household"), { kind: "choice", values: ["other"], note: long })!;
    expect(h[1]).toEqual({ t: "field", key: "basic.householdNote", value: "あ".repeat(60) });
    const w = answerChanges(ask(emptied(), "care.walking"), { kind: "choice", values: ["ok"], note: long })!;
    expect(w[1].t === "note" && w[1].value.length).toBe(NOTE_MAX);
  });

  it("補足が空なら今どおり欄の値だけ。補足だけ（何も選ばない）は保存しない", () => {
    const q = ask(emptied(), "care.walking");
    expect(answerChanges(q, { kind: "choice", values: ["hard"], note: "   " })).toEqual([{ t: "field", key: "care.walking", value: "hard" }]);
    expect(answerChanges(q, { kind: "choice", values: ["hard"] })).toEqual([{ t: "field", key: "care.walking", value: "hard" }]);
    expect(answerChanges(q, { kind: "choice", values: [], note: "杖" })).toBeNull();
  });

  it("夜間支援は選んだ人・なしと、補足を特記へ", () => {
    const l = emptied();
    const q = ask(l, "people.night_supporter");
    expect(q.answer.kind).toBe("night");
    const picked = answerChanges(q, { kind: "night", contactIds: ["c-04-1"], note: "近所の人も夜に来られる" })!;
    expect(picked).toEqual([
      { t: "contact", id: "c-04-1", value: { kind: "welfare_commissioner", nightOk: true } },
      { t: "note", value: "夜間支援: 近所の人も夜に来られる" },
    ]);
    const none = answerChanges(q, { kind: "night", contactIds: [], note: "夜は誰も来られない" })!;
    expect(none.at(-1)).toEqual({ t: "note", value: "夜間支援: 夜は誰も来られない" });
    expect(none.filter((c) => c.t === "contact").every((c) => c.t === "contact" && c.value.nightOk === false)).toBe(true);
  });

  it("台帳に当てると、選んだ値と補足の両方が入る。同じ補足を 2 回入れても特記は 1 つ", () => {
    const l = emptied();
    const walking = answerChanges(ask(l, "care.walking"), { kind: "choice", values: ["some"], note: "杖で家の中は歩ける" })!;
    const transport = answerChanges(ask(l, "evacuation.transportKind"), { kind: "choice", values: ["family_car"], note: "長女の車" })!;
    const once = applyLedgerChanges(l, [...walking, ...transport]).ledger;
    expect(once.care.walking).toBe("some");
    expect(once.notes).toContain("歩行: 杖で家の中は歩ける");
    expect(once.evacuation.transportKind).toBe("family_car");
    expect(once.evacuation.transport).toBe("長女の車");
    const twice = applyLedgerChanges(once, walking).ledger;
    expect(twice.notes.filter((n) => n === "歩行: 杖で家の中は歩ける")).toHaveLength(1);
    // 文字に戻して読み直しても同じ（台帳の型の中だけ）
    expect(parseLedger(JSON.stringify(once)).notes).toContain("歩行: 杖で家の中は歩ける");
  });

  it("noteChange: 書き足しの欄が表に無い名前なら特記へ", () => {
    expect(noteChange("介護度", "basic.nothing", "区分変更の申請中")).toEqual({ t: "note", value: "介護度: 区分変更の申請中" });
    expect(noteChange("介護度", null, "")).toBeNull();
  });
});

describe("問いの部品（components/person/IntakeQuestion.tsx）", () => {
  const render = (q: Question) =>
    renderToStaticMarkup(
      createElement(IntakeQuestion, { question: q, left: 3, busy: false, aiReady: true, onAnswer: () => {}, onSkip: () => {}, onFree: () => {} }),
    );

  it("選ぶ問い（1 つ・いくつでも・夜間支援）に補足の欄。1 つ選ぶ問いは欄が選択肢の上（打ってから押す）", () => {
    const l = emptied();
    const one = render(ask(l, "care.walking"));
    expect(one).toContain('data-intake="note"');
    expect(one).toContain("補足");
    expect(one).toContain('aria-label="歩行 補足"');
    expect(one.indexOf('data-intake="note"')).toBeLessThan(one.indexOf("data-choice="));
    const many = render(ask(l, "evacuation.support"));
    expect(many).toContain('data-intake="note"');
    // いくつでも選ぶ問いは、選ぶ所 → 補足 → 保存
    expect(many.indexOf('type="checkbox"')).toBeLessThan(many.indexOf('data-intake="note"'));
    expect(many.indexOf('data-intake="note"')).toBeLessThan(many.indexOf("保存"));
    expect(render(ask(l, "people.night_supporter"))).toContain('data-intake="note"');
  });

  it("文字・数字で答える問いには補足の欄を出さない（答えの欄そのものが文字）", () => {
    const q = questionQueue(rowsOf(seed("p-04"), emptied())).find((x) => x.answer.kind === "text" || x.answer.kind === "int" || x.answer.kind === "clock")!;
    expect(render(q)).not.toContain('data-intake="note"');
  });

  it("補足の欄は Enter で送らない（form の中に置かない）", () => {
    for (const key of ["care.walking", "evacuation.support", "people.night_supporter"]) {
      const html = render(ask(emptied(), key));
      const before = html.slice(0, html.indexOf('data-intake="note"'));
      expect(before.split("<form").length, key).toBe(before.split("</form>").length);
    }
  });
});
