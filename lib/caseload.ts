// ケアマネの担当一覧。D1 から読んで、画面の 1 行の形にする。
// 災害モード（lib/disaster）のときは、信号と台帳の時計をルールの表（lib/triage）に当てて、行に色と理由の 1 行を付け、
// 既定の並び（優先）を表の並びにする。発災時の列の増え方と行の詳細は T13。

import type { D1Database } from "@cloudflare/workers-types";
import { ageOn } from "./age.ts";
import { parseLedger } from "./db/ledger.ts";
import type { CareLevel, ClockRow, ContactRow, GeoPoint, HazardKind, Ledger, PersonRow, PlanStatus } from "./db/types.ts";
import { loadDisasterState } from "./disaster/db.ts";
import { toSituation, type DisasterSituation, type DisasterState } from "./disaster/state.ts";
import { loadOfficeSignals, triageInDisaster } from "./disaster/triage.ts";
import { DEPENDENCE_MARKS, HAZARD_LABELS } from "./labels.ts";
import { isGeoPoint } from "./map/geo.ts";
import type { StateTone } from "./person.ts";
import { compareResults, tierOf, type Tier, type TriageResult, type TriageSignal } from "./triage/index.ts";
import { toTriagePerson } from "./triage/from-ledger.ts";

export type CaseloadRow = {
  id: string;
  name: string;
  kana: string;
  age: number | null;
  careLevel: CareLevel | null;
  /** 医療依存の短い印（酸素・透析など） */
  marks: string[];
  /** ハザード（浸水 3 m・土砂・津波） */
  hazards: string[];
  /** 避難支援等実施者の人数 */
  supporters: number;
  plan: PlanStatus;
  /** 未確認の項目の数 */
  pending: number;
  /** 優先の骨格 1〜8 */
  tier: Tier;
  /** 災害モードのときのルールの表の結果（色・理由の 1 行・並びの鍵）。平時は null */
  triage: TriageResult | null;
  // ---------- 右の面（T14）の地図と内訳に使う ----------
  /** 未確認の項目の台帳の中の場所（pending の field） */
  pendingFields: string[];
  /** ハザードの種類と浸水の深さ（hazards の元。右の面の人数と地図の層） */
  hazardKinds: Array<{ kind: HazardKind; depthM: number | null }>;
  /** 避難先 1 */
  destination: string | null;
  /** 地図のピンの位置（架空）。無ければ地図に出さない */
  location: GeoPoint | null;
};

/** 一覧から外した人（T30。担当一覧の下の畳み「外した人 N」）。外した時刻の新しい順 */
export type UnlistedRow = { id: string; name: string; kana: string; unlistedAt: string };

export type Caseload = {
  office: { id: string; name: string };
  careManager: { id: string; name: string };
  /** 事業所の災害の状態（平時も） */
  disaster: DisasterState;
  /** 災害モードのとき、表に渡した状況。平時は null */
  situation: DisasterSituation | null;
  /** 一覧にいる人（外した人は入れない） */
  rows: CaseloadRow[];
  /** このケアマネの担当で、一覧から外した人 */
  unlisted: UnlistedRow[];
};

type PersonForList = Pick<
  PersonRow,
  "id" | "name" | "kana" | "birth_date" | "plan_status" | "self_report_unreliable" | "ledger"
>;
type ClockForList = Pick<
  ClockRow,
  "person_id" | "kind" | "category" | "label" | "value" | "unit" | "starts_on" | "depends_on" | "depends_check"
>;
type ContactForList = Pick<ContactRow, "person_id" | "supporter_order">;

/** 医療依存の短い印（酸素・透析など）。並びは優先の骨格の順。担当一覧の行と本人のページの上で同じ物を出す */
export function marksOf(clocks: ReadonlyArray<Pick<ClockRow, "category">>): string[] {
  const categories = new Set(clocks.map((k) => k.category));
  return DEPENDENCE_MARKS.filter(([c]) => categories.has(c)).map(([, label]) => label);
}

/** ハザード（浸水 3 m・土砂・津波） */
export function hazardsOf(ledger: Pick<Ledger, "evacuation">): string[] {
  return ledger.evacuation.hazards.map((h) =>
    h.depthM != null ? `${HAZARD_LABELS[h.kind]} ${h.depthM} m` : HAZARD_LABELS[h.kind],
  );
}

/** 災害モードのときの入力。situation が null（平時）なら色を付けない */
export type CaseloadDisaster = {
  situation: DisasterSituation | null;
  /** 本人ごとの信号（訓練でない物、発災から今まで） */
  signals: ReadonlyMap<string, ReadonlyArray<TriageSignal>>;
};

/** 行の形にする（D1 を使わない所。テストしやすいように分けた）。disaster を渡すと災害モードの色と理由を付ける */
export function toCaseloadRows(
  people: PersonForList[],
  clocks: ClockForList[],
  contacts: ContactForList[],
  today: string,
  disaster?: CaseloadDisaster,
): CaseloadRow[] {
  return people.map((p) => {
    const ledger = parseLedger(p.ledger);
    const myClocks = clocks.filter((k) => k.person_id === p.id);
    const myContacts = contacts.filter((c) => c.person_id === p.id);
    const person = toTriagePerson({ person: p, ledger, contacts: myContacts, clocks: myClocks });
    const s = disaster?.situation ?? null;
    const triage = s
      ? triageInDisaster(
          { person, signals: disaster?.signals.get(p.id) ?? [], town: ledger.basic.address?.town ?? null },
          s,
        )
      : null;
    return {
      id: p.id,
      name: p.name,
      kana: p.kana,
      age: p.birth_date ? ageOn(p.birth_date, today) : null,
      careLevel: ledger.care.careLevel ?? null,
      marks: marksOf(myClocks),
      hazards: hazardsOf(ledger),
      supporters: myContacts.filter((c) => c.supporter_order != null).length,
      plan: p.plan_status,
      pending: ledger.pending.length,
      tier: tierOf(person),
      triage,
      pendingFields: ledger.pending.map((x) => x.field),
      hazardKinds: ledger.evacuation.hazards.map((h) => ({ kind: h.kind, depthM: h.depthM ?? null })),
      destination: ledger.evacuation.destination1?.trim() || null,
      location: isGeoPoint(ledger.basic.location) ? ledger.basic.location : null,
    };
  });
}

export const SORT_KEYS = ["tier", "kana", "age", "plan"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

const PLAN_ORDER: Record<PlanStatus, number> = { none: 0, draft: 1, consented: 2, trained: 3 };

/**
 * 計画の状態の色（意味色。CLAUDE.md「画面の決まり」）。未作成は灰、下書きは黄（要確認）、同意済・訓練済は緑。
 * 色は印と数字にだけ置き、必ず状態の文字（未作成・下書き・同意済・訓練済）を添える
 */
export const PLAN_TONES: Record<PlanStatus, StateTone> = { none: "unknown", draft: "check", consented: "ok", trained: "ok" };

/**
 * 並び替え。どの並びでも、同じならカナの順。
 * 優先（tier）は、平時は骨格の段、災害モード（行に triage がある）ならルールの表の並び（色 → 時計の残り → 支援者なし → 骨格）
 */
export function sortCaseload(rows: CaseloadRow[], key: SortKey): CaseloadRow[] {
  const byKana = (a: CaseloadRow, b: CaseloadRow) => a.kana.localeCompare(b.kana, "ja");
  const primary: Record<SortKey, (a: CaseloadRow, b: CaseloadRow) => number> = {
    tier: (a, b) => (a.triage && b.triage ? compareResults(a.triage, b.triage) : a.tier - b.tier),
    kana: () => 0,
    age: (a, b) => (b.age ?? -1) - (a.age ?? -1),
    plan: (a, b) => PLAN_ORDER[a.plan] - PLAN_ORDER[b.plan] || b.pending - a.pending,
  };
  return [...rows].sort((a, b) => primary[key](a, b) || byKana(a, b));
}

// ---------- 右に開く本人のページ（?open=<id>、docs/tasks/T02.md） ----------
// URL だけで開け閉めする。同じ「/」の query が変わるだけなので別ページに飛ばない。
// 開くときは履歴に足し、開いている間に別の行を押すと履歴を置き換える。だからブラウザの戻るで閉じる。

/** 担当一覧の URL。sort は並び（既定の優先は書かない）、open は右に開く本人 */
export function caseloadHref(q: { sort?: SortKey; open?: string | null }): string {
  const params = new URLSearchParams();
  if (q.sort && q.sort !== "tier") params.set("sort", q.sort);
  if (q.open) params.set("open", q.open);
  const s = params.toString();
  return s ? `/?${s}` : "/";
}

const OPEN_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** URL の open を読む。1 つの id の形のときだけ。読むときは personInScope を通す（形が合っても範囲の外は出さない） */
export function parseOpen(v: string | string[] | undefined): string | null {
  return typeof v === "string" && OPEN_ID.test(v) ? v : null;
}

export type RowLink = { href: string; replace: boolean; current: boolean };

/** 一覧の行のリンク。閉じているときは開く（履歴に足す）、開いているときは切り替える（置き換える） */
export function rowLink(sort: SortKey, open: string | null, id: string): RowLink {
  return { href: caseloadHref({ sort, open: id }), replace: open !== null, current: open === id };
}

/** 右の面を閉じる */
export function closeHref(sort: SortKey): string {
  return caseloadHref({ sort });
}

/**
 * ケアマネ 1 人の担当を読む。範囲は lib/auth/scope.ts の caseloadScope（事業所とケアマネ）。
 * ケアマネがその事業所にいなければ null。本人も事業所で絞る（事業所の壁）。
 * 一覧から外した人（people.unlisted_at、T30）は行に入れず、unlisted に名前だけ
 */
export async function loadCaseload(
  db: D1Database,
  scope: { officeId: string; careManagerId: string },
  today: string,
  now: string = new Date().toISOString(),
): Promise<Caseload | null> {
  const cm = await db
    .prepare(
      `SELECT a.id, a.display_name, o.id AS office_id, o.name AS office_name
         FROM accounts a JOIN offices o ON o.id = a.office_id
        WHERE a.id = ?1 AND a.office_id = ?2 AND a.role = 'care_manager'`,
    )
    .bind(scope.careManagerId, scope.officeId)
    .first<{ id: string; display_name: string; office_id: string; office_name: string }>();
  if (!cm) return null;

  const mine = "SELECT id FROM people WHERE care_manager_id = ?1 AND office_id = ?2 AND unlisted_at IS NULL";
  const [people, clocks, contacts, unlisted] = await db.batch([
    db
      .prepare(
        `SELECT id, name, kana, birth_date, plan_status, self_report_unreliable, ledger FROM people
          WHERE care_manager_id = ?1 AND office_id = ?2 AND unlisted_at IS NULL ORDER BY kana`,
      )
      .bind(cm.id, cm.office_id),
    db
      .prepare(
        `SELECT person_id, kind, category, label, value, unit, starts_on, depends_on, depends_check FROM clocks
          WHERE person_id IN (${mine})`,
      )
      .bind(cm.id, cm.office_id),
    db.prepare(`SELECT person_id, supporter_order FROM contacts WHERE person_id IN (${mine})`).bind(cm.id, cm.office_id),
    db
      .prepare(
        `SELECT id, name, kana, unlisted_at FROM people
          WHERE care_manager_id = ?1 AND office_id = ?2 AND unlisted_at IS NOT NULL ORDER BY unlisted_at DESC, kana`,
      )
      .bind(cm.id, cm.office_id),
  ]);

  // 災害モードなら信号を読み、ルールの表に今・発災・停電の始まりを渡す（1 分ごとの読み直しで今が進む）
  const disaster = await loadDisasterState(db, cm.office_id);
  const situation = toSituation(disaster, now);
  const signals = situation ? await loadOfficeSignals(db, cm.office_id, situation) : new Map<string, TriageSignal[]>();

  return {
    office: { id: cm.office_id, name: cm.office_name },
    careManager: { id: cm.id, name: cm.display_name },
    disaster,
    situation,
    rows: toCaseloadRows(
      people.results as PersonForList[],
      clocks.results as ClockForList[],
      contacts.results as ContactForList[],
      today,
      { situation, signals },
    ),
    unlisted: (unlisted.results as Array<{ id: string; name: string; kana: string; unlisted_at: string }>).map((r) => ({
      id: r.id,
      name: r.name,
      kana: r.kana,
      unlistedAt: r.unlisted_at,
    })),
  };
}
