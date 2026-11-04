// デモ事業所の種のうち、架空の 10 人（seed/people.ts）に足す物（docs/tasks/T26.md）。
// 災害モード（大雨・警戒レベル 4・浸水 3 m の町で停電）と、山田 ハナの赤の信号（けが あり、文字起こし、Claude の分類の列）。
// 終わった訓練 1 回は lib/seed/drill.ts（本物の startDrill・advanceDrill を回して作る）。
//
// 時刻は種を入れた時刻（now）から数える: 発災は 4 時間前、停電と警戒レベル 4 は 3 時間前、山田の赤は 1 時間前
// （訓練の大雨の想定の 0・1・3 時間と同じ順）。毎日 4 時に入れ直すので、日がたっても停電が何日も続いた形にならない。
// 経過の 1 行は本番の流れと同じ関数（lib/signals/labels.ts・lib/classify/labels.ts・lib/disaster/state.ts）で作る。
// 分類の列は Claude を呼ばずに入れた固定の値（本番で Claude が返す形と同じ）。画面には AI の印が付く。
//
// ここは D1・R2・node のファイルに触らない（手元の CLI の seed/build-sql.ts と、Worker の lib/seed/reset.ts の両方が読む）。

import { DEMO_CARE_MANAGER_ID, DEMO_OFFICE_ID, DEMO_SELF_PERSON_ID } from "../auth/demo.ts";
import { aiClassLogBody } from "../classify/labels.ts";
import { HAIKU } from "../claude/models.ts";
import type { RecordingClass } from "../db/types.ts";
import { DISASTER_KIND_LABELS, infoChanges, statePayload, type DisasterInfo } from "../disaster/state.ts";
import { recordingLogBody, signalLogBody } from "../signals/labels.ts";
import { SEED_AT, SEED_PEOPLE } from "../../seed/people.ts";
import { insert, type SqlValue } from "../../seed/sql.ts";

const HOUR_MS = 3_600_000;

/** 山田の赤の信号の id。録音の再生（/api/recordings/<id>）は UUID の形しか通さないので、その形にする */
export const SEED_RED_SIGNAL_ID = "5eed0000-0000-4000-8000-000000000001";

/** 山田が言った言葉（訓練の大雨の想定の 3 時間の言う事と同じ） */
export const SEED_RED_TRANSCRIPT = "いたい、うごけない";

/** 種の分類（Claude の答えの形）。動けない・確信 0.9・引用「うごけない」 */
export const SEED_RED_CLASSIFICATION: { classes: RecordingClass[]; confidence: number; quote: string; model: string } = {
  classes: ["immobile"],
  confidence: 0.9,
  quote: "うごけない",
  model: HAIKU,
};

/**
 * 種の録音を置く R2 の鍵（拡張子ごと）。音のファイルは作者が seed/recordings/p-01.webm か p-01.m4a に置く（権利が作者にある物だけ）。
 * 置いてあれば手元の npm run db:seed が R2（--local）に上げ、Worker の「最初に戻す」はこの鍵が R2 にあれば信号に結ぶ。
 * 配信先の R2 には作者が同じ鍵で 1 回上げる。「最初に戻す」はこの鍵を消さない
 */
export const SEED_RECORDING_KEYS = {
  webm: `recordings/${DEMO_OFFICE_ID}/${DEMO_SELF_PERSON_ID}/seed.webm`,
  m4a: `recordings/${DEMO_OFFICE_ID}/${DEMO_SELF_PERSON_ID}/seed.m4a`,
} as const;

/** 音の形（R2 の httpMetadata と同じ）。seed/recordings のファイルの拡張子から */
export const SEED_RECORDING_TYPES = { webm: "audio/webm", m4a: "audio/mp4" } as const;

export type SeedRecordingExt = keyof typeof SEED_RECORDING_KEYS;

/** 種の録音。無ければ null（文字起こしと分類だけ。画面は「録音なし」） */
export type SeedRecording = { key: string; durationSec: number | null } | null;

/** デモの R2 の鍵の頭。「最初に戻す」はこの下の種でない物を消す */
export const DEMO_RECORDING_PREFIX = `recordings/${DEMO_OFFICE_ID}/`;

function shift(now: string, ms: number): string {
  const t = Date.parse(now);
  if (Number.isNaN(t)) throw new Error(`時刻でない: ${now}`);
  return new Date(t + ms).toISOString();
}

/** 種の時刻（now から数える） */
export function demoTimes(now: string) {
  const red = shift(now, -1 * HOUR_MS);
  return {
    /** 発災（大雨に切り替えた時刻） */
    disasterAt: shift(now, -4 * HOUR_MS),
    /** 停電と警戒レベル 4 */
    outageAt: shift(now, -3 * HOUR_MS),
    /** 山田が赤を押した */
    redAt: red,
    /** 4 問の途中で止まり、20 秒あとから録った物が届いた */
    recordedAt: shift(red, 50_000),
    /** 分類が付いた */
    classifiedAt: shift(red, 56_000),
  };
}

/** 停電の地区: 浸水 3 m 以上の人の住む町（訓練の大雨の想定の停電と同じ決め方）。種の台帳から引く */
export function demoOutageTowns(): string[] {
  const towns = new Set<string>();
  for (const p of SEED_PEOPLE) {
    if (p.person.office_id !== DEMO_OFFICE_ID) continue;
    const deep = (p.ledger.evacuation?.hazards ?? []).some((h) => h.kind === "flood" && (h.depthM ?? 0) >= 3);
    const town = p.ledger.basic.address?.town?.trim();
    if (deep && town) towns.add(town);
  }
  return [...towns].sort((a, b) => a.localeCompare(b, "ja"));
}

export type SeedRow = { table: string; row: Record<string, SqlValue> };

/** 災害モードの行と、事業所の経過の 2 行（大雨に切替・停電と警戒レベル 4）。書き手は山本 */
function disasterRows(now: string): SeedRow[] {
  const t = demoTimes(now);
  const towns = demoOutageTowns();
  const before: DisasterInfo = {
    startedAt: t.disasterAt,
    outage: { scope: "none", towns: [], startedAt: null },
    alertLevel: null,
    water: null,
    road: null,
  };
  const after: DisasterInfo = { ...before, outage: { scope: "area", towns, startedAt: t.outageAt }, alertLevel: 4 };
  const cm = DEMO_CARE_MANAGER_ID;
  return [
    {
      table: "office_timeline_entries",
      row: {
        id: "ot-seed-1",
        office_id: DEMO_OFFICE_ID,
        author_id: cm,
        author_role: "care_manager",
        kind: "disaster_on",
        body: DISASTER_KIND_LABELS.heavy_rain,
        payload: statePayload({ kind: "heavy_rain", startedAt: t.disasterAt }),
        occurred_at: t.disasterAt,
        created_at: t.disasterAt,
      },
    },
    {
      table: "office_timeline_entries",
      row: {
        id: "ot-seed-2",
        office_id: DEMO_OFFICE_ID,
        author_id: cm,
        author_role: "care_manager",
        kind: "disaster_info",
        body: infoChanges(before, after).join("・"),
        payload: statePayload({ kind: "heavy_rain", ...after }),
        occurred_at: t.outageAt,
        created_at: t.outageAt,
      },
    },
    {
      table: "disaster_state",
      row: {
        office_id: DEMO_OFFICE_ID,
        kind: "heavy_rain",
        started_at: t.disasterAt,
        started_by: cm,
        outage_scope: "area",
        outage_towns: JSON.stringify(towns),
        outage_started_at: t.outageAt,
        alert_level: 4,
        water: null,
        road: null,
        // 切替と情報の保存の 2 回ぶん
        version: 2,
        updated_by: cm,
        updated_at: t.outageAt,
      },
    },
  ];
}

/** 山田の赤の信号と、経過の 3 行（信号・録音・分類）。本番の流れ（lib/signals/save.ts・lib/classify/store.ts）と同じ形 */
function redSignalRows(now: string, recording: SeedRecording): SeedRow[] {
  const t = demoTimes(now);
  const person = DEMO_SELF_PERSON_ID;
  const c = SEED_RED_CLASSIFICATION;
  const classes = JSON.stringify(c.classes);
  const durationSec = recording?.durationSec ?? null;
  return [
    {
      table: "signals",
      row: {
        id: SEED_RED_SIGNAL_ID,
        person_id: person,
        drill_id: null,
        color: "red",
        source: "self",
        where_now: null,
        // けが あり、ほかは未回答（4 問の途中で止まった）
        injured: 1,
        at_home: null,
        can_move: null,
        has_medicine: null,
        recording_key: recording?.key ?? null,
        transcript: SEED_RED_TRANSCRIPT,
        classes,
        classified_by: "claude",
        ai_classes: classes,
        ai_confidence: c.confidence,
        ai_quote: c.quote,
        ai_model: c.model,
        ai_error: null,
        ai_at: t.classifiedAt,
        occurred_at: t.redAt,
        created_at: t.redAt,
      },
    },
    {
      table: "timeline_entries",
      row: {
        id: "t-seed-red-1",
        person_id: person,
        author_id: null,
        author_role: "self",
        kind: "signal",
        body: signalLogBody({
          color: "red",
          whereNow: null,
          answers: { injured: true, atHome: null, canMove: null, hasMedicine: null },
        }),
        payload: JSON.stringify({ source: "phone" }),
        signal_id: SEED_RED_SIGNAL_ID,
        occurred_at: t.redAt,
        created_at: t.redAt,
      },
    },
    {
      table: "timeline_entries",
      row: {
        id: "t-seed-red-2",
        person_id: person,
        author_id: null,
        author_role: "self",
        kind: "signal",
        body: recordingLogBody({ hasAudio: recording !== null, durationSec, transcript: SEED_RED_TRANSCRIPT }),
        payload: JSON.stringify({ source: "recording", durationSec }),
        signal_id: SEED_RED_SIGNAL_ID,
        occurred_at: t.recordedAt,
        created_at: t.recordedAt,
      },
    },
    {
      table: "timeline_entries",
      row: {
        id: "t-seed-red-3",
        person_id: person,
        author_id: null,
        author_role: "system",
        kind: "note",
        body: aiClassLogBody(c),
        payload: JSON.stringify({ source: "classify", ai: true, model: c.model, classes: c.classes }),
        signal_id: SEED_RED_SIGNAL_ID,
        occurred_at: t.classifiedAt,
        created_at: t.classifiedAt,
      },
    },
  ];
}

/** 10 人に足す行（災害モード・事業所の経過・山田の赤と経過）。入れる順（親の表から） */
export function demoExtraRows(now: string, recording: SeedRecording = null): SeedRow[] {
  return [...disasterRows(now), ...redSignalRows(now, recording)];
}

/**
 * デモ事業所の 10 人は QR を作った形にする（本人の 1 枚の裏と QR の画面に QR が出る。前は未作成で、裏が空の枠だった）。
 * 作った時刻は種の時刻で固定なので、毎朝の戻しでトークンは変わらない（前の日に刷った紙の QR も開ける）。期限は 180 日
 */
export const DEMO_QR = { generation: 1, issuedAt: SEED_AT, ttlDays: 180 } as const;

const DEMO_QR_SQL = `UPDATE people SET qr_generation = ${DEMO_QR.generation}, qr_issued_at = '${DEMO_QR.issuedAt}', qr_ttl_days = ${DEMO_QR.ttlDays} WHERE office_id = '${DEMO_OFFICE_ID}'`;

export function demoExtraStatements(now: string, recording: SeedRecording = null): string[] {
  return [...demoExtraRows(now, recording).map((r) => insert(r.table, r.row)), DEMO_QR_SQL];
}
