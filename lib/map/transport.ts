// 避難の手段と徒歩の見込み（T112）。
// - 手段は選ぶ欄（Ledger.evacuation.transportKind: 徒歩・車いす・家族の車・送迎・その他）と補記の文字（transport）。
//   選ぶ欄が無い古い台帳は、補記の文字を lib/map/route.ts の modeOf と同じ決まりで読み替える（transportKindOf）。
//   経路地図の手段（openrouteservice の徒歩・車）は選んだ物から決める（routeModeOf）。
// - 様式・医療班の要約・担当一覧・本人役など、手段を文字で出す所は transportText の 1 つの形を使う。
// - 徒歩の時間は openrouteservice の大人の速さを使わず、台帳の歩行から出典の速さで見込む（walkSpeedOf、出典 fdma-tsunami-2013）。
//   年齢は使わない（出典の 1.0 m/秒は老人の自由歩行を含む目安で、年齢ごとの値は無い）。
// - 浸水のハザードがあり手段が車のときの 1 語（floodCar）は、画面に出すだけで色と連絡の順には使わない（lib/triage は読まない）。

import { TRANSPORT_KINDS, type Ability, type Ledger, type RouteMode, type TransportKind } from "../db/types.ts";
import { TRANSPORT_KIND_LABELS } from "../labels.ts";
import type { SourceId } from "../sources/index.ts";
import { modeOf } from "./route.ts";

type Evacuation = Pick<Ledger["evacuation"], "transportKind" | "transport">;

const WHEELCHAIR = /車いす|車椅子|車イス/;

const isKind = (v: unknown): v is TransportKind => typeof v === "string" && (TRANSPORT_KINDS as readonly string[]).includes(v);

/**
 * 補記の文字 → 選ぶ欄（選ぶ欄の無い古い台帳の読み替え）。modeOf と同じ決まり: 車いすは徒歩の側、「車」があれば車の側。
 * 車の側は「送迎」があれば送迎、ほかは家族の車。徒歩の側は「徒歩」「歩」があれば徒歩、ほかはその他（経路は徒歩のまま）。空は null
 */
export function kindFromText(text: string | undefined | null): TransportKind | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  if (WHEELCHAIR.test(t)) return "wheelchair";
  if (modeOf(t) === "car") return t.includes("送迎") ? "pickup" : "family_car";
  if (t.includes("歩")) return "foot";
  return "other";
}

/** 選ぶ欄の値（無ければ補記の文字から読み替え）。どちらも無ければ null（未確認） */
export function transportKindOf(e: Evacuation): TransportKind | null {
  return isKind(e.transportKind) ? e.transportKind : kindFromText(e.transport);
}

/**
 * 経路地図の手段。徒歩・車いすは徒歩（車いすは歩道を使う）、家族の車・送迎は車、その他と未確認は補記の文字に「車」があれば車、ほかは徒歩。
 * 選ぶ欄の無い古い台帳は modeOf(補記) と同じ答え
 */
export function routeModeOf(e: Evacuation): RouteMode {
  const k = transportKindOf(e);
  if (k === "family_car" || k === "pickup") return "car";
  if (k === "foot" || k === "wheelchair") return "foot";
  return modeOf(e.transport);
}

/**
 * 手段の文字（様式・要約・一覧・本人役で同じ形）。選ぶ欄と補記の両方があれば「家族の車（娘の車）」、
 * 補記が選ぶ欄の言葉と同じ・選ぶ欄が無い古い台帳は補記の文字だけ。どちらも無ければ undefined
 */
export function transportText(e: Evacuation): string | undefined {
  const note = e.transport?.trim() || "";
  const kind = isKind(e.transportKind) ? TRANSPORT_KIND_LABELS[e.transportKind] : "";
  if (kind && note && note !== kind) return `${kind}（${note}）`;
  return kind || note || undefined;
}

/** 歩く速さ（m/秒）。出典 fdma-tsunami-2013: 目安 1.0、自力のみで行動しにくい人 0.8、歩行困難者・身体障がい者 0.5 */
export const WALK_SPEEDS = { ok: 1.0, some: 0.8, hard: 0.5 } as const satisfies Record<Ability, number>;

/** 歩く速さの出典（画面の根拠のリンク） */
export const WALK_SPEED_SOURCE: SourceId = "fdma-tsunami-2013";

/**
 * 徒歩の見込みの速さ（m/秒）。歩行が問題なし 1.0・一部 0.8・困難 0.5。歩行が未確認・寝たきり・車いすは遅い側の 0.5
 * （見込みを短く見せない側）
 */
export function walkSpeedOf(ledger: Pick<Ledger, "care" | "evacuation">): number {
  const w = ledger.care.walking;
  if (ledger.care.bedridden || transportKindOf(ledger.evacuation) === "wheelchair") return WALK_SPEEDS.hard;
  return w ? WALK_SPEEDS[w] : WALK_SPEEDS.hard;
}

/** 道のり（m）と速さ（m/秒）→ 見込みの分（切り上げ、1 分から） */
export function walkMinutes(distanceM: number, speed: number): number {
  return Math.max(1, Math.ceil(distanceM / speed / 60));
}

/** 「冠水注意」の出典 */
export const FLOOD_CAR_SOURCE: SourceId = "mlit-kansui-2019";

/** 浸水のハザードがあり、経路の手段が車か（経路地図の 1 語。色と連絡の順には使わない） */
export function floodCar(ledger: Pick<Ledger, "evacuation">, mode: RouteMode): boolean {
  return mode === "car" && ledger.evacuation.hazards.some((h) => h.kind === "flood");
}
