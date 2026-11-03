// 汎用の差し込み（docs/tasks/T08.md）。確かめた対応表（lib/forms/mapping.ts）と台帳から、様式の欄の順に値を並べた紙面を作る。
// 元の様式の見た目は再現しない（A4 の表）。サーバーの描画で、Claude は呼ばない（氏名・住所・電話が入る）。
//
// 決まり:
// - 値は松山市の様式（lib/forms/matsuyama.ts の buildMatsuyamaSheet）と同じ物を使う。同じ台帳から出す書類の間で値をそろえる
//   （松山市の様式に欄のある項目はその欄の値、無い項目はここで同じ部品から作る）
// - 同意の範囲は松山市の様式と同じ（計画の共有 → 医療、支援者への提供 → 避難支援者と夜間支援）。同意が無ければ「省略」
// - 台帳に対応の無い欄（item が null）と、台帳に値の無い欄は「未確認」。台帳の pending（不明・未聴取・無回答）は理由を添える
// - 手で書く欄（署名・受付印）は空ける。外した欄は出さない
// - □ が 1 つの欄（check）は項目の「当てはまるか」で ■・□、選ぶ欄（choice）は値の言葉が選択肢に合えば ■

import { ageOn } from "../age.ts";
import { parseLedger } from "../db/ledger.ts";
import type { ConsentKind, ConsentStatus, Ledger, PendingStatus } from "../db/types.ts";
import {
  ABILITY_LABELS,
  CARE_LEVEL_LABELS,
  CONSENT_STATUS_LABELS,
  CONTACT_FLAG_LABELS,
  CONTACT_KIND_LABELS,
  CONTACT_REACH_LABELS,
  HAZARD_LABELS,
  HOUSEHOLD_LABELS,
  MY_TIMELINE_LABELS,
  SEX_LABELS,
  SMARTPHONE_LABELS,
  STRUCTURE_LABELS,
  SUPPORT_KIND_LABELS,
} from "../labels.ts";
import { formatJst, type PersonPageRows } from "../person.ts";
import {
  buildMatsuyamaSheet,
  contactName,
  deviceLine,
  NONE,
  strong,
  sub,
  t,
  unconfirmed,
  unconfirmedPiece,
  value,
  type BuildOptions,
  type Cell,
  type Contact,
  type MatsuyamaKey,
  type MatsuyamaSheet,
  type Piece,
  type PieceLine,
} from "./matsuyama.ts";
import { ledgerItem, type FormMapping, type LedgerItemKey, type MappingField } from "./mapping.ts";
import { warekiText } from "./wareki.ts";

// ---------- 項目の値 ----------

/**
 * 項目の値。cell は欄に出す物。words は選ぶ欄で選択肢と照らす言葉（同意 → 同意・同意する）。
 * flag は □ 1 つの欄の「当てはまるか」（null は分からない → 未確認）
 */
export type ItemValue = { cell: Cell; words?: readonly string[]; flag?: boolean | null };

type Ctx = {
  rows: PersonPageRows;
  ledger: Ledger;
  sheet: MatsuyamaSheet;
  contacts: Contact[];
  consent: Record<ConsentKind, ConsentStatus>;
  today: string;
};

const under = (prefix: string) => (field: string) => field === prefix || field.startsWith(`${prefix}.`);

/** 台帳の pending の理由（最初に当たった物） */
function pendingOf(ledger: Ledger, ...prefixes: string[]): PendingStatus | undefined {
  return ledger.pending.find((p) => prefixes.some((pre) => under(pre)(p.field)))?.status;
}

/** 値が無い欄なら理由つきの未確認に、値があれば末尾に未確認を足す（松山市の様式と同じ） */
function withPending(cell: Cell, reason: PendingStatus | undefined): Cell {
  if (!reason) return cell;
  switch (cell.kind) {
    case "unconfirmed":
    case "none":
      return { kind: "unconfirmed", reason };
    case "value":
      return { kind: "value", lines: [...cell.lines, [unconfirmedPiece(reason)]] };
    case "choice":
      return { ...cell, unconfirmed: { reason } };
    default:
      return cell;
  }
}

const text = (v: string | null | undefined, reason?: PendingStatus, emphasize = false): Cell =>
  v == null || v.trim() === "" ? unconfirmed(reason) : withPending(value([emphasize ? strong(v) : t(v)]), reason);

/** 配列の値。無ければ未確認、空ならなし */
function list(v: readonly string[] | undefined, reason?: PendingStatus): ItemValue {
  if (v === undefined) return { cell: unconfirmed(reason), flag: null };
  if (v.length === 0) return { cell: withPending(NONE, reason), flag: false, words: ["なし"] };
  return { cell: withPending(value([t(v.join("・"))]), reason), flag: true };
}

function bool(v: boolean | undefined, reason?: PendingStatus): ItemValue {
  if (v === undefined) return { cell: unconfirmed(reason), flag: null };
  return { cell: withPending(value([t(v ? "あり" : "なし")]), reason), flag: v, words: [v ? "あり" : "なし", v ? "有" : "無"] };
}

const fromSheet = (key: MatsuyamaKey) => (c: Ctx): ItemValue => ({ cell: c.sheet.cells[key] });

/** 電話の欄: 番号と固定・携帯の区別。番号が無ければ未確認 */
function phoneCell(contact: Contact | null): Cell {
  if (!contact) return NONE;
  if (!contact.phone) return unconfirmed();
  const mobile = (contact.note ?? "").includes("携帯");
  return value([t(contact.phone), sub(mobile ? "携帯" : contact.kind === "self" ? "固定" : "電話")]);
}

/** 関係の欄: 続柄・種類・連絡順・車・夜間・スマホ・備考 */
function relationCell(c: Contact | null): Cell {
  if (!c) return NONE;
  const head: PieceLine = [strong(c.relation ?? CONTACT_KIND_LABELS[c.kind])];
  if (c.relation && c.kind !== "family" && c.kind !== "supporter") head.push(sub(CONTACT_KIND_LABELS[c.kind]));
  const flags: PieceLine = [];
  if (c.emergency_order != null) flags.push(sub(`連絡順 ${c.emergency_order}`));
  if (c.has_car === 1) flags.push(sub(`${CONTACT_FLAG_LABELS.hasCar}あり`));
  if (c.has_car === 0) flags.push(sub(`${CONTACT_FLAG_LABELS.hasCar}なし`));
  if (c.night_ok === 1) flags.push(sub(CONTACT_FLAG_LABELS.nightOk));
  if (c.night_ok === 0) flags.push(sub("夜間不可"));
  if (c.note) flags.push(sub(c.note));
  return value(head, flags);
}

/** 住所の欄: 住所は持たないので未確認。どこにいる人か（同居・近所・市内）を添える（松山市の様式と同じ） */
function addressCell(c: Contact | null): Cell {
  if (!c) return NONE;
  return c.reach ? { kind: "value", lines: [[unconfirmedPiece(), sub(CONTACT_REACH_LABELS[c.reach])]] } : unconfirmed();
}

function nameCell(c: Contact | null, reason?: PendingStatus): Cell {
  if (!c) return withPending(NONE, reason);
  return withPending(value([strong(c.name ?? c.relation ?? CONTACT_KIND_LABELS[c.kind])]), reason);
}

/** 関係先の 1 行（名前・種類・近さ・電話・備考） */
function contactLine(c: Contact): PieceLine {
  const line: PieceLine = [...contactName(c), sub(CONTACT_KIND_LABELS[c.kind])];
  if (c.reach) line.push(sub(CONTACT_REACH_LABELS[c.reach]));
  line.push(sub("TEL"), c.phone ? t(c.phone) : unconfirmedPiece());
  if (c.note) line.push(sub(c.note));
  return line;
}

const byEmergency = (c: Ctx, n: number) => c.contacts.find((x) => x.emergency_order === n) ?? null;
const bySupporter = (c: Ctx, n: number) => c.contacts.find((x) => x.supporter_order === n) ?? null;

/**
 * 緊急連絡先 2。松山市の様式は 2 人目を実施者の欄か特記に載せ、実施者なら支援者提供の同意に従う。
 * ここも同じにする（実施者でもある人は、支援者提供の同意が無ければ省略）。1 人目は松山市の様式の近親者の欄と同じく省略しない
 */
function emergency2(cell: (c: Contact | null) => Cell): Resolver {
  return (c) => {
    const x = byEmergency(c, 2);
    if (x && x.supporter_order != null && c.consent.supporters !== "granted") return { cell: { kind: "withheld", consent: "supporters" } };
    return { cell: cell(x) };
  };
}

/** 選ぶ欄の言葉の別名（様式の選択肢の書き方の揺れ） */
const SEX_WORDS = { female: ["女", "女性"], male: ["男", "男性"], other: ["その他"] } as const;
const HOUSEHOLD_WORDS: Record<string, readonly string[]> = {
  alone: ["ひとり暮らし", "独居", "単身", "一人暮らし"],
  with_spouse: ["夫婦", "高齢者のみ"],
  with_child: ["子と同居"],
  with_family: ["家族と同居"],
};
const CONSENT_WORDS: Record<Exclude<ConsentStatus, "unconfirmed">, readonly string[]> = {
  granted: ["同意", "同意する", "はい", "有"],
  refused: ["不同意", "同意しない", "いいえ", "無"],
};
const ABILITY_KEYS = ["walking", "hearing", "vision", "understanding", "judgment", "orientation"] as const;

function ability(k: (typeof ABILITY_KEYS)[number]) {
  return (c: Ctx): ItemValue => {
    const v = c.ledger.care[k];
    const reason = pendingOf(c.ledger, `care.${k}`);
    if (!v) return { cell: unconfirmed(reason), flag: null };
    // 当てはまる（□ に ■）のは「一部」「困難」
    return { cell: withPending(value([v === "ok" ? t(ABILITY_LABELS[v]) : strong(ABILITY_LABELS[v])]), reason), flag: v !== "ok", words: [ABILITY_LABELS[v]] };
  };
}

function consentItem(kind: ConsentKind) {
  return (c: Ctx): ItemValue => {
    const status = c.consent[kind];
    const reason = pendingOf(c.ledger, `consent.${kind}`);
    if (status === "unconfirmed") return { cell: unconfirmed(reason), flag: null };
    const row = c.rows.consents.find((x) => x.kind === kind);
    const rec = row ? [sub(`記録 ${formatJst(row.recorded_at).slice(0, 10)}${row.recorded_by_name ? ` ${row.recorded_by_name}` : ""}`)] : [];
    return { cell: value([strong(CONSENT_STATUS_LABELS[status]), ...rec]), flag: status === "granted", words: CONSENT_WORDS[status] };
  };
}

/** 松山市の様式の選ぶ欄から、選んだ物の言葉（別紙 あり（医療要約）） */
function chosen(cell: Cell): ItemValue {
  if (cell.kind !== "choice") return { cell };
  const on = cell.options.filter((o) => o.on);
  if (on.length === 0) return { cell: cell.unconfirmed ? unconfirmed(cell.unconfirmed.reason) : unconfirmed() };
  return {
    cell: value(...on.map((o): PieceLine => [t(o.label), ...(o.detail ? [sub(o.detail)] : [])])),
    words: on.map((o) => o.label),
    flag: on.some((o) => o.label === "あり"),
  };
}

type Resolver = (c: Ctx) => ItemValue;

/** 台帳の項目ごとの値の出し方。lib/forms/mapping.ts の LEDGER_ITEMS の key を全部持つ */
export const ITEM_VALUES: Record<LedgerItemKey, Resolver> = {
  // ---- 本人 ----
  "person.name": fromSheet("target.name"),
  "person.kana": fromSheet("target.kana"),
  "person.birth": (c) => {
    const bd = c.rows.person.birth_date;
    return { cell: bd ? value([t(warekiText(bd))]) : unconfirmed(pendingOf(c.ledger, "basic.birth")) };
  },
  "person.age": (c) => {
    const bd = c.rows.person.birth_date;
    return { cell: bd ? value([strong(String(ageOn(bd, c.today))), t("歳")]) : unconfirmed(pendingOf(c.ledger, "basic.birth")) };
  },
  "basic.sex": (c) => {
    const s = c.ledger.basic.sex;
    return s ? { cell: value([t(SEX_LABELS[s])]), words: SEX_WORDS[s] } : { cell: unconfirmed(pendingOf(c.ledger, "basic.sex")) };
  },
  "basic.address": fromSheet("target.address"),
  "basic.town": fromSheet("target.district"),
  "self.phone": fromSheet("target.phone"),
  "self.mobile": fromSheet("target.mobile"),
  "basic.contactMeans": (c) => {
    const m = c.ledger.basic.contactMeans;
    const reason = pendingOf(c.ledger, "basic.contactMeans");
    if (!m) return { cell: unconfirmed(reason) };
    const yn = (label: string, v: boolean | undefined): Piece[] => [sub(label), v === undefined ? unconfirmedPiece() : t(v ? "あり" : "なし")];
    return {
      cell: withPending(
        value([
          ...yn("固定電話", m.landline),
          ...yn("携帯", m.mobile),
          ...yn("メール", m.email),
          sub("スマホ"),
          m.smartphone ? t(SMARTPHONE_LABELS[m.smartphone]) : unconfirmedPiece(),
        ]),
        reason,
      ),
    };
  },
  "basic.household": (c) => {
    const h = c.ledger.basic.household;
    return h
      ? { cell: value([t(HOUSEHOLD_LABELS[h])]), words: [HOUSEHOLD_LABELS[h], ...(HOUSEHOLD_WORDS[h] ?? [])] }
      : { cell: unconfirmed(pendingOf(c.ledger, "basic.household")) };
  },
  "people.together": (c) => {
    const h = c.ledger.basic.household;
    const together = c.contacts.filter((x) => x.reach === "together" && x.kind !== "self");
    if (together.length > 0) {
      const lines: PieceLine[] = together.map((x) => contactName(x));
      if (h) lines.push([sub(HOUSEHOLD_LABELS[h])]);
      return { cell: value(...lines), flag: true };
    }
    if (h === "alone") return { cell: value([t("なし"), sub(HOUSEHOLD_LABELS[h])]), flag: false };
    return { cell: h ? value([unconfirmedPiece(), sub(HOUSEHOLD_LABELS[h])]) : unconfirmed(pendingOf(c.ledger, "basic.household", "people.family")), flag: null };
  },

  // ---- 介護・障害 ----
  "care.careLevel": (c) => {
    const v = c.ledger.care.careLevel;
    const reason = pendingOf(c.ledger, "care.careLevel");
    return v ? { cell: value([strong(CARE_LEVEL_LABELS[v])]), flag: true, words: [CARE_LEVEL_LABELS[v]] } : { cell: unconfirmed(reason), flag: null };
  },
  "care.handbook": (c) => {
    const v = c.ledger.care.handbook?.trim();
    const reason = pendingOf(c.ledger, "care.handbook");
    // 無い物は「なし」（松山市の様式の区分と同じ読み方）。分からないときだけ未確認
    return v ? { cell: value([t(v)]), flag: true } : { cell: withPending(NONE, reason), flag: reason ? null : false };
  },
  "care.intractableDisease": (c) => {
    const v = c.ledger.care.intractableDisease?.trim();
    const reason = pendingOf(c.ledger, "care.intractableDisease");
    return v ? { cell: value([t(v)]), flag: true } : { cell: withPending(NONE, reason), flag: reason ? null : false };
  },
  "care.walking": ability("walking"),
  "care.hearing": ability("hearing"),
  "care.vision": ability("vision"),
  "care.understanding": ability("understanding"),
  "care.judgment": ability("judgment"),
  "care.orientation": ability("orientation"),
  "care.bedridden": (c) => bool(c.ledger.care.bedridden, pendingOf(c.ledger, "care.bedridden")),
  "care.dementia": (c) => bool(c.ledger.care.dementia, pendingOf(c.ledger, "care.dementia")),
  "care.issues": fromSheet("risk.issues"),

  // ---- 医療 ----
  "medical.devices": (c) => {
    const devices = c.ledger.medical.devices;
    const reason = pendingOf(c.ledger, "medical.devices");
    if (devices.length === 0) return { cell: withPending(NONE, reason), flag: reason ? null : false };
    const used = new Set<string>();
    const clocks = [...c.rows.clocks].sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));
    return { cell: withPending(value(...devices.map((d) => deviceLine(d, clocks, used))), reason), flag: true };
  },
  "medical.medications": fromSheet("medical.drugs"),
  "medical.doctor": fromSheet("medical.doctor"),
  "medical.dialysis": (c) => {
    const centers = c.contacts.filter((x) => x.kind === "dialysis_center");
    return { cell: centers.length > 0 ? value(...centers.map(contactLine)) : NONE, flag: centers.length > 0 };
  },
  "medical.allergies": (c) => list(c.ledger.medical.allergies, pendingOf(c.ledger, "medical.allergies")),
  "medical.history": (c) => list(c.ledger.medical.history, pendingOf(c.ledger, "medical.history")),
  "medical.vaccinations": (c) => list(c.ledger.medical.vaccinations, pendingOf(c.ledger, "medical.vaccinations")),
  "medical.notes": fromSheet("notes.medical"),
  "medical.annex": (c) => chosen(c.sheet.cells["notes.annex"]),

  // ---- 避難 ----
  "evacuation.hazards": (c) => {
    const hz = c.ledger.evacuation.hazards;
    const reason = pendingOf(c.ledger, "evacuation.hazards");
    if (hz.length === 0) return { cell: withPending(NONE, reason), flag: reason ? null : false, words: ["なし"] };
    return {
      cell: withPending(value(hz.flatMap((h, i) => [...(i > 0 ? [sub("／")] : []), strong(HAZARD_LABELS[h.kind]), ...(h.depthM != null ? [sub(`${h.depthM} m`)] : []), ...(h.note?.trim() ? [sub(h.note.trim())] : [])])), reason),
      flag: true,
      words: hz.map((h) => HAZARD_LABELS[h.kind]),
    };
  },
  "evacuation.destination1": fromSheet("shelter.city.place"),
  "evacuation.destination2": fromSheet("shelter.pre.place"),
  "evacuation.transport": (c) => ({ cell: text(c.ledger.evacuation.transport, pendingOf(c.ledger, "evacuation.transport")) }),
  "evacuation.route": fromSheet("route.text"),
  "evacuation.barriers": (c) => ({ cell: text(c.ledger.evacuation.barriers, pendingOf(c.ledger, "evacuation.barriers")) }),
  "evacuation.support": (c) => {
    const s = c.ledger.evacuation.support;
    const note = c.ledger.evacuation.supportNote?.trim();
    const reason = pendingOf(c.ledger, "evacuation.support", "evacuation.supportNote");
    if (!s) return { cell: note ? withPending(value([t(note)]), reason) : unconfirmed(reason) };
    return {
      cell: withPending(value([t(s.map((k) => SUPPORT_KIND_LABELS[k]).join("・")), ...(note ? [sub(note)] : [])]), reason),
      words: s.map((k) => SUPPORT_KIND_LABELS[k]),
    };
  },
  "evacuation.carryItems": (c) => list(c.ledger.evacuation.carryItems, pendingOf(c.ledger, "evacuation.carryItems")),
  "evacuation.pets": (c) => ({ cell: text(c.ledger.evacuation.pets, pendingOf(c.ledger, "evacuation.pets")) }),
  "evacuation.myTimeline": (c) => {
    const v = c.ledger.evacuation.myTimeline;
    const reason = pendingOf(c.ledger, "evacuation.myTimeline");
    return v ? { cell: value([t(MY_TIMELINE_LABELS[v])]), words: [MY_TIMELINE_LABELS[v]], flag: v !== "none" } : { cell: unconfirmed(reason), flag: null };
  },

  // ---- 住まい ----
  "basic.housing.structure": (c) => {
    const h = c.ledger.basic.housing;
    const reason = pendingOf(c.ledger, "basic.housing.structure", "basic.housing.builtYear");
    if (!h?.structure) return { cell: unconfirmed(reason) };
    return {
      cell: withPending(value([t(STRUCTURE_LABELS[h.structure]), ...(h.builtYear != null ? [sub(`${h.builtYear} 年築`)] : [])]), reason),
      words: [STRUCTURE_LABELS[h.structure]],
    };
  },
  "basic.housing.floors": (c) => {
    const n = c.ledger.basic.housing?.floors;
    if (n == null) return { cell: unconfirmed(pendingOf(c.ledger, "basic.housing.floors")) };
    return { cell: value([t(n === 1 ? "平屋" : `${n} 階建`)]), words: n === 1 ? ["平屋"] : [`${n}階建`, n >= 3 ? "3階建以上" : `${n}階建`] };
  },
  "basic.housing.floor": (c) => {
    const n = c.ledger.basic.housing?.floor;
    return { cell: n == null ? unconfirmed(pendingOf(c.ledger, "basic.housing.floor")) : value([strong(String(n)), t("階")]) };
  },
  "basic.housing.bedroom": (c) => ({ cell: text(c.ledger.basic.housing?.bedroom, pendingOf(c.ledger, "basic.housing.bedroom")) }),

  // ---- 連絡先・支援者 ----
  "emergency1.name": fromSheet("kin.name"),
  "emergency1.relation": (c) => ({ cell: relationCell(byEmergency(c, 1)) }),
  "emergency1.phone": (c) => ({ cell: phoneCell(byEmergency(c, 1)) }),
  "emergency1.address": fromSheet("kin.address"),
  "emergency2.name": emergency2(nameCell),
  "emergency2.relation": emergency2(relationCell),
  "emergency2.phone": emergency2(phoneCell),
  "emergency2.address": emergency2(addressCell),
  "supporter1.name": fromSheet("supporter1.name"),
  "supporter1.relation": (c) => ({ cell: relationCell(bySupporter(c, 1)) }),
  "supporter1.phone": (c) => ({ cell: phoneCell(bySupporter(c, 1)) }),
  "supporter1.address": fromSheet("supporter1.address"),
  "supporter2.name": fromSheet("supporter2.name"),
  "supporter2.relation": (c) => ({ cell: relationCell(bySupporter(c, 2)) }),
  "supporter2.phone": (c) => ({ cell: phoneCell(bySupporter(c, 2)) }),
  "supporter2.address": fromSheet("supporter2.address"),
  "people.night": fromSheet("supporter.night"),
  "people.welfare": fromSheet("local.welfare"),
  "local.watcher": fromSheet("local.watcher"),
  "people.offices": fromSheet("local.office"),

  // ---- 同意 ----
  "consent.registry": consentItem("registry"),
  "consent.plan_share": consentItem("plan_share"),
  "consent.supporters": consentItem("supporters"),
  "consent.medical": consentItem("medical"),

  // ---- 計画・特記 ----
  "plan.date": fromSheet("head.date"),
  "plan.author": fromSheet("plan.author"),
  "notes.words": fromSheet("notes.words"),
  "notes.other": fromSheet("notes.other"),
};

// ---------- 欄の形に合わせる ----------

/** 照らすための形（空白を除き、全角の英数を半角に、丸数字・括弧の揺れをそろえる） */
export function normalizeWord(s: string): string {
  return s.normalize("NFKC").replace(/[\s　]/g, "").replace(/[（）()【】「」]/g, "");
}

/** 値の言葉に合う選択肢の番号。完全に同じ物が無ければ、片方がもう片方を含む物がちょうど 1 つのときだけ */
export function matchOption(options: readonly string[], words: readonly string[]): number {
  const opts = options.map(normalizeWord);
  const ws = words.map(normalizeWord).filter((w) => w !== "");
  const exact = opts.findIndex((o) => ws.includes(o));
  if (exact >= 0) return exact;
  const loose = opts.map((o, i) => (ws.some((w) => o.includes(w) || w.includes(o)) ? i : -1)).filter((i) => i >= 0);
  return loose.length === 1 ? loose[0] : -1;
}

/** 欄の値の言葉の並び（□ の横に添える） */
function pieces(cell: Cell): Piece[] {
  return cell.kind === "value" ? cell.lines.flatMap((l, i) => (i === 0 ? l : [sub("／"), ...l])) : [];
}

const CHECK_ON = { label: "", on: true } as const;
const CHECK_OFF = { label: "", on: false } as const;

/** 項目の値を欄の形（□・選ぶ・手書き）に合わせる */
export function shapeCell(field: MappingField, v: ItemValue): Cell {
  const cell = v.cell;
  if (cell.kind === "withheld" || cell.kind === "handwrite") return cell;
  // □ 1 つの欄は、欄の名前を左の列に出すので ■・□ と値だけ（名前を繰り返さない）
  if (field.shape === "check") {
    if (v.flag === true) return { kind: "choice", options: [CHECK_ON], after: pieces(cell) };
    if (v.flag === false) return { kind: "choice", options: [CHECK_OFF] };
    const reason = cell.kind === "unconfirmed" ? cell.reason : undefined;
    return { kind: "choice", options: [CHECK_OFF], unconfirmed: reason ? { reason } : {} };
  }
  if (field.shape === "choice" && field.options.length > 0) {
    if (cell.kind === "unconfirmed") {
      return { kind: "choice", options: field.options.map((label) => ({ label, on: false })), unconfirmed: cell.reason ? { reason: cell.reason } : {} };
    }
    const hit = v.words ? matchOption(field.options, v.words) : -1;
    if (hit >= 0) return { kind: "choice", options: field.options.map((label, i) => ({ label, on: i === hit })) };
    // 選択肢に合わない値は、選択肢を全部 □ のまま並べ、台帳の言葉を後ろに添える
    return { kind: "choice", options: field.options.map((label) => ({ label, on: false })), after: pieces(cell) };
  }
  return cell;
}

// ---------- 紙面 ----------

export type MappedRow = { field: MappingField; cell: Cell };
export type MappedSection = { section: string; rows: MappedRow[] };
export type MappedPage = { page: number; sections: MappedSection[] };

export type MappedSheet = {
  personId: string;
  name: string;
  title: string;
  issuer: string;
  pages: MappedPage[];
  /** 出した欄の数（外した欄を除く） */
  fields: number;
  /** 未確認の欄（台帳に値が無い・対応が無い） */
  unconfirmed: string[];
  /** 対応の無い欄（手書きを除く） */
  unmapped: string[];
  /** 同意が無くて省略した範囲 */
  withheld: ConsentKind[];
};

/** 欄 1 つの値 */
export function mappedCell(field: MappingField, ctx: Ctx): Cell {
  if (field.shape === "handwrite") return { kind: "handwrite" };
  if (field.item === null) return field.shape === "check" ? { kind: "choice", options: [CHECK_OFF], unconfirmed: {} } : unconfirmed();
  const def = ledgerItem(field.item);
  if (def.consent && ctx.consent[def.consent] !== "granted") return { kind: "withheld", consent: def.consent };
  return shapeCell(field, ITEM_VALUES[field.item](ctx));
}

const isUnconfirmed = (cell: Cell) =>
  cell.kind === "unconfirmed" ||
  (cell.kind === "choice" && cell.unconfirmed !== undefined) ||
  (cell.kind === "value" && cell.lines.some((l) => l.some((p) => p.unconfirmed)));

/** 確かめた対応表と台帳から、欄の順に値を並べた紙面を作る */
export function buildMappedSheet(rows: PersonPageRows, mapping: FormMapping, opts: BuildOptions): MappedSheet {
  const ledger = parseLedger(rows.person.ledger);
  const get = (k: ConsentKind) => rows.consents.find((x) => x.kind === k)?.status ?? "unconfirmed";
  const ctx: Ctx = {
    rows,
    ledger,
    sheet: buildMatsuyamaSheet(rows, opts),
    contacts: [...rows.contacts].sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1)),
    consent: { registry: get("registry"), plan_share: get("plan_share"), supporters: get("supporters"), medical: get("medical"), ai_overseas: get("ai_overseas") },
    today: opts.today,
  };

  const pages: MappedPage[] = [];
  const unconfirmedLabels: string[] = [];
  const unmapped: string[] = [];
  const withheld = new Set<ConsentKind>();
  let count = 0;
  for (const field of mapping.fields) {
    if (field.removed) continue;
    count += 1;
    const cell = mappedCell(field, ctx);
    const name = field.section ? `${field.section} ${field.label}` : field.label;
    if (cell.kind === "withheld") withheld.add(cell.consent);
    else if (isUnconfirmed(cell)) unconfirmedLabels.push(name);
    if (field.item === null && field.shape !== "handwrite") unmapped.push(name);
    let page = pages.find((p) => p.page === field.page);
    if (!page) {
      page = { page: field.page, sections: [] };
      pages.push(page);
    }
    const last = page.sections[page.sections.length - 1];
    if (last && last.section === field.section) last.rows.push({ field, cell });
    else page.sections.push({ section: field.section, rows: [{ field, cell }] });
  }
  pages.sort((a, b) => a.page - b.page);
  return {
    personId: rows.person.id,
    name: rows.person.name,
    title: mapping.title,
    issuer: mapping.issuer,
    pages,
    fields: count,
    unconfirmed: unconfirmedLabels,
    unmapped,
    withheld: [...withheld],
  };
}
