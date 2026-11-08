// 事業所の災害の状態（docs/tasks/T09.md）。D1 を使わない所: 言葉・ルールの表への入力・ヘッダーの印・経過の 1 行・入力の読み方。
//
// 災害モードは人が切り替える（大雨・台風・土砂・地震・津波・その他・平時に戻す）。気象庁の情報からの自動の切替は作っていない。
// ルールの表（lib/triage）に渡すのは 今・発災・停電の始まり の 3 つだけ（Situation の形は変えない）。
// 警戒レベル・断水・道路は人が見るための物で、表の入力にしない（docs/DECISIONS.md「地図と災害の情報」）。
//
// 停電の範囲が「地区」のときは、本人の町名が地区に入る人だけ停電の時計を走らせる。町名の無い人は外さない（停電に入れる）。

import type { AlertLevel, DisasterKind, DisasterStateRow, OfficeTimelineKind, OutageScope } from "../db/types.ts";
import { ALERT_LEVELS, DISASTER_KINDS, OUTAGE_SCOPES } from "../db/types.ts";
import type { Situation } from "../triage/index.ts";

// ---------- 言葉 ----------

/** 事業所の状態の言葉。画面とヘッダーの印に出す。気象庁の警報の言葉は使わない */
export const DISASTER_KIND_LABELS: Record<DisasterKind, string> = {
  normal: "平時",
  heavy_rain: "大雨",
  typhoon: "台風",
  landslide: "土砂",
  earthquake: "地震",
  tsunami: "津波",
  other: "その他",
};

/** 警戒レベルを持つ種類（場面が大雨: 大雨・台風・土砂）。ほかの種類では欄を出さず、切り替えたときと保存で NULL に */
export function hasAlertLevel(kind: DisasterKind): boolean {
  return DISASTER_SCENE[kind] === "heavy_rain";
}

/** 地図の場面（lib/map/demo.ts の雨雲・震度のデモ）の種類。null は場面なし */
export type DisasterScene = "heavy_rain" | "earthquake" | null;

/**
 * 災害の種類から地図の場面へ写す 1 つの表（T60）。大雨・台風・土砂は大雨の場面（警戒レベルが雨雲に効く）、
 * 地震・津波は地震の場面（震度の印）、平時とその他は場面なし（雨雲・震度を出さず、ピン・ハザード・避難所は今まで通り）。
 * 災害の種類で分かれるのはここから引く地図の場面だけで、ルールの表（lib/triage）の入力には種類を渡さない
 */
export const DISASTER_SCENE: Record<DisasterKind, DisasterScene> = {
  normal: null,
  heavy_rain: "heavy_rain",
  typhoon: "heavy_rain",
  landslide: "heavy_rain",
  earthquake: "earthquake",
  tsunami: "earthquake",
  other: null,
};

export const OUTAGE_SCOPE_LABELS: Record<OutageScope, string> = {
  none: "無し",
  office: "事業所全体",
  area: "地区",
};

export const OFFICE_TIMELINE_KIND_LABELS: Record<OfficeTimelineKind, string> = {
  disaster_on: "災害モード",
  disaster_off: "平時",
  disaster_info: "災害情報",
  // 利用者とケアマネ（T30、lib/office）
  person_added: "利用者追加",
  person_assigned: "担当変更",
  person_unlisted: "一覧除外",
  person_relisted: "一覧復帰",
  care_manager_added: "ケアマネ追加",
  // 改名・管理者・停止・再発行など（T61、lib/office/staff.ts）
  care_manager_changed: "ケアマネ変更",
  // 所属なしの人を引き受けた（T23、lib/custody）
  person_taken: "引受",
};

/** 画面の見出しと欄の名前 */
export const DISASTER_LABELS = {
  page: "事業所",
  mode: "災害モード",
  info: "災害情報",
  log: "経過",
  startedAt: "発災",
  startedBy: "切替",
  outage: "停電",
  outageAt: "停電開始",
  towns: "地区",
  level: "警戒レベル",
  levelNone: "なし",
  water: "断水",
  road: "道路",
  save: "保存",
  backToNormal: "平時復帰",
  /** 平時に戻す確認の欄の 1 行（戻すと消える欄） */
  clearOnNormal: "消す項目: 停電・警戒レベル・断水・道路",
  /** 平時から災害モードへの確認の窓の本文（「災害モード 大雨」） */
  toDisaster: "災害モード",
  /** 平時から災害モードへの確認の窓の箇条（切り替えると起きる事） */
  onStart: ["発災: 押した時刻", "並び: 色と連絡順"],
  cancel: "取消",
  noTown: "町名なし",
  inOutage: "停電中",
  none: "なし",
} as const;

// ---------- 状態 ----------

export type OutageState = {
  scope: OutageScope;
  /** 停電の地区（町名）。範囲が地区のときだけ中身がある */
  towns: string[];
  /** 停電の始まり（ISO 8601）。停電が無ければ null */
  startedAt: string | null;
};

/** 人が入れる災害の情報（災害モードの間だけ） */
export type DisasterInfo = {
  /** 発災（ISO 8601） */
  startedAt: string;
  outage: OutageState;
  alertLevel: AlertLevel | null;
  water: string | null;
  road: string | null;
};

export type DisasterState = {
  officeId: string;
  kind: DisasterKind;
  /** 発災。平時は null */
  startedAt: string | null;
  /** 災害モードに切り替えた人（アカウントの id と名前） */
  startedBy: string | null;
  startedByName: string | null;
  outage: OutageState;
  alertLevel: AlertLevel | null;
  water: string | null;
  road: string | null;
  /** 版。行が無ければ 0（平時） */
  version: number;
  updatedAt: string | null;
  updatedByName: string | null;
};

export type DisasterStateJoin = DisasterStateRow & { started_by_name: string | null; updated_by_name: string | null };

/** 行の無い事業所（平時） */
export function normalState(officeId: string): DisasterState {
  return {
    officeId,
    kind: "normal",
    startedAt: null,
    startedBy: null,
    startedByName: null,
    outage: { scope: "none", towns: [], startedAt: null },
    alertLevel: null,
    water: null,
    road: null,
    version: 0,
    updatedAt: null,
    updatedByName: null,
  };
}

/** 町名の JSON の配列を読む。読めない物・文字でない物は捨てる */
export function parseTowns(text: string | null): string[] {
  if (!text) return [];
  try {
    const v = JSON.parse(text) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : [];
  } catch {
    return [];
  }
}

export function fromRow(row: DisasterStateJoin): DisasterState {
  return {
    officeId: row.office_id,
    kind: row.kind,
    startedAt: row.started_at,
    startedBy: row.started_by,
    startedByName: row.started_by_name || null,
    outage: {
      scope: row.outage_scope,
      towns: row.outage_scope === "area" ? parseTowns(row.outage_towns) : [],
      startedAt: row.outage_scope === "none" ? null : row.outage_started_at,
    },
    alertLevel: row.alert_level,
    water: row.water,
    road: row.road,
    version: row.version,
    updatedAt: row.updated_at,
    updatedByName: row.updated_by_name || null,
  };
}

export function isDisaster(s: Pick<DisasterState, "kind" | "startedAt">): boolean {
  return s.kind !== "normal" && s.startedAt !== null;
}

/** 災害モードのときの今の情報（入力の欄の初めの値） */
export function infoOf(s: DisasterState): DisasterInfo | null {
  if (!isDisaster(s) || s.startedAt === null) return null;
  return { startedAt: s.startedAt, outage: s.outage, alertLevel: s.alertLevel, water: s.water, road: s.road };
}

// ---------- 切替の確認の窓（T79） ----------

/** 切替のボタンが出す確認の窓の中身（components/ui/SubmitButton の confirm と同じ形。題とボタンの言葉は呼ぶ側の CONFIRM_LABELS） */
export type ModeConfirm = {
  step: "to_disaster" | "to_normal";
  message: string;
  details: string[];
};

/**
 * 切替に確認の窓が要るか（11/4 の点検の中 8）。平時 → 災害モード と 災害モード → 平時 は窓で決めてから送る。
 * 災害の種類どうし（大雨 → 台風 など）は窓なし（発災・停電の範囲と始まり・断水・道路はそのまま。lib/disaster/db.ts の switchDisasterMode）。
 * 平時に戻すときは、今入っていて消える値を箇条に出す（種の停電・警戒レベル 4 を知らずに消さないように）
 */
export function modeConfirm(s: DisasterState, kind: DisasterKind): ModeConfirm | null {
  if (kind === s.kind) return null;
  if (kind === "normal") {
    const info = infoOf(s);
    const details = info
      ? [
          info.outage.scope !== "none" ? `${DISASTER_LABELS.outage} ${outageText(info.outage)}` : null,
          info.alertLevel !== null ? `${DISASTER_LABELS.level} ${info.alertLevel}` : null,
          info.water ? `${DISASTER_LABELS.water} ${info.water}` : null,
          info.road ? `${DISASTER_LABELS.road} ${info.road}` : null,
        ].filter((d): d is string => d !== null)
      : [];
    return { step: "to_normal", message: DISASTER_LABELS.clearOnNormal, details };
  }
  if (isDisaster(s)) return null;
  return { step: "to_disaster", message: `${DISASTER_LABELS.toDisaster} ${DISASTER_KIND_LABELS[kind]}`, details: [...DISASTER_LABELS.onStart] };
}

// ---------- ルールの表の入力 ----------

/**
 * ルールの表に渡す状況に、停電の地区を添えた物。地区が null なら停電は事業所の全員（か停電なし）。
 * Situation の形はそのまま（lib/triage は地区を知らない）。本人ごとに personSituation で地区を当ててから渡す
 */
export type DisasterSituation = Situation & { outageTowns: string[] | null };

/** 災害モードなら 今・発災・停電の始まり。平時は null（ルールの表を使わず、優先の骨格で並べる） */
export function toSituation(s: DisasterState, now: string): DisasterSituation | null {
  if (!isDisaster(s) || s.startedAt === null) return null;
  const outage = s.outage.scope !== "none" && s.outage.startedAt !== null;
  return {
    now,
    disasterAt: s.startedAt,
    outageAt: outage ? s.outage.startedAt : null,
    outageTowns: outage && s.outage.scope === "area" ? [...s.outage.towns] : null,
  };
}

/** 本人の町名が停電の地区に入るか。地区が無ければ（事業所全体）入る。町名の無い人は外さない */
export function inOutageArea(towns: ReadonlyArray<string> | null | undefined, town: string | null | undefined): boolean {
  if (!towns) return true;
  const t = town?.trim();
  if (!t) return true;
  return towns.includes(t);
}

/** 本人 1 人に渡す状況。停電の地区の外の人は停電なし（停電で走る時計は止まったまま） */
export function personSituation(s: Situation & { outageTowns?: string[] | null }, town: string | null | undefined): Situation {
  const base: Situation = { now: s.now, disasterAt: s.disasterAt, outageAt: s.outageAt };
  return inOutageArea(s.outageTowns, town) ? base : { ...base, outageAt: null };
}

// ---------- 時刻の言い方 ----------

const HOUR_MS = 3_600_000;

function jstParts(iso: string): { y: string; mo: string; d: string; h: string; mi: string } | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const s = new Date(t + 9 * HOUR_MS).toISOString();
  return { y: s.slice(0, 4), mo: s.slice(5, 7), d: s.slice(8, 10), h: s.slice(11, 13), mi: s.slice(14, 16) };
}

/** 経過の短い時刻「11/4 10:42」（日本の時刻） */
export function shortJst(iso: string): string {
  const p = jstParts(iso);
  if (!p) return iso;
  return `${Number(p.mo)}/${Number(p.d)} ${p.h}:${p.mi}`;
}

/** 日付だけ「11/2」（日本の時刻） */
export function dayJst(iso: string): string {
  const p = jstParts(iso);
  if (!p) return iso;
  return `${Number(p.mo)}/${Number(p.d)}`;
}

/** datetime-local の欄の値（日本の時刻 YYYY-MM-DDTHH:MM）。読めなければ空 */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const p = jstParts(iso);
  return p ? `${p.y}-${p.mo}-${p.d}T${p.h}:${p.mi}` : "";
}

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** datetime-local の値（日本の時刻とみなす）を ISO 8601（UTC）に。形が違えば null */
export function fromLocalInput(v: string): string | null {
  const m = LOCAL_INPUT.exec(v.trim());
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00`);
  if (Number.isNaN(t)) return null;
  const iso = new Date(t).toISOString();
  // 2 月 30 日などは Date が次の月に送るので、戻して同じかで確かめる
  return toLocalInput(iso) === `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}` ? iso : null;
}

/** 経過の時間の短い言い方。1 時間未満は分、2 日未満は時間、それ以上は日（切り捨て） */
export function elapsedText(fromIso: string, nowIso: string): string | null {
  const from = Date.parse(fromIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(from) || Number.isNaN(now) || now < from) return null;
  const h = (now - from) / HOUR_MS;
  if (h < 1) return `${Math.floor(h * 60)} 分`;
  if (h < 48) return `${Math.floor(h)} 時間`;
  return `${Math.floor(h / 24)} 日`;
}

// ---------- ヘッダーの印 ----------

export type DisasterMark =
  | { kind: "normal"; label: string }
  | { kind: "disaster"; label: string; details: string[] };

/** ヘッダーの印。平時は「平時」、災害モードは種類の言葉（「大雨」「台風」）と「レベル 4」「停電 3 時間」 */
export function disasterMark(s: DisasterState, now: string): DisasterMark {
  if (!isDisaster(s)) return { kind: "normal", label: DISASTER_KIND_LABELS.normal };
  const details: string[] = [];
  if (s.alertLevel !== null && hasAlertLevel(s.kind)) details.push(`レベル ${s.alertLevel}`);
  if (s.outage.scope !== "none" && s.outage.startedAt) {
    const e = elapsedText(s.outage.startedAt, now);
    const where = s.outage.scope === "area" ? "（地区）" : "";
    details.push(e ? `停電${where} ${e}` : `停電${where}`);
  }
  return { kind: "disaster", label: DISASTER_KIND_LABELS[s.kind], details };
}

// ---------- 経過の 1 行 ----------

/** 停電の言い方「事業所全体 11/4 08:00〜」「地区（市坪西町・北井門五丁目） 11/4 08:00〜」「無し」 */
export function outageText(o: OutageState): string {
  if (o.scope === "none" || !o.startedAt) return OUTAGE_SCOPE_LABELS.none;
  const where = o.scope === "area" ? `${OUTAGE_SCOPE_LABELS.area}（${o.towns.join("・")}）` : OUTAGE_SCOPE_LABELS.office;
  return `${where} ${shortJst(o.startedAt)}〜`;
}

const sameOutage = (a: OutageState, b: OutageState) =>
  a.scope === b.scope && a.startedAt === b.startedAt && a.towns.join("\n") === b.towns.join("\n");

/** 情報の変わった所だけを経過の 1 行に。変わっていなければ空の配列 */
export function infoChanges(before: DisasterInfo, after: DisasterInfo): string[] {
  const out: string[] = [];
  if (before.startedAt !== after.startedAt) out.push(`${DISASTER_LABELS.startedAt} ${shortJst(after.startedAt)}`);
  if (!sameOutage(before.outage, after.outage)) out.push(`${DISASTER_LABELS.outage} ${outageText(after.outage)}`);
  if (before.alertLevel !== after.alertLevel) {
    out.push(after.alertLevel === null ? `${DISASTER_LABELS.level} ${DISASTER_LABELS.levelNone}` : `${DISASTER_LABELS.level} ${after.alertLevel}`);
  }
  if (before.water !== after.water) out.push(`${DISASTER_LABELS.water} ${after.water ?? DISASTER_LABELS.none}`);
  if (before.road !== after.road) out.push(`${DISASTER_LABELS.road} ${after.road ?? DISASTER_LABELS.none}`);
  return out;
}

/** 経過の payload（変えたあとの状態の写し）。人の名前・住所は入れない */
export function statePayload(s: { kind: DisasterKind } & Partial<DisasterInfo>): string {
  return JSON.stringify({
    kind: s.kind,
    startedAt: s.startedAt ?? null,
    outage: s.outage ?? { scope: "none", towns: [], startedAt: null },
    alertLevel: s.alertLevel ?? null,
    water: s.water ?? null,
    road: s.road ?? null,
  });
}

// ---------- 入力の読み方（フォーム） ----------

export const MAX_TEXT_LENGTH = 200;
export const MAX_TOWNS = 50;
/** 先の時刻として断るまでの余裕（端末の時計のずれ） */
const FUTURE_SLACK_MS = 2 * 60_000;

export const DISASTER_FORM_ERRORS = [
  "bad",
  "started",
  "outage_at",
  "future",
  "towns",
  "long",
  "conflict",
  "normal",
] as const;
export type DisasterFormError = (typeof DISASTER_FORM_ERRORS)[number];

export const DISASTER_FORM_ERROR_LABELS: Record<DisasterFormError, string> = {
  bad: "入力不正",
  started: "発災時刻 不正",
  outage_at: "停電開始 未入力",
  future: "未来の時刻",
  towns: "地区 未選択",
  long: "文字数超過",
  conflict: "競合 再読込",
  normal: "平時は入力不可",
};

/** フォームの値（FormData の get・getAll の形） */
export type FormLike = {
  get(name: string): FormDataEntryValue | null;
  getAll(name: string): FormDataEntryValue[];
};

const str = (v: FormDataEntryValue | null | undefined): string | null => (typeof v === "string" ? v : null);

/** 画面で読んだ版。0 以上の整数だけ */
export function parseVersion(v: FormDataEntryValue | null | undefined): number | null {
  const s = str(v);
  if (s === null || !/^\d{1,9}$/.test(s)) return null;
  return Number(s);
}

export function isDisasterKind(v: unknown): v is DisasterKind {
  return typeof v === "string" && (DISASTER_KINDS as readonly string[]).includes(v);
}

export type ModeForm = { kind: DisasterKind; version: number };

/**
 * 切替のフォーム。平時に戻すは確認（confirm=1）が要る。無ければ needsConfirm（確認の欄を開く）
 */
export function parseModeForm(
  form: FormLike | null,
): { ok: true; value: ModeForm } | { ok: false; error: "bad" } | { ok: false; error: "confirm" } {
  const kind = str(form?.get("kind"));
  const version = parseVersion(form?.get("version"));
  if (!isDisasterKind(kind) || version === null) return { ok: false, error: "bad" };
  if (kind === "normal" && str(form?.get("confirm")) !== "1") return { ok: false, error: "confirm" };
  return { ok: true, value: { kind, version } };
}

function text(v: FormDataEntryValue | null | undefined): string | null | "long" {
  const s = str(v)?.trim() ?? "";
  if (s === "") return null;
  return s.length > MAX_TEXT_LENGTH ? "long" : s;
}

function notFuture(iso: string, now: string): boolean {
  return Date.parse(iso) <= Date.parse(now) + FUTURE_SLACK_MS;
}

/** 災害の情報のフォーム。時刻は日本の時刻の datetime-local。先の時刻は断る */
export function parseInfoForm(
  form: FormLike | null,
  now: string,
): { ok: true; value: DisasterInfo; version: number } | { ok: false; error: DisasterFormError } {
  if (!form) return { ok: false, error: "bad" };
  const version = parseVersion(form.get("version"));
  const scope = str(form.get("outage"));
  const level = str(form.get("level")) ?? "";
  if (version === null || scope === null || !(OUTAGE_SCOPES as readonly string[]).includes(scope)) {
    return { ok: false, error: "bad" };
  }
  const levelNum = level === "" ? null : Number(level);
  if (levelNum !== null && !(ALERT_LEVELS as readonly number[]).includes(levelNum)) return { ok: false, error: "bad" };

  const startedAt = fromLocalInput(str(form.get("started")) ?? "");
  if (!startedAt) return { ok: false, error: "started" };
  if (!notFuture(startedAt, now)) return { ok: false, error: "future" };

  let outage: OutageState = { scope: "none", towns: [], startedAt: null };
  if (scope !== "none") {
    const at = fromLocalInput(str(form.get("outage_at")) ?? "");
    if (!at) return { ok: false, error: "outage_at" };
    if (!notFuture(at, now)) return { ok: false, error: "future" };
    let towns: string[] = [];
    if (scope === "area") {
      const raw = form.getAll("town").map((v) => (typeof v === "string" ? v.trim() : "")).filter((v) => v !== "");
      towns = [...new Set(raw)];
      if (towns.length === 0) return { ok: false, error: "towns" };
      if (towns.length > MAX_TOWNS || towns.some((t) => t.length > 40)) return { ok: false, error: "long" };
    }
    outage = { scope: scope as OutageScope, towns, startedAt: at };
  }

  const water = text(form.get("water"));
  const road = text(form.get("road"));
  if (water === "long" || road === "long") return { ok: false, error: "long" };

  return { ok: true, value: { startedAt, outage, alertLevel: levelNum as AlertLevel | null, water, road }, version };
}
