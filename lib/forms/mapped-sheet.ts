// 汎用の差し込み（docs/tasks/T08.md）。確かめた対応表（lib/forms/mapping.ts）と台帳から、様式の欄の順に値を並べた紙面を作る。
// 元の様式の見た目は再現しない（A4 の表）。サーバーの描画で、Claude は呼ばない（氏名・住所・電話が入る）。
//
// 決まり:
// - 値は松山市の様式（lib/forms/matsuyama.ts の buildMatsuyamaSheet）と同じ物を使う。同じ台帳から出す書類の間で値をそろえる
//   （松山市の様式に欄のある項目はその欄の値、無い項目はここで同じ部品から作る）
// - 同意の範囲は松山市の様式と同じ（計画の共有 → 医療、支援者への提供 → 避難支援者と夜間支援）。同意が無ければ「省略」
// - 台帳に対応の無い欄（item が null）と、台帳に値の無い欄は「未確認」。台帳の pending（不明・未聴取・無回答）は理由を添える
// - 手で書く欄（署名・受付印）は空ける。外した欄は出さない
// - 居ない人の欄は松山市の様式と同じ: 1 人目の氏名だけ「なし」、ほかの欄と 2 人目からの欄は空き枠（刷らない・数えない。T111）
// - □ が 1 つの欄（check）は項目の「当てはまるか」で ■・□、選ぶ欄（choice）は値の言葉が選択肢に合えば ■

import { ageOn } from "../age.ts";
import { parseLedger } from "../db/ledger.ts";
import type { ConsentKind, ConsentStatus, Ledger, PendingStatus, TransportKind } from "../db/types.ts";
import {
  ABILITY_LABELS,
  CARE_LEVEL_LABELS,
  CONSENT_STATUS_LABELS,
  CONTACT_FLAG_LABELS,
  CONTACT_KIND_LABELS,
  CONTACT_REACH_LABELS,
  DEVICE_LABELS,
  deviceText,
  HAZARD_LABELS,
  HOUSEHOLD_LABELS,
  HOUSING_TYPE_LABELS,
  MEDICATION_CATEGORY_LABELS,
  MY_TIMELINE_LABELS,
  SEX_LABELS,
  SMARTPHONE_LABELS,
  STRUCTURE_LABELS,
  SUPPORT_KIND_LABELS,
  TRANSPORT_KIND_LABELS,
} from "../labels.ts";
import { formatJst, type PersonPageRows } from "../person.ts";
import {
  buildMatsuyamaSheet,
  contactName,
  contactPhones,
  deviceLine,
  EMPTY,
  NONE,
  strong,
  sub,
  t,
  unconfirmed,
  unconfirmedPiece,
  value,
  type BuildOptions,
  type Cell,
  type Choice,
  type Contact,
  type MatsuyamaKey,
  type MatsuyamaSheet,
  type Piece,
  type PieceLine,
} from "./matsuyama.ts";
import { heldFields } from "./field-risk.ts";
import { ledgerItem, listFieldIds, type FormMapping, type LedgerItemKey, type ListShape, type MappingField } from "./mapping.ts";
import { paperText } from "./paper-text.ts";
import { warekiText } from "./wareki.ts";
import { codeOfOption, codesOf, freeCodes, optionTable, pickByCodes, soleCodeOfText } from "./option-values.ts";
import { bracketOwners, strayOther, type BracketOwner } from "./form-shape.ts";
import { transportKindOf, transportText } from "../map/transport.ts";

// ---------- 項目の値 ----------

/**
 * 項目の値。cell は欄に出す物。words は選ぶ欄で選択肢と照らす言葉（同意 → 同意・同意する）。
 * flag は □ 1 つの欄の「当てはまるか」（null は分からない → 未確認）。
 * T122: multi は種類が並ぶ項目（自宅のリスク・支援の内容・医療機器・常用薬・既往症など）で、複数選択の欄では words に合う選択肢の全部に印。
 * kinds はその項目の種類の名前の全部（医療機器なら 在宅酸素・人工呼吸器…）。□ ごとに種類を問う欄（「在宅酸素療法（HOT）」の □）は、
 * □ の名前が種類のどれかなら、その種類が台帳にあるときだけ印（前は機器が 1 つでもあれば全部の □ に印が付いた）
 */
export type ItemValue = {
  cell: Cell;
  words?: readonly string[];
  flag?: boolean | null;
  multi?: boolean;
  kinds?: readonly string[];
  /** 種類ごとの添え（T133。自宅のリスクの浸水の深さ）。複数選択の欄で、合う選択肢に添える（紙はその選択肢の所の空きに置く） */
  details?: ReadonlyArray<{ words: readonly string[]; detail: string; kind?: keyof typeof HAZARD_LABELS }>;
  /** 選択肢・□ の名前が値に合うか（T133。無ければ words と照らす） */
  match?: (label: string) => boolean;
  /** 選択肢の字が同じときだけ照らす言葉（T133） */
  exact?: readonly string[];
  /**
   * 台帳の値のコード（T140、lib/forms/option-values.ts の ITEM_CODES の code）。選ぶ欄の選択肢と台帳の値の表と照らす。
   * 空の並びは「無い」と分かっている値（機器なし・連絡先なし）。無ければ表で照らさない（前のまま言葉で）
   */
  codes?: readonly string[];
  /** 表で当たった選択肢に添える字（T140。手段の補記「娘の車」。1 つを選ぶ欄だけ） */
  codeDetail?: string;
  /**
   * 種類の □ の後ろの括弧に書く値（T164。「□抗血小板薬（　）」の括弧）。labels は括弧の前の □ の名前（同じ行の □ の全部）で、その種類の値だけ。
   * 合う値が無ければ空（「なし」も書かない）。無い項目は種類の括弧に何も書かない
   */
  kindCell?: (labels: readonly string[]) => Cell;
};

type Ctx = {
  rows: PersonPageRows;
  ledger: Ledger;
  sheet: MatsuyamaSheet;
  contacts: Contact[];
  consent: Record<ConsentKind, ConsentStatus>;
  today: string;
  /** 計画を作った事業所の名前（T131 の plan.office） */
  officeName: string | null;
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
    case "empty":
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

/** 配列の値。無ければ未確認、空ならなし。複数選択の欄では値の全部に印、「あり・なし」の欄はあり（T122） */
function list(v: readonly string[] | undefined, reason?: PendingStatus, item?: LedgerItemKey): ItemValue {
  if (v === undefined) return { cell: unconfirmed(reason), flag: null };
  const codes = item ? { codes: freeCodes(item, v) } : {};
  if (v.length === 0) return { cell: withPending(NONE, reason), flag: false, words: ["なし"], multi: true, ...codes };
  return { cell: withPending(value([t(v.join("・"))]), reason), flag: true, words: [...v, "あり"], multi: true, ...codes };
}

/** 自宅のリスクの種類の言い方（様式の選択肢「洪水」「土砂災害」と台帳の「浸水」「土砂」を照らす。T122） */
const HAZARD_WORDS: Record<keyof typeof HAZARD_LABELS, readonly string[]> = {
  flood: ["浸水", "洪水", "水害"],
  landslide: ["土砂", "土砂災害", "がけ崩れ"],
  tsunami: ["津波"],
  other: ["その他"],
};
const DEVICE_KINDS = Object.values(DEVICE_LABELS).filter((l) => l !== "その他");

/** 浸水の言葉を含んでも洪水でない区域（津波・高潮・内水〔雨水出水〕・土砂の区域の名前） */
const OTHER_WATER = /津波|高潮|土砂|がけ|崖|雨水|内水|出水|ため池/;

/**
 * 自宅のリスクの種類が選択肢・□ の名前に合うか（T133）。「浸水」は洪水の言い方にも津波・高潮・雨水出水の区域の名前にも入るので、
 * ほかの区域の言葉を含む名前（津波浸水想定区域・雨水出水浸水想定区域）は洪水に当てない（前は浸水の字で全部に印が付いた）
 */
export function hazardMatches(kind: keyof typeof HAZARD_LABELS, label: string): boolean {
  const n = normalizeWord(label);
  if (kind === "flood") return /洪水|水害/.test(n) || (n.includes("浸水") && !OTHER_WATER.test(n));
  return HAZARD_WORDS[kind].some((w) => n.includes(normalizeWord(w)));
}

/**
 * 薬の種類の □ の名前（T131）。様式の □ は台帳の区分の名前と違う言い方をする（災害診療記録の「糖尿病治療薬」〔インスリン・経口薬〕・
 * 「ワーファリン」・「その他」）。前は区分の名前（経口糖尿病薬など）だけを種類にしていたので、「糖尿病治療薬」「その他」の □ が
 * 種類の □ と見なされず、薬が 1 つでもあれば印が付いた（評価の 3 回目の 4）。区分ごとに □ の言い方を持ち、その区分の薬があるときだけ印。
 * ワーファリンは区分でなく薬の名前（専用の紙 lib/forms/medical-summary.ts と同じ）
 */
const MEDICATION_KIND_WORDS: Record<keyof typeof MEDICATION_CATEGORY_LABELS, readonly string[]> = {
  antiplatelet: ["抗血小板薬"],
  anticoagulant: ["抗凝固薬"],
  insulin: ["インスリン", "糖尿病治療薬", "糖尿病薬"],
  oral_diabetes: ["経口糖尿病薬", "経口薬", "糖尿病治療薬", "糖尿病薬"],
  steroid: ["ステロイド"],
  antiepileptic: ["抗てんかん薬"],
  other: ["その他"],
};
const WARFARIN_WORDS = ["ワーファリン", "ワルファリン"] as const;
const WARFARIN = /ワーファリン|ワルファリン|warfarin/i;
const MEDICATION_KINDS = [...new Set([...Object.values(MEDICATION_KIND_WORDS).flat(), ...WARFARIN_WORDS])];
/** 薬 1 つの、種類の □ と照らす言葉（名前・区分の名前・□ の言い方・ワーファリン） */
const medicationWords = (m: { name: string; category: keyof typeof MEDICATION_CATEGORY_LABELS }): string[] => [
  m.name,
  ...(m.category !== "other" ? [MEDICATION_CATEGORY_LABELS[m.category]] : []),
  ...MEDICATION_KIND_WORDS[m.category],
  ...(WARFARIN.test(m.name) ? WARFARIN_WORDS : []),
];

function bool(v: boolean | undefined, reason?: PendingStatus): ItemValue {
  if (v === undefined) return { cell: unconfirmed(reason), flag: null };
  return { cell: withPending(value([t(v ? "あり" : "なし")]), reason), flag: v, words: [v ? "あり" : "なし", v ? "有" : "無"], codes: [v ? "yes" : "no"] };
}

/** 避難場所ごとの手段（T131）: 避難場所が無ければ空き枠、手段が無ければ未確認。選ぶ欄は手段の言葉と照らす */
function meansItem(kind: TransportKind | undefined, place: string | undefined, reason?: PendingStatus): ItemValue {
  if (!place?.trim()) return { cell: withPending(EMPTY, reason) };
  if (!kind) return { cell: unconfirmed(reason) };
  return { cell: withPending(value([t(TRANSPORT_KIND_LABELS[kind])]), reason), words: [TRANSPORT_KIND_LABELS[kind]], codes: [kind] };
}

const fromSheet = (key: MatsuyamaKey) => (c: Ctx): ItemValue => ({ cell: c.sheet.cells[key] });

/**
 * 電話の欄: 番号と固定・携帯の区別。電話と携帯（T117、contacts.mobile）があれば 2 行。番号が無ければ未確認。
 * 居ない人の欄は空き枠（T111。松山市の様式と同じ）
 */
function phoneCell(contact: Contact | null): Cell {
  if (!contact) return EMPTY;
  const { phone, mobile } = contactPhones(contact);
  if (!phone && !mobile) return unconfirmed();
  const lines: PieceLine[] = [];
  if (phone) lines.push([t(phone), sub(contact.kind === "self" ? "固定" : "電話")]);
  if (mobile) lines.push([t(mobile), sub("携帯")]);
  return value(...lines);
}

/** フリガナの欄（T117）。居ない人の欄は空き枠 */
function kanaCell(c: Contact | null): Cell {
  if (!c) return EMPTY;
  return c.kana?.trim() ? value([t(c.kana.trim())]) : unconfirmed();
}

/** 関係の欄: 続柄・種類・連絡順・車・夜間・スマホ・備考。居ない人の欄は空き枠 */
function relationCell(c: Contact | null): Cell {
  if (!c) return EMPTY;
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

/**
 * 関係の欄の値（T140）。選ぶ欄（「連絡先 □家族 □知人 □その他 □連絡先なし」）は連絡先の種類のコード（家族・支援者〔知人〕、ほかは その他）と照らす。
 * 居ない人は空の並び（「連絡先なし」の選択肢）
 */
function relationItem(c: Contact | null): ItemValue {
  return { cell: relationCell(c), codes: c ? [c.kind === "family" || c.kind === "supporter" ? c.kind : "kind:" + c.kind] : [] };
}

/** 住所の欄（T117）: 住所（市町村と町名まで）と近さ。住所が無ければ未確認に近さを添える（松山市の様式と同じ） */
function addressCell(c: Contact | null): Cell {
  if (!c) return EMPTY;
  const a = c.address?.trim();
  if (a) return value([t(a), ...(c.reach ? [sub(CONTACT_REACH_LABELS[c.reach])] : [])]);
  return c.reach ? { kind: "value", lines: [[unconfirmedPiece(), sub(CONTACT_REACH_LABELS[c.reach])]] } : unconfirmed();
}

/** 氏名の欄（緊急連絡先 2）。2 人目の居ない欄は空き枠（T111） */
function nameCell(c: Contact | null, reason?: PendingStatus): Cell {
  if (!c) return withPending(EMPTY, reason);
  return withPending(value([strong(c.name ?? c.relation ?? CONTACT_KIND_LABELS[c.kind])]), reason);
}

/** 関係先の 1 行（名前・種類・近さ・電話・備考） */
function contactLine(c: Contact): PieceLine {
  const line: PieceLine = [...contactName(c), sub(CONTACT_KIND_LABELS[c.kind])];
  if (c.reach) line.push(sub(CONTACT_REACH_LABELS[c.reach]));
  const tel = c.phone || c.mobile;
  line.push(sub("TEL"), tel ? t(tel) : unconfirmedPiece());
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
// T133: 同居の家族を問う □（「同居家族 □いる □いない」）と、夫婦・子との同居を「家族と同居」の □ に
const HOUSEHOLD_WORDS: Record<string, readonly string[]> = {
  alone: ["ひとり暮らし", "独居", "単身", "一人暮らし"],
  with_spouse: ["夫婦", "高齢者のみ", "家族と同居"],
  with_child: ["子と同居", "家族と同居"],
  with_family: ["家族と同居"],
};
/** 選択肢の字が同じときだけ照らす言葉（含む・含まれるでは照らさない。「いる」は「〜している」にも入る） */
const HOUSEHOLD_EXACT: Record<string, readonly string[]> = { alone: ["いない"], with_spouse: ["いる"], with_child: ["いる"], with_family: ["いる"] };
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
    return { cell: withPending(value([v === "ok" ? t(ABILITY_LABELS[v]) : strong(ABILITY_LABELS[v])]), reason), flag: v !== "ok", words: [ABILITY_LABELS[v]], codes: [v] };
  };
}

function consentItem(kind: ConsentKind) {
  return (c: Ctx): ItemValue => {
    const status = c.consent[kind];
    const reason = pendingOf(c.ledger, `consent.${kind}`);
    if (status === "unconfirmed") return { cell: unconfirmed(reason), flag: null };
    const row = c.rows.consents.find((x) => x.kind === kind);
    const rec = row ? [sub(`記録 ${formatJst(row.recorded_at).slice(0, 10)}${row.recorded_by_name ? ` ${row.recorded_by_name}` : ""}`)] : [];
    return { cell: value([strong(CONSENT_STATUS_LABELS[status]), ...rec]), flag: status === "granted", words: CONSENT_WORDS[status], codes: [status] };
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
    return s ? { cell: value([t(SEX_LABELS[s])]), words: SEX_WORDS[s], codes: [s] } : { cell: unconfirmed(pendingOf(c.ledger, "basic.sex")) };
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
      ? { cell: value([t(HOUSEHOLD_LABELS[h])]), words: [HOUSEHOLD_LABELS[h], ...(HOUSEHOLD_WORDS[h] ?? [])], exact: HOUSEHOLD_EXACT[h], codes: [h] }
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
    return v ? { cell: value([strong(CARE_LEVEL_LABELS[v])]), flag: true, words: [CARE_LEVEL_LABELS[v]], codes: [v] } : { cell: unconfirmed(reason), flag: null };
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
    if (devices.length === 0) return { cell: withPending(NONE, reason), flag: reason ? null : false, words: ["なし"], multi: true, kinds: DEVICE_KINDS, ...(reason ? {} : { codes: [] }) };
    const used = new Set<string>();
    const clocks = [...c.rows.clocks].sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));
    return {
      cell: withPending(value(...devices.map((d) => deviceLine(d, clocks, used))), reason),
      flag: true,
      words: [...devices.map((d) => deviceText(d)), "あり"],
      multi: true,
      kinds: DEVICE_KINDS,
      codes: [...new Set(devices.map((d) => d.kind))],
      kindCell: (labels) => {
        const hit = devices.filter((d) => labels.some((l) => wordMatches(l, [deviceText(d), DEVICE_LABELS[d.kind]])));
        return hit.length > 0 ? value(...hit.map((d): PieceLine => [t(deviceText(d))])) : EMPTY;
      },
    };
  },
  "medical.medications": (c) => {
    const meds = c.ledger.medical.medications;
    // 種類の □ に合わせる言葉は区分の □ の言い方（T131）。その他の区分は名前を添えない「その他」の □ だけ
    const words = [
      ...new Set(
        meds.flatMap((m) => medicationWords(m)),
      ),
      "あり",
    ];
    const reason = pendingOf(c.ledger, "medical.medications");
    const flag = meds.length > 0 ? true : reason ? null : false;
    // 種類の括弧（T164）: その種類の薬の名前と飲み方だけ（専用の紙 lib/forms/medical-summary.ts の medicationNames と同じ字）
    const kindCell = (labels: readonly string[]): Cell => {
      const hit = meds.filter((m) => labels.some((l) => wordMatches(l, medicationWords(m))));
      return hit.length > 0 ? value(...hit.map((m): PieceLine => [t(m.name), ...(m.schedule ? [sub(m.schedule)] : [])])) : EMPTY;
    };
    return { cell: c.sheet.cells["medical.drugs"], flag, words: meds.length > 0 ? words : ["なし"], multi: true, kinds: MEDICATION_KINDS, kindCell };
  },
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
    const kinds = Object.values(HAZARD_WORDS).flat();
    if (hz.length === 0) return { cell: withPending(NONE, reason), flag: reason ? null : false, words: ["なし"], multi: true, kinds, ...(reason ? {} : { codes: [] }) };
    return {
      cell: withPending(value(hz.flatMap((h, i) => [...(i > 0 ? [sub("／")] : []), strong(HAZARD_LABELS[h.kind]), ...(h.depthM != null ? [sub(`${h.depthM} m`)] : []), ...(h.note?.trim() ? [sub(h.note.trim())] : [])])), reason),
      flag: true,
      words: hz.flatMap((h) => HAZARD_WORDS[h.kind]),
      multi: true,
      kinds,
      match: (label) => hz.some((h) => hazardMatches(h.kind, label)),
      codes: [...new Set(hz.map((h) => h.kind))],
      details: hz.flatMap((h) => {
        const d = [h.depthM != null ? `${h.depthM} m` : "", h.note?.trim() ?? ""].filter(Boolean).join(" ");
        return d ? [{ words: HAZARD_WORDS[h.kind], detail: d, kind: h.kind }] : [];
      }),
    };
  },
  "evacuation.destination1": fromSheet("shelter.city.place"),
  "evacuation.destination2": fromSheet("shelter.pre.place"),
  "evacuation.transport": (c) => {
    const e = c.ledger.evacuation;
    // 選ぶ欄（【手段】の □）は選んだ手段の言葉と照らす（T131）。補記（「徒歩（杖をついて）」の括弧の中）のある人は照らさず、
    // 前のまま選択肢を □ のまま並べて値を後ろに添える（印だけにすると補記が紙から落ちる）
    const kind = e.transportKind ? TRANSPORT_KIND_LABELS[e.transportKind] : undefined;
    const shown = transportText(e);
    // 選択肢と台帳の値の表（T140）では、手段の種類（選ぶ欄の値、無い古い台帳は補記の字から読み替え）のコードで □ に印を付け、
    // 補記（「娘の車」）はその選択肢の所の空きに添える（入らなければ別紙）。補記を紙から落とさない
    const note = e.transport?.trim();
    // 手段の値が「その他」でも、補記が 1 つの手段だけを言っていれば（「民生委員と歩いて」）その手段の □（T168）。台帳の値は変えない
    const stored = transportKindOf(e);
    const code = stored === "other" && note ? ((soleCodeOfText("evacuation.transport", note) as TransportKind | null) ?? stored) : stored;
    const noteOf = code && note && note !== TRANSPORT_KIND_LABELS[code] ? note : undefined;
    return {
      cell: text(shown, pendingOf(c.ledger, "evacuation.transport")),
      ...(kind && shown === kind ? { words: [kind] } : {}),
      ...(code ? { codes: [code], ...(noteOf ? { codeDetail: noteOf } : {}) } : {}),
    };
  },
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
      flag: s.length > 0,
      multi: true,
      codes: [...s],
      kinds: Object.values(SUPPORT_KIND_LABELS),
    };
  },
  "evacuation.carryItems": (c) => list(c.ledger.evacuation.carryItems, pendingOf(c.ledger, "evacuation.carryItems"), "evacuation.carryItems"),
  "evacuation.pets": (c) => ({ cell: text(c.ledger.evacuation.pets, pendingOf(c.ledger, "evacuation.pets")) }),
  "evacuation.destination1Minutes": fromSheet("shelter.city.minutes"),
  "evacuation.destination2Minutes": fromSheet("shelter.pre.minutes"),
  "evacuation.nearest": fromSheet("shelter.near.place"),
  // 避難場所ごとの手段・時間（T131）。避難場所の無い人の欄は空き枠（松山市の様式と同じ）
  "evacuation.destination2Means": (c) => meansItem(c.ledger.evacuation.destination2Means, c.ledger.evacuation.destination2, pendingOf(c.ledger, "evacuation.destination2Means")),
  "evacuation.nearestMeans": (c) => meansItem(c.ledger.evacuation.nearestMeans, c.ledger.evacuation.nearest, pendingOf(c.ledger, "evacuation.nearestMeans")),
  "evacuation.nearestMinutes": fromSheet("shelter.near.minutes"),
  "evacuation.myTimeline": (c) => {
    const v = c.ledger.evacuation.myTimeline;
    const reason = pendingOf(c.ledger, "evacuation.myTimeline");
    return v ? { cell: value([t(MY_TIMELINE_LABELS[v])]), words: [MY_TIMELINE_LABELS[v]], flag: v !== "none", codes: [v] } : { cell: unconfirmed(reason), flag: null };
  },

  // ---- 住まい ----
  "basic.housing.structure": (c) => {
    const h = c.ledger.basic.housing;
    const reason = pendingOf(c.ledger, "basic.housing.structure", "basic.housing.builtYear");
    if (!h?.structure) return { cell: unconfirmed(reason) };
    return {
      cell: withPending(value([t(STRUCTURE_LABELS[h.structure]), ...(h.builtYear != null ? [sub(`${h.builtYear} 年築`)] : [])]), reason),
      words: [STRUCTURE_LABELS[h.structure]],
      codes: [h.structure],
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
  "basic.housing.type": (c) => {
    const v = c.ledger.basic.housing?.type;
    return v ? { cell: value([t(HOUSING_TYPE_LABELS[v])]), words: [HOUSING_TYPE_LABELS[v]], codes: [v] } : { cell: unconfirmed(pendingOf(c.ledger, "basic.housing.type")) };
  },

  // ---- 連絡先・支援者 ----
  "emergency1.name": fromSheet("kin.name"),
  "emergency1.kana": fromSheet("kin.kana"),
  "emergency1.relation": (c) => relationItem(byEmergency(c, 1)),
  "emergency1.phone": (c) => ({ cell: phoneCell(byEmergency(c, 1)) }),
  "emergency1.address": fromSheet("kin.address"),
  "emergency2.name": emergency2(nameCell),
  "emergency2.kana": emergency2(kanaCell),
  "emergency2.relation": (c) => {
    const v = emergency2(relationCell)(c);
    return v.cell.kind === "withheld" ? v : relationItem(byEmergency(c, 2));
  },
  "emergency2.phone": emergency2(phoneCell),
  "emergency2.address": emergency2(addressCell),
  "supporter1.name": fromSheet("supporter1.name"),
  "supporter1.kana": fromSheet("supporter1.kana"),
  "supporter1.relation": (c) => relationItem(bySupporter(c, 1)),
  "supporter1.phone": (c) => ({ cell: phoneCell(bySupporter(c, 1)) }),
  "supporter1.address": fromSheet("supporter1.address"),
  "supporter2.name": fromSheet("supporter2.name"),
  "supporter2.kana": fromSheet("supporter2.kana"),
  "supporter2.relation": (c) => relationItem(bySupporter(c, 2)),
  "supporter2.phone": (c) => ({ cell: phoneCell(bySupporter(c, 2)) }),
  "supporter2.address": fromSheet("supporter2.address"),
  "people.night": fromSheet("supporter.night"),
  "people.welfare": fromSheet("local.welfare"),
  "local.watcher": fromSheet("local.watcher"),
  "people.offices": fromSheet("local.office"),
  // 実施組織（T117）。値の出し方は松山市の様式と同じ（実施者がいれば空き枠）
  "org.name": fromSheet("org.name"),
  "org.phone": fromSheet("org.phone"),

  // ---- 同意 ----
  "consent.registry": consentItem("registry"),
  "consent.plan_share": consentItem("plan_share"),
  "consent.supporters": consentItem("supporters"),
  "consent.medical": consentItem("medical"),

  // ---- 計画・特記 ----
  "plan.date": fromSheet("head.date"),
  "plan.author": fromSheet("plan.author"),
  // 事業所名と担当ケアマネを別々の欄に書く様式（T131）
  "plan.office": (c) => ({ cell: text(c.officeName) }),
  "plan.careManager": (c) => ({ cell: text(c.rows.careManagerName) }),
  "notes.words": fromSheet("notes.words"),
  "notes.other": fromSheet("notes.other"),
};

// ---------- 欄の形に合わせる ----------

/** 照らすための形（空白を除き、全角の英数を半角に、丸数字・括弧の揺れをそろえる） */
export function normalizeWord(s: string): string {
  return s.normalize("NFKC").replace(/[\s　]/g, "").replace(/[（）()【】「」]/g, "");
}

/** あり・なし の選択肢（T133） */
const YES = /^(あり|有|有り|はい)$/;
const NO = /^(なし|無|無し|いいえ)$/;
const NONE_TEXT = "なし";

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

/** 言葉どうしが合うか（同じか、片方がもう片方を含む。括弧・空白の揺れはそろえる） */
export function wordMatches(label: string, words: readonly string[]): boolean {
  const l = normalizeWord(label);
  return (
    l !== "" &&
    words.some((w) => {
      const x = normalizeWord(w);
      return x !== "" && (l === x || l.includes(x) || x.includes(l));
    })
  );
}

/** 意味を変えない添えの字（「高血圧」と「高血圧症」、「インフルエンザ」と「インフルエンザワクチン」） */
const NEUTRAL_AFFIX = /^(症|病|疾患|歴|等|など|ワクチン|予防接種|接種|既往|の既往)?$/;

/**
 * 自由な言葉の並び（既往症・予防接種など）を選ぶ欄の選択肢に当てる（T160）。言葉ごとに:
 * - 同じ言葉・添えの字（症・ワクチンなど）だけ違う選択肢に印
 * - 選択肢の方が細かい（「今期インフルエンザ」に「インフルエンザ」）: 台帳に無い事を言うので印を付けない
 * - 言葉の方が細かい（「2 型糖尿病」に「糖尿病」）: 印を付け、残り（「2 型」）を選択肢の所に添える
 * - 当たらない言葉（「新型コロナ」）は after（「その他」の括弧へ）
 * どの言葉も印にならないとき、あり・なし の選択肢のある欄は null（今までの照らし方へ）。「あり」「なし」は欄の あり・なし の言葉なので照らさない
 */
export function pickWords(options: readonly string[], words: readonly string[]): { options: Choice[]; after: string[] } | null {
  const real = words.filter((w) => w !== "あり" && w !== "なし" && normalizeWord(w) !== "");
  if (real.length === 0 || options.length === 0) return null;
  const opts = options.map(normalizeWord);
  const on = options.map(() => false);
  const details: string[][] = options.map(() => []);
  const after: string[] = [];
  for (const w of real) {
    const x = normalizeWord(w);
    let hit = false;
    for (const [i, o] of opts.entries()) {
      if (o === "") continue;
      const at = o.indexOf(x);
      if (o === x || (at >= 0 && NEUTRAL_AFFIX.test(o.slice(0, at)) && NEUTRAL_AFFIX.test(o.slice(at + x.length)))) {
        on[i] = true;
        hit = true;
        continue;
      }
      const inner = x.indexOf(o);
      if (inner >= 0 && o.length >= 2) {
        on[i] = true;
        hit = true;
        const rest = `${x.slice(0, inner)}${x.slice(inner + o.length)}`;
        if (!NEUTRAL_AFFIX.test(rest)) details[i].push(w.normalize("NFKC").replace(options[i].normalize("NFKC").trim(), "").trim() || rest);
      }
    }
    if (!hit) after.push(w);
  }
  // どれも当たらない: あり・なし の欄は今までの照らし方（あり に印）、ほかは全部「その他」へ
  if (!on.some(Boolean) && opts.some((o) => YES.test(o) || NO.test(o))) return null;
  return { options: options.map((label, i) => ({ label, on: on[i], ...(details[i].length > 0 ? { detail: details[i].join("・") } : {}) })), after };
}

/**
 * □ ごとに種類を問う欄（T122）: □ の名前が項目の種類のどれかなら、その種類が台帳にあるかの印。
 * 種類でない □（「医療機器の使用」）は undefined（今まで通り有無）
 */
export function kindFlag(field: Pick<MappingField, "label">, v: ItemValue): boolean | null | undefined {
  if (!v.kinds || !wordMatches(field.label, v.kinds)) return undefined;
  if (v.flag === null || v.flag === undefined) return v.flag;
  return v.flag === true && (v.match ? v.match(field.label) : wordMatches(field.label, v.words ?? []));
}

/** 項目の値を欄の形（□・選ぶ・手書き）に合わせる */
export function shapeCell(field: MappingField, v: ItemValue): Cell {
  const cell = v.cell;
  if (cell.kind === "withheld" || cell.kind === "handwrite" || cell.kind === "empty") return cell;
  // □ 1 つの欄は、欄の名前を左の列に出すので ■・□ と値だけ（名前を繰り返さない）
  if (field.shape === "check") {
    // 要介護度の幅の □（「要介護認定が 3〜5 の方」。T140）: 台帳の値が幅の中のときだけ印（前は要介護度があれば印）
    const range = field.item === "care.careLevel" && v.codes ? codeOfOption(field.item, field.label, field) : null;
    if (range && range.length > 0 && v.codes) return { kind: "choice", options: [v.codes.some((c) => range.includes(c)) ? CHECK_ON : CHECK_OFF] };
    const kind = kindFlag(field, v);
    // 種類の □ は印だけ（ほかの種類の値を横に並べない）
    if (kind === true) return { kind: "choice", options: [CHECK_ON] };
    if (kind === false) return { kind: "choice", options: [CHECK_OFF] };
    if (v.flag === true) return { kind: "choice", options: [CHECK_ON], after: pieces(cell) };
    if (v.flag === false) return { kind: "choice", options: [CHECK_OFF] };
    const reason = cell.kind === "unconfirmed" ? cell.reason : undefined;
    return { kind: "choice", options: [CHECK_OFF], unconfirmed: reason ? { reason } : {} };
  }
  if (field.shape === "choice" && field.options.length > 0) {
    if (cell.kind === "unconfirmed") {
      return { kind: "choice", options: field.options.map((label) => ({ label, on: false })), unconfirmed: cell.reason ? { reason: cell.reason } : {} };
    }
    // 選択肢と台帳の値の表（T140、lib/forms/option-values.ts）: 台帳の値のコードと照らす。当たれば印、範囲外なら空ける（空くのが答え）。
    // 1 つを選ぶ欄で 2 つ以上当たれば選ばない（選択肢に無い）。表で当たらない選択肢だけのときは、前の言葉の照らし方へ
    const table = field.item ? optionTable(field) : null;
    if (table && v.codes) {
      const pick = pickByCodes(table, v.codes, v.multi === true, codesOf(field.item!));
      if (pick.hits.length > 0) {
        const detailOf = (label: string) =>
          v.details?.find((d) => (d.kind ? hazardMatches(d.kind, label) : wordMatches(label, d.words)))?.detail ?? (v.multi ? undefined : v.codeDetail);
        return {
          kind: "choice",
          options: field.options.map((label, i) => {
            const on = pick.hits.includes(i);
            const detail = on ? detailOf(label) : undefined;
            return { label, on, ...(detail ? { detail } : {}) };
          }),
        };
      }
      // 範囲外で空けるのは、種類の並びの欄（機器・ハザード・持ち出し品などの「あてはまる物」）と要介護度の幅だけ。1 つを選ぶ分け方の欄
      // （構造・性別・世帯）で値の選択肢が無いのは読み落としのことがあるので、選択肢に無い（置けなかった）として人に見せる
      if (pick.range && (v.multi || field.item === "care.careLevel")) return { kind: "choice", options: field.options.map((label) => ({ label, on: false })), range: true };
      if (pick.ambiguous) return { kind: "choice", options: field.options.map((label) => ({ label, on: false })), after: pieces(cell), ambiguous: true };
    }
    // 自由な言葉の並び（既往症・予防接種・アレルギー。T160）: 言葉ごとに意味を変えない選択肢にだけ印、選択肢より細かい言葉は残りを添え、
    // 当たらない言葉は「その他」の括弧へ（置き方は lib/forms/overlay-sheet.ts の placeChoice）
    if (v.multi && v.words && !v.match && !v.kinds) {
      const picked = pickWords(field.options, v.words);
      if (picked) return { kind: "choice", options: picked.options, ...(picked.after.length > 0 ? { after: [t(picked.after.join("・"))] } : {}) };
    }
    // 複数選択の欄（T122）: 種類が並ぶ項目は、合う選択肢の全部に印
    if (v.multi && v.words) {
      const words = v.words;
      const on = field.options.map((o) => (v.match ? v.match(o) : wordMatches(o, words)));
      const detailOf = (label: string) => v.details?.find((d) => (d.kind ? hazardMatches(d.kind, label) : wordMatches(label, d.words)))?.detail;
      if (on.some(Boolean))
        return {
          kind: "choice",
          options: field.options.map((label, i) => {
            const detail = on[i] ? detailOf(label) : undefined;
            return { label, on: on[i], ...(detail ? { detail } : {}) };
          }),
        };
    }
    const exactHit = v.exact ? field.options.findIndex((o) => v.exact!.some((w) => normalizeWord(o) === normalizeWord(w))) : -1;
    const hit = exactHit >= 0 ? exactHit : v.words ? matchOption(field.options, v.words) : -1;
    if (hit >= 0) return { kind: "choice", options: field.options.map((label, i) => ({ label, on: i === hit })) };
    // あり・なし の 2 つを選ぶ欄（「介護保険 □なし □あり」「医療的ケア □なし □あり」）に値があれば あり（T133。値の中身は別の欄）
    const yes = field.options.findIndex((o) => YES.test(normalizeWord(o)));
    const no = field.options.findIndex((o) => NO.test(normalizeWord(o)));
    if (yes >= 0 && no >= 0 && field.options.length === 2 && cell.kind === "value" && cell.lines.some((l) => l.some((p) => !p.sub && !p.unconfirmed && p.text.trim() !== "" && p.text !== NONE_TEXT))) {
      return { kind: "choice", options: field.options.map((label, i) => ({ label, on: i === yes })) };
    }
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
  /** 一覧の形の様式（T131）。表の列の欄の id。一括印刷で行ごとに 1 人を置く（lib/forms/list-sheet.ts） */
  list?: ListShape & { fieldIds: string[] };
};

/** 欄 1 つの値 */
export function mappedCell(field: MappingField, ctx: Ctx): Cell {
  if (field.shape === "handwrite") return { kind: "handwrite" };
  if (field.item === null) return field.shape === "check" ? { kind: "choice", options: [CHECK_OFF], unconfirmed: {} } : unconfirmed();
  const def = ledgerItem(field.item);
  if (def.consent && ctx.consent[def.consent] !== "granted") return { kind: "withheld", consent: def.consent };
  const cell = shapeCell(field, ITEM_VALUES[field.item](ctx));
  // 欄の名前が 2 つの項目を含む欄（「生年月日・年齢」「氏名・ふりがな」「住所・電話」。T141）は、もう 1 つの項目も同じ欄に置く
  const pair = pairedItem(field) ?? agePartItem(field);
  if (!pair || cell.kind !== "value" || field.shape === "choice" || field.shape === "check") return cell;
  const def2 = ledgerItem(pair.item);
  if (def2.consent && ctx.consent[def2.consent] !== "granted") return cell;
  const other = ITEM_VALUES[pair.item](ctx).cell;
  if (other.kind !== "value") return cell;
  return pairCell(cell, other, pair, field);
}

// ---------- 2 つの項目を持つ欄（T141） ----------

/**
 * 欄の名前の言葉と、項目の役（T141）。評価の 5 回目で、災害診療記録の「生年月日・年齢」の欄を年齢の項目に当てた読み取りで
 * 年齢だけが入ったと数えられた。欄の名前が 2 つの項目の言葉を区切りの字（・／、・及び・と）でつないでいれば、両方を置く
 */
const PAIR_ROLES = [
  { role: "name", re: /氏名|名前/ },
  { role: "kana", re: /ふりがな|フリガナ|カナ/ },
  { role: "birth", re: /生年月日/ },
  { role: "age", re: /年齢/ },
  { role: "address", re: /住所/ },
  { role: "phone", re: /電話|TEL/i },
  { role: "relation", re: /続柄|関係/ },
] as const;
type PairRole = (typeof PAIR_ROLES)[number]["role"];

/** 本人の項目の役 */
const PERSON_ROLES: Partial<Record<PairRole, LedgerItemKey>> = {
  name: "person.name",
  kana: "person.kana",
  birth: "person.birth",
  age: "person.age",
  address: "basic.address",
  phone: "self.phone",
};

/** 項目の仲間（本人、緊急連絡先・支援者ごと）。仲間の外の項目は組にしない */
function familyOf(item: LedgerItemKey): Partial<Record<PairRole, LedgerItemKey>> | null {
  if ((Object.values(PERSON_ROLES) as string[]).includes(item)) return PERSON_ROLES;
  const m = item.match(/^((?:emergency|supporter)\d)\.(name|kana|address|phone|relation)$/);
  if (!m) return null;
  const p = m[1];
  return { name: `${p}.name`, kana: `${p}.kana`, address: `${p}.address`, phone: `${p}.phone`, relation: `${p}.relation` } as Partial<Record<PairRole, LedgerItemKey>>;
}

/** 2 つの言葉をつなぐ区切り（括弧は入れない。「患者氏名（カタカナ）」は 1 つの項目） */
const JOINER = /^[^（）()［］[\]]{0,4}$/;
const JOIN_WORD = /[・･／/、,]|及び|および|並びに|と/;

/** 2 つの項目を持つ欄のもう 1 つの項目（T141）。second は欄の名前で後ろに書かれた方が組の相手か */
export function pairedItem(field: Pick<MappingField, "item" | "label">): { item: LedgerItemKey; role: PairRole; own: PairRole; second: boolean } | null {
  if (!field.item) return null;
  const fam = familyOf(field.item);
  if (!fam) return null;
  const label = field.label.normalize("NFKC");
  const own = (Object.entries(fam) as Array<[PairRole, LedgerItemKey]>).find(([, k]) => k === field.item)?.[0];
  const ownRe = PAIR_ROLES.find((r) => r.role === own)?.re;
  const ownAt = ownRe ? label.match(ownRe) : null;
  if (!own || !ownAt || ownAt.index === undefined) return null;
  for (const r of PAIR_ROLES) {
    if (r.role === own || !fam[r.role]) continue;
    const m = label.match(r.re);
    if (!m || m.index === undefined) continue;
    const [a, b] = m.index > ownAt.index ? [ownAt, m] : [m, ownAt];
    const between = label.slice(a.index! + a[0].length, b.index!);
    if (JOINER.test(between) && JOIN_WORD.test(between)) return { item: fam[r.role]!, role: r.role, own, second: m.index > ownAt.index };
  }
  return null;
}

/**
 * 生年月日の欄に「歳」の区切りの空きがある（「　年　月　日（　歳）」。T160）: 欄の名前に年齢の言葉が無くても、年齢の項目を組にして
 * 年・月・日・歳の空きに分ける（評価の 6 回目で、吹田市・熊本市の生年月日が「歳」の空きに分けられず 1 つの字で置かれ、全部の紙で要修正）。
 * 欄の名前で組になる物（pairedItem）が先
 */
export function agePartItem(field: Pick<MappingField, "item" | "options">): { item: LedgerItemKey; role: PairRole; own: PairRole; second: boolean } | null {
  if (field.item !== "person.birth") return null;
  const units = field.options.map((o) => o.normalize("NFKC").trim()).filter((o) => /[年月日歳]$/.test(o));
  if (!units.some((o) => o.endsWith("歳")) || !units.some((o) => o.endsWith("日"))) return null;
  return { item: "person.age", role: "age", own: "birth", second: true };
}

/** 括弧で添える役（年齢・ふりがな・続柄）。ほかは全角の空きで並べる */
const BRACKET_ROLES: ReadonlySet<PairRole> = new Set<PairRole>(["age", "kana", "relation"]);

/**
 * 2 つの項目の値を 1 つの欄に（T141）。欄に「歳」の区切りの空きがあれば（部品つきの欄）区切りで分けられる並べ方（「昭和17年4月18日 84 歳」）、
 * 無ければ決まった並べ方（「昭和17年4月18日（84 歳）」「山田 ハナ（ヤマダ ハナ）」「市 町名　090-…」）。欄の名前の順に並べる
 */
function pairCell(main: Extract<Cell, { kind: "value" }>, other: Extract<Cell, { kind: "value" }>, pair: { role: PairRole; own: PairRole; second: boolean }, field: MappingField): Cell {
  // 1 つの字にして並べる（数と単位は詰める。lib/forms/paper-text.ts）
  const flat = (c: Extract<Cell, { kind: "value" }>): string =>
    c.lines
      .map((l) => paperText(l.filter((x) => !x.unconfirmed && x.text.trim() !== "").map((x) => x.text).join(" ")))
      .filter((x) => x !== "")
      .join(" ");
  const [first, last] = pair.second ? [flat(main), flat(other)] : [flat(other), flat(main)];
  if (first === "" || last === "") return main;
  const lastRole = pair.second ? pair.role : pair.own;
  const units = field.options.map((o) => o.normalize("NFKC").trim()).filter((o) => /[年月日歳]$/.test(o));
  const agePart = units.some((o) => o.endsWith("歳"));
  if (lastRole === "age" && agePart) return { kind: "value", lines: [[t(`${first} ${last}`)]] };
  // 年月日の区切りの空きがあり「歳」の空きが無い欄は、空きに分けると年齢が落ちるので組にしない（前と同じく 1 つの項目）
  if (units.length > 0) return main;
  if (lastRole && BRACKET_ROLES.has(lastRole)) return { kind: "value", lines: [[t(`${first}（${last}）`)]] };
  return { kind: "value", lines: [[t(`${first}　${last}`)]] };
}

const isUnconfirmed = (cell: Cell) =>
  cell.kind === "unconfirmed" ||
  (cell.kind === "choice" && cell.unconfirmed !== undefined) ||
  (cell.kind === "value" && cell.lines.some((l) => l.some((p) => p.unconfirmed)));

/** 連絡先の電話の項目（電話と携帯の 2 つを持つ） */
const CONTACT_PHONE = /^(emergency|supporter)\d\.phone$/;
const MOBILE_LABEL = /携帯/;

/**
 * 電話の欄の役（T133）: 連絡先の電話の項目は電話と携帯の 2 行を持つ。欄の名前に「携帯」があれば携帯の行だけ、同じ段に同じ項目の携帯の欄が
 * あれば電話の行だけ（電話番号・携帯番号の 2 つの欄に同じ番号を 2 回書かない）。合う行が無ければ未確認
 */
export function phoneRole(cell: Cell, field: MappingField, fields: readonly MappingField[]): Cell {
  if (cell.kind !== "value" || !field.item || !CONTACT_PHONE.test(field.item)) return cell;
  const mobile = MOBILE_LABEL.test(field.label);
  const pair = !mobile && fields.some((g) => g !== field && !g.removed && g.item === field.item && g.page === field.page && g.section === field.section && MOBILE_LABEL.test(g.label));
  if (!mobile && !pair) return cell;
  const isMobile = (l: PieceLine) => l.some((p) => p.sub && p.text === "携帯");
  const lines = cell.lines.filter((l) => (mobile ? isMobile(l) : !isMobile(l)));
  return lines.length > 0 ? { kind: "value", lines } : unconfirmed();
}

/**
 * 括弧の子の欄（T164、lib/forms/form-shape.ts の bracketOwner）の値。親の値を丸ごと書かない:
 * - 親が種類の □（「□抗血小板薬（　）」）: その種類の値だけ（同じ行の左の □ の種類も。「□抗凝固薬 □ワーファリン（　）」は抗凝固薬の全部）。無ければ空
 * - 種類の □ の並びの終わりの「その他（　）」で「その他」の □ が無い（rest）: 並びのどの種類にも入らない値（「その他」の種類）
 * - 親が種類でない □（「□アレルギー（　）」）: 今までどおり項目の値（T161。□ に印、括弧の中に中身）
 * - 親が選ぶ欄（「□その他（　）」「□洪水（～）」）: 空。親の選択肢の添え・その他の値を、紙（overlay-sheet.ts の placeChoice）がこの欄の枠に置く
 */
export function bracketCell(cell: Cell, own: BracketOwner<MappingField>, ctx: Ctx): Cell {
  if (cell.kind === "withheld" || cell.kind === "handwrite") return cell;
  if (own.option !== null) return EMPTY;
  const item = own.owner.item;
  if (!item) return cell;
  const v = ITEM_VALUES[item](ctx);
  if (kindFlag(own.owner, v) === undefined) return own.rest ? EMPTY : cell;
  if (!v.kindCell || v.flag !== true) return EMPTY;
  // 「その他」の □ を読み落とした並びの終わりの「その他（　）」は、その他の種類の値
  return v.kindCell(own.rest ? ["その他"] : own.row.map((f) => f.label));
}

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
    officeName: opts.officeName,
  };

  const pages: MappedPage[] = [];
  const unconfirmedLabels: string[] = [];
  const unmapped: string[] = [];
  const withheld = new Set<ConsentKind>();
  let count = 0;
  // 要確認の欄を確認するまで紙に使わない形（T122）: 確認していない要確認の欄は対応なしと同じ（未確認）
  const held = heldFields(mapping);
  // 括弧の子の欄（T164）。確認していない要確認の欄（項目なしと同じ）は親にも子にもしない
  const shown = mapping.fields.filter((f) => !held.has(f.id));
  const brackets = bracketOwners(shown);
  for (const field of mapping.fields) {
    if (field.removed) continue;
    count += 1;
    const own = held.has(field.id) ? undefined : brackets.get(field.id);
    const base = phoneRole(mappedCell(held.has(field.id) ? { ...field, item: null } : field, ctx), field, mapping.fields);
    // 並びの終わりの「その他（　）」に違う項目（T164、form-shape.ts の strayOther）: 違う欄に書かない
    const stray = !own && !held.has(field.id) && base.kind !== "withheld" && strayOther(field, shown);
    const cell = own ? bracketCell(base, own, ctx) : stray ? EMPTY : base;
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
    ...(mapping.list ? { list: { ...mapping.list, fieldIds: listFieldIds(mapping.fields, mapping.list) } } : {}),
  };
}
