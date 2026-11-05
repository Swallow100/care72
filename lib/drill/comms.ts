// 通信の段（docs/tasks/T125.md の 4・5）。訓練の 1 つの通信の状態を、72 時間の棒の帯（view.ts の bandsOf）・被害状況・手の可否と所要
// （action-terms.ts）・世界の返事（world-reply.ts）・安否の連絡の経路（via。着信の形は lib/drill/calls.ts の isPhoneTurn が読む）・
// 本人役の状況が同じ物から読む。Claude を呼ばない。色と連絡順（lib/triage）には使わない。
//
// 段:
// - 通話（音声）: 世界の電話（world.phone）。ok 通常・busy 不安定（つながりにくい）・down 規制（通話規制。かけ直せば時々つながる）。
//   通話を全部止める段は無い（出る割合と所要で効かせる）
// - 固定電話: 停電の区域の家と、家の電話の印（lineDown）の家では使えない
// - データ（メッセージ・安否のボタン）: 電波不通になるまで届く
// - 電波不通: 監督の差し込み「携帯の基地局の停止」（world.radio）か、停電が想定の表の時間（基地局の予備電源の目安。lib/drill/fit.ts の
//   radio）続いた、表の区域の家
//
// 輪にしない: lib/drill のほかのファイルを型だけ読む（fit.ts は値で読む。fit.ts は型だけ読む）

import type { HazardKind, Ledger } from "../db/types.ts";
import type { FitProfile } from "./fit.ts";
import type { DrillTurn } from "./persona-types.ts";
import type { OutageArea, PhoneState, WorldState } from "./scenarios.ts";

// ---------- 家（開始の時に台帳から写す） ----------

/** 本人の家の通信と区域（訓練の開始の時に台帳から写す。DrillState.homes。訓練の途中で台帳を直しても変わらない） */
export type Home = {
  /** 区域（台帳のハザード） */
  zones: Array<{ kind: HazardKind; depthM: number | null }>;
  /** 町名（停電の地区に入るか。画面と仮想の町の停電だけで使い、Claude に渡さない） */
  town: string | null;
  /** 家の固定電話がある */
  landline: boolean;
  /** 携帯電話（スマホを含む）がある */
  mobile: boolean;
};
export type Homes = Readonly<Record<string, Home>>;

/** 台帳から家を写す。連絡手段が何も書かれていなければ固定電話あり・携帯なし（前からの台帳の多く） */
export function homeOf(ledger: Pick<Ledger, "basic" | "evacuation">): Home {
  const m = ledger.basic.contactMeans ?? {};
  const smart = m.smartphone === "uses" || m.smartphone === "views";
  const mobile = m.mobile === true || smart;
  return {
    zones: ledger.evacuation.hazards.map((h) => ({ kind: h.kind, depthM: h.depthM ?? null })),
    town: ledger.basic.address?.town?.trim() || null,
    landline: m.landline === true || (m.landline === undefined && !mobile),
    mobile,
  };
}

/** 停電の範囲にこの家が入るか（lib/drill/persona.ts の inOutageArea と同じ見方。町名の無い家は町の停電から外さない） */
export function homeInOutage(area: OutageArea, home: Pick<Home, "zones" | "town">): boolean {
  if (area.scope === "office") return true;
  if (area.scope === "towns") return !home.town || area.towns.includes(home.town);
  return home.zones.some((h) => h.kind === area.hazard && (h.depthM ?? 0) >= area.minDepthM);
}

// ---------- 通信の状態 ----------

/** 電波: ok・down（電波不通） */
export const RADIO_STATES = ["ok", "down"] as const;
export type RadioState = (typeof RADIO_STATES)[number];

type CommsWorld = Pick<WorldState, "phone" | "outage"> & Partial<Pick<WorldState, "radio" | "marks">>;

/** 停電が始まってからの時間（その家の町の始まり。続いていなければ null） */
function outageHours(w: CommsWorld, home: Pick<Home, "zones" | "town"> | null, minute: number): number | null {
  const o = w.outage;
  if (!o || o.restoredAt !== null) return null;
  if (home && !homeInOutage(o.area, home)) return null;
  const since = o.area.scope === "towns" && home?.town ? (o.area.since?.[home.town] ?? o.since) : o.since;
  return minute / 60 - since;
}

/**
 * その家の電波が不通か。監督の差し込みの全域の不通（world.radio）か、停電が想定の表の時間続いた表の区域の家。
 * 家が分からない（全体の手・前からの訓練）は全域の不通だけ
 */
export function radioDownAt(w: CommsWorld, profile: FitProfile | null, home: Home | null, minute: number): boolean {
  if (w.radio === "down") return true;
  const rule = profile?.radio;
  if (!rule || !home) return false;
  if (!rule.zones.includes("all") && !home.zones.some((z) => (rule.zones as ReadonlyArray<string>).includes(z.kind))) return false;
  const h = outageHours(w, home, minute);
  return h !== null && h >= rule.hours;
}

/** 本人の家の通信。landline: ok・out（停電・家の電話の印で使えない）・none。mobile: ok・down（電波不通）・none */
export type HomeComms = { landline: "ok" | "out" | "none"; mobile: "ok" | "down" | "none" };

/** 本人の家の通信（家が分からなければ固定電話あり・携帯なし。家の電話の印は前からの訓練でも効く） */
export function homeComms(w: CommsWorld, profile: FitProfile | null, person: string | null, home: Home | null, minute: number): HomeComms {
  const marked = !!person && w.marks?.[person]?.lineDown !== undefined;
  const hasLine = home ? home.landline : true;
  const out = marked || (home !== null && outageHours(w, home, minute) !== null);
  return {
    landline: !hasLine ? "none" : out ? "out" : "ok",
    mobile: !(home?.mobile ?? false) ? "none" : radioDownAt(w, profile, home, minute) ? "down" : "ok",
  };
}

/** 本人の家に電話がつながる道（固定電話か携帯）。無ければ理由（通話不可・電波不通） */
export function selfLineOf(c: HomeComms): "ok" | "noCall" | "noRadio" {
  if (c.landline === "ok" || c.mobile === "ok") return "ok";
  return c.mobile === "down" ? "noRadio" : "noCall";
}

/** 本人の家にデータ（メッセージ・安否のボタン）が届くか（携帯があり、電波不通でない） */
export const dataOk = (c: HomeComms): boolean => c.mobile === "ok";

/** 全体の通信の状態（帯・被害状況）。radio は全域の不通（all）か、区域の家の不通（area）か、無し */
export type Comms = { voice: PhoneState; radio: "ok" | "area" | "all" };

/** 全体の通信の状態。区域の不通は、家のどれかが不通のとき（家が無ければ全域の不通だけ） */
export function commsOf(w: CommsWorld, profile: FitProfile | null, homes: Homes | undefined, minute: number): Comms {
  if (w.radio === "down") return { voice: w.phone, radio: "all" };
  const area = Object.values(homes ?? {}).some((h) => radioDownAt(w, profile, h, minute));
  return { voice: w.phone, radio: area ? "area" : "ok" };
}

// ---------- 安否の連絡の経路（T127 の着信の画面が読む） ----------

/**
 * 安否 1 件がどの経路で届いたか。call 着信（家族・支援者の電話）・button 安否のボタン（本人・家族のスマホ）・message 伝言（家族・支援者の
 * メッセージ。通話が規制の間）。届かない（電波不通・通信の道が無い）連絡は安否にしない（届かなかった数は世界の gated の comms:*）
 */
export const VIAS = ["call", "button", "message"] as const;
export type Via = (typeof VIAS)[number];

/**
 * 安否 1 件の経路を決める。本人（agent）は安否のボタン。家族・支援者は言う事があれば電話（規制の間は伝言）、言う事が無ければボタン。
 * 同居の家族・本人のボタンは家の電波で、離れた家族・支援者の電話と伝言は全域の不通だけで止まる（どこにいるかは分からない）。
 * 届かなければ null。想定の表の固定の行（fixed）は止めない（デモの筋の行）
 */
export function viaOfTurn(t: DrillTurn, w: CommsWorld, profile: FitProfile | null, homes: Homes | undefined): Via | null {
  // 家の写しの無い訓練（前からの訓練・テスト）は止めない（経路だけ付ける）
  if (!homes) return viaOf(t, w, homeComms(w, profile, t.person, null, Math.round(t.at * 60)), { fixed: true });
  const c = homeComms(w, profile, t.person, homes[t.person] ?? null, Math.round(t.at * 60));
  return viaOf(t, w, c, { fixed: !t.ai || !homes[t.person] });
}

/**
 * 安否の並びに経路を付け、届かない AI の安否を外す（T125）。dropped は外した決まり（comms:radio 電波不通・comms:none 通信の道が無い）
 */
export function routeTurns(turns: ReadonlyArray<DrillTurn>, w: CommsWorld, profile: FitProfile | null, homes: Homes | undefined): { turns: DrillTurn[]; dropped: string[] } {
  const out: DrillTurn[] = [];
  const dropped: string[] = [];
  for (const t of turns) {
    const via = viaOfTurn(t, w, profile, homes);
    if (via === null) {
      const c = homeComms(w, profile, t.person, homes?.[t.person] ?? null, Math.round(t.at * 60));
      dropped.push(c.mobile === "down" || w.radio === "down" ? "comms:radio" : "comms:none");
      continue;
    }
    out.push({ ...t, via });
  }
  return { turns: out, dropped };
}

export function viaOf(
  t: Pick<DrillTurn, "source" | "saying">,
  w: CommsWorld,
  c: HomeComms,
  opts: { together?: boolean; fixed?: boolean } = {},
): Via | null {
  // 本人の連絡は赤緑のボタン（発災時の本人の画面と同じ）。表の固定の行はいつもボタン
  if (t.source === "agent") return dataOk(c) || opts.fixed ? "button" : null;
  const nearRadio = opts.together ? c.mobile !== "down" : w.radio !== "down";
  if (!nearRadio && !opts.fixed) return null;
  if (!t.saying?.trim()) return "button";
  return w.phone === "down" ? "message" : "call";
}
