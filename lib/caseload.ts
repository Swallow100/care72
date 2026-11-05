// ケアマネの担当一覧。D1 から読んで、画面の 1 行の形にする。
// 災害モード（lib/disaster）のときは、信号と台帳の時計とケアマネの上書きをルールの表（lib/triage）に当てて、
// 行に色と理由の 1 行と優先の番号を付け、既定の並び（優先）を表の並びにする。
// 発災時は行の詳細（連絡先・時計・避難先・支援者・最後の連絡・信号・録音・電話・上書き、lib/list/detail.ts）も作る（T13）。

import type { D1Database } from "@cloudflare/workers-types";
import { ageOn } from "./age.ts";
import { parseLedger } from "./db/ledger.ts";
import type { CareLevel, ClockCategory, ClockRow, ContactRow, GeoPoint, HazardKind, Ledger, PersonReportedAge, PersonRow, PlanStatus } from "./db/types.ts";
import { loadDisasterState } from "./disaster/db.ts";
import { loadOfficeOverrides, type StoredOverride } from "./disaster/override.ts";
import { personSituation, toSituation, type DisasterSituation, type DisasterState } from "./disaster/state.ts";
import { toTriageSignal, triageInDisaster, withinDisaster } from "./disaster/triage.ts";
import { DEPENDENCE_MARKS, deviceText, hazardText } from "./labels.ts";
import type { CallEntryRow } from "./list/calls.ts";
import {
  buildRowDetail,
  lastContactOf,
  remainOf,
  type ClockForDetail,
  type ContactForDetail,
  type LastContact,
  type Remain,
  type RowDetail,
  type SignalForDetail,
} from "./list/detail.ts";
import { caseloadHref, defaultDir, type CaseloadFilter, type ListView, type SortDir, type SortKey } from "./list/query.ts";
import { isGeoPoint } from "./map/geo.ts";
import { markItems, type MarkItem, type StateTone } from "./person.ts";
import { compareResults, SEVERITY, tierOf, type Color, type Tier, type TriageArrival, type TriageResult, type TriageSignal } from "./triage/index.ts";
import { loadOfficeArrivals } from "./custody/arrivals.ts";
import { toTriagePerson } from "./triage/from-ledger.ts";

export type CaseloadRow = {
  id: string;
  name: string;
  kana: string;
  age: number | null;
  careLevel: CareLevel | null;
  /** 医療依存の短い印（酸素・透析など） */
  marks: string[];
  /** 医療依存の区分（marks の元。絞込の「医療」、T58） */
  markKeys: ClockCategory[];
  /** 台帳の町名（絞込の「地区」、T58）。無ければ null */
  town: string | null;
  /** 同じ印に時計のいちばん短い残りと色（「酸素 4h」。lib/person の markItems）。狭い幅で医療の列を省くとき氏名の下に出す（T54） */
  markItems: MarkItem[];
  /** 台帳の機器（在宅酸素など）。時計の無い人（その場で登録した人）の医療の印の代わり（受け持ちの表と同じ。T56） */
  devices: string[];
  /** ハザード（浸水 3 m・土砂・津波） */
  hazards: string[];
  /** 避難支援等実施者の人数 */
  supporters: number;
  plan: PlanStatus;
  /** 未確認の項目の数 */
  pending: number;
  /** 優先の骨格 1〜8 */
  tier: Tier;
  /** 災害モードのときのルールの表の結果（色・理由の 1 行・並びの鍵、ケアマネの上書きを当てたあと）。平時は null */
  triage: TriageResult | null;
  // ---------- 発災時の列と行の詳細（T13）。平時は null ----------
  /** 優先の番号（ルールの表の並びで 1 から）。今の並び替えに関わらず同じ番号 */
  rank: number | null;
  /** 走っている時計で残りのいちばん短い物 */
  remain: Remain | null;
  /** 最後の連絡（いちばん新しい信号の時刻と出どころ） */
  lastContact: LastContact | null;
  /** 行の下に開く詳細 */
  detail: RowDetail | null;
  // ---------- 右の面（T14）の地図と内訳に使う ----------
  /** 未確認の項目の台帳の中の場所（pending の field） */
  pendingFields: string[];
  /** ハザードの種類と浸水の深さ（hazards の元。右の面の人数と地図の層） */
  hazardKinds: Array<{ kind: HazardKind; depthM: number | null }>;
  /** 避難先 1 */
  destination: string | null;
  /** 地図のピンの位置（架空）。無ければ地図に出さない */
  location: GeoPoint | null;
  /**
   * 本人が送った端末の位置（T69b）。今の災害モードの中で最も新しい、撤回されていない赤の信号の申告位置。平時・無ければ null。
   * 地図のピンは これ ?? location に置く（lib/map/side.ts の mapPins）。ルールの表には渡さない（表示だけ）
   */
  reported: GeoPoint | null;
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
> &
  /** 申告の年齢（医療班・行政がその場で登録して引き受けた人、T23）。生年月日が無いときだけ使う */
  Partial<PersonReportedAge>;
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

/** 医療依存の区分（marksOf と同じ並び） */
export function markKeysOf(clocks: ReadonlyArray<Pick<ClockRow, "category">>): ClockCategory[] {
  const categories = new Set(clocks.map((k) => k.category));
  return DEPENDENCE_MARKS.filter(([c]) => categories.has(c)).map(([c]) => c);
}

/** ハザード（浸水 3 m・土砂・津波） */
export function hazardsOf(ledger: Pick<Ledger, "evacuation">): string[] {
  // 書き足し（その他の中身。T57）は括弧で添える（lib/labels.ts の hazardText）
  return ledger.evacuation.hazards.map(hazardText);
}

/**
 * 申告位置（T69b）: 赤の信号のうち、位置のある最も新しい物（now より後は使わない）。信号は発災から今までの撤回されていない物（loadDetailSource）。
 * 色と順には使わない（ルールの表は読まない。地図のピンの置き場所だけ）
 */
export function reportedPoint(
  signals: ReadonlyArray<Pick<SignalForDetail, "color" | "occurred_at" | "reported_lat" | "reported_lng">>,
  now: string,
): GeoPoint | null {
  const t = Date.parse(now);
  let best: { at: number; p: GeoPoint } | null = null;
  for (const s of signals) {
    if (s.color !== "red") continue;
    const p = { lat: s.reported_lat, lng: s.reported_lng };
    if (!isGeoPoint(p)) continue;
    const at = Date.parse(s.occurred_at);
    if (at > t) continue;
    if (!best || at >= best.at) best = { at, p };
  }
  return best?.p ?? null;
}

/** 行の詳細の元（D1 の行。本人の id で引く）。発災時だけ */
export type CaseloadDetailSource = {
  contacts: ReadonlyArray<ContactForDetail>;
  clocks: ReadonlyArray<ClockForDetail & { person_id: string }>;
  /** 発災から今までの信号（訓練でない物） */
  signals: ReadonlyArray<SignalForDetail>;
  /** 発災から今までの電話の記録（経過の called の行、時刻の順） */
  calls: ReadonlyArray<CallEntryRow>;
};

/** 災害モードのときの入力。situation が null（平時）なら色を付けない */
export type CaseloadDisaster = {
  situation: DisasterSituation | null;
  /** 本人ごとの信号（訓練でない物、発災から今まで） */
  signals: ReadonlyMap<string, ReadonlyArray<TriageSignal>>;
  /** 本人ごとのケアマネの上書き（発災から今まで、lib/disaster/override.ts） */
  overrides?: ReadonlyMap<string, StoredOverride>;
  /** 本人ごとの医療班・行政の受け入れ（発災から今までと受入中の物、lib/custody/arrivals.ts。T23・T80）。状態は「到着 避難所」 */
  arrivals?: ReadonlyMap<string, ReadonlyArray<TriageArrival>>;
  /** 行の詳細の元。無ければ詳細を作らない */
  detail?: CaseloadDetailSource;
};

/**
 * 行の形にする（D1 を使わない所。テストしやすいように分けた）。disaster を渡すと災害モードの色と理由を付け、
 * 優先の番号（ルールの表の並び）・残り・最後の連絡、detail を渡せば行の詳細も付ける
 */
export function toCaseloadRows(
  people: PersonForList[],
  clocks: ClockForList[],
  contacts: ContactForList[],
  today: string,
  disaster?: CaseloadDisaster,
): CaseloadRow[] {
  const rows = people.map((p): CaseloadRow => {
    const ledger = parseLedger(p.ledger);
    const myClocks = clocks.filter((k) => k.person_id === p.id);
    const myContacts = contacts.filter((c) => c.person_id === p.id);
    const person = toTriagePerson({ person: p, ledger, contacts: myContacts, clocks: myClocks });
    const s = disaster?.situation ?? null;
    const town = ledger.basic.address?.town ?? null;
    const signals = disaster?.signals.get(p.id) ?? [];
    const override = disaster?.overrides?.get(p.id);
    const arrivals = disaster?.arrivals?.get(p.id) ?? [];
    const triage = s ? triageInDisaster({ person, signals, arrivals, ...(override ? { override } : {}), town }, s) : null;
    const own = s ? personSituation(s, town) : null;
    const src = disaster?.detail;
    return {
      id: p.id,
      name: p.name,
      kana: p.kana,
      age: p.birth_date ? ageOn(p.birth_date, today) : (p.reported_age ?? null),
      careLevel: ledger.care.careLevel ?? null,
      marks: marksOf(myClocks),
      markKeys: markKeysOf(myClocks),
      town: town?.trim() || null,
      markItems: markItems(myClocks, own),
      devices: ledger.medical.devices.map(deviceText),
      hazards: hazardsOf(ledger),
      supporters: myContacts.filter((c) => c.supporter_order != null).length,
      plan: p.plan_status,
      pending: ledger.pending.length,
      tier: tierOf(person),
      triage,
      rank: null,
      remain: own ? remainOf(myClocks, own) : null,
      lastContact: own ? lastContactOf(signals, own.now) : null,
      detail:
        triage && own && src
          ? buildRowDetail({
              personId: p.id,
              ledger,
              // 「全部」（T132）: 本人のページと同じ面の組み立て
              person: p,
              today,
              contacts: src.contacts.filter((c) => c.person_id === p.id),
              clocks: src.clocks.filter((k) => k.person_id === p.id),
              signals: src.signals.filter((x) => x.person_id === p.id),
              calls: src.calls.filter((x) => x.person_id === p.id),
              triage,
              situation: own,
            })
          : null,
      pendingFields: ledger.pending.map((x) => x.field),
      hazardKinds: ledger.evacuation.hazards.map((h) => ({ kind: h.kind, depthM: h.depthM ?? null })),
      destination: ledger.evacuation.destination1?.trim() || null,
      location: isGeoPoint(ledger.basic.location) ? ledger.basic.location : null,
      reported: src && own ? reportedPoint(src.signals.filter((x) => x.person_id === p.id), own.now) : null,
    };
  });
  // 優先の番号: ルールの表の並び（compareResults）で 1 から。画面で並べ替えても番号は変わらない
  rows
    .filter((r) => r.triage)
    .sort((a, b) => compareResults(a.triage!, b.triage!))
    .forEach((r, i) => {
      r.rank = i + 1;
    });
  return rows;
}

// 並びの鍵・向き・絞込・URL は lib/list/query.ts（ブラウザの絞込の帯も読む）。ここから出し直す
export {
  caseloadHref,
  defaultDir,
  filterActive,
  isSortKey,
  NO_FILTER,
  parseDir,
  parseFilter,
  SORT_KEYS,
  type CaseloadFilter,
  type ListView,
  type SortDir,
  type SortKey,
} from "./list/query.ts";

/** 発災時だけの並び（平時の表には列が無い） */
export const DISASTER_SORT_KEYS: ReadonlyArray<SortKey> = ["state", "remain", "contact"];

const PLAN_ORDER: Record<PlanStatus, number> = { none: 0, draft: 1, consented: 2, trained: 3 };

/** 数の昇順。null は後ろ（nullFirst なら前） */
function byNumber(a: number | null, b: number | null, nullFirst = false): number {
  if (a === null || b === null) return a === b ? 0 : (a === null) === nullFirst ? -1 : 1;
  return a - b;
}

/** ハザードの重さ（浸水の深さ。ハザードがあれば深さ＋1、無ければ 0） */
function hazardWeight(r: CaseloadRow): number {
  if (r.hazardKinds.length === 0) return 0;
  return 1 + Math.max(...r.hazardKinds.map((h) => h.depthM ?? 0));
}

/**
 * 計画の状態の色（意味色。CLAUDE.md「画面の決まり」）。未作成は灰、下書きは黄（要確認）、同意済・訓練済は緑。
 * 色は印と数字にだけ置き、必ず状態の文字（未作成・下書き・同意済・訓練済）を添える
 */
export const PLAN_TONES: Record<PlanStatus, StateTone> = { none: "unknown", draft: "check", consented: "ok", trained: "ok" };

/**
 * 並び替え。どの並びでも、同じならカナの順。
 * 優先（tier）は、平時は骨格の段、災害モード（行に triage がある）ならルールの表の並び（色 → 時計の残り → 支援者なし → 骨格）。
 * 状態は色の悪い順（表の色のまま）、残りは短い順、最終連絡は連絡の無い人 → 古い順、医療は骨格の段、
 * ハザードは浸水の深い順、支援者は少ない順。どれも表の結果と台帳の値を並べるだけで、色を決め直さない。
 * dir が列の既定の向き（defaultDir）と違えば、その列の比べ方だけを反転する（同じならカナの順のまま。T58）
 */
export function sortCaseload(rows: CaseloadRow[], key: SortKey, dir: SortDir = defaultDir(key)): CaseloadRow[] {
  const sign = dir === defaultDir(key) ? 1 : -1;
  const byKana = (a: CaseloadRow, b: CaseloadRow) => a.kana.localeCompare(b.kana, "ja");
  const primary: Record<SortKey, (a: CaseloadRow, b: CaseloadRow) => number> = {
    state: (a, b) => (a.triage && b.triage ? SEVERITY[b.triage.color] - SEVERITY[a.triage.color] : 0),
    tier: (a, b) => (a.triage && b.triage ? compareResults(a.triage, b.triage) : a.tier - b.tier),
    kana: (a, b) => byKana(a, b),
    remain: (a, b) => byNumber(a.remain?.hours ?? null, b.remain?.hours ?? null),
    contact: (a, b) =>
      byNumber(a.lastContact ? Date.parse(a.lastContact.at) : null, b.lastContact ? Date.parse(b.lastContact.at) : null, true),
    age: (a, b) => (b.age ?? -1) - (a.age ?? -1),
    medical: (a, b) => a.tier - b.tier,
    hazard: (a, b) => hazardWeight(b) - hazardWeight(a),
    supporter: (a, b) => a.supporters - b.supporters,
    plan: (a, b) => PLAN_ORDER[a.plan] - PLAN_ORDER[b.plan] || b.pending - a.pending,
  };
  return [...rows].sort((a, b) => sign * primary[key](a, b) || byKana(a, b));
}

// ---------- 絞込と検索（T58） ----------
// 絞っても優先の番号（rank）は絞る前の番号のまま（表の順位を変えない）。色は発災時だけ

/** 検索の比べ方: 全角・半角をそろえ、空白を除き、ひらがなをカタカナに（カナはカタカナで持つ） */
function fold(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

/** 絞る。並び（sortCaseload）のあとに当てても前に当ててもよい（順を変えない） */
export function filterCaseload(rows: CaseloadRow[], f: CaseloadFilter): CaseloadRow[] {
  const q = fold(f.q);
  return rows.filter(
    (r) =>
      (f.color === null || r.triage?.color === f.color) &&
      (f.area === null || r.town === f.area) &&
      (f.mark === null || r.markKeys.includes(f.mark)) &&
      (q === "" || fold(r.name).includes(q) || fold(r.kana).includes(q)),
  );
}

/** 絞込の帯の選ぶ所の中身（絞る前の行から）。地区は町名のカナ順、医療は骨格の順 */
export function filterOptions(rows: ReadonlyArray<CaseloadRow>): { areas: string[]; marks: Array<[ClockCategory, string]> } {
  const areas = [...new Set(rows.flatMap((r) => (r.town ? [r.town] : [])))].sort((a, b) => a.localeCompare(b, "ja"));
  const present = new Set(rows.flatMap((r) => r.markKeys));
  return { areas, marks: DEPENDENCE_MARKS.filter(([c]) => present.has(c)).map(([c, l]) => [c, l]) };
}

// ---------- 右に開く本人のページ（?open=<id>、docs/tasks/T02.md） ----------
// URL だけで開け閉めする。同じ「/」の query が変わるだけなので別ページに飛ばない。
// 開くときは履歴に足し、開いている間に別の行を押すと履歴を置き換える。だからブラウザの戻るで閉じる。

const OPEN_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** URL の open を読む。1 つの id の形のときだけ。読むときは personInScope を通す（形が合っても範囲の外は出さない） */
export function parseOpen(v: string | string[] | undefined): string | null {
  return typeof v === "string" && OPEN_ID.test(v) ? v : null;
}

export type RowLink = { href: string; replace: boolean; current: boolean };

/** 一覧の行のリンク。閉じているときは開く（履歴に足す）、開いているときは切り替える（置き換える） */
export function rowLink(sort: SortKey, open: string | null, id: string, view: ListView = {}): RowLink {
  return { href: caseloadHref({ sort, ...view, open: id }), replace: open !== null, current: open === id };
}

/** 右の面を閉じる（並びの向きと絞込は残す） */
export function closeHref(sort: SortKey, view: ListView = {}): string {
  return caseloadHref({ sort, ...view });
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
        `SELECT id, name, kana, birth_date, plan_status, self_report_unreliable, ledger, reported_age FROM people
          WHERE care_manager_id = ?1 AND office_id = ?2 AND unlisted_at IS NULL ORDER BY kana`,
      )
      .bind(cm.id, cm.office_id),
    // 時計と連絡先は行の詳細（発災時）にも使うので列を全部読む
    db.prepare(`SELECT * FROM clocks WHERE person_id IN (${mine}) ORDER BY person_id, sort, id`).bind(cm.id, cm.office_id),
    db
      .prepare(
        `SELECT id, person_id, kind, relation, name, phone, reach, emergency_order, supporter_order,
                night_ok, has_car, has_smartphone, note, kana, address, mobile, sort
           FROM contacts WHERE person_id IN (${mine}) ORDER BY person_id, sort, id`,
      )
      .bind(cm.id, cm.office_id),
    db
      .prepare(
        `SELECT id, name, kana, unlisted_at FROM people
          WHERE care_manager_id = ?1 AND office_id = ?2 AND unlisted_at IS NOT NULL ORDER BY unlisted_at DESC, kana`,
      )
      .bind(cm.id, cm.office_id),
  ]);

  // 災害モードなら信号・上書き・電話の記録を読み、ルールの表に今・発災・停電の始まりを渡す（1 分ごとの読み直しで今が進む）
  const disaster = await loadDisasterState(db, cm.office_id);
  const situation = toSituation(disaster, now);
  const detail = situation ? await loadDetailSource(db, cm.id, cm.office_id, situation) : null;
  const overrides = situation ? await loadOfficeOverrides(db, cm.office_id, situation) : undefined;
  const arrivals = situation ? await loadOfficeArrivals(db, cm.office_id, situation) : undefined;
  const signals = new Map<string, TriageSignal[]>();
  for (const s of detail?.signals ?? []) signals.set(s.person_id, [...(signals.get(s.person_id) ?? []), toTriageSignal(s)]);

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
      {
        situation,
        signals,
        ...(overrides ? { overrides } : {}),
        ...(arrivals ? { arrivals } : {}),
        ...(detail
          ? {
              detail: {
                ...detail,
                contacts: contacts.results as unknown as ContactForDetail[],
                clocks: clocks.results as unknown as Array<ClockForDetail & { person_id: string }>,
              },
            }
          : {}),
      },
    ),
    unlisted: (unlisted.results as Array<{ id: string; name: string; kana: string; unlisted_at: string }>).map((r) => ({
      id: r.id,
      name: r.name,
      kana: r.kana,
      unlistedAt: r.unlisted_at,
    })),
  };
}

/** 発災時の行の詳細の元のうち、信号と電話の記録（担当の本人の、訓練でない物、発災から今まで） */
async function loadDetailSource(
  db: D1Database,
  careManagerId: string,
  officeId: string,
  s: DisasterSituation,
): Promise<Pick<CaseloadDetailSource, "signals" | "calls">> {
  const mine = "SELECT id FROM people WHERE care_manager_id = ?1 AND office_id = ?2 AND unlisted_at IS NULL";
  const [signals, calls] = await db.batch([
    // 列は全部（分類の部品 T12 が読む ai_* の列も、表に足されればそのまま行の詳細に渡る）
    db
      .prepare(
        `SELECT * FROM signals WHERE drill_id IS NULL AND retracted_at IS NULL AND person_id IN (${mine}) ORDER BY occurred_at, created_at, id`,
      )
      .bind(careManagerId, officeId),
    db
      .prepare(
        `SELECT t.person_id, t.body, t.payload, t.occurred_at, a.display_name AS author_name
           FROM timeline_entries t LEFT JOIN accounts a ON a.id = t.author_id
          WHERE t.kind = 'called' AND t.retracted_at IS NULL AND t.person_id IN (${mine}) ORDER BY t.occurred_at, t.created_at, t.id`,
      )
      .bind(careManagerId, officeId),
  ]);
  return {
    signals: (signals.results as SignalForDetail[]).filter((x) => withinDisaster(x.occurred_at, s)),
    calls: (calls.results as CallEntryRow[]).filter((x) => withinDisaster(x.occurred_at, s)),
  };
}
