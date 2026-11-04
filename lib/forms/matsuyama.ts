// 松山市「避難行動要支援者名簿登録申込書 兼 個別避難計画」（様式【2026.9.10】、A4 表裏の 2 ページ）の欄の一覧と差し込み。
// 欄の名前と順は市の PDF（MATSUYAMA_FORM_URL。リポジトリに入れない）から起こした。罫線の位置は真似しない。
// 差し込みは台帳（lib/person.ts の loadPersonPage の行）から、サーバーの描画で。Claude は呼ばない（氏名・住所・電話が入る）。
//
// 決まり:
// - 空欄は「未確認」と印刷する（計画に残し、次の訪問の問いにする）。台帳の pending（不明・未聴取・無回答）はその欄に理由を添える
// - 台帳に項目の無い欄も「未確認」。手で書く欄（番号・自署・代理人・市受付印）だけは空ける
// - 同意 4 つ: 様式の 2 つの問いは名簿登録・計画共有から。実施者ごとの同意※は支援者提供から、組織の同意※は計画共有から
//   （docs/DECISIONS.md「仮名化・同意・個人情報」）
// - 同意のない範囲は落とす（印刷しない）: 支援者提供 → 実施者 1・2 と夜間支援、
//   計画共有 → 実施組織と医療の欄（かかりつけ医・薬局、医薬品情報、特記の医療、別紙）
// - 医療班提供は様式に効かない（医療班の要約 T07 と QR の頁 T16 にだけ効く。docs/DECISIONS.md「仮名化・同意・個人情報」）
// - 台帳にある値は余さず差し込む。様式に欄の無い値（機器と時計、緊急連絡先の 2 人目から、持出品など）は特記事項に
// - 居ない人の欄は、実施者・近親者の 1 人目の氏名だけ「なし」。ほかの欄と 2 人目からの欄・値の無い特記の段は空き枠（EMPTY。T111）

import { ageOn } from "../age.ts";
import {
  SUPPORT_KINDS,
  type ClockRow,
  type ConsentKind,
  type ConsentStatus,
  type DeviceKind,
  type Ledger,
  type MedicationCategory,
  type PendingStatus,
  type SupportKind,
} from "../db/types.ts";
import { parseLedger } from "../db/ledger.ts";
import {
  ABILITY_ITEM_LABELS,
  ABILITY_LABELS,
  CARE_LEVEL_LABELS,
  CHECK_STATUS_LABELS,
  CLOCK_SOURCE_LABELS,
  CLOCK_START_LABELS,
  CLOCK_UNIT_LABELS,
  CONSENT_KIND_LABELS,
  CONTACT_FLAG_LABELS,
  CONTACT_KIND_LABELS,
  CONTACT_REACH_LABELS,
  DEPENDS_ON_LABELS,
  DEVICE_LABELS,
  HOUSEHOLD_LABELS,
  hazardText,
  householdText,
  MEDICATION_CATEGORY_LABELS,
  MEDICATION_FLAG_LABELS,
  PENDING_STATUS_LABELS,
  SMARTPHONE_LABELS,
  STRUCTURE_LABELS,
} from "../labels.ts";
import { ROUTE_FRAME, routeSceneOf } from "../map/route-image.ts";
import { formatJst, FIELDS as PAGE_FIELDS, type PersonPageRows } from "../person.ts";
import { ERAS, wareki, warekiDate, warekiText } from "./wareki.ts";
import { transportText } from "../map/transport.ts";

/** 市の PDF（2026.9.10 版）。開いて照らすためのリンクだけ持つ */
export const MATSUYAMA_FORM_URL =
  "https://www.city.matsuyama.ehime.jp/kurashi/fukushi/shogai/hinankodo/kobetsuhinannkeikaku.files/R8.9.10keikaku.pdf";

export const MATSUYAMA_FORM_VERSION = "2026.9.10";

/**
 * 様式に刷ってある文（題・あて先・段の注・同意の問い・注意書き）。市の PDF の字のまま（11/3 T47 で照合。前は短く言い換えていた）。
 * 紙面（components/forms/MatsuyamaSheet.tsx）はここから出し、照合の表（lib/forms/form-audit.ts）も同じ物を指す
 */
export const MATSUYAMA_TEXTS = {
  version: `（様式【${MATSUYAMA_FORM_VERSION}】）`,
  title: "松山市避難行動要支援者名簿登録申込書 兼 個別避難計画",
  to: "（あて先）松山市長",
  consentRegistry:
    "災害時の救援活動等に役立てるため、市が作成する避難行動要支援者名簿に登録し、上記事項を平常時から避難支援等関係者（消防機関、警察、民生児童委員、市社会福祉協議会、自主防災組織等の避難支援の実施に携わる者）へ提供することに同意しますか？",
  consentPlanShare:
    "災害の発生のおそれがある時又は災害が発生した時に円滑な避難を行うための個別避難計画を作成し、避難支援等関係者と事前に共有することに同意しますか？",
  confirmed: "上記内容を確認し、了承しています。",
  proxyNote: "（やむを得ない理由により本人が記入できない場合）",
  kinNote: "（安否確認ができたときの連絡先）",
  supportersHead: "避難支援等実施者(近隣協力員)",
  supportersNote: "避難支援等の実施に法的な責任や義務を負うものではありません。",
  orgNote: "※避難支援等実施者がいない場合、自治会や自主防災組織等の支援組織を記入します。",
  supporterConsentNote:
    "※…避難支援等実施者(近隣協力員)の同意：この個別避難計画は、避難行動要支援者と避難支援に関わる関係者との話し合いの上で作成し、上記事項を平常時から避難支援等関係者へ提供することに同意します。",
  preNote: "（親戚宅や近くの安全な場所等）",
  notesNote: "（リスクや課題への対応、具体的な支援方法、医療・福祉サービスの利用状況など）",
  routeNote: "※地図上または箇条書き等で避難経路を記入してください。",
  footPrepare: "※自宅でできる防災訓練の実施や各地域の防災訓練への参加、物資を備蓄しておくなど、平常時からできる範囲で災害に備えることも重要です。",
  footNoGuarantee:
    "※この個別避難計画は、災害が発生し、または発生するおそれが高まったときに、要支援者が避難するために必要な情報をまとめたものです。災害等での避難支援がなされることを保証するものではなく、関係者に法的な責任や義務を負わせるものではありません。",
  footUse:
    "この申込書に記載する情報は、災害発生時に地域の支援等により生命等の安全を図るためのものであり、それ以外の用途に使用することを禁止します。",
  mayor: "松山市長",
} as const;

/** 支援の内容の選択肢の様式の言葉（台帳は SUPPORT_KINDS、本人のページは短い SUPPORT_KIND_LABELS） */
const SUPPORT_SHEET_LABELS: Record<SupportKind, string> = {
  call: "避難の声掛け",
  guide: "避難の誘導",
  assist: "移動介助",
  other: "その他",
};

// ---------- 欄の一覧 ----------

/** 様式の段。ページの上から順 */
export const MATSUYAMA_BLOCKS = {
  head: "表題",
  target: "対象者",
  local: "地域の支援者",
  consent: "同意",
  sign: "署名",
  kin: "近親者及緊急時の連絡先",
  supporter1: "避難支援等実施者１",
  supporter2: "避難支援等実施者２",
  org: "避難支援等実施組織",
  plan: "計画作成者・医療",
  risk: "自宅のリスク",
  shelter: "私の避難場所",
  housing: "住居",
  support: "支援の内容",
  notes: "特記事項",
  route: "避難経路",
  city: "受付",
} as const;
export type MatsuyamaBlock = keyof typeof MATSUYAMA_BLOCKS;

/**
 * 値の形。text 文字・date 日付（和暦）・choice 選ぶ（様式の □）・phone 電話・consent 同意・lines 何行か・handwrite 手で書く（空ける）
 */
export type FieldShape = "text" | "date" | "choice" | "phone" | "consent" | "lines" | "handwrite";

export type MatsuyamaFieldDef = {
  key: string;
  page: 1 | 2;
  block: MatsuyamaBlock;
  /** 様式の欄の名前（様式の字のまま。照合は lib/forms/form-audit.ts）。様式に名前の無い欄は、ケア72 が付けた呼び名 */
  label: string;
  /** 台帳のどこから。台帳に項目の無い欄は NO_SOURCE、手で書く欄は HANDWRITE */
  source: string;
  shape: FieldShape;
  /** 選ぶ欄の選択肢（様式の字と順） */
  options?: readonly string[];
  /** 様式に欄の名前が無い（□ の並びだけ・空の行）。紙面に名前を出さない */
  unnamed?: true;
  /** 様式に無い欄（台帳の値を余さず載せるために足した）。紙面では特記事項の書き込みの中に出す */
  extra?: true;
};

const NO_SOURCE = "台帳に無い";
const HANDWRITE = "手書き";
const SUPPORTER_SOURCE = (n: 1 | 2) => `contacts（実施者 ${n}: supporter_order = ${n}）`;
const CONSENT_OPTIONS = ["同意する", "同意しない"] as const;
const MARK_OPTIONS = ["同意", "不同意"] as const;

function supporterFields(n: 1 | 2) {
  const block = `supporter${n}` as const;
  const src = SUPPORTER_SOURCE(n);
  return [
    { key: `${block}.kana`, page: 1, block, label: "フリガナ", source: NO_SOURCE, shape: "text" },
    { key: `${block}.name`, page: 1, block, label: "氏名", source: `${src}.name`, shape: "text" },
    { key: `${block}.address`, page: 1, block, label: "住所", source: `${src}.reach（住所は持たない）`, shape: "text" },
    { key: `${block}.phone`, page: 1, block, label: "電話番号", source: `${src}.phone`, shape: "phone" },
    { key: `${block}.mobile`, page: 1, block, label: "携帯番号", source: `${src}.phone（備考が携帯）`, shape: "phone" },
    {
      key: `${block}.relation`,
      page: 1,
      block,
      label: "関係",
      source: `${src}.relation・kind・車・夜間・emergency_order`,
      shape: "lines",
    },
    {
      key: `${block}.consent`,
      page: 1,
      block,
      label: "同意※",
      source: "consents.supporters（支援者提供）",
      shape: "consent",
      options: MARK_OPTIONS,
    },
  ] as const;
}

function shelterFields(id: "pre" | "near" | "city", label: string, source: string, means: string) {
  const block = "shelter" as const;
  return [
    { key: `shelter.${id}.place`, page: 2, block, label, source, shape: "text" },
    { key: `shelter.${id}.means`, page: 2, block, label: "【手段】", source: means, shape: "choice", options: ["徒歩", "その他"] },
    { key: `shelter.${id}.minutes`, page: 2, block, label: "【時間】", source: NO_SOURCE, shape: "text" },
  ] as const;
}

/** 欄の一覧（様式の順）。画面の紙面とテストはここから全部を出す */
export const MATSUYAMA_FIELDS = [
  // ---- 1 ページ（表） ----
  { key: "head.number", page: 1, block: "head", label: "番号", source: HANDWRITE, shape: "handwrite", unnamed: true },
  { key: "head.date", page: 1, block: "head", label: "年月日作成", source: "印刷する日（JST）", shape: "date" },
  { key: "target.kana", page: 1, block: "target", label: "フリガナ", source: "people.kana", shape: "text" },
  { key: "target.name", page: 1, block: "target", label: "氏名", source: "people.name", shape: "text" },
  {
    key: "target.sex",
    page: 1,
    block: "target",
    label: "性別",
    source: "ledger.basic.sex",
    shape: "choice",
    options: ["男", "女"],
    unnamed: true,
  },
  {
    key: "target.birth",
    page: 1,
    block: "target",
    label: "生年月日",
    source: "people.birth_date（和暦）",
    shape: "date",
    options: ERAS,
  },
  { key: "target.district", page: 1, block: "target", label: "地区", source: "ledger.basic.address.town", shape: "text" },
  {
    key: "target.address",
    page: 1,
    block: "target",
    label: "住所",
    source: "ledger.basic.address（市・町名。番地は持たない）",
    shape: "text",
  },
  {
    key: "target.phone",
    page: 1,
    block: "target",
    label: "電話番号",
    source: "contacts（本人・固定電話）、ledger.basic.contactMeans.landline",
    shape: "phone",
  },
  {
    key: "target.mobile",
    page: 1,
    block: "target",
    label: "携帯番号",
    source: "contacts（本人・携帯）、ledger.basic.contactMeans.mobile",
    shape: "phone",
  },
  {
    key: "target.category",
    page: 1,
    block: "target",
    label: "区分",
    source: "年齢・ledger.basic.household・ledger.care.careLevel・handbook・intractableDisease",
    shape: "choice",
    options: ["高齢者", "障がい者", "難病患者", "小児慢性特定疾病児童", "その他"],
    unnamed: true,
  },
  // 地域の支援者の 5 行は区分の右に並ぶ（様式の読む順で区分の次、世帯の前）
  {
    key: "local.welfare",
    page: 1,
    block: "local",
    label: "民生・児童委員",
    source: "contacts（民生委員）",
    shape: "lines",
  },
  { key: "local.watcher", page: 1, block: "local", label: "みまもり員", source: "ledger.local.watcher", shape: "lines" },
  {
    key: "local.office",
    page: 1,
    block: "local",
    label: "事業所等",
    source: "contacts（訪問看護・介護事業所）",
    shape: "lines",
  },
  {
    key: "local.other",
    page: 1,
    block: "local",
    label: "その他",
    source: "contacts（市役所・実施者でない支援者）",
    shape: "lines",
    unnamed: true,
  },
  {
    key: "target.household",
    page: 1,
    block: "target",
    label: "世帯",
    source: "ledger.basic.household",
    shape: "choice",
    options: ["ひとり暮らし", "日中ひとり", "高齢者のみ", "障がい者等のみ", "その他"],
  },
  {
    key: "target.timeline",
    page: 1,
    block: "target",
    label: "マイ・タイムラインの作成",
    source: "ledger.evacuation.myTimeline",
    shape: "choice",
    options: ["あり（アプリ・紙）", "なし"],
  },
  {
    key: "consent.registry",
    page: 1,
    block: "consent",
    label: "名簿登録と平常時からの提供",
    source: "consents.registry（名簿登録）",
    shape: "consent",
    options: CONSENT_OPTIONS,
    unnamed: true,
  },
  {
    key: "consent.planShare",
    page: 1,
    block: "consent",
    label: "個別避難計画の作成と事前の共有",
    source: "consents.plan_share（計画共有）",
    shape: "consent",
    options: CONSENT_OPTIONS,
    unnamed: true,
  },
  { key: "sign.self", page: 1, block: "sign", label: "本人：氏名（自署）", source: HANDWRITE, shape: "handwrite" },
  {
    key: "sign.proxy",
    page: 1,
    block: "sign",
    label: "代理人：氏名（続柄）連絡先：",
    source: HANDWRITE,
    shape: "handwrite",
  },
  { key: "kin.kana", page: 1, block: "kin", label: "フリガナ", source: NO_SOURCE, shape: "text" },
  { key: "kin.name", page: 1, block: "kin", label: "氏名", source: "contacts（緊急連絡先 1）.name", shape: "text" },
  { key: "kin.relation", page: 1, block: "kin", label: "続柄", source: "contacts（緊急連絡先 1）.relation", shape: "text" },
  { key: "kin.phone", page: 1, block: "kin", label: "電話番号", source: "contacts（緊急連絡先 1）.phone", shape: "phone" },
  {
    key: "kin.mobile",
    page: 1,
    block: "kin",
    label: "携帯番号",
    source: "contacts（緊急連絡先 1）.phone（備考が携帯）",
    shape: "phone",
  },
  {
    key: "kin.address",
    page: 1,
    block: "kin",
    label: "住所",
    source: "contacts（緊急連絡先 1）.reach（住所は持たない）",
    shape: "text",
  },
  ...supporterFields(1),
  ...supporterFields(2),
  { key: "org.name", page: 1, block: "org", label: "組織・団体名称", source: NO_SOURCE, shape: "text" },
  { key: "org.phone", page: 1, block: "org", label: "電話番号", source: NO_SOURCE, shape: "phone" },
  {
    key: "org.consent",
    page: 1,
    block: "org",
    label: "同意※",
    source: "consents.plan_share（計画共有）",
    shape: "consent",
    options: MARK_OPTIONS,
  },

  // ---- 2 ページ（裏） ----
  {
    key: "plan.author",
    page: 2,
    block: "plan",
    label: "計画作成者・団体",
    source: "offices.name・担当のケアマネ",
    shape: "text",
  },
  {
    key: "medical.doctor",
    page: 2,
    block: "plan",
    label: "かかりつけ医・薬局",
    source: "contacts（かかりつけ・薬局）",
    shape: "lines",
  },
  {
    key: "medical.drugs",
    page: 2,
    block: "plan",
    label: "医薬品情報",
    source: "ledger.medical.medications・clocks（薬の残り）",
    shape: "lines",
  },
  {
    key: "risk.home",
    page: 2,
    block: "risk",
    label: "自宅のリスク（複数選択可）",
    source: "ledger.evacuation.hazards",
    shape: "choice",
    options: ["土砂災害", "洪水", "高潮", "津波", "地震"],
  },
  {
    key: "risk.timing",
    page: 2,
    block: "risk",
    label: "避難のタイミング",
    source: "ハザードがあればレベル３（既定）",
    shape: "choice",
    options: ["自主避難", "レベル３高齢者等避難"],
  },
  {
    key: "risk.issues",
    page: 2,
    block: "risk",
    label: "避難にあたっての課題",
    source: "ledger.care（6 項目・寝たきり・認知症）・ledger.evacuation.barriers",
    shape: "lines",
  },
  ...shelterFields("pre", "事前避難場所", "ledger.evacuation.destination2", NO_SOURCE),
  ...shelterFields("near", "最寄りの避難場所", NO_SOURCE, NO_SOURCE),
  ...shelterFields("city", "市指定避難所", "ledger.evacuation.destination1", "ledger.evacuation.transport"),
  {
    key: "housing.type",
    page: 2,
    block: "housing",
    label: "【種別】",
    source: NO_SOURCE,
    shape: "choice",
    options: ["戸建住宅", "共同住宅"],
  },
  {
    key: "housing.structure",
    page: 2,
    block: "housing",
    label: "構造",
    source: "ledger.basic.housing.structure・builtYear",
    shape: "choice",
    options: ["木造", "その他"],
    unnamed: true,
  },
  {
    key: "housing.floors",
    page: 2,
    block: "housing",
    label: "【階層】",
    source: "ledger.basic.housing.floors",
    shape: "choice",
    options: ["平屋", "２階建", "３階建以上"],
  },
  {
    key: "housing.room",
    page: 2,
    block: "housing",
    label: "普段いる部屋",
    source: "ledger.basic.housing.floor",
    shape: "text",
  },
  { key: "housing.bedroom", page: 2, block: "housing", label: "寝室", source: "ledger.basic.housing.bedroom", shape: "text" },
  {
    key: "support.kinds",
    page: 2,
    block: "support",
    label: "支援の内容（複数選択可）",
    source: "ledger.evacuation.support・supportNote",
    shape: "choice",
    options: ["避難の声掛け", "避難の誘導", "移動介助", "その他"],
  },
  // 特記事項は様式では 1 つの書き込みの欄。中を 医療・本人の言葉・夜間支援・その他 の段に分けて書く（段の名前はケア72 の物）
  {
    key: "notes.medical",
    page: 2,
    block: "notes",
    label: "医療",
    source: "ledger.medical.devices・clocks・contacts（透析施設）・allergies・history・vaccinations",
    shape: "lines",
  },
  { key: "notes.words", page: 2, block: "notes", label: "本人の言葉", source: "ledger.notes（そのまま）", shape: "lines" },
  {
    key: "notes.other",
    page: 2,
    block: "notes",
    label: "その他",
    source: "carryItems・pets・連絡手段・本人報告・様式に載らない連絡先・欄の無い pending",
    shape: "lines",
  },
  // 夜間支援は様式に欄が無い（前は実施者の段の中に行を足していた）。特記事項の書き込みの中に出す
  {
    key: "supporter.night",
    page: 2,
    block: "notes",
    label: "夜間支援",
    source: "contacts.night_ok",
    shape: "lines",
    extra: true,
  },
  {
    key: "notes.annex",
    page: 2,
    block: "notes",
    label: "別紙",
    source: "consents.plan_share（計画共有）と 薬・機器（別紙は医療要約、T07）",
    shape: "choice",
    options: ["あり", "なし"],
  },
  { key: "route.text", page: 2, block: "route", label: "避難経路", source: "ledger.evacuation.route", shape: "lines" },
  {
    key: "route.map",
    page: 2,
    block: "route",
    label: "まつやま総合防災マップからの引用",
    source: NO_SOURCE,
    shape: "choice",
    options: ["あり", "なし"],
  },
  { key: "city.stamp", page: 2, block: "city", label: "市受付印", source: HANDWRITE, shape: "handwrite" },
] as const satisfies readonly MatsuyamaFieldDef[];

export type MatsuyamaKey = (typeof MATSUYAMA_FIELDS)[number]["key"];

const FIELD_BY_KEY = new Map<string, MatsuyamaFieldDef>(MATSUYAMA_FIELDS.map((f) => [f.key, f]));

export function matsuyamaField(key: MatsuyamaKey): MatsuyamaFieldDef {
  return FIELD_BY_KEY.get(key)!;
}

// ---------- 値の形 ----------

/**
 * 1 つの言葉。sub は小さく添える（続柄・出典）、strong は大きく（名前・場所・薬）、unconfirmed は「未確認」（reason は台帳の pending）。
 * raw は本人の言葉（台帳の特記）で、紙でも書き方を直さない（数字と単位を詰めない。lib/forms/paper-text.ts）
 */
export type Piece = {
  text: string;
  sub?: true;
  strong?: true;
  unconfirmed?: true;
  reason?: PendingStatus;
  raw?: true;
};
export type PieceLine = Piece[];

/** 選ぶ欄の 1 つ。on は ■、detail は（ ）の中、sub は中の選択肢（高齢者 → 独居・要介護） */
export type Choice = { label: string; on: boolean; detail?: string; sub?: Choice[] };

/**
 * 欄の値。none は「なし」（居ない・無いと分かっている）、empty は空き枠（T111。刷らない・未確認に数えない・色付けで塗らない）:
 * 2 人目からの居ない人の欄（実施者 2・地域の支援者の名前の無い行）、居ない人の氏名のほかの欄（フリガナ・住所・電話・関係・同意※）、
 * 値の無い特記の段（本人の言葉・その他）。原本の紙に手で書くときと同じく空けておく
 */
export type Cell =
  | { kind: "value"; lines: PieceLine[] }
  | { kind: "choice"; options: Choice[]; after?: Piece[]; unconfirmed?: { reason?: PendingStatus } }
  | { kind: "unconfirmed"; reason?: PendingStatus }
  | { kind: "none" }
  | { kind: "empty" }
  | { kind: "withheld"; consent: ConsentKind }
  | { kind: "handwrite" };

export type PlacedPending = { field: string; status: PendingStatus; key: MatsuyamaKey; label: string };

export type MatsuyamaSheet = {
  personId: string;
  name: string;
  cells: Record<MatsuyamaKey, Cell>;
  /** 台帳の pending と、出した欄。全部どこかに出る */
  pending: PlacedPending[];
  /** 同意のない範囲（落とした） */
  withheld: ConsentKind[];
};

export type BuildOptions = {
  /** 作成日・年齢を数える日（JST、YYYY-MM-DD） */
  today: string;
  /** 計画を作った事業所の名前 */
  officeName: string | null;
};

// ---------- 言葉の道具（医療要約 lib/forms/medical-summary.ts も同じ物を使う。薬・機器・時計の値を書類の間でそろえる） ----------

export const BLANK = { unconfirmed: "未確認", none: "なし" } as const;

export const t = (text: string): Piece => ({ text });
export const sub = (text: string): Piece => ({ text, sub: true });
export const strong = (text: string): Piece => ({ text, strong: true });
/** 本人の言葉（台帳の特記）。紙でも書き方を直さない */
export const raw = (text: string): Piece => ({ text, raw: true });
export const unconfirmedPiece = (reason?: PendingStatus): Piece =>
  reason ? { text: BLANK.unconfirmed, unconfirmed: true, reason } : { text: BLANK.unconfirmed, unconfirmed: true };
const SEP: Piece = sub("／");

export const value = (...lines: PieceLine[]): Cell => {
  const kept = lines.map((l) => l.filter((p) => p.text !== "")).filter((l) => l.length > 0);
  return kept.length > 0 ? { kind: "value", lines: kept } : { kind: "unconfirmed" };
};
export const unconfirmed = (reason?: PendingStatus): Cell => (reason ? { kind: "unconfirmed", reason } : { kind: "unconfirmed" });
export const NONE: Cell = { kind: "none" };
/** 空き枠（T111）。紙に何も刷らない */
export const EMPTY: Cell = { kind: "empty" };

/** 文字の値。空なら未確認 */
function textCell(v: string | null | undefined, emphasize = false): Cell {
  if (v == null || v.trim() === "") return unconfirmed();
  return value([emphasize ? strong(v) : t(v)]);
}

/** 塊を「／」でつなぐ（空の塊は落とす） */
export function joinGroups(groups: Piece[][]): PieceLine {
  const kept = groups.filter((g) => g.some((p) => p.text !== ""));
  return kept.flatMap((g, i) => (i === 0 ? g : [SEP, ...g]));
}

/** 欄の値を 1 行の文字にする（テスト・画面の要約用） */
export function cellText(cell: Cell): string {
  const piece = (p: Piece) => (p.unconfirmed && p.reason ? `${p.text}（${PENDING_STATUS_LABELS[p.reason]}）` : p.text);
  const choice = (c: Choice): string =>
    `${c.on ? "■" : "□"}${c.label}${c.detail ? `（${c.detail}）` : ""}${c.sub ? `（${c.sub.map(choice).join(" ")}）` : ""}`;
  switch (cell.kind) {
    case "value":
      return cell.lines.map((l) => l.map(piece).join(" ")).join(" ");
    case "choice": {
      const parts = cell.options.map(choice);
      if (cell.after) parts.push(cell.after.map(piece).join(" "));
      if (cell.unconfirmed) parts.push(piece(unconfirmedPiece(cell.unconfirmed.reason)));
      return parts.join(" ");
    }
    case "unconfirmed":
      return cell.reason ? `${BLANK.unconfirmed}（${PENDING_STATUS_LABELS[cell.reason]}）` : BLANK.unconfirmed;
    case "none":
      return BLANK.none;
    case "withheld":
      return withheldText(cell.consent);
    case "empty":
    case "handwrite":
      return "";
  }
}

/** 同意のない範囲の印字 */
export function withheldText(consent: ConsentKind): string {
  return `省略（${CONSENT_KIND_LABELS[consent]} 同意なし）`;
}

// ---------- pending を欄に ----------

type Pending = Ledger["pending"][number];

export const under = (prefix: string) => (field: string) => field === prefix || field.startsWith(`${prefix}.`);

/** 本人のページの欄の名前（いちばん長く一致する物）。欄の無い pending の見出しに使う */
export function pendingLabel(field: string): string {
  let best: { key: string; label: string } | null = null;
  for (const f of PAGE_FIELDS) {
    if (under(f.key)(field) && (!best || f.key.length > best.key.length)) best = f;
  }
  return best?.label ?? field;
}

class PendingPool {
  readonly placed: PlacedPending[] = [];
  private rest: Pending[];
  constructor(items: readonly Pending[]) {
    this.rest = [...items];
  }
  /** 当てはまる pending を全部取り、key の欄に出したと記録する。いちばん強い理由（最初の物）を返す */
  take(key: MatsuyamaKey, match: (field: string) => boolean, label?: string): PendingStatus | undefined {
    const hit = this.rest.filter((p) => match(p.field));
    if (hit.length === 0) return undefined;
    this.rest = this.rest.filter((p) => !match(p.field));
    for (const p of hit) this.placed.push({ field: p.field, status: p.status, key, label: label ?? matsuyamaField(key).label });
    return hit[0].status;
  }
  takeOne(key: MatsuyamaKey, p: Pending, label: string): PendingStatus {
    this.rest = this.rest.filter((x) => x !== p);
    this.placed.push({ field: p.field, status: p.status, key, label });
    return p.status;
  }
  remaining(): Pending[] {
    return [...this.rest];
  }
  get all(): readonly Pending[] {
    return this.rest;
  }
}

/** 値が無い欄なら pending の理由つき未確認に、値があれば末尾に未確認を足す */
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

// ---------- 連絡先 ----------

export type Contact = PersonPageRows["contacts"][number];
export type Clock = PersonPageRows["clocks"][number];

export function contactName(c: Contact): Piece[] {
  const out: Piece[] = [strong(c.name ?? c.relation ?? CONTACT_KIND_LABELS[c.kind])];
  if (c.name && c.relation) out.push(sub(c.relation));
  return out;
}

const isMobileNote = (c: Contact) => (c.note ?? "").includes("携帯");

/** 連絡先の電話を 電話番号・携帯番号 に分ける（備考に「携帯」とあれば携帯番号） */
function phoneCells(c: Contact): { phone: Cell; mobile: Cell } {
  if (!c.phone) return { phone: unconfirmed(), mobile: unconfirmed() };
  const v = value([t(c.phone)]);
  return isMobileNote(c) ? { phone: unconfirmed(), mobile: v } : { phone: v, mobile: unconfirmed() };
}

/** 地域の支援者・関係先の 1 行: 名前・間柄・種類・電話 */
function contactLine(c: Contact, opts: { kind?: boolean; order?: boolean } = {}): PieceLine {
  const line: PieceLine = [...contactName(c)];
  if (opts.kind) line.push(sub(CONTACT_KIND_LABELS[c.kind]));
  if (c.reach) line.push(sub(CONTACT_REACH_LABELS[c.reach]));
  if (opts.order && c.emergency_order != null) line.push(sub(`緊急連絡 ${c.emergency_order}`));
  line.push(sub("TEL"), c.phone ? t(c.phone) : unconfirmedPiece());
  if (c.note) line.push(sub(c.note));
  return line;
}

function contactsCell(cs: Contact[], opts: { kind?: boolean; order?: boolean } = {}, empty: Cell = NONE): Cell {
  return cs.length > 0 ? value(...cs.map((c) => contactLine(c, opts))) : empty;
}

/** 住所の欄: 番地も町名も持たないので未確認。どこにいる人か（同居・近所・市内）を添える */
function contactAddress(c: Contact): Cell {
  return c.reach ? { kind: "value", lines: [[unconfirmedPiece(), sub(CONTACT_REACH_LABELS[c.reach])]] } : unconfirmed();
}

// ---------- 同意 ----------

type ConsentMap = Record<ConsentKind, ConsentStatus>;

function consentMap(rows: PersonPageRows["consents"]): ConsentMap {
  const get = (k: ConsentKind) => rows.find((c) => c.kind === k)?.status ?? "unconfirmed";
  return { registry: get("registry"), plan_share: get("plan_share"), supporters: get("supporters"), medical: get("medical"), ai_overseas: get("ai_overseas") };
}

function consentCell(
  status: ConsentStatus,
  options: readonly [string, string],
  reason?: PendingStatus,
  recorded?: PersonPageRows["consents"][number],
): Cell {
  const [yes, no] = options;
  if (status === "unconfirmed") {
    return { kind: "choice", options: [{ label: yes, on: false }, { label: no, on: false }], unconfirmed: reason ? { reason } : {} };
  }
  // 記録した日と人（様式の問いの 2 つだけに添える）
  const after = recorded
    ? [sub(`記録 ${formatJst(recorded.recorded_at).slice(0, 10)}${recorded.recorded_by_name ? ` ${recorded.recorded_by_name}` : ""}`)]
    : undefined;
  return {
    kind: "choice",
    options: [
      { label: yes, on: status === "granted" },
      { label: no, on: status === "refused" },
    ],
    after,
  };
}

// ---------- 医療 ----------

export function clockValue(k: Clock): string | null {
  return k.value != null && k.unit != null ? `${k.value} ${CLOCK_UNIT_LABELS[k.unit]}` : null;
}

/** 時計の出典と起点（「停電から・説明書」） */
export function clockBasis(k: Clock): string {
  const parts: string[] = [];
  if (k.starts_on !== "none") parts.push(`${CLOCK_START_LABELS[k.starts_on]}から`);
  if (k.source) parts.push(CLOCK_SOURCE_LABELS[k.source]);
  if (k.source_note) parts.push(k.source_note);
  return parts.join("・");
}

/** 時計の 1 塊: 名前・長さ・出典・頼り先・メモ */
export function clockGroup(k: Clock, label = k.label): Piece[] {
  const v = clockValue(k);
  const out: Piece[] = [t(label), v ? strong(v) : k.starts_on === "none" ? t("") : unconfirmedPiece()];
  const basis = clockBasis(k);
  if (basis) out.push(sub(basis));
  if (k.depends_on && k.depends_check) {
    const dep = `${DEPENDS_ON_LABELS[k.depends_on]} ${CHECK_STATUS_LABELS[k.depends_check]}`;
    out.push(k.depends_check === "unconfirmed" ? strong(dep) : sub(dep));
  }
  if (k.note) out.push(sub(k.note));
  return out;
}

/** 電気で動く機器（内蔵電池と予備を必ず書く） */
const POWERED: ReadonlySet<DeviceKind> = new Set(["oxygen", "ventilator", "suction"]);

/** 薬の区分と時計の区分（名前で当たらないときに使う） */
export const MED_CLOCK_CATEGORY: Partial<Record<MedicationCategory, ClockRow["category"]>> = {
  antiplatelet: "antiplatelet",
  anticoagulant: "anticoagulant",
  insulin: "insulin",
  steroid: "steroid",
  antiepileptic: "antiepileptic",
};

/** 薬の時計と薬の名前が同じ物か（時計の名前は薬の名前の一部のことがある: DOAC と 抗凝固薬（DOAC）） */
function sameMedication(clockLabel: string, medicationName: string): boolean {
  return clockLabel.includes(medicationName) || medicationName.includes(clockLabel);
}

const MED_REMAINING = /^medical\.medications\.([^.]+)\.remaining$/;

export type Medication = Ledger["medical"]["medications"][number];

/** 薬ごとの残りの時計。使った時計は used に入れる */
export function medicationClocks(meds: readonly Medication[], clocks: readonly Clock[], used: Set<string>): Array<Clock | null> {
  const candidates = clocks.filter((k) => k.kind === "medication" || k.kind === "supply");
  return meds.map((m) => {
    const byName = candidates.find((k) => !used.has(k.id) && sameMedication(k.label, m.name));
    const cat = MED_CLOCK_CATEGORY[m.category];
    const byCategory = cat ? candidates.filter((k) => !used.has(k.id) && k.category === cat) : [];
    const hit = byName ?? (byCategory.length === 1 ? byCategory[0] : undefined);
    if (hit) used.add(hit.id);
    return hit ?? null;
  });
}

/**
 * 薬の残りの pending が当たる薬の番号。番号か名前で探し、無ければ残りの分からない薬が 1 つだけのときにそこへ
 * （種の山田さんの「warfarin」はこれ。本人のページ lib/person.ts と同じ決まり）
 */
export function pendingMedicationIndex(field: string, meds: readonly Medication[], medClocks: ReadonlyArray<Clock | null>): number {
  const m = MED_REMAINING.exec(field);
  if (!m) return -1;
  if (/^\d+$/.test(m[1])) return Number(m[1]) < meds.length ? Number(m[1]) : -1;
  const byName = meds.findIndex((x) => x.name === m[1]);
  if (byName >= 0) return byName;
  const unknown = meds.map((_, i) => i).filter((i) => medClocks[i]?.value == null);
  return unknown.length === 1 ? unknown[0] : -1;
}

function medicationLine(m: Medication, clock: Clock | null, reason: PendingStatus | undefined): PieceLine {
  const remaining: Piece[] = [sub("残り")];
  const v = clock ? clockValue(clock) : null;
  if (v) {
    remaining.push(strong(v));
    const basis = clock ? clockBasis(clock) : "";
    if (basis) remaining.push(sub(basis));
  } else {
    remaining.push(unconfirmedPiece(reason));
  }
  const flags: Piece[] = [];
  if (m.storage) flags.push(sub("保管"), t(m.storage));
  if (m.needsRefrigeration) flags.push(t(MEDICATION_FLAG_LABELS.needsRefrigeration));
  if (m.interruptionRisk) flags.push(strong(MEDICATION_FLAG_LABELS.interruptionRisk));
  if (clock?.note) flags.push(sub(clock.note));
  // 区分は名前に含まれず「その他」でないときだけ添える（インスリン インスリン、抗凝固薬（DOAC） 抗凝固薬 にしない）
  const categoryLabel = MEDICATION_CATEGORY_LABELS[m.category];
  const showCategory = m.category !== "other" && !m.name.includes(categoryLabel);
  return joinGroups([
    [strong(m.name), ...(showCategory ? [sub(categoryLabel)] : [])],
    m.schedule ? [t(m.schedule)] : [sub("回数"), unconfirmedPiece()],
    [sub("用量"), m.amount ? t(m.amount) : unconfirmedPiece()],
    remaining,
    flags,
  ]);
}

/** 機器の 1 行: 名前・中身・回数 ／ その区分の時計（電池・予備）。電気の機器で時計が無ければ未確認 */
export function deviceLine(d: Ledger["medical"]["devices"][number], clocks: readonly Clock[], used: Set<string>): PieceLine {
  const mine = clocks.filter((k) => k.category === d.kind && !used.has(k.id));
  for (const k of mine) used.add(k.id);
  const groups: Piece[][] = [[strong(DEVICE_LABELS[d.kind]), t(d.detail ?? ""), t(d.schedule ?? "")]];
  const battery = mine.filter((k) => k.kind === "device");
  const spare = mine.filter((k) => k.kind !== "device");
  if (POWERED.has(d.kind) && battery.length === 0) groups.push([t("内蔵電池"), unconfirmedPiece()]);
  for (const k of battery) groups.push(clockGroup(k));
  if (d.kind === "oxygen" && spare.length === 0) groups.push([t("予備"), unconfirmedPiece()]);
  for (const k of spare) groups.push(clockGroup(k));
  return joinGroups(groups);
}

/** 配列の値。無ければ未確認、空ならなし */
export function listPieces(label: string, v: readonly string[] | undefined): Piece[] {
  if (v === undefined) return [sub(label), unconfirmedPiece()];
  if (v.length === 0) return [sub(label), t(BLANK.none)];
  return [sub(label), t(v.join("・"))];
}

// ---------- 差し込み ----------

const SUPPORTER_PARTS = ["kana", "name", "address", "phone", "mobile", "relation", "consent"] as const;
type SupporterPart = (typeof SUPPORTER_PARTS)[number];

function supporterKeys<N extends 1 | 2>(n: N, parts: Record<SupporterPart, Cell>): Record<`supporter${N}.${SupporterPart}`, Cell> {
  return Object.fromEntries(SUPPORTER_PARTS.map((p) => [`supporter${n}.${p}`, parts[p]])) as Record<
    `supporter${N}.${SupporterPart}`,
    Cell
  >;
}

const DEVICE_CATEGORIES: ReadonlySet<string> = new Set(["oxygen", "ventilator", "suction", "tube_feeding", "dialysis"]);

/** 台帳（本人のページの行）から松山市の様式の欄を全部埋める */
export function buildMatsuyamaSheet(rows: PersonPageRows, opts: BuildOptions): MatsuyamaSheet {
  const { person } = rows;
  const ledger = parseLedger(person.ledger);
  const { basic, care, medical, evacuation } = ledger;
  const contacts = [...rows.contacts].sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));
  const clocks = [...rows.clocks].sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));
  const consent = consentMap(rows.consents);
  const consentRow = (k: ConsentKind) => rows.consents.find((c) => c.kind === k);
  const granted = (k: ConsentKind) => consent[k] === "granted";
  const pool = new PendingPool(ledger.pending);
  const placedContacts = new Set<string>();
  const place = (cs: Contact[]) => {
    for (const c of cs) placedContacts.add(c.id);
    return cs;
  };
  // 様式で落とす物があるのは計画共有と支援者提供だけ（名簿登録は問いの答えだけ、医療班提供は様式に効かない）
  const withheld = (["plan_share", "supporters"] as const).filter((k) => !granted(k));

  // ---- 対象者 ----
  const self = place(contacts.filter((c) => c.kind === "self"));
  const selfMobile = self.filter((c) => c.phone && isMobileNote(c));
  const selfPhone = self.filter((c) => c.phone && !isMobileNote(c));
  const phoneCell = (list: Contact[], flag: boolean | undefined): Cell =>
    list.length > 0
      ? value(...list.map((c) => [t(c.phone!)]))
      : flag === false
        ? NONE
        : unconfirmed();

  const birth = person.birth_date ? wareki(person.birth_date) : null;
  const age = person.birth_date ? ageOn(person.birth_date, opts.today) : null;
  const careLevel = care.careLevel;
  const isCare = careLevel?.startsWith("care") ?? false;
  const handbook = care.handbook ?? "";
  const category: Cell = {
    kind: "choice",
    options: [
      {
        label: "高齢者",
        on: age !== null && age >= 65,
        sub: [
          { label: "独居", on: basic.household === "alone" },
          { label: "要介護", on: isCare, detail: isCare && careLevel ? CARE_LEVEL_LABELS[careLevel] : undefined },
        ],
      },
      {
        label: "障がい者",
        on: handbook !== "",
        sub: [
          { label: "身体", on: handbook.includes("身体") },
          { label: "知的", on: handbook.includes("知的") || handbook.includes("療育") },
          { label: "精神", on: handbook.includes("精神") },
        ],
      },
      { label: "難病患者", on: Boolean(care.intractableDisease), detail: care.intractableDisease },
      { label: "小児慢性特定疾病児童", on: false },
      {
        label: "その他",
        on: careLevel !== undefined && !isCare,
        detail: careLevel !== undefined && !isCare ? CARE_LEVEL_LABELS[careLevel] : undefined,
      },
    ],
    // 手帳の言葉が身体・知的・精神に当たらないときは、そのまま添える
    after: handbook && !/身体|知的|療育|精神/.test(handbook) ? [sub("手帳"), t(handbook)] : undefined,
  };

  const household: Cell = basic.household
    ? {
        kind: "choice",
        options: [
          { label: "ひとり暮らし", on: basic.household === "alone" },
          { label: "日中ひとり", on: false },
          { label: "高齢者のみ", on: false },
          { label: "障がい者等のみ", on: false },
          {
            label: "その他",
            on: basic.household !== "alone",
            detail: basic.household !== "alone" ? householdText(basic.household, basic.householdNote) : undefined,
          },
        ],
      }
    : unconfirmed(pool.take("target.household", under("basic.household")));

  // ---- 地域の支援者 ----
  const welfare = place(contacts.filter((c) => c.kind === "welfare_commissioner"));
  const offices = place(contacts.filter((c) => c.kind === "visiting_nurse" || c.kind === "care_service"));
  const supporterOf = (n: number) => contacts.find((c) => c.supporter_order === n) ?? null;
  const s1 = supporterOf(1);
  const s2 = supporterOf(2);
  const kin = contacts.find((c) => c.emergency_order === 1) ?? null;
  const localOther = place(
    contacts.filter(
      (c) =>
        (c.kind === "city_office" || c.kind === "supporter") &&
        c.supporter_order == null &&
        c.emergency_order == null &&
        !placedContacts.has(c.id),
    ),
  );

  // ---- 実施者 ----
  // 居ない人の欄（T111）: 実施者が 1 人も居なければ 1 人目の氏名だけ「なし」、ほかの欄と 2 人目の欄は空き枠（刷らない・数えない）
  const noSupporter = !s1 && !s2;
  const supporterCells = (n: 1 | 2, c: Contact | null): Record<SupporterPart, Cell> => {
    const consentReason = pool.take(`supporter${n}.consent`, under("consent.supporters"));
    const nameReason = pool.take(`supporter${n}.name`, under(`people.supporter${n}`));
    if (!c) {
      const name = nameReason ? unconfirmed(nameReason) : n === 1 && noSupporter ? NONE : EMPTY;
      return { kana: EMPTY, name, address: EMPTY, phone: EMPTY, mobile: EMPTY, relation: EMPTY, consent: EMPTY };
    }
    place([c]);
    const consentC = consentCell(consent.supporters, MARK_OPTIONS, consentReason);
    if (!granted("supporters")) {
      const w: Cell = { kind: "withheld", consent: "supporters" };
      return { kana: w, name: w, address: w, phone: w, mobile: w, relation: w, consent: consentC };
    }
    const phones = phoneCells(c);
    const relation: PieceLine = [strong(c.relation ?? CONTACT_KIND_LABELS[c.kind])];
    if (c.relation && c.kind !== "family" && c.kind !== "supporter") relation.push(sub(CONTACT_KIND_LABELS[c.kind]));
    const flags: PieceLine = [];
    if (c.emergency_order != null) flags.push(sub(`連絡順 ${c.emergency_order}`));
    if (c.has_car === 1) flags.push(sub(`${CONTACT_FLAG_LABELS.hasCar}あり`));
    if (c.has_car === 0) flags.push(sub(`${CONTACT_FLAG_LABELS.hasCar}なし`));
    if (c.night_ok === 1) flags.push(sub(CONTACT_FLAG_LABELS.nightOk));
    if (c.night_ok === 0) flags.push(sub("夜間不可"));
    if (c.has_smartphone === 1) flags.push(sub(`${CONTACT_FLAG_LABELS.hasSmartphone}あり`));
    if (c.has_smartphone === 0) flags.push(sub(`${CONTACT_FLAG_LABELS.hasSmartphone}なし`));
    if (c.note) flags.push(sub(c.note));
    return {
      kana: unconfirmed(),
      name: withPending(value([strong(c.name ?? c.relation ?? CONTACT_KIND_LABELS[c.kind])]), nameReason),
      address: contactAddress(c),
      phone: phones.phone,
      mobile: phones.mobile,
      relation: value(relation, flags),
      consent: consentC,
    };
  };

  const nightOk = contacts.filter((c) => c.night_ok === 1);
  const nightReason = pool.take("supporter.night", under("people.night_supporter"));
  const night: Cell =
    nightOk.length > 0
      ? granted("supporters")
        ? withPending(value(...nightOk.map((c) => contactName(c))), nightReason)
        : { kind: "withheld", consent: "supporters" }
      : contacts.some((c) => c.night_ok === 0)
        ? withPending(NONE, nightReason)
        : unconfirmed(nightReason);

  // ---- 近親者 ----
  if (kin) place([kin]);
  const kinPhones = kin ? phoneCells(kin) : null;
  const kinReason = pool.take("kin.name", (f) => under("people.emergency")(f) || under("people.family")(f));

  // ---- 医療 ----
  const doctors = contacts.filter((c) => c.kind === "home_doctor" || c.kind === "pharmacy");
  const dialysisCenters = contacts.filter((c) => c.kind === "dialysis_center");
  place([...doctors, ...dialysisCenters]);
  const usedClocks = new Set<string>();
  const deviceLines = medical.devices.map((d) => deviceLine(d, clocks, usedClocks));
  const medClocks = medicationClocks(medical.medications, clocks, usedClocks);
  const medReasons = medical.medications.map((): PendingStatus | undefined => undefined);
  for (const p of [...pool.all]) {
    const i = pendingMedicationIndex(p.field, medical.medications, medClocks);
    if (i >= 0) medReasons[i] = pool.takeOne("medical.drugs", p, `${medical.medications[i].name} 残り`);
  }
  const medLines = medical.medications.map((m, i) => medicationLine(m, medClocks[i], medReasons[i]));
  // 機器にも薬にも当たらない時計（透析の次の回・栄養剤・本人の状態など）
  const otherClockLines = clocks.filter((k) => !usedClocks.has(k.id)).map((k) => joinGroups([clockGroup(k)]));
  const dialysisLines = dialysisCenters.map((c) => [sub("透析先"), ...contactLine(c)]);
  const medicalNoteLines: PieceLine[] = [
    ...deviceLines,
    ...otherClockLines,
    ...dialysisLines,
    joinGroups([listPieces("アレルギー", medical.allergies), listPieces("既往", medical.history), listPieces("予防接種", medical.vaccinations)]),
  ];
  const hasMedicalDetail = medical.devices.length > 0 || medical.medications.length > 0 || clocks.some((k) => DEVICE_CATEGORIES.has(k.category));

  const drugsReason = pool.take("medical.drugs", under("medical.medications"));
  const doctorReason = pool.take("medical.doctor", under("medical.doctor"));
  const medicalNoteReason = pool.take("notes.medical", (f) => under("medical")(f) || under("clocks")(f));
  // 様式の医療の欄は計画共有に従う（市に出す計画の一部）。医療班提供は要約（T07）と QR（T16）だけ
  const medicalShared = granted("plan_share");
  const medicalWithheld: Cell = { kind: "withheld", consent: "plan_share" };

  // ---- 避難 ----
  const hazards = evacuation.hazards;
  const hazardOn = (k: string) => hazards.find((h) => h.kind === k);
  const flood = hazardOn("flood");
  const tsunami = hazardOn("tsunami");
  const otherHazard = hazardOn("other");
  const depth =(h: { depthM?: number } | undefined) => (h?.depthM != null ? `浸水 ${h.depthM} m` : undefined);
  const riskHome: Cell = {
    kind: "choice",
    options: [
      { label: "土砂災害", on: Boolean(hazardOn("landslide")) },
      { label: "洪水", on: Boolean(flood), detail: depth(flood) },
      { label: "高潮", on: false },
      { label: "津波", on: Boolean(tsunami), detail: depth(tsunami) },
      { label: "地震", on: false },
    ],
    // その他のハザード（T57）は様式の選択肢に無いので、名前つきで後ろに書く
    after: hazards.length === 0 ? [t(BLANK.none)] : otherHazard ? [t(hazardText(otherHazard))] : undefined,
  };
  const riskHomeReason = pool.take("risk.home", under("evacuation.hazards"));

  const abilityKeys = Object.keys(ABILITY_ITEM_LABELS) as Array<keyof typeof ABILITY_ITEM_LABELS>;
  const notOk = abilityKeys.filter((k) => care[k] && care[k] !== "ok");
  const ok = abilityKeys.filter((k) => care[k] === "ok");
  const missing = abilityKeys.filter((k) => !care[k]);
  const issueLines: PieceLine[] = [];
  const issueHead: Piece[] = [
    ...notOk.map((k) => strong(`${ABILITY_ITEM_LABELS[k]} ${ABILITY_LABELS[care[k]!]}`)),
    ...(care.bedridden ? [strong("寝たきり")] : []),
    ...(care.dementia ? [strong("認知症")] : []),
  ];
  if (issueHead.length > 0) issueLines.push(issueHead);
  if (evacuation.barriers) issueLines.push([sub("段差"), t(evacuation.barriers)]);
  const issueTail: Piece[] = [];
  if (ok.length > 0) issueTail.push(sub(`${ok.map((k) => ABILITY_ITEM_LABELS[k]).join("・")} ${ABILITY_LABELS.ok}`));
  if (missing.length > 0) issueTail.push(sub(missing.map((k) => ABILITY_ITEM_LABELS[k]).join("・")), unconfirmedPiece());
  if (issueTail.length > 0) issueLines.push(issueTail);
  const issuesReason = pool.take("risk.issues", (f) => under("care")(f) || under("evacuation.barriers")(f));
  const issues: Cell =
    issueHead.length === 0 && !evacuation.barriers && missing.length === 0 ? withPending(value([t(BLANK.none)], issueTail), issuesReason) : withPending(value(...issueLines), issuesReason);

  const means = (transport: string | undefined, reason: PendingStatus | undefined): Cell => {
    if (!transport) return unconfirmed(reason);
    const walk = transport.trim() === "徒歩";
    return {
      kind: "choice",
      options: [
        { label: "徒歩", on: walk },
        { label: "その他", on: !walk, detail: walk ? undefined : transport },
      ],
    };
  };

  const housing = basic.housing;
  // 寝室は住居の下の場所なので、住居より先に取る
  const bedroomReason = pool.take("housing.bedroom", under("basic.housing.bedroom"));
  const housingReason = pool.take("housing.room", under("basic.housing"));
  // 入れる欄（T03）で足した欄: みまもり員・マイ・タイムライン・支援の内容
  const watcherReason = pool.take("local.watcher", under("local.watcher"));
  const timelineReason = pool.take("target.timeline", under("evacuation.myTimeline"));
  const supportReason = pool.take(
    "support.kinds",
    (f) => under("evacuation.support")(f) || under("evacuation.supportNote")(f),
  );
  const support = evacuation.support;
  const supportNote = evacuation.supportNote?.trim() || undefined;
  const floors = housing?.floors;
  const structure = housing?.structure;

  // ---- 特記（その他） ----
  const otherLines: PieceLine[] = [];
  const carryReason = pool.take("notes.other", under("evacuation.carryItems"), "持出品");
  if (evacuation.carryItems === undefined) otherLines.push([sub("持出品"), unconfirmedPiece(carryReason)]);
  else otherLines.push([sub("持出品"), t(evacuation.carryItems.length > 0 ? evacuation.carryItems.join("・") : BLANK.none)]);
  if (evacuation.pets) otherLines.push([sub("ペット"), t(evacuation.pets)]);
  const smartphone = basic.contactMeans?.smartphone;
  const contactMeansLine: Piece[] = [];
  if (smartphone) contactMeansLine.push(sub("スマホ"), t(SMARTPHONE_LABELS[smartphone]));
  if (basic.contactMeans?.email) contactMeansLine.push(sub("メール"), t("あり"));
  if (contactMeansLine.length > 0) otherLines.push(contactMeansLine);
  if (person.self_report_unreliable === 1) otherLines.push([sub("本人報告"), strong("参考扱い")]);

  const route = evacuation.route;
  const routeReason = pool.take("route.text", under("evacuation.route"));
  const preReason = pool.take("shelter.pre.place", under("evacuation.destination2"));
  const cityReason = pool.take("shelter.city.place", under("evacuation.destination1"));
  const transportReason = pool.take("shelter.city.means", under("evacuation.transport"));
  const addressReason = pool.take("target.address", under("basic.address"));
  const sexReason = pool.take("target.sex", under("basic.sex"));
  const birthReason = pool.take("target.birth", under("basic.birth"));
  const phoneReason = pool.take("target.phone", under("basic.contactMeans"));
  const welfareReason = pool.take("local.welfare", under("people.welfare_commissioner"));
  const registryReason = pool.take("consent.registry", under("consent.registry"));
  const planShareReason = pool.take("consent.planShare", under("consent.plan_share"));
  // 医療班提供の pending は様式の欄に効かないので、欄の無い pending と同じく「その他」に出す

  const s1Cells = supporterCells(1, s1);
  const s2Cells = supporterCells(2, s2);

  // 様式に載らない連絡先（緊急連絡先の 2 人目から、実施者でない家族など）。同意で落とした人は載せない
  const restContacts = contacts.filter((c) => !placedContacts.has(c.id) && c.supporter_order == null);
  if (restContacts.length > 0) {
    for (const c of restContacts) otherLines.push([sub("連絡先"), ...contactLine(c, { kind: c.kind !== "family", order: true })]);
  }
  // 欄の無い pending（全部どこかに出す）
  for (const p of pool.remaining()) {
    otherLines.push([sub(pendingLabel(p.field)), unconfirmedPiece(pool.takeOne("notes.other", p, pendingLabel(p.field)))]);
  }

  const cells: Record<MatsuyamaKey, Cell> = {
    "head.number": { kind: "handwrite" },
    "head.date": value([t(warekiText(opts.today))]),
    "target.kana": textCell(person.kana),
    "target.name": textCell(person.name, true),
    "target.sex": basic.sex
      ? {
          kind: "choice",
          options: [
            { label: "男", on: basic.sex === "male" },
            { label: "女", on: basic.sex === "female" },
          ],
          after: basic.sex === "other" ? [t("その他")] : undefined,
        }
      : unconfirmed(sexReason),
    "target.birth": birth
      ? { kind: "choice", options: ERAS.map((e) => ({ label: e, on: e === birth.era })), after: [t(warekiDate(birth))] }
      : person.birth_date
        ? value([t(person.birth_date)])
        : unconfirmed(birthReason),
    "target.district": textCell(basic.address?.town),
    "target.address": basic.address ? value([t(`${basic.address.city} ${basic.address.town}`)]) : unconfirmed(addressReason),
    "target.phone": withPending(phoneCell(selfPhone, basic.contactMeans?.landline), phoneReason),
    "target.mobile": phoneCell(selfMobile, basic.contactMeans?.mobile),
    "target.category": category,
    "target.household": household,
    "local.welfare": withPending(contactsCell(welfare), welfareReason),
    "local.watcher": withPending(textCell(ledger.local?.watcher, true), watcherReason),
    "local.office": contactsCell(offices, { kind: true }, unconfirmed()),
    // 地域の支援者の名前の無い 2 行は、足すための空き枠（居なければ刷らない。T111）
    "local.other": contactsCell(localOther, { kind: true }, EMPTY),
    // 様式は「あり（アプリ・紙）・なし」。あり の中に アプリ・紙 を選ぶ
    "target.timeline": withPending(
      {
        kind: "choice",
        options: [
          {
            label: "あり",
            on: evacuation.myTimeline === "app" || evacuation.myTimeline === "paper",
            sub: [
              { label: "アプリ", on: evacuation.myTimeline === "app" },
              { label: "紙", on: evacuation.myTimeline === "paper" },
            ],
          },
          { label: "なし", on: evacuation.myTimeline === "none" },
        ],
        ...(evacuation.myTimeline ? {} : { unconfirmed: {} }),
      },
      timelineReason,
    ),
    "consent.registry": consentCell(consent.registry, CONSENT_OPTIONS, registryReason, consentRow("registry")),
    "consent.planShare": consentCell(consent.plan_share, CONSENT_OPTIONS, planShareReason, consentRow("plan_share")),
    "sign.self": { kind: "handwrite" },
    "sign.proxy": { kind: "handwrite" },
    // 近親者が居なければ氏名だけ「なし」、ほかの欄は空き枠（T111）
    "kin.kana": kin ? unconfirmed() : EMPTY,
    "kin.name": kin ? value([strong(kin.name ?? kin.relation ?? CONTACT_KIND_LABELS[kin.kind])]) : withPending(NONE, kinReason),
    "kin.relation": kin ? textCell(kin.relation ?? CONTACT_KIND_LABELS[kin.kind]) : EMPTY,
    "kin.phone": kinPhones?.phone ?? EMPTY,
    "kin.mobile": kinPhones?.mobile ?? EMPTY,
    "kin.address": kin ? contactAddress(kin) : EMPTY,
    ...supporterKeys(1, s1Cells),
    ...supporterKeys(2, s2Cells),
    "supporter.night": night,
    "org.name": granted("plan_share") ? unconfirmed() : { kind: "withheld", consent: "plan_share" },
    "org.phone": granted("plan_share") ? unconfirmed() : { kind: "withheld", consent: "plan_share" },
    "org.consent": consentCell(consent.plan_share, MARK_OPTIONS),

    "plan.author": opts.officeName || rows.careManagerName
      ? value([strong(opts.officeName ?? ""), t(rows.careManagerName ?? ""), sub(rows.careManagerName ? "ケアマネ" : "")])
      : unconfirmed(),
    "medical.doctor": medicalShared
      ? withPending(contactsCell(doctors, { kind: true }, unconfirmed()), doctorReason)
      : medicalWithheld,
    "medical.drugs": medicalShared
      ? withPending(medLines.length > 0 ? value(...medLines) : NONE, drugsReason)
      : medicalWithheld,
    "risk.home": withPending(riskHome, riskHomeReason),
    "risk.timing":
      hazards.length > 0
        ? {
            kind: "choice",
            options: [
              { label: "自主避難", on: false },
              { label: "レベル３高齢者等避難", on: true },
            ],
          }
        : {
            kind: "choice",
            options: [
              { label: "自主避難", on: false },
              { label: "レベル３高齢者等避難", on: false },
            ],
            unconfirmed: {},
          },
    "risk.issues": issues,
    "shelter.pre.place": withPending(textCell(evacuation.destination2, true), preReason),
    "shelter.pre.means": unconfirmed(),
    "shelter.pre.minutes": unconfirmed(),
    "shelter.near.place": unconfirmed(),
    "shelter.near.means": unconfirmed(),
    "shelter.near.minutes": unconfirmed(),
    "shelter.city.place": withPending(textCell(evacuation.destination1, true), cityReason),
    "shelter.city.means": evacuation.destination1 ? means(transportText(evacuation), transportReason) : unconfirmed(transportReason),
    "shelter.city.minutes": unconfirmed(),
    "housing.type": {
      kind: "choice",
      options: [
        { label: "戸建住宅", on: false },
        { label: "共同住宅", on: false },
      ],
      unconfirmed: {},
    },
    "housing.structure": structure
      ? {
          kind: "choice",
          options: [
            { label: "木造", on: structure === "wood" },
            { label: "その他", on: structure !== "wood", detail: structure !== "wood" ? STRUCTURE_LABELS[structure] : undefined },
          ],
          after: housing?.builtYear != null ? [t(`${housing.builtYear} 年築`)] : undefined,
        }
      : unconfirmed(),
    "housing.floors":
      floors != null
        ? {
            kind: "choice",
            options: [
              { label: "平屋", on: floors === 1 },
              { label: "２階建", on: floors === 2 },
              { label: "３階建以上", on: floors >= 3 },
            ],
          }
        : unconfirmed(),
    "housing.room": withPending(housing?.floor != null ? value([strong(`${housing.floor}`), t("階")]) : unconfirmed(), housingReason),
    "housing.bedroom": withPending(textCell(housing?.bedroom), bedroomReason),
    "support.kinds": withPending(
      {
        kind: "choice",
        options: SUPPORT_KINDS.map((k) => ({
          label: SUPPORT_SHEET_LABELS[k],
          on: support?.includes(k) ?? false,
          // その他の中身は書き足し（supportNote）
          detail: k === "other" && support?.includes("other") ? supportNote : undefined,
        })),
        // その他を選んでいないときの書き足しは後ろに添える
        after: supportNote && !support?.includes("other") ? [t(supportNote)] : undefined,
        ...(support ? {} : { unconfirmed: {} }),
      },
      supportReason,
    ),
    "notes.medical": medicalShared ? withPending(value(...medicalNoteLines), medicalNoteReason) : medicalWithheld,
    // 特記の段で値の無い物は段ごと刷らない（本人の言葉をまだ聞いていないだけ。T111）
    "notes.words": ledger.notes.length > 0 ? value(...ledger.notes.map((n) => [raw(n)])) : EMPTY,
    "notes.other": otherLines.length > 0 ? value(...otherLines) : EMPTY,
    "notes.annex": {
      kind: "choice",
      options: [
        { label: "あり", on: medicalShared && hasMedicalDetail, detail: medicalShared && hasMedicalDetail ? "医療要約" : undefined },
        { label: "なし", on: !(medicalShared && hasMedicalDetail) },
      ],
    },
    // 様式の注は「地図上または箇条書き等で避難経路を記入」。経路地図（T102）を紙に置ける人は、文が無くても欄は埋まる（T106。未確認に数えない）
    "route.text": route ? value([t(route)]) : routeSceneOf(ledger, ROUTE_FRAME) ? { kind: "value", lines: [] } : unconfirmed(routeReason),
    "route.map": {
      kind: "choice",
      options: [
        { label: "あり", on: false },
        { label: "なし", on: false },
      ],
      unconfirmed: {},
    },
    "city.stamp": { kind: "handwrite" },
  };

  return { personId: person.id, name: person.name, cells, pending: pool.placed, withheld };
}

