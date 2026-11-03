// 電話の記録（docs/tasks/T13.md「電話は tel: のリンクで、押した事実を経過に残す」）。
// 担当一覧の行の詳細の電話のボタンを押すと「電話 家族 娘」、続けて「不通」を押すと「電話 家族 娘 不通」が
// 本人の経過に残る（kind called）。電話をかけるのはケアマネ本人（自動の電話はしない）。名前と番号は経過の文に書かない。
// 相手は台帳の連絡先の行から決め、画面から送られた名前は読まない。
// 「通話」（T58）はつながった電話。聞いた安否（無事・無事でない）があれば、人が確かめた事実として信号（出どころ care_manager）を
// 1 行足し、色と連絡順はルールの表（lib/triage）に任せる（訓練の通話 lib/drill/db.ts の heardStatements と同じ形）。
// lib/signals/save.ts の saveSignal は書き手が本人・家族・支援者に限られるので通さない。メモは経過の payload にだけ持ち、本文に入れない。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { roleAllows } from "../auth/roles.ts";
import { personInScope } from "../auth/scope.ts";
import type { ContactKind, ContactRow } from "../db/types.ts";
import { personDisaster } from "../disaster/person.ts";
import { shortJst } from "../disaster/state.ts";
import { CONTACT_KIND_LABELS } from "../labels.ts";
import { loadPersonPage } from "../person.ts";

export const CALL_SOURCE = "call";

/** dialed は電話のボタンを押した、no_answer はつながらなかった（不通）、connected はつながった（通話。T58） */
export const CALL_RESULTS = ["dialed", "no_answer", "connected"] as const;
export type CallResult = (typeof CALL_RESULTS)[number];

export const CALL_RESULT_LABELS: Record<CallResult, string> = { dialed: "発信", no_answer: "不通", connected: "通話" };

export function isCallResult(v: unknown): v is CallResult {
  return typeof v === "string" && (CALL_RESULTS as readonly string[]).includes(v);
}

/** メモの長さの上限（字） */
export const MAX_CALL_MEMO = 100;

/**
 * 通話で聞いた安否。緑は「無事」、赤は「無事でない」。赤のときだけ けが・動けない（本人・家族の答えと同じ列 injured・can_move）。
 * 確かめていない問いは持たない（列は null。「けがなし」とは書かない）
 */
export type Heard = { color: "green" | "red"; injured?: true; canMove?: false };

/** 聞いた安否の言い方（画面と経過の本文）。「聞けず」は安否を書かない通話 */
export const HEARD_LABELS = { green: "無事", red: "無事でない", none: "聞けず", injured: "けが", immobile: "動けない" } as const;

/** 聞いた安否の 1 語「無事」「無事でない けが 動けない」 */
export function heardText(h: Heard): string {
  if (h.color === "green") return HEARD_LABELS.green;
  return [HEARD_LABELS.red, h.injured ? HEARD_LABELS.injured : null, h.canMove === false ? HEARD_LABELS.immobile : null]
    .filter((s) => s)
    .join(" ");
}

/** 形を確かめて聞いた安否に。緑には けが・動けない を持たせない。形が違えば null */
export function parseHeard(v: unknown): Heard | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o.color !== "green" && o.color !== "red") return null;
  if (o.injured !== undefined && typeof o.injured !== "boolean") return null;
  if (o.canMove !== undefined && typeof o.canMove !== "boolean") return null;
  if (o.color === "green") return { color: "green" };
  return {
    color: "red",
    ...(o.injured === true ? { injured: true as const } : {}),
    ...(o.canMove === false ? { canMove: false as const } : {}),
  };
}

export type CallPayload = {
  source: typeof CALL_SOURCE;
  contactId: string;
  contactKind: ContactKind;
  result: CallResult;
  /** 通話で聞いた安否（足した信号は経過の行の signal_id） */
  heard?: Heard;
  /** ケアマネのメモ（100 字まで）。経過の本文に入れない */
  memo?: string;
};

export function parseCallPayload(text: string | null): CallPayload | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as Partial<CallPayload>;
    if (v.source !== CALL_SOURCE || typeof v.contactId !== "string" || !isCallResult(v.result)) return null;
    if (typeof v.contactKind !== "string" || !(v.contactKind in CONTACT_KIND_LABELS)) return null;
    const heard = v.heard === undefined ? null : parseHeard(v.heard);
    const memo = typeof v.memo === "string" && v.memo.trim() ? v.memo.trim() : null;
    return {
      source: CALL_SOURCE,
      contactId: v.contactId,
      contactKind: v.contactKind,
      result: v.result,
      ...(heard ? { heard } : {}),
      ...(memo ? { memo } : {}),
    };
  } catch {
    return null;
  }
}

type CallTarget = Pick<ContactRow, "kind" | "relation">;

/**
 * 相手の言い方「本人」「家族 娘」「支援者 隣人」。名前と番号は経過の文に書かない（文は要約や訓練で読み返すことがあり、
 * 名前を自由文に残さない。誰かは payload の contactId から連絡先の行を引く）
 */
export function callTargetText(c: CallTarget): string {
  const relation = c.kind === "self" ? null : c.relation?.trim() || null;
  return [CONTACT_KIND_LABELS[c.kind], relation].filter((s) => s).join(" ");
}

/**
 * 経過の 1 行の本文（種類の「電話」は経過の画面が前に付ける）。「本人」「家族 娘 不通」「家族 娘 通話 無事」。
 * 聞いた安否は事実の 1 語だけ。メモは入れない（本文は要約や訓練で読み返す文）
 */
export function callLogBody(c: CallTarget, result: CallResult, heard: Heard | null = null): string {
  const t = callTargetText(c);
  if (result === "no_answer") return `${t} ${CALL_RESULT_LABELS.no_answer}`;
  if (result === "connected") return [t, CALL_RESULT_LABELS.connected, heard ? heardText(heard) : null].filter((s) => s).join(" ");
  return t;
}

export type CallInput = {
  personId: string;
  contactId: string;
  result: CallResult;
  /** 通話で聞いた安否。通話（connected）のときだけ */
  heard?: Heard | null;
  /** メモ。通話のときだけ */
  memo?: string | null;
};

/** normal は平時の安否、injury は 赤 けが・動けない の人への「無事」（画面は「至急維持」） */
export type CallError = "forbidden" | "not_found" | "invalid" | "normal" | "injury";

export type CallSaveResult = { ok: true } | { ok: false; error: CallError };

const bit = (v: boolean | undefined): 0 | 1 | null => (v === undefined ? null : v ? 1 : 0);

/**
 * 電話の記録を書く。ケアマネの役だけ、事業所の中の本人の、番号のある連絡先だけ。
 * 通話で聞いた安否があれば、災害モードの間だけ信号（出どころ care_manager）を足す（平時は normal で断る。平時の通話だけは残せる）。
 * 保存のときにサーバーで本人を表に当て直し（lib/list/override.ts の saveOverride と同じ personDisaster）、今の表の行が
 * red_injury（けが・動けない）なら「無事」は書かずに断る（injury。下げるなら理由つきの順番変更）。
 * 期限を過ぎた機器の時計・頼り先の未確認・時計の半分は、ケアマネの緑のあとも表がそのまま赤・黄にする（ここでは見ない）
 */
export async function saveCall(db: D1Database, p: Principal | null, input: CallInput, now: string): Promise<CallSaveResult> {
  if (!p || p.role !== "care_manager" || !roleAllows(p.role, "save")) return { ok: false, error: "forbidden" };
  const heard = input.heard ?? null;
  const memo = input.memo?.trim() || null;
  if (input.result !== "connected" && (heard || memo)) return { ok: false, error: "invalid" };
  if (memo && memo.length > MAX_CALL_MEMO) return { ok: false, error: "invalid" };
  const person = await personInScope(db, p, input.personId);
  if (!person) return { ok: false, error: "not_found" };
  const contact = await db
    .prepare("SELECT id, kind, relation, phone FROM contacts WHERE id = ?1 AND person_id = ?2")
    .bind(input.contactId, person.id)
    .first<Pick<ContactRow, "id" | "kind" | "relation" | "phone">>();
  if (!contact) return { ok: false, error: "not_found" };
  if (!contact.phone?.trim()) return { ok: false, error: "invalid" };

  if (heard) {
    const rows = await loadPersonPage(db, p, person.id);
    if (!rows) return { ok: false, error: "not_found" };
    const d = await personDisaster(db, rows, now);
    if (!d.triage) return { ok: false, error: "normal" };
    if (heard.color === "green" && d.triage.rule === "red_injury") return { ok: false, error: "injury" };
  }

  const payload: CallPayload = {
    source: CALL_SOURCE,
    contactId: contact.id,
    contactKind: contact.kind,
    result: input.result,
    ...(heard ? { heard } : {}),
    ...(memo ? { memo } : {}),
  };
  const signalId = heard ? crypto.randomUUID() : null;
  const statements = [];
  if (heard && signalId) {
    statements.push(
      db
        .prepare(
          `INSERT INTO signals (id, person_id, drill_id, color, source, injured, can_move, occurred_at)
           VALUES (?1, ?2, NULL, ?3, 'care_manager', ?4, ?5, ?6)`,
        )
        .bind(signalId, person.id, heard.color, bit(heard.injured), bit(heard.canMove), now),
    );
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, body, payload, signal_id, occurred_at)
         VALUES (?1, ?2, ?3, 'care_manager', 'called', ?4, ?5, ?6, ?7)`,
      )
      .bind(
        crypto.randomUUID(),
        person.id,
        p.accountId,
        callLogBody(contact, input.result, heard),
        JSON.stringify(payload),
        signalId,
        now,
      ),
  );
  await db.batch(statements);
  return { ok: true };
}

/** 行の詳細に出す電話の記録 1 行 */
export type CallLog = {
  at: string;
  /** 日本の短い時刻「11/4 10:42」 */
  when: string;
  body: string;
  result: CallResult | null;
  contactId: string | null;
  who: string | null;
  /** 通話で聞いた安否 */
  heard: Heard | null;
  /** メモ（経過の payload から。本文には無い） */
  memo: string | null;
};

export type CallEntryRow = {
  person_id: string;
  body: string | null;
  payload: string | null;
  occurred_at: string;
  author_name: string | null;
};

/** 経過の called の行（時刻の順）を本人の行の詳細の形に。新しい順 */
export function callLogsOf(rows: ReadonlyArray<CallEntryRow>): CallLog[] {
  return rows
    .map((r) => {
      const p = parseCallPayload(r.payload);
      return {
        at: r.occurred_at,
        when: shortJst(r.occurred_at),
        body: r.body ?? "",
        result: p?.result ?? null,
        contactId: p?.contactId ?? null,
        who: r.author_name,
        heard: p?.heard ?? null,
        memo: p?.memo ?? null,
      };
    })
    .reverse();
}
