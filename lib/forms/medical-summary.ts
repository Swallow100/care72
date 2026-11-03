// 医療要約（docs/tasks/T07.md）。避難所の医療班が災害診療記録 2018（一般診療版）の 1 頁（基本情報の面）へ
// そのまま写せる順と欄で、台帳の値を並べる。助言はしない、情報を渡す。
// 欄の名前と順は厚労省の頁の通知の別添（SAIGAI_KIROKU_URL。リポジトリに入れない）から起こした。既往症・予防接種は様式では 2 頁。
// 組み立ては定型で、Claude は呼ばない（氏名・電話が入る）。
//
// 決まり:
// - 医療班提供の同意（consents.medical）が「同意」の人だけ要約を作る。不同意は「同意なし」、未確認は「未確認」で、中身は作らない
//   （計画書の医療の欄は計画共有に従う。医療班提供は要約と QR の頁にだけ効く。docs/DECISIONS.md の 11/2 夕方の案 a）
// - 薬・機器・時計の値は計画書（lib/forms/matsuyama.ts）と同じ道具で作る（どの書類でも同じ値）
// - 中断注意の印は優先の骨格（lib/triage の categoryTier）から機械的に付ける。段 4・5 の薬と段 4 の機器（経管栄養）に付け、
//   段の根拠の出典 id を添える。台帳の印（interruptionRisk）だけの薬にも印を出すが、出典は付けない（骨格から来た物だけが登録簿を指す）
// - 本人の 1 枚の裏（buildOwnSheetMedical）は、支援者提供の同意が無ければ表と同じく支援者の名前・電話を出さない（T37 の 5）。
//   医療班の画面の要約は医療班提供の同意だけを見る（今まで通り）
// - 診断名を推し量らない（降圧薬から高血圧を立てない）。既往症・予防接種は台帳の言葉のまま、様式の選択肢と同じ言葉だけ印を付ける
// - 発災後に医療班が書く欄（初診日・医師・保険証・職業・傷病名・トリアージ）は出さない。家の状態（健存・半壊・全壊）は未確認
// - 「なぜこの行があるか」（basis）は骨格の段の根拠（lib/triage の TIERS）と登録簿の出典だけから作る。紙には出さず、
//   ケアマネ・主治医の画面の脇にだけ出す

import type {
  ConsentStatus,
  Ledger,
  MedicationCategory,
  PendingStatus,
} from "../db/types.ts";
import { parseLedger } from "../db/ledger.ts";
import { ageOn } from "../age.ts";
import {
  ABILITY_LABELS,
  CARE_LEVEL_LABELS,
  CONTACT_KIND_LABELS,
  CONTACT_REACH_LABELS,
  DEVICE_LABELS,
  HAZARD_LABELS,
  HOUSEHOLD_LABELS,
  MEDICATION_CATEGORY_LABELS,
  MEDICATION_FLAG_LABELS,
  STRUCTURE_LABELS,
} from "../labels.ts";
import type { PersonPageRows } from "../person.ts";
import { sourceById, type SourceId } from "../sources/index.ts";
import { toTriagePerson } from "../triage/from-ledger.ts";
import { categoryTier, tierBasis, type Tier } from "../triage/index.ts";
import {
  BLANK,
  clockBasis,
  clockGroup,
  clockValue,
  contactName,
  deviceLine,
  joinGroups,
  MED_CLOCK_CATEGORY,
  medicationClocks,
  NONE,
  pendingLabel,
  pendingMedicationIndex,
  raw,
  strong,
  sub,
  t,
  under,
  unconfirmed,
  unconfirmedPiece,
  value,
  type Cell,
  type Choice,
  type Clock,
  type Contact,
  type Medication,
  type Piece,
  type PieceLine,
} from "./matsuyama.ts";
import { wareki, warekiDate } from "./wareki.ts";

/** 災害診療記録 2018 の出典の id（登録簿 lib/sources） */
export const SAIGAI_KIROKU_SOURCE: SourceId = "saigai-kiroku-2018";
/** 様式の PDF。開いて照らすためのリンクだけ持つ */
export const SAIGAI_KIROKU_URL = sourceById(SAIGAI_KIROKU_SOURCE).url;

// ---------- 欄の一覧 ----------

/** 要約の段（様式の 1 頁の上から。既往症・予防接種は様式の 2 頁） */
export const MEDICAL_BLOCKS = {
  patient: "患者",
  shelter: "避難先",
  contact: "連絡先",
  contra: "禁忌事項等",
  special: "特記事項（常用薬等）",
  meds: "常用薬",
  care: "要配慮者",
  history: "既往症・予防接種",
  id: "メディカル ID",
} as const;
export type MedicalBlock = keyof typeof MEDICAL_BLOCKS;

export type MedicalFieldDef = {
  key: string;
  block: MedicalBlock;
  /** 様式の欄の名前（足した欄は要約での名前） */
  label: string;
  /** 台帳のどこから */
  source: string;
  /** 様式の何頁の欄か */
  page: 1 | 2;
  /** 様式に無い欄（台帳の値を医療班へ渡すために足した） */
  extra?: true;
};

const NO_SOURCE = "台帳に無い";

/** 欄の一覧（様式の順）。紙面とテストはここから全部を出す */
export const MEDICAL_FIELDS = [
  { key: "patient.kana", block: "patient", label: "患者氏名（カタカナ）", source: "people.kana", page: 1 },
  { key: "patient.name", block: "patient", label: "漢字等", source: "people.name", page: 1 },
  // 様式は（漢字等）の右に性別、その下に生年月日・年齢（T47 の照合で順を直した）
  { key: "patient.sex", block: "patient", label: "性別", source: "ledger.basic.sex", page: 1 },
  { key: "patient.birth", block: "patient", label: "生年月日・年齢", source: "people.birth_date（西暦と和暦）", page: 1 },
  { key: "patient.phone", block: "patient", label: "[携帯]電話番号", source: "contacts（本人）", page: 1 },
  { key: "patient.address", block: "patient", label: "住所", source: "ledger.basic.address（市・町名）", page: 1 },
  { key: "patient.house", block: "patient", label: "状態", source: `${NO_SOURCE}（発災後の家の被害）`, page: 1 },
  {
    key: "patient.dwelling",
    block: "patient",
    label: "住まい",
    source: "ledger.basic.housing・evacuation.hazards",
    page: 1,
    extra: true,
  },
  {
    key: "shelter.first",
    block: "shelter",
    label: "避難先１",
    source: "ledger.evacuation.destination1・transport（計画）",
    page: 1,
  },
  { key: "shelter.second", block: "shelter", label: "避難先２", source: "ledger.evacuation.destination2（計画）", page: 1 },
  {
    key: "contact.kinds",
    block: "contact",
    label: "連絡先",
    source: "contacts（緊急連絡先・避難支援等実施者）の種類",
    page: 1,
  },
  {
    key: "contact.people",
    block: "contact",
    label: "連絡先の人",
    source: "contacts（emergency_order・supporter_order の順）",
    page: 1,
    extra: true,
  },
  {
    key: "contact.others",
    block: "contact",
    label: "関係先",
    source: "contacts（かかりつけ・薬局・訪問看護・介護事業所ほか）",
    page: 1,
    extra: true,
  },
  { key: "contra.allergy", block: "contra", label: "アレルギー", source: "ledger.medical.allergies", page: 1 },
  { key: "contra.food", block: "contra", label: "禁忌食物", source: NO_SOURCE, page: 1 },
  { key: "drug.antiplatelet", block: "special", label: "抗血小板薬", source: "ledger.medical.medications（抗血小板薬）", page: 1 },
  {
    key: "drug.anticoagulant",
    block: "special",
    label: "抗凝固薬",
    source: "ledger.medical.medications（抗凝固薬。名前にワーファリン）",
    page: 1,
  },
  {
    key: "drug.diabetes",
    block: "special",
    label: "糖尿病治療薬",
    source: "ledger.medical.medications（インスリン・経口糖尿病薬）",
    page: 1,
  },
  { key: "drug.steroid", block: "special", label: "ステロイド", source: "ledger.medical.medications（ステロイド）", page: 1 },
  {
    key: "drug.antiepileptic",
    block: "special",
    label: "抗てんかん薬",
    source: "ledger.medical.medications（抗てんかん薬）",
    page: 1,
  },
  { key: "drug.other", block: "special", label: "その他", source: "ledger.medical.medications（その他）", page: 1 },
  {
    key: "drug.dialysis",
    block: "special",
    label: "透析",
    source: "ledger.medical.devices（透析）・clocks・contacts（透析施設）",
    page: 1,
  },
  {
    key: "drug.hot",
    block: "special",
    label: "在宅酸素療法（HOT）",
    source: "ledger.medical.devices（在宅酸素）・clocks",
    page: 1,
  },
  {
    key: "drug.devices",
    block: "special",
    label: "機器",
    source: "ledger.medical.devices（人工呼吸器・吸引・経管栄養）・clocks",
    page: 1,
    extra: true,
  },
  {
    key: "meds.list",
    block: "meds",
    label: "薬・用量・残り",
    source: "ledger.medical.medications・clocks（薬の残り）・骨格の段（中断注意）",
    page: 1,
    extra: true,
  },
  { key: "meds.carry", block: "meds", label: "持出品", source: "ledger.evacuation.carryItems", page: 1, extra: true },
  { key: "meds.notes", block: "meds", label: "特記", source: "ledger.notes（そのまま）・ほかの時計", page: 1, extra: true },
  {
    key: "care.vulnerable",
    block: "care",
    label: "災害時要配慮者",
    source: "年齢・ledger.care（要介護度・手帳・難病・認知症・寝たきり・歩行）・ledger.basic.household",
    page: 1,
  },
  {
    key: "care.protect",
    block: "care",
    label: "要保護者",
    source: "contacts.supporter_order（避難支援等実施者の有無）",
    page: 1,
  },
  {
    key: "id.medical",
    block: "id",
    label: "メディカル ID",
    source: "people.birth_date・ledger.basic.sex・people.kana（機械的に）",
    page: 1,
  },
  { key: "history.disease", block: "history", label: "既往症", source: "ledger.medical.history（そのまま）", page: 2 },
  {
    key: "history.vaccination",
    block: "history",
    label: "予防接種",
    source: "ledger.medical.vaccinations（そのまま）",
    page: 2,
  },
] as const satisfies readonly MedicalFieldDef[];

export type MedicalKey = (typeof MEDICAL_FIELDS)[number]["key"];

const FIELD_BY_KEY = new Map<string, MedicalFieldDef>(MEDICAL_FIELDS.map((f) => [f.key, f]));

export function medicalField(key: MedicalKey): MedicalFieldDef {
  return FIELD_BY_KEY.get(key)!;
}

// ---------- メディカル ID ----------

/**
 * メディカル ID（災害診療記録 2018）: 西暦生年月日 8 桁 ＋ 性別（M・F）＋ 氏名カタカナの上から 7 字。
 * どれかが欠けると作らない（id は null、missing に欠けた物）
 */
export type MedicalId = {
  birth8: string | null;
  sex: "M" | "F" | null;
  kana7: string | null;
  id: string | null;
  missing: Array<"birth" | "sex" | "kana">;
};

export const MEDICAL_ID_PART_LABELS = { birth: "生年月日", sex: "性別", kana: "カナ" } as const;

/**
 * カナの揃え方: NFKC（半角カナ → 全角、全角の空白 → 空白）→ 空白と中黒を除く → ひらがなをカタカナに。
 * 濁点・半濁点・長音・小書きの字はそのまま 1 字に数える。カタカナと長音のほかが残れば null（漢字・英字の名前は作らない）。
 * 7 字に満たない名前は足さずにそのまま
 */
export function medicalIdKana(kana: string): string | null {
  const s = kana
    .normalize("NFKC")
    .replace(/[\s・]/gu, "")
    .replace(/[ぁ-ゖ]/gu, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
  if (s === "" || !/^[ァ-ヺー]+$/u.test(s)) return null;
  return Array.from(s).slice(0, 7).join("");
}

export function medicalId(src: { birthDate: string | null; sex: Ledger["basic"]["sex"]; kana: string | null }): MedicalId {
  const m = src.birthDate ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(src.birthDate) : null;
  const birth8 = m ? `${m[1]}${m[2]}${m[3]}` : null;
  const sex = src.sex === "male" ? "M" : src.sex === "female" ? "F" : null;
  const kana7 = src.kana ? medicalIdKana(src.kana) : null;
  const missing: MedicalId["missing"] = [];
  if (!birth8) missing.push("birth");
  if (!sex) missing.push("sex");
  if (!kana7) missing.push("kana");
  return { birth8, sex, kana7, id: birth8 && sex && kana7 ? `${birth8}${sex}${kana7}` : null, missing };
}

// ---------- 中断注意の印 ----------

/**
 * 中断注意の印を付ける骨格の段（4 インスリン・経管栄養、5 抗血小板薬・抗凝固薬・ステロイド・抗てんかん薬）。
 * 段 4 の経管栄養は機器の行に付ける（deviceMark）。docs/DECISIONS.md 11/3 04:0x の 2・3
 */
export const INTERRUPTION_TIERS: ReadonlySet<Tier> = new Set<Tier>([4, 5]);

/** 中断注意の印。tier は骨格の段（台帳の印だけなら null）、sourceIds は段の根拠の出典 */
export type InterruptionMark = { label: string; tier: Tier | null; sourceIds: ReadonlyArray<SourceId> };

/** 機器の区分から骨格の段を引き、段 4（経管栄養）なら印。電気の機器（段 1・2）と透析（段 3）には付けない */
export function deviceMark(kind: Ledger["medical"]["devices"][number]["kind"]): InterruptionMark | null {
  const tier = categoryTier(kind);
  if (tier === null || !INTERRUPTION_TIERS.has(tier)) return null;
  return { label: MEDICATION_FLAG_LABELS.interruptionRisk, tier, sourceIds: [...tierBasis(tier).sourceIds] };
}

/** 薬の区分から骨格の段を引き、段 4・5 なら印。骨格に段の無い区分（経口糖尿病薬・その他）は台帳の印だけ */
export function interruptionMark(m: Pick<Medication, "category" | "interruptionRisk">): InterruptionMark | null {
  const clockCategory = MED_CLOCK_CATEGORY[m.category];
  const tier = clockCategory ? categoryTier(clockCategory) : null;
  if (tier !== null && INTERRUPTION_TIERS.has(tier)) {
    return { label: MEDICATION_FLAG_LABELS.interruptionRisk, tier, sourceIds: [...tierBasis(tier).sourceIds] };
  }
  if (m.interruptionRisk) return { label: MEDICATION_FLAG_LABELS.interruptionRisk, tier: null, sourceIds: [] };
  return null;
}

// ---------- 値の形 ----------

/** 常用薬の表の 1 行 */
export type MedicationRow = {
  name: string;
  category: MedicationCategory;
  /** 区分の名前（その他は空） */
  categoryLabel: string;
  schedule: Cell;
  amount: Cell;
  remaining: Cell;
  storage: Cell;
  mark: InterruptionMark | null;
};

/** 「なぜこの行があるか」の 1 行。画面の脇だけ（紙に出さない） */
export type BasisLine = {
  key: MedicalKey;
  /** 行の名前（ワーファリン・在宅酸素療法（HOT）など） */
  label: string;
  tier: Tier | null;
  why: string;
  sourceIds: ReadonlyArray<SourceId>;
};

/** 台帳の pending と、要約のどの欄に出したか（key が null は欄が無く、下の未確認の一覧だけ） */
export type MedicalPending = { field: string; status: PendingStatus; key: MedicalKey | null; label: string };

export type MedicalConsent = {
  status: ConsentStatus;
  recordedAt: string | null;
  recordedBy: string | null;
  note: string | null;
  /** 台帳の pending（consent.medical）の理由 */
  reason?: PendingStatus;
};

export type MedicalSummary = {
  personId: string;
  name: string;
  /** 作る日（JST、YYYY-MM-DD） */
  today: string;
  /** 台帳の更新の時刻（ISO） */
  ledgerAt: string;
  author: { office: string | null; careManager: string | null };
  consent: MedicalConsent;
  cells: Record<MedicalKey, Cell>;
  medications: MedicationRow[];
  medicalId: MedicalId;
  basis: BasisLine[];
  pending: MedicalPending[];
  /** 範囲の外で出さない欄（医療班・行政の住所・本人の電話。T24）。紙面はその欄を描かない */
  hidden?: MedicalKey[];
};

/** 同意が無ければ要約を作らない。refused は「同意なし」、unconfirmed は「未確認」 */
export type MedicalSummaryResult =
  | { kind: "sheet"; sheet: MedicalSummary }
  | { kind: "refused" | "unconfirmed"; personId: string; name: string; consent: MedicalConsent };

export type MedicalBuildOptions = {
  /** 作る日・年齢を数える日（JST、YYYY-MM-DD） */
  today: string;
  officeName: string | null;
  /**
   * 医療班・行政が開くときの範囲（T24、lib/consent/scope.ts から app/people/[id]/forms/medical が渡す）。
   * partialPeople: 連絡先の人は緊急連絡先だけ名前と電話、支援者は役割名と実施者の番号だけ。関係先はかかりつけ・薬局だけ。
   * hide: 出さない欄（住所・本人の電話）。値は作らず（なし）、未確認の一覧からも落とす。紙面はその欄を描かない
   */
  view?: { partialPeople?: boolean; hide?: readonly MedicalKey[] };
  /**
   * 本人の 1 枚の裏（T37 の 5）で、支援者提供の同意が無い人。表（lib/forms/own-sheet.ts）と同じ扱いにする:
   * 支援者（避難支援等実施者）の名前・電話は出さず「計画で決めた人 実施者 N」。家族は表の「電話」の段にも出るので名前と電話を残し、
   * 実施者の番号だけ外す。要保護者の実施者も「計画で決めた人」。医療班の画面の要約は渡さない（医療班提供の同意に従う）
   */
  supporters?: "planned";
};

/** 支援者提供の同意が無い人の 1 枚の裏で、支援者の名前の代わりに出す言葉（表の「計画で 決めた 人」と同じ） */
export const PLANNED_SUPPORTER = "計画で決めた人";

/** 本人の 1 枚の裏の要約。支援者提供の同意（表と同じ: 同意のときだけ）が無ければ supporters: "planned" で作る */
export function buildOwnSheetMedical(rows: PersonPageRows, opts: Omit<MedicalBuildOptions, "supporters">): MedicalSummaryResult {
  const shared = rows.consents.find((c) => c.kind === "supporters")?.status === "granted";
  return buildMedicalSummary(rows, shared ? opts : { ...opts, supporters: "planned" });
}

/** 人の一部で関係先に残す種類（本人のページの医療の区分の「かかりつけ」と同じ） */
const PARTIAL_OTHER_KINDS: ReadonlySet<Contact["kind"]> = new Set(["home_doctor", "pharmacy"]);

// ---------- 言葉の道具 ----------

const SEP: Piece = sub("／");
const isSep = (p: Piece) => p.sub === true && p.text === "／";

/** 1 行の頭の空の言葉と区切りを落とす */
function trimHead(line: PieceLine): PieceLine {
  let i = 0;
  while (i < line.length && (line[i].text === "" || isSep(line[i]))) i++;
  return line.slice(i);
}

/** 選ぶ欄（様式の □）と、後ろに添える言葉 */
function checks(options: Choice[], after: Piece[] = []): Cell {
  const kept = trimHead(after);
  return kept.length > 0 ? { kind: "choice", options, after: kept } : { kind: "choice", options };
}

/** 文字の値の配列。undefined は未確認（pending の理由つき）、空は「なし」 */
function listCell(v: readonly string[] | undefined, reason: PendingStatus | undefined, emphasize = false): Cell {
  if (v === undefined) return unconfirmed(reason);
  if (v.length === 0) return reason ? unconfirmed(reason) : NONE;
  const pieces = v.map((s) => (emphasize ? strong(s) : t(s)));
  return value(reason ? [...pieces, unconfirmedPiece(reason)] : pieces);
}

/** 様式の選択肢と同じ言葉の物にだけ印を付け、ほかは「その他」の（ ）に。言葉は言い換えない */
function namedChecks(v: readonly string[] | undefined, labels: readonly string[], reason: PendingStatus | undefined): Cell {
  if (v === undefined) return unconfirmed(reason);
  if (v.length === 0) return reason ? unconfirmed(reason) : NONE;
  const rest = v.filter((x) => !labels.includes(x));
  const options: Choice[] = [
    ...labels.map((l) => ({ label: l, on: v.includes(l) })),
    { label: "その他", on: rest.length > 0, detail: rest.length > 0 ? rest.join("・") : undefined },
  ];
  return reason ? { kind: "choice", options, unconfirmed: { reason } } : { kind: "choice", options };
}

const FORMAT_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 「1942 年 4 月 18 日」 */
function seirekiText(iso: string): string {
  const m = FORMAT_DATE.exec(iso);
  return m ? `${Number(m[1])} 年 ${Number(m[2])} 月 ${Number(m[3])} 日` : iso;
}

// ---------- 薬 ----------

const WARFARIN = /ワーファリン|ワルファリン|warfarin/i;

/** 区分ごとの薬の名前と印（特記事項のチェックの後ろに添える） */
function medicationNames(meds: ReadonlyArray<{ m: Medication; mark: InterruptionMark | null }>): Piece[] {
  return joinGroups(meds.map(({ m, mark }) => [strong(m.name), ...(m.schedule ? [sub(m.schedule)] : []), ...(mark ? [strong(mark.label)] : [])]));
}

function remainingCell(clock: Clock | null, reason: PendingStatus | undefined): Cell {
  const v = clock ? clockValue(clock) : null;
  if (!v) {
    const line: PieceLine = [unconfirmedPiece(reason)];
    if (clock?.note) line.push(sub(clock.note));
    return value(line);
  }
  const line: PieceLine = [strong(v)];
  const basis = clock ? clockBasis(clock) : "";
  if (basis) line.push(sub(basis));
  if (clock?.note) line.push(sub(clock.note));
  return value(line);
}

function storageCell(m: Medication): Cell {
  const line: PieceLine = [];
  if (m.storage) line.push(t(m.storage));
  if (m.needsRefrigeration) line.push(strong(MEDICATION_FLAG_LABELS.needsRefrigeration));
  return line.length > 0 ? value(line) : unconfirmed();
}

/** 常用薬の表の行を 1 行の言葉に（欄の値と画面の要約用） */
function medicationRowLine(r: MedicationRow): PieceLine {
  const piecesOf = (c: Cell): Piece[] =>
    c.kind === "value" ? c.lines.flat() : c.kind === "unconfirmed" ? [unconfirmedPiece(c.reason)] : [];
  return joinGroups([
    [strong(r.name), ...(r.categoryLabel ? [sub(r.categoryLabel)] : [])],
    piecesOf(r.schedule),
    [sub("用量"), ...piecesOf(r.amount)],
    [sub("残り"), ...piecesOf(r.remaining)],
    [sub("保管"), ...piecesOf(r.storage)],
    r.mark ? [strong(r.mark.label)] : [],
  ]);
}

// ---------- 連絡先 ----------

/** 様式の連絡先の種類（□家族・□知人・□その他） */
function contactSort(kind: Contact["kind"]): "家族" | "知人" | "その他" {
  if (kind === "family") return "家族";
  if (kind === "supporter") return "知人";
  return "その他";
}

function personLine(c: Contact): PieceLine {
  const line: PieceLine = [...contactName(c)];
  if (c.kind !== "family" && c.kind !== "supporter") line.push(sub(CONTACT_KIND_LABELS[c.kind]));
  if (c.reach) line.push(sub(CONTACT_REACH_LABELS[c.reach]));
  if (c.emergency_order != null) line.push(sub(`緊急連絡 ${c.emergency_order}`));
  if (c.supporter_order != null) line.push(sub(`実施者 ${c.supporter_order}`));
  line.push(sub("TEL"), c.phone ? strong(c.phone) : unconfirmedPiece());
  if (c.note) line.push(sub(c.note));
  return line;
}

/** 支援者の役割名だけの行（人の一部。名前・電話・どこにいるか・備考は出さない） */
function roleLine(c: Contact): PieceLine {
  const relation = c.relation?.trim();
  const line: PieceLine = [strong(relation || CONTACT_KIND_LABELS[c.kind])];
  if (relation && c.kind !== "family" && c.kind !== "supporter") line.push(sub(CONTACT_KIND_LABELS[c.kind]));
  if (c.supporter_order != null) line.push(sub(`実施者 ${c.supporter_order}`));
  return line;
}

const order = (n: number | null) => (n == null ? Number.POSITIVE_INFINITY : n);

// ---------- 組み立て ----------

/** 台帳（本人のページの行）から医療要約を作る。医療班提供の同意が無ければ中身を作らない */
export function buildMedicalSummary(rows: PersonPageRows, opts: MedicalBuildOptions): MedicalSummaryResult {
  const { person } = rows;
  const ledger = parseLedger(person.ledger);
  const consentRow = rows.consents.find((c) => c.kind === "medical");
  const consentReason = ledger.pending.find((p) => under("consent.medical")(p.field))?.status;
  const consent: MedicalConsent = {
    status: consentRow?.status ?? "unconfirmed",
    recordedAt: consentRow?.recorded_at ?? null,
    recordedBy: consentRow?.recorded_by_name ?? null,
    note: consentRow?.note ?? null,
    ...(consentReason ? { reason: consentReason } : {}),
  };
  if (consent.status !== "granted") {
    return { kind: consent.status, personId: person.id, name: person.name, consent };
  }

  const { basic, care, medical, evacuation } = ledger;
  const contacts = [...rows.contacts].sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));
  const clocks = [...rows.clocks].sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));
  const triage = toTriagePerson({ person, ledger, contacts, clocks });

  // ---- pending: 欄に出す物を先に決める。全部は下の未確認の一覧にも出る ----
  const pending: MedicalPending[] = [];
  const placedFields = new Set<string>();
  const take = (key: MedicalKey, match: (field: string) => boolean, label?: string): PendingStatus | undefined => {
    const hit = ledger.pending.filter((p) => !placedFields.has(p.field) && match(p.field));
    for (const p of hit) {
      placedFields.add(p.field);
      pending.push({ field: p.field, status: p.status, key, label: label ?? pendingLabel(p.field) });
    }
    return hit[0]?.status;
  };

  // ---- 機器と薬（計画書と同じ道具。時計は機器 → 薬の順に当てる） ----
  const usedClocks = new Set<string>();
  const deviceOf = (kind: Ledger["medical"]["devices"][number]["kind"]) => medical.devices.filter((d) => d.kind === kind);
  /** 特記事項のチェックの後ろに置く機器の行（頭の機器の名前はチェックの名前と同じなので落とす） */
  const deviceDetail = (kind: Ledger["medical"]["devices"][number]["kind"]): PieceLine[] =>
    deviceOf(kind).map((d) => trimHead(deviceLine(d, clocks, usedClocks).slice(1)));
  const hotLines = deviceDetail("oxygen");
  const dialysisLines = deviceDetail("dialysis");
  const otherDevices = medical.devices.filter((d) => d.kind !== "oxygen" && d.kind !== "dialysis");
  // 経管栄養（段 4）の行には中断注意の印を添える（計画書の機器の行は変えない。医療要約だけ）
  const otherDeviceLines = otherDevices.map((d) => {
    const mark = deviceMark(d.kind);
    const line = deviceLine(d, clocks, usedClocks);
    return mark ? [...line, strong(mark.label)] : line;
  });
  // 機器が台帳に無くても、その区分の時計があれば出す（透析の次の回だけ・酸素の時計だけ）
  const looseClockLines = (category: Clock["category"]): PieceLine[] =>
    clocks
      .filter((k) => k.category === category && !usedClocks.has(k.id))
      .map((k) => {
        usedClocks.add(k.id);
        return clockGroup(k);
      });
  hotLines.push(...looseClockLines("oxygen"));
  dialysisLines.push(...looseClockLines("dialysis"));

  const medClocks = medicationClocks(medical.medications, clocks, usedClocks);
  const medReasons = medical.medications.map((): PendingStatus | undefined => undefined);
  for (const p of ledger.pending) {
    const i = pendingMedicationIndex(p.field, medical.medications, medClocks);
    if (i >= 0 && !placedFields.has(p.field)) {
      placedFields.add(p.field);
      pending.push({ field: p.field, status: p.status, key: "meds.list", label: `${medical.medications[i].name} 残り` });
      medReasons[i] ??= p.status;
    }
  }
  const medications: MedicationRow[] = medical.medications.map((m, i) => {
    const categoryLabel = m.category === "other" || m.name.includes(MEDICATION_CATEGORY_LABELS[m.category]) ? "" : MEDICATION_CATEGORY_LABELS[m.category];
    return {
      name: m.name,
      category: m.category,
      categoryLabel,
      schedule: m.schedule ? value([t(m.schedule)]) : unconfirmed(),
      amount: m.amount ? value([t(m.amount)]) : unconfirmed(),
      remaining: remainingCell(medClocks[i], medReasons[i]),
      storage: storageCell(m),
      mark: interruptionMark(m),
    };
  });
  const medsReason = take("meds.list", under("medical.medications"));
  const withMark = (cats: readonly MedicationCategory[]) =>
    medical.medications
      .map((m, i) => ({ m, mark: medications[i].mark }))
      .filter(({ m }) => cats.includes(m.category));

  const antiplatelet = withMark(["antiplatelet"]);
  const anticoagulant = withMark(["anticoagulant"]);
  const insulin = withMark(["insulin"]);
  const oral = withMark(["oral_diabetes"]);
  const steroid = withMark(["steroid"]);
  const antiepileptic = withMark(["antiepileptic"]);
  const otherMeds = withMark(["other"]);

  const dialysisCenters = contacts.filter((c) => c.kind === "dialysis_center");
  const dialysisOn = dialysisLines.length > 0 || deviceOf("dialysis").length > 0 || dialysisCenters.length > 0;
  const hotOn = hotLines.length > 0 || deviceOf("oxygen").length > 0;
  const devicesReason = take("drug.devices", (f) => under("medical.devices")(f));

  // 機器にも薬にも当たらない時計（栄養剤だけの時計など）。本人の状態の時計（D、走らない。認知症の「信号が当てにならない」）は
  // 安否の信号の読み方の印で医療の値ではないので載せない（認知症は要配慮者の欄に出る）
  const leftoverClockLines = clocks
    .filter((k) => !usedClocks.has(k.id) && k.kind !== "condition")
    .map((k) => joinGroups([clockGroup(k)]));
  const clocksReason = take("meds.notes", (f) => under("clocks")(f));

  // ---- 連絡先 ----
  const self = contacts.filter((c) => c.kind === "self");
  const people = contacts
    .filter((c) => c.kind !== "self" && (c.emergency_order != null || c.supporter_order != null))
    .sort(
      (a, b) =>
        order(a.emergency_order) - order(b.emergency_order) ||
        order(a.supporter_order) - order(b.supporter_order) ||
        a.sort - b.sort,
    );
  const peopleIds = new Set(people.map((c) => c.id));
  const partial = opts.view?.partialPeople === true;
  const others = contacts.filter(
    (c) =>
      c.kind !== "self" && c.kind !== "dialysis_center" && !peopleIds.has(c.id) && (!partial || PARTIAL_OTHER_KINDS.has(c.kind)),
  );
  // 人の一部: 緊急連絡先は名前と電話、緊急連絡先でない支援者は役割名だけ
  const peopleLine = (c: Contact): PieceLine => (partial && c.emergency_order == null ? roleLine(c) : personLine(c));
  // 本人の 1 枚の裏で支援者提供の同意が無い（T37 の 5）: 支援者は「計画で決めた人 実施者 N」、家族は名前と電話のまま実施者の番号を外す
  const planned = opts.supporters === "planned";
  const plannedLine = (c: Contact): PieceLine => [strong(PLANNED_SUPPORTER), sub(`実施者 ${c.supporter_order}`)];
  const peopleLines: PieceLine[] = planned
    ? [
        ...people
          .filter((c) => c.supporter_order == null || c.kind === "family")
          .map((c) => personLine({ ...c, supporter_order: null })),
        ...people
          .filter((c) => c.supporter_order != null)
          .sort((a, b) => order(a.supporter_order) - order(b.supporter_order))
          .map(plannedLine),
      ]
    : people.map(peopleLine);
  const hasDoctor = contacts.some((c) => c.kind === "home_doctor");
  const doctorReason = take("contact.others", under("medical.doctor"), "かかりつけ");
  const peopleReason = take(
    "contact.people",
    (f) => under("people.emergency")(f) || under("people.family")(f) || under("people.supporter1")(f) || under("people.supporter2")(f),
  );
  const sorts = new Set(people.map((c) => contactSort(c.kind)));
  const otherLines: PieceLine[] = others.map(personLine);
  if (!hasDoctor) otherLines.push([sub("かかりつけ"), unconfirmedPiece(doctorReason)]);

  // ---- 患者 ----
  const age = person.birth_date ? ageOn(person.birth_date, opts.today) : null;
  const birthW = person.birth_date ? wareki(person.birth_date) : null;
  const birthReason = take("patient.birth", under("basic.birth"));
  const sexReason = take("patient.sex", under("basic.sex"));
  const addressReason = take("patient.address", under("basic.address"));
  const phoneReason = take("patient.phone", under("basic.contactMeans"));
  const housingReason = take("patient.dwelling", (f) => under("basic.housing")(f) || under("evacuation.hazards")(f));
  const means = basic.contactMeans;
  const phoneCell: Cell =
    self.some((c) => c.phone)
      ? value(...self.filter((c) => c.phone).map((c) => [strong(c.phone!), ...(c.note ? [sub(c.note)] : [])]))
      : means && means.landline === false && means.mobile === false
        ? NONE
        : unconfirmed(phoneReason);

  const housing = basic.housing;
  const housingParts: string[] = [];
  if (housing?.structure) housingParts.push(STRUCTURE_LABELS[housing.structure]);
  if (housing?.floors != null) housingParts.push(housing.floors === 1 ? "平屋" : `${housing.floors} 階建`);
  if (housing?.floor != null) housingParts.push(`${housing.floor} 階に住む`);
  if (housing?.builtYear != null) housingParts.push(`${housing.builtYear} 年築`);
  const hazardPieces: Piece[] = evacuation.hazards.map((h) =>
    strong(h.depthM != null ? `${HAZARD_LABELS[h.kind]} ${h.depthM} m` : HAZARD_LABELS[h.kind]),
  );
  const dwelling: Cell = value(
    housingParts.length > 0 ? [t(housingParts.join("・"))] : [unconfirmedPiece(housingReason)],
    [sub("ハザード"), ...(hazardPieces.length > 0 ? hazardPieces : [t(BLANK.none)])],
  );

  // ---- 避難先（計画） ----
  const firstReason = take("shelter.first", (f) => under("evacuation.destination1")(f) || under("evacuation.transport")(f));
  const secondReason = take("shelter.second", under("evacuation.destination2"));
  const first: Cell = evacuation.destination1
    ? value([
        strong(evacuation.destination1),
        ...(evacuation.transport ? [sub("移動"), t(evacuation.transport)] : [sub("移動"), unconfirmedPiece()]),
      ])
    : unconfirmed(firstReason);
  const second: Cell = evacuation.destination2 ? value([strong(evacuation.destination2)]) : unconfirmed(secondReason);

  // ---- 禁忌・既往・予防接種 ----
  const allergyReason = take("contra.allergy", under("medical.allergies"));
  const historyReason = take("history.disease", under("medical.history"));
  const vaccinationReason = take("history.vaccination", under("medical.vaccinations"));
  const carryReason = take("meds.carry", under("evacuation.carryItems"), "持出品");

  // ---- 要配慮者・要保護者 ----
  const careReason = take("care.vulnerable", under("care"));
  const careLevel = care.careLevel;
  const elderly = age !== null && age >= 65;
  const handbook = care.handbook ?? "";
  const otherCare = (careLevel !== undefined && !elderly) || Boolean(care.intractableDisease);
  const otherCareDetail = [!elderly && careLevel ? CARE_LEVEL_LABELS[careLevel] : "", care.intractableDisease ?? ""]
    .filter(Boolean)
    .join("・");
  const vulnerable = elderly || handbook !== "" || otherCare || careLevel !== undefined || triage.dementia || triage.bedridden;
  const facts: Piece[] = [];
  if (careLevel) facts.push(strong(CARE_LEVEL_LABELS[careLevel]));
  if (basic.household) facts.push(basic.household === "alone" ? strong(HOUSEHOLD_LABELS.alone) : t(HOUSEHOLD_LABELS[basic.household]));
  if (triage.dementia) facts.push(strong("認知症"));
  if (care.bedridden) facts.push(strong("寝たきり"));
  if (care.walking && care.walking !== "ok") facts.push(sub("歩行"), t(ABILITY_LABELS[care.walking]));
  if (handbook) facts.push(sub("手帳"), t(handbook));
  if (careReason) facts.push(unconfirmedPiece(careReason));
  const vulnerableCell = checks(
    [
      { label: "災害時要配慮者", on: vulnerable },
      { label: "高齢者", on: elderly },
      { label: "障害者", on: handbook !== "" },
      { label: "乳幼児", on: false },
      { label: "妊婦", on: false },
      { label: "日本語が不自由", on: false },
      { label: "その他", on: otherCare, detail: otherCare && otherCareDetail ? otherCareDetail : undefined },
    ],
    facts,
  );
  const supporters = contacts
    .filter((c) => c.supporter_order != null)
    .sort((a, b) => order(a.supporter_order) - order(b.supporter_order));
  const noSupporter = !triage.hasSupporter;
  // 該当状況（身体的・精神的・社会的）は医療班が書く欄なので印を付けない。事実（実施者の有無）だけ添える
  const protectCell = checks(
    [{ label: "支援者のいない要配慮者等", on: vulnerable && noSupporter }],
    [
      sub("実施者"),
      // 人の一部（T24）: 緊急連絡先でない実施者は役割名だけ。本人の 1 枚の裏で支援者提供の同意が無ければ「計画で決めた人」（T37 の 5）
      ...(supporters.length === 0
        ? [strong(BLANK.none)]
        : planned
          ? [strong(PLANNED_SUPPORTER)]
          : joinGroups(supporters.map((c) => (partial && c.emergency_order == null ? roleLine(c).slice(0, 1) : contactName(c))))),
    ],
  );

  // ---- メディカル ID ----
  const mid = medicalId({ birthDate: person.birth_date, sex: basic.sex, kana: person.kana });

  // ---- 欄の値 ----
  const cells: Record<MedicalKey, Cell> = {
    "patient.kana": person.kana ? value([strong(person.kana)]) : unconfirmed(),
    "patient.name": person.name ? value([strong(person.name)]) : unconfirmed(),
    "patient.birth": person.birth_date
      ? value([
          strong(seirekiText(person.birth_date)),
          ...(birthW ? [sub(`${birthW.era} ${warekiDate(birthW)}`)] : []),
          ...(age !== null ? [t(`${age} 歳`)] : []),
        ])
      : unconfirmed(birthReason),
    "patient.sex": basic.sex
      ? checks(
          [
            { label: "男", on: basic.sex === "male" },
            { label: "女", on: basic.sex === "female" },
          ],
          basic.sex === "other" ? [t("その他")] : [],
        )
      : unconfirmed(sexReason),
    "patient.phone": phoneCell,
    "patient.house": {
      kind: "choice",
      options: [
        { label: "健存", on: false },
        { label: "半壊", on: false },
        { label: "全壊", on: false },
      ],
      unconfirmed: {},
    },
    "patient.dwelling": dwelling,
    "patient.address": basic.address ? value([t(`${basic.address.city} ${basic.address.town}`)]) : unconfirmed(addressReason),
    "shelter.first": first,
    "shelter.second": second,
    "contact.kinds": checks([
      { label: "家族", on: sorts.has("家族") },
      { label: "知人", on: sorts.has("知人") },
      { label: "その他", on: sorts.has("その他") },
      { label: "連絡先なし", on: people.length === 0 },
    ]),
    "contact.people": people.length > 0 ? value(...peopleLines, ...(peopleReason ? [[unconfirmedPiece(peopleReason)]] : [])) : unconfirmed(peopleReason),
    "contact.others": otherLines.length > 0 ? value(...otherLines) : NONE,
    "contra.allergy": listCell(medical.allergies, allergyReason, true),
    "contra.food": unconfirmed(),
    "drug.antiplatelet": checks([{ label: "抗血小板薬", on: antiplatelet.length > 0 }], medicationNames(antiplatelet)),
    "drug.anticoagulant": checks(
      [
        { label: "抗凝固薬", on: anticoagulant.length > 0 },
        { label: "ワーファリン", on: anticoagulant.some(({ m }) => WARFARIN.test(m.name)) },
      ],
      medicationNames(anticoagulant),
    ),
    "drug.diabetes": checks(
      [
        { label: "糖尿病治療薬", on: insulin.length + oral.length > 0 },
        { label: "インスリン", on: insulin.length > 0 },
        { label: "経口薬", on: oral.length > 0 },
      ],
      medicationNames([...insulin, ...oral]),
    ),
    "drug.steroid": checks([{ label: "ステロイド", on: steroid.length > 0 }], medicationNames(steroid)),
    "drug.antiepileptic": checks([{ label: "抗てんかん薬", on: antiepileptic.length > 0 }], medicationNames(antiepileptic)),
    "drug.other": checks([{ label: "その他", on: otherMeds.length > 0 }], medicationNames(otherMeds)),
    "drug.dialysis": checks(
      [{ label: "透析", on: dialysisOn }],
      joinGroups([...dialysisLines, ...dialysisCenters.map((c) => [sub("透析先"), ...personLine(c)])]),
    ),
    "drug.hot": checks([{ label: "在宅酸素療法（HOT）", on: hotOn }], joinGroups(hotLines)),
    "drug.devices":
      otherDeviceLines.length > 0
        ? value(...otherDeviceLines, ...(devicesReason ? [[unconfirmedPiece(devicesReason)]] : []))
        : devicesReason
          ? unconfirmed(devicesReason)
          : NONE,
    "meds.list":
      medications.length > 0
        ? value(...medications.map(medicationRowLine), ...(medsReason ? [[unconfirmedPiece(medsReason)]] : []))
        : medsReason
          ? unconfirmed(medsReason)
          : NONE,
    "meds.carry": listCell(evacuation.carryItems, carryReason),
    "meds.notes":
      ledger.notes.length + leftoverClockLines.length > 0
        ? value(
            ...ledger.notes.map((n) => [raw(n)]),
            ...leftoverClockLines,
            ...(clocksReason ? [[unconfirmedPiece(clocksReason)]] : []),
          )
        : clocksReason
          ? unconfirmed(clocksReason)
          : NONE,
    "care.vulnerable": vulnerableCell,
    "care.protect": protectCell,
    "history.disease": namedChecks(medical.history, ["高血圧", "糖尿病", "喘息"], historyReason),
    "history.vaccination": namedChecks(
      medical.vaccinations,
      ["麻疹", "破傷風", "今期インフルエンザ", "肺炎球菌", "風疹"],
      vaccinationReason,
    ),
    "id.medical": mid.id
      ? value([strong(mid.id)])
      : value([unconfirmedPiece(), sub(mid.missing.map((m) => MEDICAL_ID_PART_LABELS[m]).join("・"))]),
  };

  // 欄の無い pending（夜間支援・同意など）も全部、下の未確認の一覧に出す
  for (const p of ledger.pending) {
    if (!placedFields.has(p.field)) {
      placedFields.add(p.field);
      pending.push({ field: p.field, status: p.status, key: null, label: pendingLabel(p.field) });
    }
  }

  // ---- なぜこの行があるか（画面の脇だけ） ----
  // 同じ段は 1 行にまとめ、行の名前を「・」でつなぐ（ワーファリン・ステロイド）
  const basis: BasisLine[] = [];
  const tierLine = (key: MedicalKey, label: string, tier: Tier | null) => {
    if (tier === null) return;
    const same = basis.find((b) => b.tier === tier);
    if (same) {
      if (!same.label.split("・").includes(label)) same.label = `${same.label}・${label}`;
      return;
    }
    const b = tierBasis(tier);
    basis.push({ key, label, tier, why: b.why, sourceIds: [...b.sourceIds] });
  };
  if (dialysisOn) tierLine("drug.dialysis", medicalField("drug.dialysis").label, categoryTier("dialysis"));
  if (hotOn) tierLine("drug.hot", medicalField("drug.hot").label, categoryTier("oxygen"));
  for (const d of otherDevices) tierLine("drug.devices", DEVICE_LABELS[d.kind], categoryTier(d.kind));
  for (const r of medications) if (r.mark?.tier != null) tierLine("meds.list", r.name, r.mark.tier);
  if (triage.dementia && triage.livesAlone) tierLine("care.vulnerable", "認知症・独居", 6);
  if (triage.bedridden && noSupporter) tierLine("care.protect", "支援者のいない要配慮者等", 7);
  basis.sort((a, b) => fieldIndex(a.key) - fieldIndex(b.key) || (a.tier ?? 9) - (b.tier ?? 9));

  // 医療班・行政の範囲（T24）: 出さない欄は値を作らず、未確認の一覧は要約の欄に出した物だけ（欄の無い物・出さない欄の物は落とす）
  const hide = opts.view?.hide ?? [];
  for (const k of hide) cells[k] = NONE;
  const shownPending = opts.view ? pending.filter((p) => p.key !== null && !hide.includes(p.key)) : pending;

  return {
    kind: "sheet",
    sheet: {
      personId: person.id,
      name: person.name,
      today: opts.today,
      ledgerAt: person.updated_at,
      author: { office: opts.officeName, careManager: rows.careManagerName },
      consent,
      cells,
      medications,
      medicalId: mid,
      basis,
      pending: shownPending,
      ...(hide.length > 0 ? { hidden: [...hide] } : {}),
    },
  };
}

const FIELD_INDEX = new Map<string, number>(MEDICAL_FIELDS.map((f, i) => [f.key, i]));
function fieldIndex(key: MedicalKey): number {
  return FIELD_INDEX.get(key) ?? MEDICAL_FIELDS.length;
}

/** 欄の順の根拠（画面の脇の 1 行目）。新しい文は足さず、登録簿の出典を指すだけ */
export const FORM_ORDER_BASIS = {
  label: "欄の順",
  why: "災害診療記録 2018 の 1 頁の順（既往症・予防接種は 2 頁）",
  sourceIds: [SAIGAI_KIROKU_SOURCE] as ReadonlyArray<SourceId>,
} as const;
