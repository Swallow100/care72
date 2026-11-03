// 担当一覧の右の面（T14）の中身。担当一覧の行（lib/caseload.ts）と、発災時はルールの表の結果（lib/triage）から作る。
// 色と順位は lib/triage の結果をそのまま使い、ここで計算し直さない（ピンの色は COLOR_TONES で引くだけ）。
//
// 平時: 計画の状態の内訳、今週の見直し（計画が下書きで未確認のある人）、未確認の多い人、地図（ピンは名前だけ）、ハザードと避難先の人数
// 発災時: 地図が上（ピンは状態の色と 2 字ほどの状態）、状態ごとの人数、ハザードごとの人数と状態の内訳、避難先、見直し

import { PLAN_TONES, rowLink, type CaseloadRow, type SortKey } from "../caseload.ts";
import { PLAN_STATUSES, type GeoPoint, type HazardKind, type OfficeKind, type PlanStatus } from "../db/types.ts";
import { DISASTER_SCENE, type DisasterState } from "../disaster/state.ts";
import { BLANK_LABELS, COLOR_LABELS, HAZARD_LABELS, PLAN_STATUS_LABELS } from "../labels.ts";
import { PLACE_LABELS } from "../signals/labels.ts";
import { COLOR_TONES, fieldLabelOf, type StateTone } from "../person.ts";
import { compareResults, type Color, type TriageResult } from "../triage/index.ts";
import { demoOverlay, type DemoOverlay, type DemoScene } from "./demo.ts";

/** 状態の 4 色の並び（至急・要確認・不明・無事） */
export const COLOR_ORDER: readonly Color[] = ["red", "yellow", "gray", "green"];

/** 発災時に右の面へ渡す物。担当一覧の行の結果と事業所の災害の状態（T09）から sideDisasterOf で作る */
export type SideDisaster = {
  /** ルールの表の結果（lib/triage の rank の順） */
  results: ReadonlyArray<TriageResult>;
  /** 雨雲・震度のデモの元。災害の種類が場面を持たない（その他）ときは null（雨雲・震度を出さない） */
  scene: DemoScene | null;
};

/**
 * 災害モードの担当一覧の行（lib/caseload.ts が行ごとに lib/triage の結果を付けた物）と事業所の災害の状態から、右の面の発災時の入力を作る。
 * 結果は表の並び（compareResults）に並べ直す（ピンの重なりは連絡の順。一覧の並びが氏名・年齢でも変わらない）。
 * 場面は災害の種類を DISASTER_SCENE で引いた物と警戒レベル（入れていなければ null）。場面の無い種類（その他）は scene が null。
 * 雨雲・震度のデモの絵はデモ事業所だけ（T72）: office にデモでない事業所の種類（regular・unaffiliated）を渡すと scene は null
 * （本物の事業所の地図に松山の雨雲と「震度6強」を出さない）。office を渡さないのは訓練の画面で、場面は筋書きの物なので今まで通り。
 * 平時か、結果の無い行があるときは null（平時の面）
 */
export function sideDisasterOf(
  rows: ReadonlyArray<Pick<CaseloadRow, "triage">>,
  state: Pick<DisasterState, "kind" | "alertLevel">,
  opts: { office?: OfficeKind } = {},
): SideDisaster | null {
  if (state.kind === "normal") return null;
  const results: TriageResult[] = [];
  for (const r of rows) {
    if (!r.triage) return null;
    results.push(r.triage);
  }
  const kind = opts.office === undefined || opts.office === "demo" ? DISASTER_SCENE[state.kind] : null;
  const scene: DemoScene | null =
    kind === "heavy_rain" ? { kind: "heavy_rain", level: state.alertLevel } : kind === "earthquake" ? { kind: "earthquake" } : null;
  return { results: results.sort(compareResults), scene };
}

export type StateCount = { color: Color; label: string; tone: StateTone; count: number };

export type MapPin = {
  id: string;
  /** ピンの名前の印（姓） */
  label: string;
  /** 押したときの読み上げと title（氏名と状態と理由） */
  title: string;
  location: GeoPoint;
  href: string;
  /** 発災時だけ。状態の色（lib/triage の色を COLOR_TONES で引いた物） */
  tone: StateTone | null;
  /** 発災時だけ。状態の言葉（至急・要確認・不明・無事） */
  state: string | null;
  /** 描く順。後ろほど上に重なる（発災時は連絡の順が先の人を上に） */
  layer: number;
};

export type HazardCount = {
  key: string;
  kind: HazardKind | null;
  /** 浸水 3 m・土砂・津波・なし */
  label: string;
  count: number;
  /** 発災時だけ。状態ごとの人数（0 の色は出さない） */
  states: StateCount[];
};

export type DestinationCount = { label: string; count: number; unset: boolean };

export type ReviewItem = { id: string; name: string; href: string; pending: number; labels: string[]; plan: PlanStatus };

export type PlanCount = { status: PlanStatus; label: string; tone: StateTone; count: number };

export type SidePaneData = {
  mode: "normal" | "disaster";
  plan: PlanCount[];
  /** 今週の見直し: 計画が下書きで、未確認の項目がある人（未確認の多い順） */
  review: ReviewItem[];
  /** 未確認の多い人（多い順） */
  pendingTop: ReviewItem[];
  pins: MapPin[];
  /** 位置の無い人の数（地図に出せない） */
  unplaced: number;
  hazards: HazardCount[];
  destinations: DestinationCount[];
  /** 発災時だけ */
  states: StateCount[] | null;
  /** 発災時だけ。雨雲・震度のデモ */
  demo: DemoOverlay | null;
};

/** 名前の姓（空白の前）。ピンの名前の印に出す */
export function surname(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function byPendingThenKana(a: CaseloadRow, b: CaseloadRow): number {
  return b.pending - a.pending || a.kana.localeCompare(b.kana, "ja");
}

function reviewItem(r: CaseloadRow, sort: SortKey): ReviewItem {
  return {
    id: r.id,
    name: r.name,
    href: rowLink(sort, null, r.id).href,
    pending: r.pending,
    labels: [...new Set(r.pendingFields.map(fieldLabelOf))],
    plan: r.plan,
  };
}

export function planCounts(rows: ReadonlyArray<CaseloadRow>): PlanCount[] {
  return PLAN_STATUSES.map((s) => ({
    status: s,
    label: PLAN_STATUS_LABELS[s],
    tone: PLAN_TONES[s],
    count: rows.filter((r) => r.plan === s).length,
  }));
}

export function stateCounts(results: ReadonlyArray<Pick<TriageResult, "color">>): StateCount[] {
  return COLOR_ORDER.map((color) => ({
    color,
    label: COLOR_LABELS[color],
    tone: COLOR_TONES[color],
    count: results.filter((r) => r.color === color).length,
  }));
}

const HAZARD_ORDER: Record<HazardKind, number> = { flood: 0, landslide: 1, tsunami: 2, other: 3 };

/**
 * ハザードごとの人数（浸水 3 m 2 人・土砂 2 人・津波 1 人・なし 2 人）。台帳のハザードから数え、地図の層からは数えない。
 * 2 つのハザードを持つ人は両方に数える。浸水は深い順、深さの無い浸水はその後。ハザードの無い人は「なし」で最後
 */
export function hazardCounts(
  rows: ReadonlyArray<CaseloadRow>,
  colorOf?: (id: string) => Color | undefined,
): HazardCount[] {
  const groups = new Map<string, { kind: HazardKind | null; depth: number | null; label: string; ids: Set<string> }>();
  const add = (key: string, kind: HazardKind | null, depth: number | null, label: string, id: string) => {
    const g = groups.get(key) ?? { kind, depth, label, ids: new Set<string>() };
    g.ids.add(id);
    groups.set(key, g);
  };
  for (const r of rows) {
    if (r.hazardKinds.length === 0) add("none", null, null, BLANK_LABELS.none, r.id);
    for (const h of r.hazardKinds) {
      const label = h.depthM != null ? `${HAZARD_LABELS[h.kind]} ${h.depthM} m` : HAZARD_LABELS[h.kind];
      add(`${h.kind}:${h.depthM ?? ""}`, h.kind, h.depthM, label, r.id);
    }
  }
  return [...groups.entries()]
    .sort(([, a], [, b]) => {
      if (a.kind === null || b.kind === null) return a.kind === null ? (b.kind === null ? 0 : 1) : -1;
      return (
        HAZARD_ORDER[a.kind] - HAZARD_ORDER[b.kind] || (b.depth ?? -1) - (a.depth ?? -1) || a.label.localeCompare(b.label, "ja")
      );
    })
    .map(([key, g]) => {
      const colors = colorOf ? [...g.ids].map(colorOf).filter((c): c is Color => c !== undefined) : [];
      return {
        key,
        kind: g.kind,
        label: g.label,
        count: g.ids.size,
        states: colorOf ? stateCounts(colors.map((color) => ({ color }))).filter((s) => s.count > 0) : [],
      };
    });
}

/** 避難先 1 ごとの人数（多い順、同じなら名前の順）。避難先の無い人は「未確認」で最後 */
export function destinationCounts(rows: ReadonlyArray<CaseloadRow>): DestinationCount[] {
  const counts = new Map<string, number>();
  let unset = 0;
  for (const r of rows) {
    if (r.destination) counts.set(r.destination, (counts.get(r.destination) ?? 0) + 1);
    else unset++;
  }
  const out: DestinationCount[] = [...counts.entries()]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b, "ja"))
    .map(([label, count]) => ({ label, count, unset: false }));
  if (unset > 0) out.push({ label: BLANK_LABELS.unconfirmed, count: unset, unset: true });
  return out;
}

/**
 * 地図のピン。発災時はルールの表の色と状態の言葉、理由を title に。
 * 本人が送った端末の位置（T69b の reported）があればそこに置き、title に「申告位置」を添える（無ければ台帳の位置）。印の形は同じ
 */
export function mapPins(
  rows: ReadonlyArray<CaseloadRow>,
  sort: SortKey,
  results?: ReadonlyArray<TriageResult>,
): MapPin[] {
  const rank = new Map((results ?? []).map((r, i) => [r.personId, { r, i }]));
  const n = rows.length;
  return rows
    .flatMap((r) => {
      const at = r.reported ?? r.location;
      return at ? [{ row: r, at, reported: r.reported !== null && r.reported !== undefined }] : [];
    })
    .map(({ row, at, reported }, i) => {
      const hit = rank.get(row.id);
      const state = hit ? COLOR_LABELS[hit.r.color] : null;
      const base = hit ? `${row.name} ${state} ${hit.r.reason}` : row.name;
      return {
        id: row.id,
        label: surname(row.name),
        title: reported ? `${base} ${PLACE_LABELS.reported}` : base,
        location: at,
        href: rowLink(sort, null, row.id).href,
        tone: hit ? COLOR_TONES[hit.r.color] : null,
        state,
        // 発災時は連絡の順が先の人ほど上に重ねる。平時は行の順
        layer: hit ? n - hit.i : i,
      };
    })
    .sort((a, b) => a.layer - b.layer);
}

export function buildSidePane(
  rows: ReadonlyArray<CaseloadRow>,
  opts: { sort: SortKey; disaster?: SideDisaster | null },
): SidePaneData {
  const disaster = opts.disaster ?? null;
  const colorById = disaster ? new Map(disaster.results.map((r) => [r.personId, r.color])) : null;
  const withPending = rows.filter((r) => r.pending > 0).sort(byPendingThenKana);
  return {
    mode: disaster ? "disaster" : "normal",
    plan: planCounts(rows),
    review: withPending.filter((r) => r.plan === "draft").map((r) => reviewItem(r, opts.sort)),
    pendingTop: withPending.map((r) => reviewItem(r, opts.sort)),
    pins: mapPins(rows, opts.sort, disaster?.results),
    unplaced: rows.filter((r) => r.location === null).length,
    hazards: hazardCounts(rows, colorById ? (id) => colorById.get(id) : undefined),
    destinations: destinationCounts(rows),
    states: disaster ? stateCounts(disaster.results) : null,
    demo: disaster?.scene ? demoOverlay(disaster.scene) : null,
  };
}
