// 初めて入った管理者の準備の欄（docs/tasks/T98.md）。事業所の画面（/office）の一番上に、残っている準備だけを 1 行ずつ出し、済んだら消す。
// 出すのは事業所の管理者だけ（審査員のケアマネの役・管理者でないケアマネには出さない。app/office/page.tsx）。
// 数えるのは事業所の画面がもう読んでいる物（ケアマネの一覧・利用者の一覧）と、事業所の中心（offices.center_lat・center_lng）だけ。
// - 地域: 事業所の中心が無い（lib/office/place.ts。市は事業所を作るときに入るので見ない）
// - ケアマネ: 使える（停止していない）ケアマネが 1 人以下（管理者だけ）。1 人で回す事業所もあるので「後で」で閉じられる（下の cookie）
// - 利用者: 一覧にいる人が 0（外した人は数えない）
// - 担当: 一覧にいる人のうち担当（care_manager_id）が無い人の数。停止した人が担当の人は、担当の表に「（名前） 停止」と出るので数えない
// パスワードが初期のままか（持つ列が無い）と使用様式（既定で入る。lib/forms/plan-form.ts）は出さない。
// 「後で」は端末の cookie（値は事業所の id）。表に列を足さない（migration なし）。別の端末・別の事業所では出る。

import type { D1Database } from "@cloudflare/workers-types";
import type { GeoPoint } from "../db/types.ts";
import { ASSIGN_ANCHOR, CARE_MANAGERS_ANCHOR } from "./http-paths.ts";
import { OFFICE_LABELS } from "./labels.ts";
import type { CareManagerItem, OfficePersonItem } from "./people.ts";
import { OFFICE_PLACE_ANCHOR } from "./place.ts";

/** 準備の行の種類（並びもこの順） */
export const SETUP_KINDS = ["place", "care_manager", "people", "assign"] as const;
export type SetupKind = (typeof SETUP_KINDS)[number];

/** 準備の欄の言葉（2〜4 字の漢語） */
export const SETUP_LABELS = {
  title: "準備",
  /** 見出しの横の「残り N」 */
  left: "残り",
  place: "地域",
  unset: "未設定",
  addCareManager: OFFICE_LABELS.addCareManager,
  addPerson: OFFICE_LABELS.addPerson,
  assign: OFFICE_LABELS.careManager,
  unassigned: OFFICE_LABELS.unassigned,
  /** ケアマネの行を閉じる（1 人で回す事業所） */
  later: "後で",
} as const;

/** 「後で」の印の cookie（値は事業所の id。/office の下だけに送る） */
export const SETUP_LATER_COOKIE = "care72_setup_cm_later";
export const SETUP_LATER_PATH = "/office";
/** 1 年 */
export const SETUP_LATER_MAX_AGE = 60 * 60 * 24 * 365;

export type SetupItem = {
  kind: SetupKind;
  /** 行の言葉（地域・ケアマネ追加・利用者追加・担当） */
  label: string;
  /** 言葉の後ろ（未設定・未割当）。無ければ null */
  status: string | null;
  /** 数（担当の未割当の人数）。無ければ null */
  count: number | null;
  /** 押したときの送り先（/office の区分の id。保存のあとに戻る所と同じ） */
  href: string;
};

export type SetupInput = {
  center: GeoPoint | null;
  careManagers: readonly Pick<CareManagerItem, "disabled">[];
  people: readonly Pick<OfficePersonItem, "careManagerId" | "unlistedAt">[];
  /** ケアマネの行を「後で」で閉じた（この事業所の cookie がある） */
  careManagerLater: boolean;
};

/**
 * 準備の欄を見る人か: 事業所の管理者（ケアマネの役）だけ。審査員のケアマネの役は管理者でない（lib/auth/principal.ts の admin は false。
 * lib/office/scope.ts の officeActor.admin は審査員にも真なので、こちらは principal の admin を見る）
 */
export function canSeeSetup(p: { role: string; admin: boolean } | null): boolean {
  return p !== null && p.role === "care_manager" && p.admin;
}

/** 残っている準備（無ければ空）。並びは SETUP_KINDS の順 */
export function setupItems(input: SetupInput): SetupItem[] {
  const items: SetupItem[] = [];
  if (input.center === null) {
    items.push({ kind: "place", label: SETUP_LABELS.place, status: SETUP_LABELS.unset, count: null, href: `#${OFFICE_PLACE_ANCHOR}` });
  }
  const active = input.careManagers.filter((c) => !c.disabled).length;
  if (active <= 1 && !input.careManagerLater) {
    items.push({ kind: "care_manager", label: SETUP_LABELS.addCareManager, status: null, count: null, href: `#${CARE_MANAGERS_ANCHOR}` });
  }
  const listed = input.people.filter((p) => p.unlistedAt === null);
  if (listed.length === 0) {
    items.push({ kind: "people", label: SETUP_LABELS.addPerson, status: null, count: null, href: `#${ASSIGN_ANCHOR}` });
  }
  const unassigned = listed.filter((p) => p.careManagerId === null).length;
  if (unassigned > 0) {
    items.push({ kind: "assign", label: SETUP_LABELS.assign, status: SETUP_LABELS.unassigned, count: unassigned, href: `#${ASSIGN_ANCHOR}` });
  }
  return items;
}

/** 「後で」の cookie がこの事業所の物か */
export function isSetupLater(cookieValue: string | null | undefined, officeId: string): boolean {
  return typeof cookieValue === "string" && cookieValue === officeId;
}

/** 「後で」の cookie の文字列（document.cookie に書く） */
export function setupLaterCookie(officeId: string): string {
  return `${SETUP_LATER_COOKIE}=${encodeURIComponent(officeId)}; Path=${SETUP_LATER_PATH}; Max-Age=${SETUP_LATER_MAX_AGE}; SameSite=Lax`;
}

/** 事業所の中心だけ（町名は読まない）。無い・事業所が無ければ null */
export async function loadOfficeCenter(db: D1Database, officeId: string): Promise<GeoPoint | null> {
  const row = await db
    .prepare("SELECT center_lat, center_lng FROM offices WHERE id = ?1")
    .bind(officeId)
    .first<{ center_lat: number | null; center_lng: number | null }>();
  return row && row.center_lat != null && row.center_lng != null ? { lat: row.center_lat, lng: row.center_lng } : null;
}
