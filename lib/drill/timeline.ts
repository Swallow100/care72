// 訓練の経過を 3 つのタブに分ける表（docs/tasks/T105.md）。発生（起きたこと）・把握（分かったこと）・対応（した対応）。
//
// - 1 行がどのタブに入るかは、記録の種類（状況 incident・本人のする事 doing・安否 signal・手の返事で届いた事 heard・手 action）から
//   LOG_ROUTE の表で決める。状況は公表か（ケアマネが訓練の途中で知り得るか）を変化の種類ごとの表 INCIDENT_REACH で見て、
//   公表の状況は起きた時に把握にも入る
// - 公表の決めは、採点（lib/drill/score.ts の knownOf）が「手を打った時に分かっていた事実」に数える物とそろえる
//   （世界の電話・施設の休止・道・家の電話の通話不可・訪問看護が来られない）。そろえないと、見比べで「未把握」の事実への手を
//   採点が空振りに数えて食い違う
// - 非公表（本人に起きたこと: 持ち出し忘れ・帰宅希望・介護事業所の休止・家族の帰宅困難・車中泊・近所の声掛・外出・冷蔵不可・
//   本人の予定・本人のする事）は、訓練の途中は発生に出さず、終わってから出す（問いの答えまで。docs/progress/t105.md）
// - 把握の時刻: 非公表の物は、起きた時刻より後（同じ分を含む）に、その人の側から言葉が届いた最初の時刻
//   （安否の言う事・電話に出た人の言う事・通話の往復・訪問で見た様子・通話や訪問で聞いた安否）。届かなければ未把握。
//   届いた言葉がその出来事に触れたかは見ない（言葉を読んで決めると Claude の判断になる）
// - 時刻は発災からの分（分に丸める。lib/drill/time-text.ts の言い方）。並びは古い順で返し、画面は新しい順に逆にして描く
//
// D1 を読まない。Claude を呼ばない。色と連絡の順（lib/triage）は読まない・変えない。

import type { ActionRecord, DrillIncident, DrillTurn, Tick } from "./engine.ts";
import { isStopIncident } from "./ai-stop.ts";
import { turnRoutes, type TurnRoute } from "./calls.ts";
import type { CallRecord } from "./responses.ts";
import { LOG_LABELS } from "./labels.ts";
import type { Arrival, PersonMarks, Scheduled, WorldEventKind } from "./scenarios.ts";

// ---------- タブと表 ----------

export const LOG_TABS = ["occur", "know", "act"] as const;
export type LogTab = (typeof LOG_TABS)[number];

/** 既定のタブ（訓練の途中も終わったあとも、届いた物から見る） */
export const DEFAULT_LOG_TAB: LogTab = "know";

export function parseLogTab(v: unknown): LogTab {
  return typeof v === "string" && (LOG_TABS as readonly string[]).includes(v) ? (v as LogTab) : DEFAULT_LOG_TAB;
}

/**
 * 記録の種類。incident 状況・doing 本人のする事・signal 安否・heard 手の返事で届いた事・action 手・
 * call 着信への応答と拒否（T127）・reply 着信の往復で掛けてきた人の言った事（T127）
 */
export const LOG_SOURCES = ["incident", "doing", "signal", "heard", "action", "call", "reply"] as const;
export type LogSource = (typeof LOG_SOURCES)[number];

/**
 * 記録の種類 → 入るタブ（1 か所の表）。状況は公表なら把握にも入る（incidentReach）。
 * 手の返事のうち言葉・様子・事実の届いた物（heard）は把握、手そのもの（action）は対応
 */
export const LOG_ROUTE: Readonly<Record<LogSource, ReadonlyArray<LogTab>>> = {
  incident: ["occur"],
  doing: ["occur"],
  signal: ["know"],
  heard: ["know"],
  action: ["act"],
  call: ["act"],
  reply: ["know"],
};

/**
 * 状況の届き方。public 公表（起きた時に把握）・private 本人に起きたこと（途中は出さない）・
 * byPerson 本人の付いた物は private、付かない物は public・none 経過に出さない（AI 停止の印は上の帯 1 本、T76）
 */
export type Reach = "public" | "private" | "byPerson" | "none";

export const INCIDENT_REACH: Readonly<Record<WorldEventKind, Reach>> = {
  alert: "public",
  quake: "public",
  tsunami: "public",
  flood: "public",
  outage: "public",
  outage_restored: "public",
  phone: "public",
  radio: "public",
  water: "public",
  road: "public",
  shelter: "public",
  facility: "public",
  supply_left: "private",
  nurse_away: "public",
  going_home: "private",
  line_down: "public",
  town_flood: "public",
  landslide: "public",
  town_road: "public",
  town_water: "public",
  town_line: "public",
  town_facility: "public",
  weather: "public",
  narration: "byPerson",
  // 世界の止まりの印は上の帯（T76）。世界の 1 文のある刻みの代替の印は 1 文に添える（行にしない）
  world_note: "none",
  // 結末（仮想モード、T53）は左の表の名前の下に途中から出ている（app/drill/[id]/page.tsx の nameNote）ので、隠さない
  outcome: "public",
  ai_stop: "none",
  auto_abandon: "public",
  note: "public",
  mark: "private",
  check: "private",
  schedule: "byPerson",
};

/**
 * 本人ごとの印の届き方（被害状況の「個別」。訓練の途中は公表の物だけ出す）。
 * 家の電話・訪問看護は採点の knownOf が分かっていた事実に数えるので公表、浸水・断水は町の出来事（仮想モード）から付くので公表
 */
export const MARK_REACH: Readonly<Record<keyof PersonMarks, "public" | "private">> = {
  supplyLeft: "private",
  nurseAway: "public",
  goingHome: "private",
  lineDown: "public",
  flooded: "public",
  waterOut: "public",
  helperAway: "private",
  familyAway: "private",
  carSleep: "private",
  neighborWatch: "private",
  wandering: "private",
  found: "private",
};

/** 状況の届き方（public・private・none）。表の外の種類は private（隠す側に倒す） */
export function incidentReach(e: Pick<DrillIncident, "change" | "person">): "public" | "private" | "none" {
  const r = INCIDENT_REACH[e.change.kind] ?? "private";
  if (r === "byPerson") return e.person ? "private" : "public";
  return r;
}

/** 予定の出来事（被害状況の「予定」）を訓練の途中に出すか。本人の付いた予定（業者の巡回など）は出さない。ケアマネの手の予定は出す */
export function scheduledPublic(s: Pick<Scheduled, "person" | "by">): boolean {
  return s.by === "action" || !s.person;
}

/** 向かっている人（被害状況の「到着」）を訓練の途中に出すか。ケアマネの手で向かった人だけ（監督・世界の巡回は出さない） */
export function arrivalPublic(a: Pick<Arrival, "from">): boolean {
  return a.from !== "director" && a.from !== "world";
}

/** 記録の種類と公表かから、入るタブ */
export function tabsOf(source: LogSource, reach: "public" | "private" = "private"): LogTab[] {
  const base = [...LOG_ROUTE[source]];
  return source === "incident" && reach === "public" ? [...base, "know"] : base;
}

// ---------- 行 ----------

type RowBase = { key: string; minute: number; person: string | null };

export type LogRow =
  | (RowBase & { source: "incident"; e: DrillIncident; step: number; reach: "public" | "private"; fallback: boolean })
  | (RowBase & { source: "doing"; t: DrillTurn; step: number })
  | (RowBase & { source: "signal"; t: DrillTurn; step: number; callIn: boolean; route: TurnRoute })
  | (RowBase & { source: "heard"; a: ActionRecord })
  | (RowBase & { source: "action"; a: ActionRecord })
  | (RowBase & { source: "call"; c: CallRecord })
  | (RowBase & { source: "reply"; c: CallRecord });

/**
 * 把握の行がどの経路で届いたか（T127。行の印）。安否は着信・不在・ボタン（lib/drill/calls.ts の turnRoute）、
 * 手の返事は発信（電話）・訪問・結果（世界の事実だけ）、着信の往復は着信、公表の状況は公表
 */
export type KnowRoute = TurnRoute | "out" | "visit" | "result" | "public";

/** 経路の印の言葉（2〜4 字。「ボタン」は本人・家族の画面の安否のボタン） */
export const ROUTE_LABELS: Readonly<Record<KnowRoute, string>> = {
  call: "着信",
  missed: "不在",
  button: "ボタン",
  // 通話の規制の間の家族・支援者のメッセージ（T125）
  message: "伝言",
  out: "発信",
  visit: "訪問",
  result: "結果",
  public: "公表",
};

/** 対応のタブの着信の行の言葉（T127） */
export const CALL_LOG_LABELS = { answer: "応答", decline: "拒否" } as const;

/** 訪問の形の手（着いて様子を見る） */
const VISIT_KINDS: ReadonlySet<ActionRecord["kind"]> = new Set(["visit"]);

export function knowRouteOf(r: LogRow): KnowRoute | null {
  switch (r.source) {
    case "signal":
      return r.route;
    case "reply":
      return "call";
    case "incident":
      return "public";
    case "heard": {
      const res = r.a.result;
      if (!res) return null;
      if (res.heard?.via === "visit" || res.visit || VISIT_KINDS.has(r.a.kind)) return "visit";
      if (res.pickup !== null || res.speech || (res.talk?.length ?? 0) > 0 || res.heard?.via === "call") return "out";
      return "result";
    }
    default:
      return null;
  }
}

/** 把握の経路。public 公表・signal 安否の言う事・heard 通話や訪問 */
export type AwareVia = "public" | "signal" | "heard";

/** 発生の 1 行の把握。at は把握の時刻（分）、lag は起きてからの分。mark は late 遅れ（lag が 0 より大）・never 未把握 */
export type Awareness = {
  at: number | null;
  via: AwareVia | null;
  /** 把握を運んだ行の鍵（安否・手の返事）。公表と未把握は null */
  from: string | null;
  lag: number | null;
  mark: "late" | "never" | null;
};

export type DrillLog = {
  /** 古い順 */
  occur: LogRow[];
  know: LogRow[];
  act: LogRow[];
  /** 発生の行の鍵 → 把握 */
  aware: Record<string, Awareness>;
  /** 訓練の途中で発生に出していない行の数（終わっていれば 0） */
  hidden: number;
};

const minuteOf = (hour: number) => Math.max(0, Math.round(hour * 60));

/** 手の返事で、その人の側から言葉か様子が届いたか（通話・往復・訪問・聞いた安否） */
function contactOf(a: ActionRecord): boolean {
  const r = a.result;
  if (!r) return false;
  return Boolean(r.speech) || (r.talk?.length ?? 0) > 0 || Boolean(r.visit) || Boolean(r.heard);
}

/** 手の返事に、把握のタブに出す物（言葉・様子・聞いた安否・世界の事実）があるか */
export function heardOf(a: ActionRecord): boolean {
  const r = a.result;
  if (!r) return false;
  return contactOf(a) || Boolean(r.because);
}

/** 本人の側から言葉の届いた安否（言う事がある） */
const saidOf = (t: DrillTurn) => Boolean(t.saying?.trim());

/**
 * 刻みと手から 3 つのタブの行を作る。finished は終わった・中断した訓練（非公表の行も発生に出す）。
 * 状況の欄と同じく、AI 停止の印（ai_stop・世界の止まり）は上の帯に任せて外し、世界の 1 文のある刻みの代替の印は 1 文に添える
 */
export function buildDrillLog(
  ticks: ReadonlyArray<Tick>,
  actions: ReadonlyArray<ActionRecord>,
  opts: { finished: boolean; calls?: ReadonlyArray<CallRecord> },
): DrillLog {
  const all: LogRow[] = [];
  for (const t of ticks) {
    const fellBack = t.incidents.some((e) => e.change.kind === "world_note" && e.change.state === "down");
    const hasNarration = t.incidents.some((e) => e.change.kind === "narration");
    t.incidents.forEach((e, n) => {
      if (isStopIncident(e, t)) return;
      if (hasNarration && e.change.kind === "world_note") return;
      const reach = incidentReach(e);
      if (reach === "none") return;
      all.push({
        source: "incident",
        key: `i-${t.step}-${n}`,
        minute: minuteOf(e.at),
        person: e.person ?? null,
        e,
        step: t.step,
        reach,
        fallback: fellBack && e.change.kind === "narration",
      });
    });
    const routes = turnRoutes(t.turns);
    t.turns.forEach((x, n) => {
      const route = routes[n];
      all.push({ source: "signal", key: `s-${t.step}-${n}`, minute: minuteOf(x.at), person: x.person, t: x, step: t.step, callIn: route === "call", route });
      if (x.doing?.trim()) all.push({ source: "doing", key: `d-${t.step}-${n}`, minute: minuteOf(x.at), person: x.person, t: x, step: t.step });
    });
  }
  for (const a of actions) {
    all.push({ source: "action", key: `a-${a.id}`, minute: a.atMinute, person: a.person, a });
    if (a.result && heardOf(a)) all.push({ source: "heard", key: `h-${a.id}`, minute: a.result.atMinute, person: a.person, a });
  }
  // 着信への応答・拒否（対応）と、往復で掛けてきた人の言った事（把握。最初の返事の時刻）。T127
  for (const c of opts.calls ?? []) {
    if (!c.response) continue;
    all.push({ source: "call", key: `c-${c.signal}`, minute: c.respondedAt ?? c.minute, person: c.person, c });
    const said = (c.talk ?? []).find((l) => l.who === "them");
    if (said) all.push({ source: "reply", key: `r-${c.signal}`, minute: said.minute, person: c.person, c });
  }
  // 古い順（同じ分は作った順）
  const sorted = all.map((r, i) => ({ r, i })).sort((x, y) => x.r.minute - y.r.minute || x.i - y.i).map((x) => x.r);

  const reachOfRow = (r: LogRow): "public" | "private" => (r.source === "incident" ? r.reach : "private");
  const inTab = (r: LogRow, tab: LogTab) => tabsOf(r.source, reachOfRow(r)).includes(tab);
  const know = sorted.filter((r) => inTab(r, "know"));
  const occurAll = sorted.filter((r) => inTab(r, "occur"));
  const occur = opts.finished ? occurAll : occurAll.filter((r) => reachOfRow(r) === "public");
  const act = sorted.filter((r) => inTab(r, "act"));

  // 把握: その人の側から言葉か様子が届いた時刻（安否の言う事・手の返事の言葉と様子）
  const contacts = know.flatMap((r): Array<{ person: string; minute: number; via: AwareVia; key: string }> => {
    if (r.source === "signal" && saidOf(r.t)) return [{ person: r.t.person, minute: r.minute, via: "signal", key: r.key }];
    if (r.source === "heard" && r.person && contactOf(r.a)) return [{ person: r.person, minute: r.minute, via: "heard", key: r.key }];
    // 着信の往復（T127）: 掛けてきた人の言葉ごと
    if (r.source === "reply") {
      return (r.c.talk ?? []).flatMap((l) => (l.who === "them" ? [{ person: r.c.person, minute: l.minute, via: "heard" as const, key: r.key }] : []));
    }
    return [];
  });
  const aware: Record<string, Awareness> = {};
  for (const r of occurAll) {
    if (reachOfRow(r) === "public") {
      aware[r.key] = { at: r.minute, via: "public", from: null, lag: 0, mark: null };
      continue;
    }
    const hit = r.person ? contacts.find((c) => c.person === r.person && c.minute >= r.minute) : undefined;
    if (!hit) {
      aware[r.key] = { at: null, via: null, from: null, lag: null, mark: "never" };
      continue;
    }
    const lag = hit.minute - r.minute;
    aware[r.key] = { at: hit.minute, via: hit.via, from: hit.key, lag, mark: lag > 0 ? "late" : null };
  }
  return { occur, know, act, aware, hidden: occurAll.length - occur.length };
}

/** 見比べの数（訓練記録。採点 T94 の内訳と同じ形の 1 行に）。発生の行のうち遅れ・未把握・公表の数 */
export type AwareCounts = { total: number; publicCount: number; late: number; never: number };

export function awareCounts(log: Pick<DrillLog, "occur" | "aware">): AwareCounts {
  const out: AwareCounts = { total: log.occur.length, publicCount: 0, late: 0, never: 0 };
  for (const r of log.occur) {
    const w = log.aware[r.key];
    if (!w) continue;
    if (w.via === "public") out.publicCount += 1;
    if (w.mark === "late") out.late += 1;
    if (w.mark === "never") out.never += 1;
  }
  return out;
}

/** 見比べの 1 行（「発生 12・公表 8・遅れ 3・未把握 1」）。採点の内訳（score-view.ts の extraText）と同じ形 */
export function awareText(c: AwareCounts): string {
  return [
    `${LOG_LABELS.occur} ${c.total}`,
    `${LOG_LABELS.public} ${c.publicCount}`,
    `${LOG_LABELS.late} ${c.late}`,
    `${LOG_LABELS.never} ${c.never}`,
  ].join("・");
}
