// スマホ入口の版を D1 で持つ（migrations/0018_phone_link.sql の people.phone_link_generation・phone_link_issued_at、T69a）。
// 作る・作り直すは版を 1 つ上げて時刻を書き、本人の経過に「スマホ入口 発行」「スマホ入口 再発行」を 1 行（同じ batch）。
// 本人の行の version・updated_at は変えない（台帳の中身は変わらない）。リンクは版と時刻から署名で作り直す（lib/qr/phone-link.ts）。
//
// リンクで開ける人（resolvePhoneLink と、開いたあとのセッションの principalOf が同じ linkTarget を通る）:
// - 本人用（連絡先なし）: 本人が一覧にいる（people.unlisted_at IS NULL）こと
// - 家族用: 連絡先の行がその本人の物で、答えられる種類（家族・支援者・民生委員。lib/signals/labels.ts の SIGNAL_WRITER_KINDS。
//   lib/signals/family.ts の familyWriterOf と同じ範囲）。本人の電話（self）・機関の連絡先は通さない
// どの失敗も同じ null（どこで落ちたかを頁に出さない）。

import type { D1Database } from "@cloudflare/workers-types";
import type { ContactKind, OfficeKind, PersonListMark, PersonPhoneLink } from "../db/types.ts";
import { isSignalWriterKind } from "../signals/labels.ts";
import { phoneLinkTimes, signPhoneLink, verifyPhoneLink, PHONE_LINK_TTL_SEC, type PhoneLinkPayload } from "./phone-link.ts";

/** 本人の行のスマホ入口の列と、一覧から外した印 */
export type PhoneLinkRow = PersonPhoneLink & PersonListMark;

/** スマホ入口の状態: 未発行・有効・期限切れ */
export type PhoneLinkStatus = "none" | "active" | "expired";

export type PhoneLinkState = {
  status: PhoneLinkStatus;
  /** 版（0 はまだ作っていない） */
  generation: number;
  /** 作った時刻（ISO） */
  issuedAt: string | null;
  /** 期限（ISO）。作った時刻から 180 日 */
  expiresAt: string | null;
};

function issuedSec(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

/** 版と時刻から状態を作る。now は秒 */
export function phoneLinkState(row: PersonPhoneLink, now: number): PhoneLinkState {
  const iat = issuedSec(row.phone_link_issued_at);
  if (row.phone_link_generation < 1 || iat === null) {
    return { status: "none", generation: row.phone_link_generation, issuedAt: null, expiresAt: null };
  }
  const { exp } = phoneLinkTimes(iat);
  return {
    status: exp > now ? "active" : "expired",
    generation: row.phone_link_generation,
    issuedAt: row.phone_link_issued_at,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export async function loadPhoneLinkRow(db: D1Database, personId: string): Promise<PhoneLinkRow | null> {
  return db
    .prepare("SELECT phone_link_generation, phone_link_issued_at, unlisted_at FROM people WHERE id = ?1")
    .bind(personId)
    .first<PhoneLinkRow>();
}

/** 経過の payload の出どころ（kind は note。kind を足すと timeline_entries の CHECK の建て直しが要るので、QR の閲覧と同じ作り） */
export const PHONE_LINK_SOURCE = "phone_link";
export type PhoneLinkLogPayload = { source: typeof PHONE_LINK_SOURCE; generation: number };

/** 経過の本文。版 1 は発行、2 から再発行 */
export const PHONE_LINK_LOG = { issued: "スマホ入口 発行", reissued: "スマホ入口 再発行" } as const;

/** 作る人（ケアマネ）。事業所の中の本人だけ。書き手は経過の author_id（審査員は審査員のアカウント） */
export type PhoneLinkIssuer = { officeId: string; authorId: string | null };

/**
 * 作る・作り直す。版を 1 つ上げ、作った時刻を書き、本人の経過に 1 行（1 つの batch）。前の版のリンクとセッションはこれで通らなくなる。
 * 事業所の外の本人・無い本人は何も書かず null
 */
export async function issuePhoneLink(
  db: D1Database,
  issuer: PhoneLinkIssuer,
  personId: string,
  nowIso: string,
): Promise<PhoneLinkRow | null> {
  const [updated] = await db.batch([
    db
      .prepare(
        `UPDATE people SET phone_link_generation = phone_link_generation + 1, phone_link_issued_at = ?2
          WHERE id = ?1 AND office_id = ?3`,
      )
      .bind(personId, nowIso, issuer.officeId),
    // 経過の行は書き換えたあとの版から（読んでから書くあいだに別の人が作り直しても、版と本文が食い違わない）
    db
      .prepare(
        `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, body, payload, occurred_at)
         SELECT ?1, p.id, ?3, 'care_manager', 'note',
                CASE WHEN p.phone_link_generation = 1 THEN ?5 ELSE ?6 END,
                json_object('source', ?7, 'generation', p.phone_link_generation), ?4
           FROM people p WHERE p.id = ?2 AND p.office_id = ?8 AND p.phone_link_issued_at = ?4`,
      )
      .bind(
        crypto.randomUUID(),
        personId,
        issuer.authorId,
        nowIso,
        PHONE_LINK_LOG.issued,
        PHONE_LINK_LOG.reissued,
        PHONE_LINK_SOURCE,
        issuer.officeId,
      ),
  ]);
  if ((updated.meta.changes ?? 0) === 0) return null;
  return loadPhoneLinkRow(db, personId);
}

/** 今の版のリンクのトークン。まだ作っていなければ null（期限切れでも作る。期限切れかは phoneLinkState で見る） */
export async function currentPhoneLinkToken(
  personId: string,
  contactId: string | null,
  row: PersonPhoneLink,
  secret: string,
): Promise<string | null> {
  const iat = issuedSec(row.phone_link_issued_at);
  if (row.phone_link_generation < 1 || iat === null) return null;
  return signPhoneLink({ v: 1, p: personId, c: contactId, g: row.phone_link_generation, ...phoneLinkTimes(iat) }, secret);
}

/** リンクで開く先の本人と事業所（と家族用なら連絡先）。開いたあとのセッションの Principal もここから作る */
export type LinkTarget = {
  personId: string;
  personName: string;
  office: { id: string; name: string; kind: OfficeKind };
  /** 家族用の連絡先。本人用は null */
  contact: { id: string; name: string | null } | null;
  generation: number;
  issuedAt: string | null;
};

type TargetJoin = {
  name: string;
  unlisted_at: string | null;
  phone_link_generation: number;
  phone_link_issued_at: string | null;
  office_id: string;
  office_name: string;
  office_kind: OfficeKind;
};

/**
 * 本人（と連絡先）がリンクで開ける形か。版が g と同じ・本人が一覧にいる・事業所がある・家族用なら連絡先の行が本人の物で答えられる種類。
 * 違えば null（次の要求から入れない）
 */
export async function linkTarget(
  db: D1Database,
  input: { personId: string; contactId: string | null; generation: number },
): Promise<LinkTarget | null> {
  const p = await db
    .prepare(
      `SELECT p.name, p.unlisted_at, p.phone_link_generation, p.phone_link_issued_at,
              o.id AS office_id, o.name AS office_name, o.kind AS office_kind
         FROM people p JOIN offices o ON o.id = p.office_id
        WHERE p.id = ?1`,
    )
    .bind(input.personId)
    .first<TargetJoin>();
  if (!p || p.unlisted_at !== null || p.phone_link_generation < 1 || p.phone_link_generation !== input.generation) return null;
  const base = {
    personId: input.personId,
    personName: p.name,
    office: { id: p.office_id, name: p.office_name, kind: p.office_kind },
    generation: p.phone_link_generation,
    issuedAt: p.phone_link_issued_at,
  };
  if (input.contactId === null) return { ...base, contact: null };
  const c = await db
    .prepare("SELECT id, name, kind FROM contacts WHERE id = ?1 AND person_id = ?2")
    .bind(input.contactId, input.personId)
    .first<{ id: string; name: string | null; kind: ContactKind }>();
  if (!c || !isSignalWriterKind(c.kind)) return null;
  return { ...base, contact: { id: c.id, name: c.name } };
}

/**
 * リンクを確かめる: 署名・形・期限（verifyPhoneLink）のあとに、本人の行の今の版と作った時刻、本人・連絡先の行を比べる。
 * 作り直した前の版・時刻が違う・期限が 180 日でない・一覧から外した本人・ほかの本人の連絡先・本人の電話・機関の連絡先は null
 */
export async function resolvePhoneLink(
  db: D1Database,
  secret: string,
  token: string | null | undefined,
  now: number,
): Promise<{ payload: PhoneLinkPayload; target: LinkTarget } | null> {
  const payload = await verifyPhoneLink(token, secret, now);
  if (!payload) return null;
  const target = await linkTarget(db, { personId: payload.p, contactId: payload.c, generation: payload.g });
  if (!target) return null;
  const iat = issuedSec(target.issuedAt);
  if (iat === null || iat !== payload.iat || payload.exp !== iat + PHONE_LINK_TTL_SEC) return null;
  return { payload, target };
}
