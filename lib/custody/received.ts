// 受け入れた人の画面（T152）。医療班・行政の役で本人のページを開いた時の出し方。
// 上に氏名・状態と受け入れた避難所、その下に医療班の要約（薬・機器・アレルギー・連絡先）、次に経過（書き足しと行）、その下に残りの区分。
//
// 中身は本人のページの組み立て（lib/person.ts の toPersonView に見る人の範囲〔lib/consent/scope.ts〕を渡した物）をそのまま使い、
// 区分の行を並べ替えるだけ。範囲の外の行は元から来ないので、ここで見える物は増えない（同意の無い人は本人確認と医療班の書いた経過だけ）。
// 要約に出した行は残りの区分から外す（同じ物を 2 回出さない）。D1 は受け持ちの行を読むだけ。

import type { D1Database } from "@cloudflare/workers-types";
import { shownViaSql, type ShownVia } from "./labels.ts";
import type { Block, PersonView, Section, SectionId } from "../person.ts";
import type { StaffActor } from "./actor.ts";

/** 要約の 4 つ（薬・機器・アレルギー・連絡先）。key は本人のページの欄の名前（lib/person.ts の FIELDS） */
export const SUMMARY_PARTS = [
  { part: "medications", label: "薬", rows: ["medical.medications"] },
  { part: "devices", label: "機器", rows: ["medical.devices"] },
  { part: "allergies", label: "アレルギー", rows: ["medical.allergies"] },
  // 医療班・行政は「人の一部」（緊急連絡先と支援者の役割名）。全部見える役（使わないが同じ形）は 1 人 1 行の一覧
  { part: "contacts", label: "連絡先", rows: ["people.emergency", "people.contacts"] },
] as const;
export type SummaryPart = (typeof SUMMARY_PARTS)[number]["part"];

export type SummaryCell = { part: SummaryPart; label: string; blocks: Block[] };

export type ReceivedLayout = {
  /** 要約の 4 つ。医療が範囲の外（同意なし・未確認）なら null（画面は同意の状態だけ） */
  summary: SummaryCell[] | null;
  /** 経過の区分（範囲の外なら null） */
  timeline: Section | null;
  /** 残りの区分（医療 → 関係者 → 避難 → 基本 → 書類。要約に出した行は外し、空になった区分は出さない） */
  rest: Section[];
};

/** 残りの区分の並び（医療班が先に見る順） */
const REST_ORDER: readonly SectionId[] = ["medical", "people", "evacuation", "basic", "consent", "documents"];

const rowKey = (b: Block): string | null => (b.type === "row" ? b.row.key : null);

export function receivedLayout(view: Pick<PersonView, "sections">): ReceivedLayout {
  const byId = new Map(view.sections.map((s) => [s.id, s]));
  const medical = byId.get("medical");
  const people = byId.get("people");
  const pool = [...(medical?.blocks ?? []), ...(people?.blocks ?? [])];
  const used = new Set<string>();
  const summary: SummaryCell[] | null = medical
    ? SUMMARY_PARTS.map(({ part, label, rows }) => {
        const blocks = pool.filter((b) => {
          const k = rowKey(b);
          return k !== null && (rows as readonly string[]).includes(k);
        });
        for (const b of blocks) used.add(rowKey(b)!);
        return { part, label, blocks };
      })
    : null;
  const rest = REST_ORDER.flatMap((id): Section[] => {
    const s = byId.get(id);
    if (!s) return [];
    const blocks = s.blocks.filter((b) => {
      const k = rowKey(b);
      return k === null || !used.has(k);
    });
    if (blocks.length === 0) return [];
    // 未確認の数は残った行の物だけ数え直す（要約に出した行の未確認は要約の中に出る）
    const unconfirmed = blocks.reduce(
      (n, b) => n + (b.type === "row" ? b.row.pending.length : b.type === "clocks" ? b.clocks.reduce((m, k) => m + k.pending.length, 0) : 0),
      0,
    );
    return [{ ...s, blocks, unconfirmed }];
  });
  return { summary, timeline: byId.get("timeline") ?? null, rest };
}

/** 自分の開いた受け持ち（受け入れた避難所・時刻・入り方）。受け持っていなければ null */
export type OpenCustody = { custodyId: string; shelter: string; via: ShownVia; receivedAt: string };

export async function openCustodyOf(db: D1Database, actor: Pick<StaffActor, "accountId">, personId: string): Promise<OpenCustody | null> {
  const row = await db
    .prepare(
      `SELECT id, shelter, ${shownViaSql("custody")} AS via, received_at FROM custody
        WHERE person_id = ?1 AND holder_id = ?2 AND released_at IS NULL
        ORDER BY received_at DESC, id DESC LIMIT 1`,
    )
    .bind(personId, actor.accountId)
    .first<{ id: string; shelter: string; via: ShownVia; received_at: string }>();
  return row ? { custodyId: row.id, shelter: row.shelter, via: row.via, receivedAt: row.received_at } : null;
}
