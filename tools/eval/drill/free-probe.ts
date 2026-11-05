// 自由対応の状況違いの試し（docs/tasks/T129.md の 7）。同じ文を 8 つの状況（事業所／訪問先 × 通話可／不可 × 昼／夜）で
// 自由対応の口（lib/drill/free-action.ts の planFree）に通し、結果が状況に合うかを数える。訓練は回さない（エンジンの状態を作って読み替えだけ）。
//
// 見る所（どれも 0 のはず）:
// - phone_down_ran: 通信の道が無い（T125: 通話の規制・全域の電波不通・本人の家の電話の不通）のに、本人・家族・近所の人への電話で済む手・
//   電話で頼む手（表の手か、そのままの手の電話）が打てる形で返った
// - no_alt: 押せない手に、今できる別の道（代案）が無い
// - dropped: 表の手に当たる文（119・家族への電話）が「変化なし」に落ちた
// - inner_name: 画面に出す物（扱い・理由・1 文・代案・押せない理由）に内部の名前（英字の id）が出た
// - dark_visit: 夜の訪問（表の訪問か、そのままの手の訪問）の所要に夜の足し分が無い
// 本物の Claude で回すときは、評価の台の作業者が鍵のある口を渡す（1 回の試しで Opus を文の数 × 8 回呼ぶ）。テストは偽の client で回す

import type { ActionRecord } from "../../../lib/drill/action-types.ts";
import { ACTION_WAYS, TERM_LABELS } from "../../../lib/drill/action-terms.ts";
import type { ActTarget } from "../../../lib/drill/actions.ts";
import { advance, initialState, type DrillState } from "../../../lib/drill/engine.ts";
import { planFree, type FreeHook } from "../../../lib/drill/free-action.ts";
import { planView } from "../../../lib/drill/http.ts";
import { CONTACT_KIND_LABELS } from "../../../lib/labels.ts";
import { SEED_PEOPLE } from "../../../seed/people.ts";
import { INNER_NAME, type CheckHit } from "./checks.ts";

/** 試す文（表の手に当たる文 2 つと、当たらない文 1 つ） */
export const PROBE_TEXTS = ["危険な状態なので 119 に連絡", "家族に電話して様子を聞く", "近所の人に様子を見に行ってもらう"] as const;
/** 表の手に当たる文 → 当たるべき手（変化なしに落ちたら dropped） */
const PROBE_CATALOG: Readonly<Record<string, string>> = { [PROBE_TEXTS[0]]: "advise_119", [PROBE_TEXTS[1]]: "call_contact" };

export type ProbeCase = { where: "office" | "home"; phone: "ok" | "down"; night: boolean };
export const PROBE_CASES: ReadonlyArray<ProbeCase> = (["office", "home"] as const).flatMap((where) =>
  (["ok", "down"] as const).flatMap((phone) => [false, true].map((night) => ({ where, phone, night }))),
);

export type ProbeRow = ProbeCase & { text: string; label: string; block: string | null; alt: string | null; minutes: number; adds: string[] };

/** 種の本人（台帳の連絡先を手の相手に。名前と番号は持たない） */
const PERSON = "p-01";
const CONTACTS: ReadonlyArray<ActTarget> = SEED_PEOPLE.find((p) => p.person.id === PERSON)!.contacts.map((c) => ({
  id: c.id,
  kind: c.kind,
  label: CONTACT_KIND_LABELS[c.kind],
  hasPhone: typeof c.phone === "string" && c.phone !== "",
}));

/** 日本の 10 時（昼）と 20 時（夜）に始める */
const DAY = "2026-11-05T01:00:00.000Z";
const NIGHT = "2026-11-05T11:00:00.000Z";

async function stateOf(c: ProbeCase): Promise<DrillState> {
  const participants = SEED_PEOPLE.map((p) => p.person.id);
  const init = initialState("earthquake", participants, c.night ? NIGHT : DAY, { clock: true, terms: true });
  const s = (await advance(init, 0, {}, { policy: "clock" }))!.state;
  const visited: ActionRecord[] =
    c.where === "home"
      ? [{ id: "a0", kind: "visit", person: PERSON, result: { ok: true, status: "arrived" } } as unknown as ActionRecord]
      : [];
  // 「不可」は通信の道が無い時（T125: 通話の規制・全域の電波不通・本人の家の電話の不通。通話の規制だけでは全部は止まらない）
  const down = c.phone === "down" ? { phone: "down" as const, radio: "down" as const, marks: { ...s.world.marks, [PERSON]: { ...(s.world.marks[PERSON] ?? {}), lineDown: 0 } } } : {};
  return { ...s, actions: visited, world: { ...s.world, ...down } };
}

/** 電話で済む・電話で頼む手か（決まりの表のやり方 phone・home、そのままの手の電話） */
const usesPhone = (label: string, as: string | null, way: string | null) => (as ? ACTION_WAYS[as as keyof typeof ACTION_WAYS] === "phone" || ACTION_WAYS[as as keyof typeof ACTION_WAYS] === "home" : way === "電話" || label === "電話");

/** 8 つの状況 × 文で口を通し、行と引っかかった所を返す */
export async function freeProbe(hook: FreeHook, texts: ReadonlyArray<string> = PROBE_TEXTS): Promise<{ rows: ProbeRow[]; hits: CheckHit[] }> {
  const rows: ProbeRow[] = [];
  const hits: CheckHit[] = [];
  for (const c of PROBE_CASES) {
    const s = await stateOf(c);
    for (const text of texts) {
      const plan = await planFree({ ...s, participants: s.participants }, { text, person: PERSON, contacts: CONTACTS }, hook);
      const view = planView(plan);
      const tag = `${c.where === "home" ? "訪問先" : "事業所"}・電話 ${c.phone === "ok" ? "可" : "不可"}・${c.night ? "夜" : "昼"}: ${text}`;
      rows.push({ ...c, text, label: view.label, block: view.block, alt: view.alt, minutes: view.minutes, adds: view.adds });
      if (c.phone === "down" && !view.block && !view.idle && usesPhone(view.label, view.as, view.way)) {
        hits.push({ check: "free", rule: "probe:phone_down_ran", evidence: `${tag} → ${view.label}` });
      }
      if (view.block && !view.alt) hits.push({ check: "free", rule: "probe:no_alt", evidence: `${tag} → 不可 ${view.block}` });
      if (PROBE_CATALOG[text] && view.idle) hits.push({ check: "free", rule: "probe:dropped", evidence: `${tag} → 変化なし` });
      for (const v of [view.label, view.reason, view.words, view.alt, view.block]) {
        const m = v ? INNER_NAME.exec(v) : null;
        if (m) hits.push({ check: "free", rule: "probe:inner_name", evidence: `${tag} → ${m[0]}` });
      }
      const visits = view.as === "visit" || (!view.as && view.way === "訪問");
      if (c.night && visits && !view.block && !view.adds.includes(TERM_LABELS.dark)) {
        hits.push({ check: "free", rule: "probe:dark_visit", evidence: `${tag} → ${view.minutes} 分` });
      }
    }
  }
  return { rows, hits };
}
