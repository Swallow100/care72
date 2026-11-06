// 医療班への受入依頼（docs/tasks/T163.md、migrations/0039_custody_requests.sql）。D1 と役の物を引数で受け取る（テストで node:sqlite）。
//
// 流れ: ケアマネ（事業所）が本人を依頼として送る → 医療班の受入一覧の上の「受入依頼」に出る → 医療班が「受入」か「受入不可」を返す
// → 本人のページ（事業所の側）に返事が見える。訓練の外（発災時・デモの発災開始）の道。訓練の中の「受入依頼」の手（福祉避難所へ）は別。
//
// - 送れるのは医療班への提供に同意（granted）のある人だけ。未確認・不同意はサーバーが断る（consent）。受け入れる時にもう一度見る
// - 宛先は医療班の役（アカウントを決めない）。行政の役には出さない。審査員（壁の中、lib/auth/wall.ts）はデモの人の依頼だけ
// - 受け入れる前の依頼の行は本人確認の範囲（カナ・年齢）と依頼元の事業所・行き先・依頼の時刻だけ。漢字の氏名・住所・電話・薬・機器は
//   返さない（型にも持たない。氏名検索のヒットと同じ線、lib/custody/search.ts）。受け入れて提供の記録を書いてから本人のページで見る
// - 受入は今の受け入れ（lib/custody/store.ts の receive）を通す。受け持ちの一意・壁・第三者提供の記録・経過の「受入 避難所」はそのまま。
//   受け持ちの入り方（custody.via）は表の CHECK を変えないため search（登録済の人を引いた形）にし、依頼の行の custody_id で結ぶ
// - 返事は 2 つの決まった言葉だけ（自由文の理由の欄は持たない。医療の助言の入口にしない。医療班からケアマネへの伝達も今はなし、T172）。Claude は呼ばない
// - 依頼・返事は色と連絡順の入力にしない（受け入れたあとは今の受け入れと同じに、ルールの表が「受入」を読む）

import type { D1Database } from "@cloudflare/workers-types";
import { ageOn } from "../age.ts";
import { DEMO_OFFICE_ID } from "../auth/demo.ts";
import { JUDGE_LABEL } from "../auth/roles.ts";
import { demoPersonSql } from "../auth/wall.ts";
import type { CustodyRequestState } from "../db/types.ts";
import type { OfficeActor } from "../office/scope.ts";
import type { StaffActor } from "./actor.ts";
import type { CustodyError } from "./labels.ts";
import { receive } from "./store.ts";

/** 受入一覧の上の依頼の 1 行。住所・電話・漢字の氏名・医療の中身は持たない */
export type RequestHit = {
  id: string;
  personId: string;
  kana: string;
  age: number | null;
  /** 依頼元の事業所の名前 */
  office: string;
  /** 行き先（受け入れたときの避難所） */
  shelter: string;
  requestedAt: string;
};

/** 本人のページ（事業所の側）の依頼の状態。返事をした人は名前の写し（審査員は「審査員」） */
export type RequestStatus = {
  id: string;
  state: CustodyRequestState;
  shelter: string;
  requestedAt: string;
  repliedName: string | null;
  repliedAt: string | null;
};

/** 依頼の欄の見え方: 送れる・同意なし（医療班への提供が granted でない） */
export type RequestPanel = { canSend: boolean; latest: RequestStatus | null; defaultShelter: string };

/** 医療班の役だけ依頼を見る・返す（行政は受け持つが、依頼の宛先ではない） */
export function seesRequests(actor: Pick<StaffActor, "role">): boolean {
  return actor.role === "medical";
}

function wallOf(actor: Pick<StaffActor, "walled" | "wallOffice">, alias = "p"): string {
  return actor.walled ? ` AND ${demoPersonSql(alias, actor.wallOffice ?? DEMO_OFFICE_ID)}` : "";
}

const MEDICAL_GRANTED = (alias: string) =>
  `EXISTS (SELECT 1 FROM consents k WHERE k.person_id = ${alias}.id AND k.kind = 'medical' AND k.status = 'granted')`;

export type SendResult = { ok: true; requestId: string } | { ok: false; error: CustodyError };

/**
 * 依頼を送る（ケアマネの役。事業所の中の人だけ）。shelter は行き先（空は断る。lib/custody/forms.ts の parseShelter を通した値）。
 * 同意が無ければ consent、依頼中が既にあれば pending、事業所の外の人は not_found
 */
export async function sendRequest(
  db: D1Database,
  actor: Pick<OfficeActor, "officeId" | "authorId">,
  input: { personId: string; shelter: string },
  at: string,
  id: string = `rq-${crypto.randomUUID()}`,
): Promise<SendResult> {
  const person = await db
    .prepare(
      `SELECT p.id, ${MEDICAL_GRANTED("p")} AS granted,
              EXISTS (SELECT 1 FROM custody_requests r WHERE r.person_id = p.id AND r.state = 'open') AS pending
         FROM people p WHERE p.id = ?1 AND p.office_id = ?2`,
    )
    .bind(input.personId, actor.officeId)
    .first<{ id: string; granted: number; pending: number }>();
  if (!person) return { ok: false, error: "not_found" };
  if (Number(person.granted) !== 1) return { ok: false, error: "consent" };
  if (Number(person.pending) === 1) return { ok: false, error: "pending" };
  try {
    await db
      .prepare(
        `INSERT INTO custody_requests (id, person_id, office_id, requested_by, shelter, state, requested_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'open', ?6)`,
      )
      .bind(id, person.id, actor.officeId, actor.authorId, input.shelter, at)
      .run();
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) return { ok: false, error: "pending" };
    throw e;
  }
  return { ok: true, requestId: id };
}

export type ReplyResult = { ok: true; personId: string; custodyId: string | null } | { ok: false; error: CustodyError };

/** 依頼を下げる（ケアマネの役。事業所の中の依頼中だけ） */
export async function withdrawRequest(
  db: D1Database,
  actor: Pick<OfficeActor, "officeId" | "authorId">,
  requestId: string,
  at: string,
): Promise<ReplyResult> {
  const row = await db
    .prepare("SELECT person_id, state FROM custody_requests WHERE id = ?1 AND office_id = ?2")
    .bind(requestId, actor.officeId)
    .first<{ person_id: string; state: CustodyRequestState }>();
  if (!row) return { ok: false, error: "not_found" };
  if (row.state !== "open") return { ok: false, error: "answered" };
  const r = await db
    .prepare(
      `UPDATE custody_requests SET state = 'withdrawn', replied_by = ?3, replied_role = 'care_manager', replied_name = NULL, replied_at = ?4
        WHERE id = ?1 AND office_id = ?2 AND state = 'open'`,
    )
    .bind(requestId, actor.officeId, actor.authorId, at)
    .run();
  if ((r.meta.changes ?? 0) === 0) return { ok: false, error: "answered" };
  return { ok: true, personId: row.person_id, custodyId: null };
}

type HitRow = { id: string; person_id: string; kana: string; birth_date: string | null; reported_age: number | null; office: string; shelter: string; requested_at: string };

/** 医療班に出す依頼中の一覧（古い順）。行政・ほかの役は空。審査員はデモの人の依頼だけ */
export async function openRequests(db: D1Database, actor: StaffActor, today: string): Promise<RequestHit[]> {
  if (!seesRequests(actor)) return [];
  const res = await db
    .prepare(
      `SELECT r.id, r.person_id, p.kana, p.birth_date, p.reported_age, o.name AS office, r.shelter, r.requested_at
         FROM custody_requests r JOIN people p ON p.id = r.person_id JOIN offices o ON o.id = r.office_id
        WHERE r.state = 'open'${wallOf(actor)}
        ORDER BY r.requested_at, r.id`,
    )
    .all<HitRow>();
  return res.results.map((r) => ({
    id: r.id,
    personId: r.person_id,
    kana: r.kana,
    age: (r.birth_date ? ageOn(r.birth_date, today) : r.reported_age) ?? null,
    office: r.office,
    shelter: r.shelter,
    requestedAt: r.requested_at,
  }));
}

async function openRequestFor(db: D1Database, actor: StaffActor, requestId: string) {
  return db
    .prepare(
      `SELECT r.id, r.person_id, r.shelter, r.state, ${MEDICAL_GRANTED("p")} AS granted
         FROM custody_requests r JOIN people p ON p.id = r.person_id
        WHERE r.id = ?1${wallOf(actor)}`,
    )
    .bind(requestId)
    .first<{ id: string; person_id: string; shelter: string; state: CustodyRequestState; granted: number }>();
}

function repliedName(actor: StaffActor): string | null {
  return actor.name ?? (actor.judge ? JUDGE_LABEL : null);
}

/**
 * 受け入れる（医療班の役）。今の受け入れ（receive）を通し、依頼の行に受け持ちを結ぶ。
 * 先に依頼を「受入」にして（同時に押したほかの医療班は answered）、受け入れに失敗したら依頼中に戻す。
 * 自分がもう受け入れている人は、その受け持ちを結ぶ（誤りにしない）。
 * shelter は一括受入の 1 回の入力（T172。parseShelter を通した値）。無ければ依頼の行き先。依頼の行の行き先は実際の受け持ちの避難所に合わせる
 * （事業所の側の本人のページはこの行き先を出すので、別の避難所で受け入れたら居場所が食い違う）
 */
export async function acceptRequest(db: D1Database, actor: StaffActor, requestId: string, at: string, shelter?: string): Promise<ReplyResult> {
  if (!seesRequests(actor)) return { ok: false, error: "forbidden" };
  const req = await openRequestFor(db, actor, requestId);
  if (!req) return { ok: false, error: "not_found" };
  if (req.state !== "open") return { ok: false, error: "answered" };
  // 送ったあとに同意が変わった人は受け入れの道に乗せない（依頼は同意が前提）
  if (Number(req.granted) !== 1) return { ok: false, error: "consent" };
  const claim = await db
    .prepare(
      `UPDATE custody_requests SET state = 'accepted', replied_by = ?2, replied_role = ?3, replied_name = ?4, replied_at = ?5
        WHERE id = ?1 AND state = 'open'`,
    )
    .bind(requestId, actor.accountId, actor.role, repliedName(actor), at)
    .run();
  if ((claim.meta.changes ?? 0) === 0) return { ok: false, error: "answered" };

  const place = shelter ?? req.shelter;
  const r = await receive(db, actor, { personId: req.person_id, shelter: place, via: "search" }, at);
  let custodyId: string | null = r.ok ? r.custodyId : null;
  let held = place;
  if (!r.ok && r.error === "already") {
    const open = await db
      .prepare("SELECT id, shelter FROM custody WHERE person_id = ?1 AND holder_id = ?2 AND released_at IS NULL")
      .bind(req.person_id, actor.accountId)
      .first<{ id: string; shelter: string }>();
    custodyId = open?.id ?? null;
    held = open?.shelter ?? place;
  }
  if (!custodyId) {
    await db
      .prepare(
        `UPDATE custody_requests SET state = 'open', replied_by = NULL, replied_role = NULL, replied_name = NULL, replied_at = NULL
          WHERE id = ?1 AND state = 'accepted' AND replied_by = ?2 AND replied_at = ?3`,
      )
      .bind(requestId, actor.accountId, at)
      .run();
    return { ok: false, error: r.ok ? "conflict" : r.error };
  }
  await db.prepare("UPDATE custody_requests SET custody_id = ?2, shelter = ?3 WHERE id = ?1").bind(requestId, custodyId, held).run();
  return { ok: true, personId: req.person_id, custodyId };
}

/** 受入不可を返す（医療班の役）。依頼中だけ */
export async function declineRequest(db: D1Database, actor: StaffActor, requestId: string, at: string): Promise<ReplyResult> {
  if (!seesRequests(actor)) return { ok: false, error: "forbidden" };
  const req = await openRequestFor(db, actor, requestId);
  if (!req) return { ok: false, error: "not_found" };
  if (req.state !== "open") return { ok: false, error: "answered" };
  const r = await db
    .prepare(
      `UPDATE custody_requests SET state = 'declined', replied_by = ?2, replied_role = ?3, replied_name = ?4, replied_at = ?5
        WHERE id = ?1 AND state = 'open'`,
    )
    .bind(requestId, actor.accountId, actor.role, repliedName(actor), at)
    .run();
  if ((r.meta.changes ?? 0) === 0) return { ok: false, error: "answered" };
  return { ok: true, personId: req.person_id, custodyId: null };
}

/** 本人の最後の依頼（事業所の側の本人のページ）。無ければ null。事業所の壁は呼ぶ側（本人のページを開けた人） */
export async function latestRequestOf(db: D1Database, personId: string): Promise<RequestStatus | null> {
  const r = await db
    .prepare(
      `SELECT id, state, shelter, requested_at, replied_name, replied_role, replied_at FROM custody_requests
        WHERE person_id = ?1 ORDER BY requested_at DESC, id DESC LIMIT 1`,
    )
    .bind(personId)
    .first<{ id: string; state: CustodyRequestState; shelter: string; requested_at: string; replied_name: string | null; replied_role: string | null; replied_at: string | null }>();
  if (!r) return null;
  return {
    id: r.id,
    state: r.state,
    shelter: r.shelter,
    requestedAt: r.requested_at,
    // 取消はケアマネの側の操作なので名前を出さない
    repliedName: r.replied_role === "care_manager" ? null : r.replied_name,
    repliedAt: r.replied_at,
  };
}

/** 依頼の欄の中身（ケアマネの役の本人のページ）。行き先の既定は台帳の避難先 1（呼ぶ側が渡す。無ければ空） */
export async function requestPanelOf(db: D1Database, personId: string, defaultShelter: string): Promise<RequestPanel> {
  const [granted, latest] = await Promise.all([
    db
      .prepare("SELECT 1 AS ok FROM consents WHERE person_id = ?1 AND kind = 'medical' AND status = 'granted'")
      .bind(personId)
      .first<{ ok: number }>(),
    latestRequestOf(db, personId),
  ]);
  return { canSend: !!granted, latest, defaultShelter };
}
