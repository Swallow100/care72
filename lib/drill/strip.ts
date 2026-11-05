// 訓練の上の帯の段（docs/tasks/T128.md の 1）。72 時間の軸に、何が起きたかを種類の段に分けて印で置く。
//
// - 印は経過の行（lib/drill/timeline.ts の buildDrillLog）から作る。行の key がそのまま印と経過の行の結び付き（押すと経過のその行へ）。
//   進行中の非公表の隠し方も経過の発生のタブと同じになる（ケアマネが知り得ない物を帯にも出さない）
// - 段は表 1 つで決める: 状況（incident）は変化の種類 → 段（INCIDENT_LANE。全部の種類を持つ。足して行が無いと型で落ちる）、
//   本人のする事（doing）は本人、安否（signal）は赤と着信の物だけ連絡、手（action）は対応。手の返事で届いた事（heard）は対応の印に任せて置かない
// - 停電・電話・断水の段は帯（lib/drill/view.ts の bandsOf の Band）を描き、その段の状況の印も同じ段に置く。帯の種類が増えれば段も増える
//   （段の並びは BAND_LABELS の並び）
// - 空の段は出さない。段の並びは STRIP_ORDER
// - 色は 3 つだけ: 止まった・悪くなった状況は要確認の色（被害状況の欄と帯と同じ）、赤の安否は至急の色、ほかは本文色と灰。段ごとの色は作らない
//
// D1 を読まない。Claude を呼ばない。色と連絡の順（lib/triage）は読まない・変えない。

import { BAND_LABELS } from "./labels.ts";
import type { DrillLog, LogRow, LogTab } from "./timeline.ts";
import type { WorldChange, WorldEventKind } from "./scenarios.ts";

/** 帯の種類（停電・断水・電話。lib/drill/view.ts の Band の kind と同じ物を BAND_LABELS から） */
export type BandLane = keyof typeof BAND_LABELS;

/** 段。disaster 災害・帯の段・infra 道路と施設・shelter 避難所・person 本人に起きたこと・contact 人の連絡・act 自分の対応 */
export type StripLane = "disaster" | BandLane | "infra" | "shelter" | "person" | "contact" | "act";

/** 段の並び（上から）。帯の段は BAND_LABELS の並び */
export const STRIP_ORDER: ReadonlyArray<StripLane> = [
  "disaster",
  ...(Object.keys(BAND_LABELS) as BandLane[]),
  "infra",
  "shelter",
  "person",
  "contact",
  "act",
];

/** 段の名前（2〜4 字）。帯の段は BAND_LABELS */
export const STRIP_LABELS: Readonly<Record<StripLane, string>> = {
  disaster: "災害",
  ...BAND_LABELS,
  infra: "道路施設",
  shelter: "避難所",
  person: "本人",
  contact: "連絡",
  act: "対応",
};

/** 帯の段か */
export function isBandLane(lane: StripLane): lane is BandLane {
  return Object.hasOwn(BAND_LABELS, lane);
}

/**
 * 状況の変化の種類 → 段（1 か所の表）。null は帯に置かない（AI 停止の印は上の帯 1 本・世界の代替の印・予定は起きた時に別の状況になる・
 * 自動中断）。note と narration は中身で分ける（noteLane・narration は本人が付けば本人）
 */
export const INCIDENT_LANE: Readonly<Record<WorldEventKind, StripLane | "note" | "byPerson" | null>> = {
  alert: "disaster",
  quake: "disaster",
  tsunami: "disaster",
  flood: "disaster",
  town_flood: "disaster",
  landslide: "disaster",
  weather: "disaster",
  outage: "outage",
  outage_restored: "outage",
  phone: "phone",
  water: "water",
  road: "infra",
  town_road: "infra",
  facility: "infra",
  town_facility: "infra",
  town_water: "infra",
  town_line: "infra",
  shelter: "shelter",
  supply_left: "person",
  nurse_away: "person",
  going_home: "person",
  line_down: "person",
  mark: "person",
  check: "person",
  outcome: "person",
  narration: "byPerson",
  note: "note",
  schedule: null,
  world_note: null,
  ai_stop: null,
  auto_abandon: null,
};

/** 情報の話題 → 段。給水所は避難所、自分の身の回り（T104 の self_*）は自分の対応の段、ほかは災害 */
function noteLane(topic: string): StripLane {
  if (topic === "water_station") return "shelter";
  if (topic.startsWith("self_")) return "act";
  return "disaster";
}

/** 状況 1 つの段（帯に置かなければ null） */
export function incidentLane(e: { change: WorldChange; person?: string | null }): StripLane | null {
  const l = INCIDENT_LANE[e.change.kind] ?? null;
  if (l === "note") return e.change.kind === "note" ? noteLane(e.change.topic) : "disaster";
  if (l === "byPerson") return e.person ? "person" : "disaster";
  return l;
}

/** 印の色。check 要確認の色（止まった・悪くなった）、urgent 至急の色（赤の安否）、call 着信、plain 本文色・灰 */
export type MarkTone = "check" | "urgent" | "call" | "plain";

/** 悪くなった・止まった状況か（被害状況の欄で要確認の色の文字にする物と同じ向き）。解除・復旧・開設・通行の再開は plain */
export function worsened(c: WorldChange): boolean {
  switch (c.kind) {
    case "alert":
      return c.level !== null;
    case "tsunami":
      return c.state === "evacuate";
    case "phone":
      return c.state !== "ok";
    case "water":
    case "town_water":
      return c.out;
    case "road":
    case "town_road":
    case "facility":
    case "town_facility":
      return !c.open;
    case "shelter":
      return c.state !== "open";
    case "weather":
      return c.state === "rain";
    case "outage_restored":
    case "outcome":
    case "check":
    case "schedule":
    case "narration":
    case "world_note":
    case "ai_stop":
    case "auto_abandon":
      return false;
    case "note":
      return c.topic === "landslide_warn" || c.topic === "info_confusion" || c.topic === "self_outage" || c.topic === "self_battery" || c.topic === "self_late";
    default:
      return true;
  }
}

/** 印 1 つ。key は経過の行の鍵、tab は押したときに開く経過のタブ。end は幅のある印（手の始まりから終わり） */
export type StripMark = {
  key: string;
  lane: StripLane;
  tab: LogTab;
  minute: number;
  end: number | null;
  tone: MarkTone;
  row: LogRow;
};

/** 経過の行 → 印（帯に置かない行は null） */
export function markOf(r: LogRow): StripMark | null {
  const base = { key: r.key, minute: r.minute, end: null, row: r };
  switch (r.source) {
    case "incident": {
      const lane = incidentLane(r.e);
      if (!lane) return null;
      return { ...base, lane, tab: "occur", tone: worsened(r.e.change) ? "check" : "plain" };
    }
    case "doing":
      return { ...base, lane: "person", tab: "occur", tone: "plain" };
    case "signal":
      // 人の連絡は赤と着信だけ（緑の安否は数が多く、印を埋める。経過の把握のタブにはある）
      if (r.t.color === "red") return { ...base, lane: "contact", tab: "know", tone: "urgent" };
      return r.callIn ? { ...base, lane: "contact", tab: "know", tone: "call" } : null;
    case "action":
      return { ...base, lane: "act", tab: "act", tone: "plain", end: Math.max(r.a.atMinute, r.a.result?.atMinute ?? r.a.endMinute) };
    case "heard":
      return null;
  }
}

export type StripLaneView = { lane: StripLane; marks: StripMark[] };

/**
 * 帯の段（空の段は出さない。帯の段は帯か印があれば出す）。log は経過（進行中は公表の物だけの発生のタブと、把握・対応）。
 * 発生と把握の両方にある公表の状況は 1 つにする（発生の物を使う）
 */
export function buildStrip(log: Pick<DrillLog, "occur" | "know" | "act">, bandKinds: ReadonlyArray<BandLane> = []): StripLaneView[] {
  const seen = new Set<string>();
  const marks: StripMark[] = [];
  for (const r of [...log.occur, ...log.know, ...log.act]) {
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    const m = markOf(r);
    if (m) marks.push(m);
  }
  marks.sort((a, b) => a.minute - b.minute);
  const bands = new Set<StripLane>(bandKinds);
  return STRIP_ORDER.flatMap((lane) => {
    const own = marks.filter((m) => m.lane === lane);
    return own.length > 0 || bands.has(lane) ? [{ lane, marks: own }] : [];
  });
}

/** 近い印をまとめた 1 つ（重なると押せない）。from・to は先頭と最後の印の時刻 */
export type MarkCluster = { from: number; to: number; marks: StripMark[] };

/**
 * 同じ段で近い印（先頭から window 分の内）を 1 つにまとめる（幅のある印 end はまとめない）。72 時間の軸で 60 分は 1280px の幅で約 11px
 */
export function clusterMarks(marks: ReadonlyArray<StripMark>, window = 60): MarkCluster[] {
  const out: MarkCluster[] = [];
  for (const m of [...marks].sort((a, b) => a.minute - b.minute)) {
    const last = out.at(-1);
    if (last && m.end === null && last.marks[0].end === null && m.minute - last.from <= window) {
      last.marks.push(m);
      last.to = m.minute;
    } else {
      out.push({ from: m.minute, to: m.minute, marks: [m] });
    }
  }
  return out;
}

/** まとめた印の色（至急 → 要確認 → 着信 → 本文色の順に強い物） */
export function clusterTone(c: MarkCluster): MarkTone {
  const order: MarkTone[] = ["urgent", "check", "call", "plain"];
  return order.find((t) => c.marks.some((m) => m.tone === t)) ?? "plain";
}

// 経過の行への錨の id と、hash → タブは lib/drill/news.ts（ブラウザの部品も読むので、そちらに 1 か所）
export { logAnchorId, tabOfAnchor } from "./news.ts";
