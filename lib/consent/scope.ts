// 同意の範囲（docs/tasks/T24.md）。役と同意から、見える区分・書類・録音・経過・書き足せる種類・第三者提供の記録を決める 1 か所。
// 本人のページ（lib/person.ts の toPersonView）・書類の頁（app/people/[id]/forms）・受け持ちの一覧（lib/custody/board.ts）・
// 録音の API（app/api/recordings）・経過の書き足しの API（app/api/timeline）・受入の記録（lib/custody/store.ts）がここを通る。
// 画面だけで判定しない。ここは D1 に触らない（入力は本人の行の同意と出どころ）。壁（誰の本人を開けるか）は lib/auth/scope.ts。
//
// - ケアマネ: 全部（壁で自分の事業所の本人だけ）。本人: 全部（自分だけ）
// - 医療班・行政（同じ扱い。docs/SPEC.md「画面 6」）:
//   - 医療班への提供に同意あり → 本人確認・医療・避難・人の一部（緊急連絡先と支援者の役割名）。根拠は同意
//   - 住所は医療班への提供の同意の範囲（consents.scope の {"address": true}）にあるときだけ足す
//   - 同意なし・未確認 → 本人確認だけ。根拠は生命・身体の保護（個人情報保護法 27 条 1 項 2 号）
//   - その場で登録した人（origin on_site、T23）は受け持つ人が本人から聞いた物なので、同意ありと同じ区分（根拠は生命保護）。
//     はっきり「同意なし」を記録した人は本人確認だけ
//   - 経過: 医療が見えるときは全部。本人確認だけのときは医療班・行政の書いた行（受入・搬送・退所・提供の行を含む）だけ
//   - 書類は医療要約だけ（医療班への提供に同意があるとき。要約は同意で作る書類、T07）。計画書・本人の1枚・QR・対応表の書類と録音は開けない
//   - 書き足し: 行政は全部の種類。医療班は今はなし（T172、lib/consent/relay.ts の定数 1 つで戻せる）
// - 家族・支援者: 支援者への提供に同意あり → 避難・人と経過（決まった言葉だけ。lib/signals/family.ts）。なし・未確認 → 何も無し

import type { Role } from "../auth/roles.ts";
import type { ConsentKind, ConsentStatus, PersonOrigin, ProvisionBasis, TimelineKind } from "../db/types.ts";
import { MEDICAL_TIMELINE_WRITES } from "./relay.ts";

/** 見える区分の単位 */
export const SCOPE_ITEMS = [
  "identity", // 本人確認（氏名・カナ・生年月日・年齢）
  "medical", // 医療（薬・機器・時計・かかりつけ・アレルギー・既往。介護度と医療の印も）
  "evacuation", // 避難（ハザード・避難先・手段・住居・支援の内容）
  "people", // 人（全部）
  "people_partial", // 人の一部（緊急連絡先と支援者の役割名）
  "address", // 住所
  "basic", // 基本（住所のほか、連絡手段・世帯・心身・特記）
  "consent", // 同意
  "plan", // 避難計画の状態と台帳の未確認の数（事業所の側の物）
] as const;
export type ScopeItem = (typeof SCOPE_ITEMS)[number];

/** 第三者提供の記録に残す区分（T23 の provision。住所は範囲にあるときだけ） */
export const PROVISION_SECTIONS = ["identity", "medical", "evacuation", "people_partial", "address"] as const;
export type ProvisionSection = (typeof PROVISION_SECTIONS)[number];

/** 書類（本人のページの書類の区分の key と、対応表の差し込み） */
export const SCOPE_DOCUMENTS = ["matsuyama", "medical", "own", "qr", "phone", "mapped"] as const;
export type ScopeDocument = (typeof SCOPE_DOCUMENTS)[number];

/** 経過: all 全部・staff 医療班・行政の書いた行だけ・none 出さない */
export type TimelineScope = "all" | "staff" | "none";

/** 書き足せる経過の種類（定型と自由文。既にある経過の種類） */
export const WRITABLE_KINDS = [
  "safety_check",
  "examined",
  "medication_given",
  "transported",
  "arrived_shelter",
  "note",
] as const satisfies readonly TimelineKind[];
export type WritableKind = (typeof WRITABLE_KINDS)[number];

/** 役ごとの書き足しの種類。ケアマネは診察・配薬を書かない */
const STAFF_WRITES: readonly WritableKind[] = WRITABLE_KINDS;
const CARE_MANAGER_WRITES: readonly WritableKind[] = ["safety_check", "transported", "arrived_shelter", "note"];

/** 医療班・行政の書き足しの種類。医療班からケアマネへの伝達は今はなし（T172）なので、医療班は定数が true の時だけ */
function staffWrites(role: Role): WritableKind[] {
  return role === "medical" && !MEDICAL_TIMELINE_WRITES ? [] : [...STAFF_WRITES];
}

/** 見る人の種類（役から） */
export type Viewer = "care_manager" | "staff" | "supporter" | "self" | "none";

export function viewerOf(role: Role): Viewer {
  switch (role) {
    case "care_manager":
      return "care_manager";
    case "medical":
    case "government":
      return "staff";
    case "family":
      return "supporter";
    case "self":
      return "self";
    case "unselected":
      return "none";
  }
}

/** 決めるのに要る本人の物。consents は本人の同意の行（無い種類は未確認） */
export type ScopeInput = {
  consents: ReadonlyArray<{ kind: ConsentKind; status: ConsentStatus; scope: string | null }>;
  origin: PersonOrigin;
};

export type ViewScope = {
  viewer: Viewer;
  /** 見える区分（SCOPE_ITEMS の順） */
  items: ScopeItem[];
  timeline: TimelineScope;
  documents: ScopeDocument[];
  recordings: boolean;
  /** 本人のページの経過に書き足せる種類（空なら書き足しの欄を出さない） */
  writes: WritableKind[];
  /** 第三者提供の記録（医療班・行政だけ。受け入れたときに残す）。ほかの役は null */
  provision: { basis: ProvisionBasis; sections: ProvisionSection[] } | null;
};

/** consents.scope（本人の同意の範囲）。今は住所だけ持つ。読めない・形の違う物は範囲なしと読む */
export type ConsentScopeJson = { address?: boolean };

export function consentScopeHasAddress(scope: string | null | undefined): boolean {
  if (!scope) return false;
  try {
    const v = JSON.parse(scope) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v) && (v as ConsentScopeJson).address === true;
  } catch {
    return false;
  }
}

function consentOf(input: ScopeInput, kind: ConsentKind) {
  return input.consents.find((c) => c.kind === kind) ?? { kind, status: "unconfirmed" as const, scope: null };
}

const ALL_ITEMS: ScopeItem[] = SCOPE_ITEMS.filter((i) => i !== "people_partial");

function ordered<T extends string>(all: readonly T[], picked: ReadonlyArray<T>): T[] {
  return all.filter((x) => picked.includes(x));
}

const NOTHING: Omit<ViewScope, "viewer"> = {
  items: [],
  timeline: "none",
  documents: [],
  recordings: false,
  writes: [],
  provision: null,
};

/** 役と本人の同意から見える範囲 */
export function viewScope(role: Role, input: ScopeInput): ViewScope {
  const viewer = viewerOf(role);
  switch (viewer) {
    case "care_manager":
      return {
        viewer,
        items: [...ALL_ITEMS],
        timeline: "all",
        documents: [...SCOPE_DOCUMENTS],
        recordings: true,
        writes: [...CARE_MANAGER_WRITES],
        provision: null,
      };
    case "self":
      return { viewer, ...NOTHING, items: [...ALL_ITEMS], timeline: "all", documents: [...SCOPE_DOCUMENTS], recordings: true };
    case "supporter":
      return consentOf(input, "supporters").status === "granted"
        ? { viewer, ...NOTHING, items: ["evacuation", "people"], timeline: "all" }
        : { viewer, ...NOTHING };
    case "none":
      return { viewer, ...NOTHING };
    case "staff":
      return staffScope(role, input);
  }
}

function staffScope(role: Role, input: ScopeInput): ViewScope {
  const medical = consentOf(input, "medical");
  const granted = medical.status === "granted";
  const onSite = input.origin === "on_site" && medical.status !== "refused";
  if (!granted && !onSite) {
    return {
      viewer: "staff",
      ...NOTHING,
      items: ["identity"],
      timeline: "staff",
      writes: staffWrites(role),
      provision: { basis: "vital", sections: ["identity"] },
    };
  }
  const address = granted && consentScopeHasAddress(medical.scope);
  const sections: ProvisionSection[] = ["identity", "medical", "evacuation", "people_partial", ...(address ? (["address"] as const) : [])];
  return {
    viewer: "staff",
    items: ordered(SCOPE_ITEMS, sections),
    timeline: "all",
    // 医療要約は医療班への提供の同意で作る書類（T07。その場で登録した人は同意の行が無く、要約を作らない）
    documents: granted ? ["medical"] : [],
    recordings: false,
    writes: staffWrites(role),
    provision: { basis: granted ? "consent" : "vital", sections },
  };
}

/** 本人のページの行（同意の行と出どころを持つ物）から。lib/person.ts の PersonPageRows を渡す */
export function scopeOfRows(
  role: Role,
  rows: { consents: ScopeInput["consents"]; person: { origin: PersonOrigin } },
): ViewScope {
  return viewScope(role, { consents: rows.consents, origin: rows.person.origin });
}

export function scopeHas(scope: Pick<ViewScope, "items">, item: ScopeItem): boolean {
  return scope.items.includes(item);
}

/** 人の区分の出し方: all 全部・partial 緊急連絡先と支援者の役割名・null 出さない */
export function peopleMode(scope: Pick<ViewScope, "items">): "all" | "partial" | null {
  if (scopeHas(scope, "people")) return "all";
  if (scopeHas(scope, "people_partial")) return "partial";
  return null;
}

export function canOpenDocument(scope: Pick<ViewScope, "documents">, doc: ScopeDocument): boolean {
  return scope.documents.includes(doc);
}

export function canWrite(scope: Pick<ViewScope, "writes">, kind: string): kind is WritableKind {
  return (scope.writes as readonly string[]).includes(kind);
}
