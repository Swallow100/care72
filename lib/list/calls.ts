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
  /** サーバーが受けた時刻（T71 の続き）。経過の時刻は端末で押した時刻（callOccurredAt で丸めた物） */
  receivedAt?: string;
  /** 端末で作った重ならない id（同じ id の 2 回目は捨てる。経過の行の id は callEntryId） */
  clientId?: string;
  /** 聞いた安否を信号にしなかった訳（T82）。heard は聞いた事実として残し、表には入れていない */
  uncounted?: CallUncounted;
};

/**
 * 聞いた安否を信号にしなかった訳（T82）。normal は平時、injury は至急維持（赤 けが・動けない の人への「無事」など、T58・T78）、
 * old は古い押下（24 時間より古い・今の発災より前。callOccurredAt）。どれも電話の経過の行は書く
 */
export const CALL_UNCOUNTED = ["normal", "injury", "old"] as const;
export type CallUncounted = (typeof CALL_UNCOUNTED)[number];
const isCallUncounted = (v: unknown): v is CallUncounted => typeof v === "string" && (CALL_UNCOUNTED as readonly string[]).includes(v);

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
      ...(typeof v.receivedAt === "string" ? { receivedAt: v.receivedAt } : {}),
      ...(typeof v.clientId === "string" ? { clientId: v.clientId } : {}),
      ...(heard && isCallUncounted(v.uncounted) ? { uncounted: v.uncounted } : {}),
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
  /** 端末で作った重ならない id（T71 の続き。通信なしで貯めて送り直す記録。無ければサーバーが作る） */
  clientId?: string | null;
  /** 端末で押した時刻（ISO）。経過と信号の時刻にする（callOccurredAt で丸める） */
  pressedAt?: string | null;
};

/** normal は平時の安否、injury は 赤 けが・動けない の人への「無事」（画面は「無事 不可（本人が「けが」）」。T78） */
export type CallError = "forbidden" | "not_found" | "invalid" | "normal" | "injury";

/**
 * duplicate は同じ端末の id の 2 回目（前に届いていたので書かない。端末は届いた扱いで消す）。
 * uncounted は経過の行を書いたが聞いた安否を信号にしなかった訳（T82）。label はそのときの短い言葉（normal・injury だけ。
 * 「無事 不可（本人が「けが」）」「無事 不可（平時）」）。断る（ok false）のは経過も書かない物だけ
 */
export type CallSaveResult =
  | { ok: true; duplicate?: true; uncounted?: CallUncounted; label?: string }
  | { ok: false; error: CallError; label?: string };

/** 信号にしなかった聞いた安否の言葉（T78・T82）: 聞いた安否（「無事」「無事でない」）＋「不可」＋訳 */
const refusalLabel = (heard: Heard, why: string) => `${heard.color === "green" ? HEARD_LABELS.green : HEARD_LABELS.red} 不可（${why}）`;

/**
 * 至急を保つために信号にしなかった通話の言葉（T78）: 聞いた安否＋「不可」＋表の理由の頭（けが・動けないを言った人の答え。
 * 「本人が「けが」」「分類（ケアマネ）: 動けない」）。前は「至急維持」だけで、何を断ったか分からなかった。色と順は表のまま
 */
export function injuryRefusal(heard: Heard, reason: string): string {
  return refusalLabel(heard, reason.split("、")[0]);
}

/** 平時に聞いた安否を信号にしなかった言葉「無事 不可（平時）」（T82。電話の経過は書いたので、前の「平時」だけでは書かなかったように読める） */
export const normalRefusal = (heard: Heard) => refusalLabel(heard, "平時");

const bit = (v: boolean | undefined): 0 | 1 | null => (v === undefined ? null : v ? 1 : 0);

/** 端末で作る id の形（crypto.randomUUID の 36 字が入る。経過の行の id が 64 字に収まる長さ） */
export const CALL_CLIENT_ID = /^[A-Za-z0-9-]{8,40}$/;
export const isCallClientId = (v: unknown): v is string => typeof v === "string" && CALL_CLIENT_ID.test(v);
/** 端末の id から決まる経過の行と信号の id（同じ id の 2 回目は主キーで弾く） */
export const callEntryId = (clientId: string) => `call-${clientId}`;
export const callSignalId = (clientId: string) => `call-${clientId}-s`;

/** 押した時刻を経過に使える古さの上限（ミリ秒） */
export const CALL_PRESSED_MAX_AGE_MS = 24 * 3_600_000;

/** 経過と信号の時刻と、古い押下か（old なら聞いた安否の信号は作らない） */
export type CallTime = { at: string; old: boolean };

/**
 * 経過と信号の時刻: 端末で押した時刻。サーバーの受けた時刻（now）に丸めるのは、読めない物と未来の物（端末の時計が進んでいる）だけ。
 * 24 時間より古い・今の発災より前の押下は、押した時刻のまま返して old を立てる（経過には押した時刻で書き、安否の信号は作らない）。
 * 前（T71 の続き）は古い押下も now に丸めていたので、古い「通話 無事」がいちばん新しい信号になり、あとから来た本人の赤を
 * 上書きしえた（表はいちばん新しい信号で決まる。review 11/4 正しさ 高 1、T82）
 */
export function callOccurredAt(pressedAt: string | null | undefined, now: string, disasterStartedAt: string | null): CallTime {
  const t = Date.parse(pressedAt ?? "");
  const n = Date.parse(now);
  if (!Number.isFinite(t) || !Number.isFinite(n) || t > n) return { at: now, old: false };
  const s = disasterStartedAt ? Date.parse(disasterStartedAt) : NaN;
  const old = n - t > CALL_PRESSED_MAX_AGE_MS || (Number.isFinite(s) && t < s);
  return { at: new Date(t).toISOString(), old };
}

/**
 * 電話の記録を書く。ケアマネの役だけ、事業所の中の本人の、番号のある連絡先だけ。
 * 通話で聞いた安否があれば、災害モードの間だけ信号（出どころ care_manager）を足す。
 * 保存のときにサーバーで本人を表に当て直し（lib/list/override.ts の saveOverride と同じ personDisaster。押した時刻までの信号で）、
 * その時の表の行が red_injury（けが・動けない）なら、「無事」と、けが・動けないのどちらも付けない「無事でない」は信号にしない（injury。
 * どちらも連絡順の組を下げるため。けが か 動けない を付けた「無事でない」は通す。下げるなら理由つきの順番変更）。
 * 平時（normal）と古い押下（old。callOccurredAt）も信号にしない。どれも電話の経過の行は書き、payload に uncounted を残す（T82）。
 * 期限を過ぎた機器の時計・頼り先の未確認・時計の半分は、ケアマネの緑のあとも表がそのまま赤・黄にする（ここでは見ない）
 */
export async function saveCall(db: D1Database, p: Principal | null, input: CallInput, now: string): Promise<CallSaveResult> {
  if (!p || p.role !== "care_manager" || !roleAllows(p.role, "save")) return { ok: false, error: "forbidden" };
  const heard = input.heard ?? null;
  const memo = input.memo?.trim() || null;
  if (input.result !== "connected" && (heard || memo)) return { ok: false, error: "invalid" };
  if (memo && memo.length > MAX_CALL_MEMO) return { ok: false, error: "invalid" };
  const clientId = input.clientId ?? null;
  if (clientId !== null && !isCallClientId(clientId)) return { ok: false, error: "invalid" };
  const person = await personInScope(db, p, input.personId);
  if (!person) return { ok: false, error: "not_found" };
  // 同じ端末の id の 2 回目（応答が落ちて送り直した物）は、前に届いているので書かない。表の今の状態で断り直さない
  if (clientId) {
    const seen = await db
      .prepare("SELECT 1 AS hit FROM timeline_entries WHERE id = ?1 AND person_id = ?2")
      .bind(callEntryId(clientId), person.id)
      .first<{ hit: number }>();
    if (seen) return { ok: true, duplicate: true };
  }
  const contact = await db
    .prepare("SELECT id, kind, relation, phone FROM contacts WHERE id = ?1 AND person_id = ?2")
    .bind(input.contactId, person.id)
    .first<Pick<ContactRow, "id" | "kind" | "relation" | "phone">>();
  if (!contact) return { ok: false, error: "not_found" };
  if (!contact.phone?.trim()) return { ok: false, error: "invalid" };

  // 押した時刻（丸めたあと）。発災より前かは事業所の今の災害モードの始まりで見る
  const disaster = await db
    .prepare("SELECT started_at FROM disaster_state WHERE office_id = ?1")
    .bind(person.office_id)
    .first<{ started_at: string | null }>();
  const time = callOccurredAt(input.pressedAt, now, disaster?.started_at ?? null);
  const occurredAt = time.at;

  // 聞いた安否を信号にするか。しないときも電話の経過の行は書く（端末の保留から送り直した通話の記録を捨てない。review 中 2、T82）
  let uncounted: CallUncounted | null = null;
  let label: string | undefined;
  if (heard) {
    if (time.old) uncounted = "old";
    else {
      const rows = await loadPersonPage(db, p, person.id);
      if (!rows) return { ok: false, error: "not_found" };
      // 押した時刻までの信号で当てる（押したあとに来た本人の「けが」で断らない。表はいちばん新しい信号で決まるので、
      // 押した時刻の「無事」はあとの「けが」を上書きしない）
      const d = await personDisaster(db, rows, occurredAt);
      const keepsInjury = heard.color === "red" && (heard.injured === true || heard.canMove === false);
      if (!d.triage) {
        uncounted = "normal";
        label = normalRefusal(heard);
      } else if (d.triage.rule === "red_injury" && !keepsInjury) {
        uncounted = "injury";
        label = injuryRefusal(heard, d.triage.reason);
      }
    }
  }

  const payload: CallPayload = {
    source: CALL_SOURCE,
    contactId: contact.id,
    contactKind: contact.kind,
    result: input.result,
    ...(heard ? { heard } : {}),
    ...(memo ? { memo } : {}),
    receivedAt: now,
    ...(clientId ? { clientId } : {}),
    ...(heard && uncounted ? { uncounted } : {}),
  };
  const signalId = heard && !uncounted ? (clientId ? callSignalId(clientId) : crypto.randomUUID()) : null;
  const statements = [];
  // 重ねないのは同じ id だけ（ON CONFLICT(id)）。INSERT OR IGNORE は CHECK の違反も黙って捨て、書けていないのに届いた扱いにしえた
  if (heard && signalId) {
    statements.push(
      db
        .prepare(
          `INSERT INTO signals (id, person_id, drill_id, color, source, injured, can_move, occurred_at)
           VALUES (?1, ?2, NULL, ?3, 'care_manager', ?4, ?5, ?6)
           ON CONFLICT(id) DO NOTHING`,
        )
        .bind(signalId, person.id, heard.color, bit(heard.injured), bit(heard.canMove), occurredAt),
    );
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, body, payload, signal_id, occurred_at)
         VALUES (?1, ?2, ?3, 'care_manager', 'called', ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(
        clientId ? callEntryId(clientId) : crypto.randomUUID(),
        person.id,
        p.accountId,
        callLogBody(contact, input.result, heard),
        JSON.stringify(payload),
        signalId,
        occurredAt,
      ),
  );
  const results = await db.batch(statements);
  // 同じ id が同時に 2 つ来たときは、先に書いた方だけが残る（主キー）
  const wrote = (results[results.length - 1] as { meta?: { changes?: number } } | undefined)?.meta?.changes;
  if (clientId && wrote === 0) return { ok: true, duplicate: true };
  return uncounted ? { ok: true, uncounted, ...(label ? { label } : {}) } : { ok: true };
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
  /** 聞いた安否を信号にしなかった訳（T82。行の詳細は意味色で塗らない） */
  uncounted: CallUncounted | null;
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
        uncounted: p?.uncounted ?? null,
        memo: p?.memo ?? null,
      };
    })
    .reverse();
}
