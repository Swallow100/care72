// 着信の応答・拒否の記録（docs/tasks/T22.md）。D1 と範囲を引数で受け取る（テストで node:sqlite）。
//
// 着信の画面（components/drill/IncomingCall、T21）で押した応答・拒否を drill_events に kind call_answer・call_decline で残す
// （actor care_manager、person は着信の本人）。採点（lib/drill/score.ts）が読み、赤の着信の拒否は順番の誤りに数える。
// - 着信はこの訓練の call_in（payload の signal）だけ。画面から送られた本人・色は読まない（call_in の行から写す）
// - 1 つの着信に 1 回だけ（id は `<signal>-p`。2 回目は記録しない。二度押し・読み直しで重ねない）
// - 訓練が終わったあとも受ける（最後の刻みの着信は、刻みを当てた時点で訓練が終了になってから鳴るため）
// - 時刻はケアマネの時計（drills.world の minute）。画面の時計は読まない

import type { D1Database } from "@cloudflare/workers-types";
import type { DrillEventRow, SignalColor } from "../db/types.ts";
import type { ContactKind } from "../db/types.ts";
import { loadDrillRow, stateOfRow, type DrillScope } from "./db.ts";
import { dialogueFields, type TalkLine } from "./dialogue.ts";
import type { DrillTurn } from "./engine.ts";

export const CALL_RESPONSES = ["answer", "decline"] as const;
export type CallResponse = (typeof CALL_RESPONSES)[number];

export function isCallResponse(v: unknown): v is CallResponse {
  return typeof v === "string" && (CALL_RESPONSES as readonly string[]).includes(v);
}

const KIND: Readonly<Record<CallResponse, "call_answer" | "call_decline">> = {
  answer: "call_answer",
  decline: "call_decline",
};

/** drill_events の call_answer・call_decline の payload */
export type CallResponsePayload = {
  /** 着信の安否の signals の id（call_in の payload の signal） */
  signal: string;
  response: CallResponse;
  /** 着信の色・出どころ（call_in から写す） */
  color: SignalColor;
  source: DrillTurn["source"];
  /** 掛かってきた時刻（発災からの分） */
  callMinute: number;
  /** 応答・拒否した時刻（ケアマネの時計、発災からの分） */
  minute: number;
  /**
   * 応答した着信の往復（T127、lib/drill/incoming-talk.ts が足す。3 往復まで）。ケアマネの問いと掛けてきた人の言葉。
   * 頼み事は drills.world の asks にも積む（作り直しは lib/drill/db.ts の replayState が同じ所を通す）
   */
  talk?: TalkLine[];
  /** 往復を切った時刻（発災からの分）。切っていなければ無し */
  talkEnd?: number;
  /** 往復の話し手（掛けてきた人の連絡先。lib/drill/calls.ts の callerContact）。名前と番号は持たない */
  callee?: CallCallee;
  /**
   * 応答・拒否した時の手の数（T127）。往復は、応答のあとに手を打っていない間だけ続けられる
   * （作り直しが往復を応答の記録の位置で当てるので、手のあとに往復を足すと順が食い違うため）。T127 より前の記録には無い
   */
  actions?: number;
};

/** 着信の往復の話し手（連絡先の id・区分・言い方）。連絡先の無い人は id null */
export type CallCallee = { id: string | null; kind: ContactKind; label: string };

export const callResponseId = (signal: string) => `${signal}-p`;

export type RespondResult = { ok: true; recorded: boolean } | { ok: false; error: "not_found" };

type CallInRow = Pick<DrillEventRow, "person_id" | "sim_hour" | "payload">;

/**
 * 着信 1 つに応答・拒否を残す。訓練が事業所の外・無い、着信がこの訓練の物でなければ not_found。
 * もう残っていれば recorded false（先に押した方のまま）
 */
export async function respondCall(
  db: D1Database,
  scope: Pick<DrillScope, "officeId">,
  drillId: string,
  signal: string,
  response: CallResponse,
): Promise<RespondResult> {
  const row = await loadDrillRow(db, scope.officeId, drillId);
  if (!row) return { ok: false, error: "not_found" };
  const call = await db
    .prepare(
      `SELECT person_id, sim_hour, payload FROM drill_events
        WHERE drill_id = ?1 AND kind = 'call_in' AND json_extract(payload, '$.signal') = ?2 LIMIT 1`,
    )
    .bind(drillId, signal)
    .first<CallInRow>();
  if (!call) return { ok: false, error: "not_found" };
  let p: Partial<{ color: SignalColor; source: DrillTurn["source"] }> = {};
  try {
    p = JSON.parse(call.payload) as typeof p;
  } catch {
    // 形の崩れた着信は色・出どころを不明で残す
  }
  const state = stateOfRow(row);
  const minute = state.minute;
  const payload: CallResponsePayload = {
    signal,
    response,
    color: p.color ?? "unknown",
    source: p.source ?? "family",
    callMinute: Math.round(call.sim_hour * 60),
    minute,
    actions: state.actions.length,
  };
  const id = callResponseId(signal);
  const r = await db
    .prepare(
      `INSERT INTO drill_events (id, drill_id, seq, step, sim_hour, person_id, actor, kind, payload)
       SELECT ?1, ?2, (SELECT COALESCE(MAX(seq), 0) + 1 FROM drill_events WHERE drill_id = ?2), ?3, ?4, ?5, 'care_manager', ?6, ?7
        WHERE NOT EXISTS (SELECT 1 FROM drill_events WHERE id = ?1)`,
    )
    .bind(id, drillId, row.step, minute / 60, call.person_id, KIND[response], JSON.stringify(payload))
    .run();
  return { ok: true, recorded: (r.meta.changes ?? 0) > 0 };
}

/** 訓練の着信と応答・拒否（採点が読む）。着信は鳴らした順（刻み・順） */
export type CallRecord = {
  signal: string;
  person: string;
  color: SignalColor;
  source: DrillTurn["source"];
  /** 掛かってきた時刻（発災からの分） */
  minute: number;
  step: number;
  /** 応答・拒否。押していなければ null（未応答） */
  response: CallResponse | null;
  /** 応答・拒否した時刻（ケアマネの時計） */
  respondedAt: number | null;
  /** 着信の言う事（call_in の写し。T127 の紙と経過）。無ければ null */
  saying?: string | null;
  /** 言う事が本人役（Claude）の物 */
  ai?: boolean;
  /** 応答した着信の往復（T127）。無ければ空 */
  talk?: TalkLine[];
  talkEnd?: number | null;
  callee?: CallCallee | null;
};

/** この訓練の着信（call_in）と応答・拒否を読む */
export async function loadCallRecords(db: D1Database, drillId: string): Promise<CallRecord[]> {
  const res = await db
    .prepare(
      `SELECT step, sim_hour, person_id, kind, payload FROM drill_events
        WHERE drill_id = ?1 AND kind IN ('call_in', 'call_answer', 'call_decline') ORDER BY step, seq`,
    )
    .bind(drillId)
    .all<Pick<DrillEventRow, "step" | "sim_hour" | "person_id" | "kind" | "payload">>();
  const calls: CallRecord[] = [];
  const responses = new Map<string, { response: CallResponse; minute: number; talk: TalkLine[]; talkEnd: number | null; callee: CallCallee | null }>();
  for (const r of res.results) {
    let p: Record<string, unknown>;
    try {
      p = JSON.parse(r.payload) as Record<string, unknown>;
    } catch {
      continue;
    }
    const signal = typeof p.signal === "string" ? p.signal : null;
    if (!signal || !r.person_id) continue;
    if (r.kind === "call_in") {
      calls.push({
        signal,
        person: r.person_id,
        color: p.color === "red" || p.color === "green" ? p.color : "unknown",
        source: p.source === "agent" || p.source === "supporter" ? p.source : "family",
        minute: Math.round(r.sim_hour * 60),
        step: r.step,
        response: null,
        respondedAt: null,
        saying: typeof p.saying === "string" && p.saying.trim() ? p.saying : null,
        ai: p.ai === true,
      });
    } else if (!responses.has(signal)) {
      const d = dialogueFields(p);
      responses.set(signal, {
        response: r.kind === "call_answer" ? "answer" : "decline",
        minute: typeof p.minute === "number" ? p.minute : Math.round(r.sim_hour * 60),
        talk: d.talk ?? [],
        talkEnd: d.talkEnd ?? null,
        callee: calleeOf(p.callee),
      });
    }
  }
  return calls.map((c) => {
    const x = responses.get(c.signal);
    return x ? { ...c, response: x.response, respondedAt: x.minute, talk: x.talk, talkEnd: x.talkEnd, callee: x.callee } : c;
  });
}

/** 往復の話し手の形（形が違えば null） */
export function calleeOf(v: unknown): CallCallee | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Partial<CallCallee>;
  if (typeof c.kind !== "string" || typeof c.label !== "string") return null;
  return { id: typeof c.id === "string" ? c.id : null, kind: c.kind, label: c.label };
}
