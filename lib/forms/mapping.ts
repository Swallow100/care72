// 様式の対応表（docs/tasks/T08.md）。松山市以外の様式の「どの欄に台帳のどの項目」を持つ形と、台帳の項目の一覧。
//
// - 台帳の項目の一覧（LEDGER_ITEMS、聞き取りの項目表）を唯一の正とする。Claude にはこの一覧の key と名前だけを渡し
//   （台帳の値は渡さない）、返った対応表の項目名はここに無ければ弾く（checkReadResult・parseMappingInput）。
// - 項目の名前と範囲は松山市の様式（lib/forms/matsuyama.ts の欄と source）と台帳の型（lib/db/types.ts）から起こした。
//   値の出し方（差し込み）は lib/forms/mapped-sheet.ts。ここはブラウザでも読む（確かめる画面の選択肢）ので、サーバーの物を import しない。
// - 対応表はケアマネが画面で確かめてから使う（status が checked の物だけ差し込みに使う。自動で使わない）。
// - 欄ごとに AI の読んだ物（ai）を残し、人が直した所と分けて数える（mappingStats）。

import type { ConsentKind } from "../db/types.ts";

// ---------- 台帳の項目の一覧 ----------

export const ITEM_GROUPS = {
  person: "本人",
  care: "介護・障害",
  medical: "医療",
  evacuation: "避難",
  housing: "住まい",
  contacts: "連絡先・支援者",
  consent: "同意",
  plan: "計画・特記",
} as const;
export type ItemGroup = keyof typeof ITEM_GROUPS;

export type LedgerItemDef = {
  key: string;
  group: ItemGroup;
  /** 画面と Claude に出す項目の名前 */
  label: string;
  /** Claude に渡す説明（範囲・持たない物） */
  hint?: string;
  /** この同意が無ければ差し込みで省略する（松山市の様式と同じ範囲。lib/forms/matsuyama.ts の決まり） */
  consent?: ConsentKind;
};

const contactItems = (
  prefix: "emergency1" | "emergency2" | "supporter1" | "supporter2",
  name: string,
  consent?: ConsentKind,
): LedgerItemDef[] => {
  const c = consent ? { consent } : {};
  return [
    { key: `${prefix}.name`, group: "contacts", label: `${name} 氏名`, hint: "団体なら団体名", ...c },
    // フリガナ（T117、contacts.kana）
    { key: `${prefix}.kana`, group: "contacts", label: `${name} フリガナ`, ...c },
    { key: `${prefix}.relation`, group: "contacts", label: `${name} 続柄・関係`, hint: "車・夜間・スマホの有無も", ...c },
    { key: `${prefix}.phone`, group: "contacts", label: `${name} 電話`, hint: "電話と携帯の 2 つまで。メール・FAX は持たない", ...c },
    { key: `${prefix}.address`, group: "contacts", label: `${name} 住所`, hint: "市町村と町名まで（番地は持たない）と、同居・近所・市内などの近さ", ...c },
  ];
};

/** 台帳の項目（聞き取りの項目表）。差し込み（lib/forms/mapped-sheet.ts）は全部の key の出し方を持つ */
export const LEDGER_ITEMS = [
  // ---- 本人 ----
  { key: "person.name", group: "person", label: "氏名" },
  { key: "person.kana", group: "person", label: "フリガナ" },
  { key: "person.birth", group: "person", label: "生年月日", hint: "和暦で出す。元号の選択肢と年月日は 1 つの欄" },
  { key: "person.age", group: "person", label: "年齢", hint: "作成日の満年齢" },
  { key: "basic.sex", group: "person", label: "性別" },
  { key: "basic.address", group: "person", label: "住所", hint: "市と町名まで。番地は持たない" },
  { key: "basic.town", group: "person", label: "地区（町名）" },
  { key: "self.phone", group: "person", label: "電話番号（本人・固定）" },
  { key: "self.mobile", group: "person", label: "携帯番号（本人）" },
  {
    key: "basic.contactMeans",
    group: "person",
    label: "連絡手段",
    hint: "固定電話・携帯・メール・スマホの有無。メールアドレス・FAX 番号は持たない",
  },
  { key: "basic.household", group: "person", label: "世帯", hint: "独居・夫婦・子と同居・家族と同居" },
  { key: "people.together", group: "person", label: "同居家族", hint: "同居の人の続柄と名前、世帯" },

  // ---- 介護・障害 ----
  { key: "care.careLevel", group: "care", label: "要介護度", hint: "要支援1〜要介護5。介護保険の認定" },
  { key: "care.handbook", group: "care", label: "障害者手帳", hint: "種類と等級" },
  { key: "care.intractableDisease", group: "care", label: "難病", hint: "病名" },
  { key: "care.walking", group: "care", label: "歩行", hint: "立つこと・歩くこと。問題なし・一部・困難" },
  { key: "care.hearing", group: "care", label: "聴覚", hint: "音が聞こえるか" },
  { key: "care.vision", group: "care", label: "視覚", hint: "物が見えるか" },
  { key: "care.understanding", group: "care", label: "理解", hint: "言葉や文字の理解" },
  { key: "care.judgment", group: "care", label: "判断", hint: "危険なことの判断" },
  { key: "care.orientation", group: "care", label: "見当識", hint: "知人や家族の見分け" },
  { key: "care.bedridden", group: "care", label: "寝たきり" },
  { key: "care.dementia", group: "care", label: "認知症" },
  {
    key: "care.issues",
    group: "care",
    label: "避難の課題",
    hint: "心身の 6 項目・寝たきり・認知症・段差をまとめた物。避難支援時の留意事項・配慮事項の欄に",
  },

  // ---- 医療（計画の共有の同意の中） ----
  {
    key: "medical.devices",
    group: "medical",
    label: "医療機器",
    hint: "在宅酸素・人工呼吸器・吸引・経管栄養・透析と、電池と予備。機器の種類ごとの □（在宅酸素療法・人工呼吸器）は □ ごとにこの項目",
    consent: "plan_share",
  },
  {
    key: "medical.medications",
    group: "medical",
    label: "常用薬",
    hint: "薬の名前・回数・残り・保管場所。医薬品情報・お薬の欄（かかりつけ医・薬局の欄とは別）。薬の区分ごとの □（抗凝固薬・インスリン）は □ ごとにこの項目",
    consent: "plan_share",
  },
  { key: "medical.doctor", group: "medical", label: "かかりつけ医・薬局", hint: "医療機関・薬局の名前と電話（医薬品情報の欄とは別）", consent: "plan_share" },
  { key: "medical.dialysis", group: "medical", label: "透析先", hint: "透析を受ける施設の名前と電話", consent: "plan_share" },
  { key: "medical.allergies", group: "medical", label: "アレルギー", consent: "plan_share" },
  { key: "medical.history", group: "medical", label: "既往症", hint: "既往症・既往歴。病名の □ の並びは 1 つの欄", consent: "plan_share" },
  { key: "medical.vaccinations", group: "medical", label: "予防接種", hint: "予防接種の種類の □ の並びは 1 つの欄", consent: "plan_share" },
  {
    key: "medical.notes",
    group: "medical",
    label: "医療の特記",
    hint: "機器・時計・透析先・アレルギー・既往・予防接種をまとめた物",
    consent: "plan_share",
  },
  { key: "medical.annex", group: "medical", label: "別紙（医療要約）", hint: "別紙の有無。特記事項の横などの「別紙 あり・なし」の欄", consent: "plan_share" },

  // ---- 避難 ----
  { key: "evacuation.hazards", group: "evacuation", label: "自宅のリスク", hint: "浸水（深さ）・土砂・津波。「自宅のリスク（複数選択可）」の □ の並びは 1 つの欄" },
  { key: "evacuation.destination1", group: "evacuation", label: "避難先1", hint: "市の指定避難所など。名称だけ（住所は持たない）" },
  { key: "evacuation.destination2", group: "evacuation", label: "避難先2", hint: "事前に行く所（親族の家など）" },
  { key: "evacuation.transport", group: "evacuation", label: "移動手段", hint: "徒歩・車いす・家族の車など" },
  { key: "evacuation.route", group: "evacuation", label: "避難経路" },
  { key: "evacuation.barriers", group: "evacuation", label: "段差・エレベーター" },
  { key: "evacuation.support", group: "evacuation", label: "支援の内容", hint: "声掛け・誘導・移動介助と書き足し。複数選択の □ の並びは 1 つの欄" },
  { key: "evacuation.carryItems", group: "evacuation", label: "持出品" },
  { key: "evacuation.pets", group: "evacuation", label: "ペット" },
  { key: "evacuation.myTimeline", group: "evacuation", label: "マイ・タイムライン", hint: "作成の有無" },
  // 避難場所の時間・最寄りの避難場所（T117）
  { key: "evacuation.destination1Minutes", group: "evacuation", label: "避難先1までの時間", hint: "分" },
  { key: "evacuation.destination2Minutes", group: "evacuation", label: "避難先2までの時間", hint: "分" },
  { key: "evacuation.nearest", group: "evacuation", label: "最寄りの避難場所", hint: "指定緊急避難場所など。名称だけ" },

  // ---- 住まい ----
  { key: "basic.housing.structure", group: "housing", label: "構造・築年", hint: "木造・鉄骨・鉄筋など" },
  { key: "basic.housing.floors", group: "housing", label: "建物の階数" },
  { key: "basic.housing.floor", group: "housing", label: "普段いる階" },
  { key: "basic.housing.bedroom", group: "housing", label: "寝室" },
  { key: "basic.housing.type", group: "housing", label: "住居の種別", hint: "戸建住宅・共同住宅" },

  // ---- 連絡先・支援者 ----
  ...contactItems("emergency1", "緊急連絡先1"),
  ...contactItems("emergency2", "緊急連絡先2"),
  ...contactItems("supporter1", "避難支援者1", "supporters"),
  ...contactItems("supporter2", "避難支援者2", "supporters"),
  { key: "people.night", group: "contacts", label: "夜間支援", hint: "夜に来られる人", consent: "supporters" },
  { key: "people.welfare", group: "contacts", label: "民生委員" },
  { key: "local.watcher", group: "contacts", label: "みまもり員" },
  { key: "people.offices", group: "contacts", label: "事業所等", hint: "訪問看護・介護の事業所" },
  // 避難支援等実施組織（T117。自主防災組織・町内会など）。計画書と同じく計画共有に従う
  { key: "org.name", group: "contacts", label: "避難支援組織", hint: "自主防災組織・町内会など", consent: "plan_share" },
  { key: "org.phone", group: "contacts", label: "避難支援組織 電話", consent: "plan_share" },

  // ---- 同意 ----
  { key: "consent.registry", group: "consent", label: "名簿登録の同意", hint: "名簿への登録と平常時からの提供" },
  { key: "consent.plan_share", group: "consent", label: "計画共有の同意", hint: "計画を作り、避難支援等関係者と事前に共有" },
  { key: "consent.supporters", group: "consent", label: "支援者提供の同意", hint: "避難支援等実施者への提供" },
  { key: "consent.medical", group: "consent", label: "医療班提供の同意" },

  // ---- 計画・特記 ----
  { key: "plan.date", group: "plan", label: "作成日" },
  { key: "plan.author", group: "plan", label: "計画作成者", hint: "事業所名と担当のケアマネ" },
  { key: "notes.words", group: "plan", label: "本人の言葉", hint: "特記。言い換えない" },
  { key: "notes.other", group: "plan", label: "その他の特記", hint: "持出品・ペット・連絡手段・様式に載らない連絡先など" },
] as const satisfies readonly LedgerItemDef[];

export type LedgerItemKey = (typeof LEDGER_ITEMS)[number]["key"];

export const LEDGER_ITEM_KEYS: readonly LedgerItemKey[] = LEDGER_ITEMS.map((i) => i.key);

const ITEM_BY_KEY = new Map<string, LedgerItemDef>(LEDGER_ITEMS.map((i) => [i.key, i]));

export function isLedgerItemKey(v: unknown): v is LedgerItemKey {
  return typeof v === "string" && ITEM_BY_KEY.has(v);
}

export function ledgerItem(key: LedgerItemKey): LedgerItemDef {
  return ITEM_BY_KEY.get(key)!;
}

/** Claude に渡す項目表（key・名前・区分・説明だけ。値は無い） */
export function itemCatalog(): Array<{ key: string; group: string; label: string; hint?: string }> {
  return LEDGER_ITEMS.map((i) => ({
    key: i.key,
    group: ITEM_GROUPS[i.group],
    label: i.label,
    ...("hint" in i && i.hint ? { hint: i.hint } : {}),
  }));
}

// ---------- 対応表 ----------

/**
 * 欄の値の形。text 文字・date 日付・choice 選ぶ（□ が並ぶ）・check □ 1 つ（あてはまる物に ☑）・
 * phone 電話・lines 何行かの自由記入・handwrite 手で書く（署名・受付印。空ける）
 */
export const FIELD_SHAPES = ["text", "date", "choice", "check", "phone", "lines", "handwrite"] as const;
export type FieldShape = (typeof FIELD_SHAPES)[number];

export const FIELD_SHAPE_LABELS: Record<FieldShape, string> = {
  text: "文字",
  date: "日付",
  choice: "選択",
  check: "□",
  phone: "電話",
  lines: "複数行",
  handwrite: "手書き",
};

/** AI の自信: 高（名前も中身も合う）・中（範囲が違う）・低（推測） */
export const CONFIDENCES = ["high", "medium", "low"] as const;
export type Confidence = (typeof CONFIDENCES)[number];
export const CONFIDENCE_LABELS: Record<Confidence, string> = { high: "高", medium: "中", low: "低" };

/**
 * 頁の中の場所（T86）。その頁の画像の左上を (0,0)、右下を (1,1) とした比で、左 x・上 y・幅 w・高さ h。
 * 欄の値を書き込む所（欄の名前の字や □ の印の外の空白）。元の様式の頁の画像の上に値を置くときに使う（lib/forms/overlay-sheet.ts）
 */
export type FieldBox = { x: number; y: number; w: number; h: number };

/** 様式に印刷された字の書体。値を置くときに合わせる（BIZ UDPゴシック・BIZ UDP明朝） */
export const TYPEFACES = ["gothic", "mincho"] as const;
export type Typeface = (typeof TYPEFACES)[number];
export const TYPEFACE_LABELS: Record<Typeface, string> = { gothic: "ゴシック", mincho: "明朝" };

/** 場所の小ささの下限（頁の 0.2%）。これより小さい枠は場所なしにする */
const BOX_MIN = 0.002;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * 場所を 0〜1 の中に収める。数でない・幅や高さが 0 以下の物は null。頁の外にはみ出した分は切り、切って小さすぎれば null。
 * AI の返事・画面からの保存・保存した JSON の読み出しで同じ物を通す
 */
export function clampBox(v: unknown): FieldBox | null {
  if (!v || typeof v !== "object") return null;
  const b = v as Record<string, unknown>;
  const nums = [b.x, b.y, b.w, b.h];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  let [x, y, w, h] = nums as number[];
  if (w <= 0 || h <= 0) return null;
  // 左・上にはみ出した分は幅・高さから引く
  if (x < 0) {
    w += x;
    x = 0;
  }
  if (y < 0) {
    h += y;
    y = 0;
  }
  w = Math.min(w, 1 - x);
  h = Math.min(h, 1 - y);
  if (x >= 1 || y >= 1 || w < BOX_MIN || h < BOX_MIN) return null;
  return { x: round4(x), y: round4(y), w: round4(w), h: round4(h) };
}

export function sameBox(a: FieldBox | null | undefined, b: FieldBox | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/** AI が読んだときの対応（人が直しても残す） */
export type AiReading = {
  item: LedgerItemKey | null;
  confidence: Confidence;
  /** 対応の理由（短い） */
  reason: string;
  /** 台帳に無い項目名を返したとき、その名前（弾いて item は null） */
  rejected?: string;
  /** AI が読んだ値の場所（T86。場所を読む前に作った対応表には無い） */
  box?: FieldBox | null;
  /**
   * 項目なし（item が null）にした欄で、AI が「たぶんこの項目」と挙げた物（T120）。同意・署名など本人の意思の欄は
   * 決まりで item を null にするので、候補だけを出し、確かめの画面で人が選ぶ
   */
  candidate?: LedgerItemKey;
};

export type MappingField = {
  /** 対応表の中の id（f1, f2…）。並べ替えても変わらない */
  id: string;
  /** 頁（1 から） */
  page: number;
  /** 段の見出し（緊急時の連絡先① など）。無ければ空 */
  section: string;
  /** 様式に印刷された欄の名前 */
  label: string;
  /** 欄の位置の説明（表 上から 3 段目 右 など） */
  position: string;
  shape: FieldShape;
  /** choice の選択肢（様式の順） */
  options: string[];
  /** 入れる台帳の項目。null は台帳に無い（差し込みは未確認、手書きの欄は空ける） */
  item: LedgerItemKey | null;
  /** 外した欄（差し込みに出さない） */
  removed: boolean;
  /** AI が読んだ物。手で足した欄は null */
  ai: AiReading | null;
  /**
   * 値を書く場所（T86。頁は page）。無い・読めなかった欄は null。check は □ の場所、handwrite は空けておく所。
   * 場所を読む前に作った対応表には無い（undefined は null と同じ）
   */
  box?: FieldBox | null;
  /**
   * choice の選択肢ごとの □（□ が無ければ選択肢の字）の場所。options と同じ順。無い物は null。
   * T120: 日付・電話・文字の欄で、欄の中に「年」「月」「日」「歳」や「−」が刷ってあり値を空きに分けて書く物は、
   * options に区切りの字（["年","月","日"]）、optionBoxes に空きごとの場所（lib/forms/split-parts.ts）
   */
  optionBoxes?: Array<FieldBox | null>;
};

export type FormMapping = {
  /** 様式の題名 */
  title: string;
  /** 出した所（内閣府・〇〇市）。分からなければ空 */
  issuer: string;
  pages: number;
  fields: MappingField[];
  /** 様式の字の書体（T86。無ければゴシック） */
  typeface?: Typeface;
  /** 読み取りに失敗した頁（T120。読めた頁の欄だけで対応表にした。無ければ全部の頁を読めた） */
  unread?: number[];
};

/** 区切りの空きを持てる欄の形（T120。選ぶ欄は選択肢の □） */
export const PART_SHAPES: readonly FieldShape[] = ["date", "phone", "text"];
/** 欄の形が選択肢・区切りの場所を持つか */
export const keepsOptionBoxes = (shape: FieldShape) => shape === "choice" || PART_SHAPES.includes(shape);

// ---------- 画面の言葉（2〜4 字の漢語） ----------

export const MAPPING_LABELS = {
  title: "様式対応",
  read: "読取",
  reading: "読取中",
  manual: "手作成",
  save: "確認保存",
  saving: "保存中",
  saved: "保存済",
  draft: "下書き",
  checked: "確認済",
  addField: "欄追加",
  remove: "外す",
  restore: "戻す",
  removed: "除外",
  noItem: "対応なし",
  changed: "修正済",
  added: "手追加",
  rejected: "項目不明",
  reused: "読取済",
  fill: "差込",
  print: "印刷",
  back: "戻る",
  aiNotConfigured: "AI 未設定",
  aiLimit: "上限到達",
  aiFailed: "AI 失敗",
  aiRefused: "AI 不可",
  conflict: "競合",
  invalid: "入力不備",
  unknownItem: "項目不明",
  fileType: "形式外",
  fileLarge: "容量超過",
  fileEmpty: "空ファイル",
  /** 黒塗りの画面を通っていない（生の写真・PDF、付け足しのある JPEG、隠した所 0 で人が選んだ印が無い）。入れる欄と同じ言葉 */
  notRedacted: "未加工",
  notFound: "該当なし",
  forbidden: "権限なし",
  unconfirmed: "未確認",
  unmapped: "対応なし",
  withheld: "省略",
  // ---- 値の場所（T86） ----
  box: "位置",
  noBox: "位置なし",
  addBox: "位置追加",
  clearBox: "位置解除",
  boxMoved: "位置修正",
  typeface: "書体",
  /** 欄に収まらない値を書く別の紙。欄には「別紙」と書く */
  annex: "別紙",
  // ---- T120 ----
  /** 読み取りに失敗した頁 */
  unread: "未読",
  /** 台帳の項目なしで、人が選ぶ欄（同意など） */
  pick: "要選択",
  /** AI の挙げた候補の項目 */
  candidate: "候補",
  /** 候補をそのまま使う */
  adopt: "採用",
  /** 区切りの字（年 月 日・− −） */
  parts: "区切り",
} as const;

// ---------- 長さの上限（画面・保存・AI の返事で同じ） ----------

/** 読む写真・PDF 1 つの上限。写真は API の上限（5 MB）、PDF も同じにそろえる（様式は数頁なので足りる） */
export const FORM_FILE_MAX_BYTES = 5 * 1024 * 1024;

export const LIMITS = { title: 80, issuer: 40, section: 40, label: 80, position: 60, reason: 120, option: 30, options: 16, fields: 200, pages: 20 } as const;

const clip = (s: string, n: number) => s.trim().slice(0, n);

/** 電話番号らしい並び（様式に見本の番号が印刷されていることがある）。対応表には残さない */
const PHONE_LIKE = /(?<![0-9０-９])[0０][0-9０-９]{1,4}[-‐－ー ]?[0-9０-９]{1,4}[-‐－ー ]?[0-9０-９]{3,4}(?![0-9０-９])/g;
const PHONE_MARK = "（番号）";

/** 長さを切り、電話番号らしい並びを消す（対応表に残す文字。T120 から読み取りの続きの頼みにも） */
export function clean(s: string, n: number): string {
  return clip(s.replace(PHONE_LIKE, PHONE_MARK), n);
}

// ---------- AI の返事の検査 ----------

/** Claude の返事の形（lib/forms/form-read.ts の schema と同じ）。item は文字のまま受け、ここで台帳の一覧と照らす */
export type ReadResult = {
  title: string;
  issuer: string;
  pages: number;
  fields: Array<{
    page: number;
    section: string;
    label: string;
    position: string;
    shape: FieldShape;
    options: string[];
    item: string | null;
    /** 項目なしの欄の候補（T120。無い返事もある） */
    candidate?: string | null;
    confidence: Confidence;
    reason: string;
    /** 値を書く場所（T86。前の固定の返事〔内閣府の様式例〕には無い） */
    box?: FieldBox | null;
    /** choice の選択肢ごとの場所（options と同じ順） */
    option_boxes?: Array<FieldBox | null>;
  }>;
  /** 様式の字の書体（T86） */
  typeface?: Typeface;
  /** 読めなかった頁（T120） */
  unread?: number[];
};

/**
 * 選択肢と、その場所の並びをそろえて切る（空の選択肢を落とすと、場所もいっしょに落とす）。
 * 場所が 1 つも無ければ optionBoxes は付けない
 */
function optionsOf(rawOptions: readonly unknown[], rawBoxes: unknown): { options: string[]; optionBoxes?: Array<FieldBox | null> } {
  const boxes = Array.isArray(rawBoxes) ? rawBoxes : [];
  const pairs: Array<{ label: string; box: FieldBox | null }> = [];
  rawOptions.forEach((o, i) => {
    if (typeof o !== "string") return;
    const label = clean(o, LIMITS.option);
    if (label !== "") pairs.push({ label, box: clampBox(boxes[i]) });
  });
  const kept = pairs.slice(0, LIMITS.options);
  const options = kept.map((p) => p.label);
  return kept.some((p) => p.box !== null) ? { options, optionBoxes: kept.map((p) => p.box) } : { options };
}

const typefaceOf = (v: unknown): Typeface => ((TYPEFACES as readonly unknown[]).includes(v) ? (v as Typeface) : "gothic");

/**
 * 頁の数を、受けた頁の画像の数にそろえる（T86）。AI の言う頁の数は信じず、欄の頁も画像の数の中に収める
 * （値を置く紙は頁の画像を下に敷くので、頁の番号が画像の順と合っていないと別の頁に字が乗る）
 */
export function fitPages(m: FormMapping, pages: number): FormMapping {
  const n = Math.min(Math.max(1, Math.trunc(pages) || 1), LIMITS.pages);
  return { ...m, pages: n, fields: m.fields.map((f) => (f.page > n ? { ...f, page: n } : f)) };
}

export type CheckedRead = {
  mapping: FormMapping;
  /** 台帳に無い項目名を返した欄（欄の id と返った名前） */
  rejected: Array<{ id: string; label: string; item: string }>;
};

/**
 * AI の返事を対応表にする。台帳に無い項目名は弾き（item を null、自信を低に、名前を ai.rejected に残す）、
 * 名前の無い欄は落とし、長さを切り、電話番号らしい並びを消す
 */
export function checkReadResult(r: ReadResult): CheckedRead {
  const rejected: CheckedRead["rejected"] = [];
  const fields: MappingField[] = [];
  const pages = Math.min(Math.max(1, Math.trunc(r.pages) || 1), LIMITS.pages);
  for (const f of r.fields) {
    if (fields.length >= LIMITS.fields) break;
    const label = clean(f.label, LIMITS.label);
    if (!label) continue;
    const id = `f${fields.length + 1}`;
    const raw = f.item?.trim() || null;
    const known = isLedgerItemKey(raw) ? raw : null;
    const ai: AiReading = {
      item: known,
      confidence: raw && !known ? "low" : f.confidence,
      reason: clean(f.reason, LIMITS.reason),
    };
    if (raw && !known) {
      ai.rejected = clean(raw, LIMITS.label);
      rejected.push({ id, label, item: ai.rejected });
    }
    // 候補（T120）は項目なしの欄で、台帳の一覧にある物だけ
    const cand = f.candidate?.trim() || null;
    if (!known && f.shape !== "handwrite" && isLedgerItemKey(cand)) ai.candidate = cand;
    // 手で書く欄に台帳の値は入れない
    const item = f.shape === "handwrite" ? null : known;
    // 場所（T86）。返事に場所の欄があれば AI の読んだ物として残す（人が動かしたかを数える）
    const box = clampBox(f.box);
    if (f.box !== undefined) ai.box = box;
    const opts = optionsOf(f.options, keepsOptionBoxes(f.shape) ? f.option_boxes : undefined);
    fields.push({
      id,
      page: Math.min(Math.max(1, Math.trunc(f.page) || 1), pages),
      section: clean(f.section, LIMITS.section),
      label,
      position: clean(f.position, LIMITS.position),
      shape: f.shape,
      ...opts,
      item,
      removed: false,
      ai,
      ...(f.box !== undefined ? { box } : {}),
    });
  }
  return {
    mapping: {
      title: clean(r.title, LIMITS.title) || "様式",
      issuer: clean(r.issuer, LIMITS.issuer),
      pages,
      fields,
      ...(r.typeface !== undefined ? { typeface: typefaceOf(r.typeface) } : {}),
      ...unreadOf(r.unread, pages),
    },
    rejected,
  };
}

/** 読めなかった頁の並び（1〜頁の数、重ねない、昇順）。無ければ欄ごと付けない */
function unreadOf(v: unknown, pages: number): { unread?: number[] } {
  if (!Array.isArray(v)) return {};
  const list = [...new Set(v.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= pages))].sort((a, b) => a - b);
  return list.length > 0 ? { unread: list } : {};
}

// ---------- 画面から保存する対応表の検査 ----------

export type MappingInputError = "invalid" | "unknown_item" | "duplicate_id" | "too_many";

/** 保存の要求の対応表を確かめる。台帳に無い項目名があれば弾く（unknown_item）。形が違えば invalid */
export function parseMappingInput(v: unknown): { ok: true; mapping: FormMapping } | { ok: false; error: MappingInputError; at?: string } {
  if (!v || typeof v !== "object") return { ok: false, error: "invalid" };
  const o = v as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" ? x : null);
  const title = str(o.title);
  const issuer = str(o.issuer) ?? "";
  if (title === null || !Array.isArray(o.fields) || typeof o.pages !== "number") return { ok: false, error: "invalid" };
  if (o.fields.length > LIMITS.fields) return { ok: false, error: "too_many" };
  const pages = Math.min(Math.max(1, Math.trunc(o.pages)), LIMITS.pages);
  const ids = new Set<string>();
  const fields: MappingField[] = [];
  for (const raw of o.fields as unknown[]) {
    if (!raw || typeof raw !== "object") return { ok: false, error: "invalid" };
    const f = raw as Record<string, unknown>;
    const id = str(f.id);
    const label = str(f.label);
    if (!id || !/^f[0-9]{1,4}$/.test(id) || label === null || typeof f.page !== "number") return { ok: false, error: "invalid" };
    if (ids.has(id)) return { ok: false, error: "duplicate_id", at: id };
    ids.add(id);
    if (!(FIELD_SHAPES as readonly unknown[]).includes(f.shape)) return { ok: false, error: "invalid", at: id };
    if (f.item !== null && !isLedgerItemKey(f.item)) return { ok: false, error: "unknown_item", at: id };
    const ai = parseAi(f.ai);
    if (ai === undefined) {
      const aiItem = f.ai && typeof f.ai === "object" ? (f.ai as Record<string, unknown>).item : null;
      return { ok: false, error: aiItem !== null && aiItem !== undefined && !isLedgerItemKey(aiItem) ? "unknown_item" : "invalid", at: id };
    }
    const shape = f.shape as FieldShape;
    const cleanLabel = clean(label, LIMITS.label);
    if (!cleanLabel) return { ok: false, error: "invalid", at: id };
    // 場所（T86）は 0〜1 の中に収めて受ける（はみ出しは切る、形の違う物は場所なし）。前の対応表には無い
    const opts = optionsOf(Array.isArray(f.options) ? f.options : [], keepsOptionBoxes(shape) ? f.optionBoxes : undefined);
    fields.push({
      id,
      page: Math.min(Math.max(1, Math.trunc(f.page)), pages),
      section: clean(str(f.section) ?? "", LIMITS.section),
      label: cleanLabel,
      position: clean(str(f.position) ?? "", LIMITS.position),
      shape,
      ...opts,
      item: shape === "handwrite" ? null : (f.item as LedgerItemKey | null),
      removed: f.removed === true,
      ai,
      ...(f.box !== undefined ? { box: clampBox(f.box) } : {}),
    });
  }
  return {
    ok: true,
    mapping: {
      title: clean(title, LIMITS.title) || "様式",
      issuer: clean(issuer, LIMITS.issuer),
      pages,
      fields,
      ...(o.typeface !== undefined ? { typeface: typefaceOf(o.typeface) } : {}),
      ...unreadOf(o.unread, pages),
    },
  };
}

/** 保存の要求の ai（AI が読んだ物）。無ければ null、形が違えば undefined */
function parseAi(v: unknown): AiReading | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object") return undefined;
  const a = v as Record<string, unknown>;
  if (a.item !== null && !isLedgerItemKey(a.item)) return undefined;
  if (!(CONFIDENCES as readonly unknown[]).includes(a.confidence) || typeof a.reason !== "string") return undefined;
  const out: AiReading = { item: a.item as LedgerItemKey | null, confidence: a.confidence as Confidence, reason: clean(a.reason, LIMITS.reason) };
  if (typeof a.rejected === "string" && a.rejected) out.rejected = clean(a.rejected, LIMITS.label);
  if (a.box !== undefined) out.box = clampBox(a.box);
  if (isLedgerItemKey(a.candidate)) out.candidate = a.candidate;
  return out;
}

// ---------- 数え方 ----------

export type MappingStats = {
  /** 差し込みに出す欄（外した欄を除く） */
  fields: number;
  /** AI が読んだ欄 */
  read: number;
  /** AI が台帳の項目に対応させた欄 */
  autoMapped: number;
  /** AI の対応をそのまま使う欄 */
  kept: number;
  /** 人が直した欄（項目を変えた・外した） */
  changed: number;
  /** 人が足した欄 */
  added: number;
  /** 台帳の項目に対応する欄（外した欄を除く） */
  mapped: number;
  /** 値を書く場所がある欄（外した欄を除く。T86） */
  placed: number;
  /** AI が読んだ場所を人が動かした・外した・足した欄（T86。AI が場所を読んだ欄だけ数える） */
  boxMoved: number;
};

export function fieldChanged(f: MappingField): boolean {
  return f.ai !== null && (f.removed || f.item !== f.ai.item);
}

/** AI が読んだ場所から人が動かしたか（場所を読む前の対応表・手で足した欄は false） */
export function boxMoved(f: MappingField): boolean {
  return f.ai !== null && f.ai.box !== undefined && !f.removed && !sameBox(f.ai.box, f.box ?? null);
}

export function mappingStats(m: FormMapping): MappingStats {
  const read = m.fields.filter((f) => f.ai !== null);
  return {
    fields: m.fields.filter((f) => !f.removed).length,
    read: read.length,
    autoMapped: read.filter((f) => f.ai!.item !== null).length,
    kept: read.filter((f) => f.ai!.item !== null && !fieldChanged(f)).length,
    changed: read.filter(fieldChanged).length,
    added: m.fields.filter((f) => f.ai === null).length,
    mapped: m.fields.filter((f) => !f.removed && f.item !== null).length,
    placed: m.fields.filter((f) => !f.removed && (f.box ?? null) !== null).length,
    boxMoved: m.fields.filter(boxMoved).length,
  };
}

/** 次の欄の id（手で足すとき） */
export function nextFieldId(fields: readonly MappingField[]): string {
  const n = fields.reduce((max, f) => Math.max(max, Number(f.id.slice(1)) || 0), 0);
  return `f${n + 1}`;
}

/** 手で足す空の欄 */
export function blankField(fields: readonly MappingField[], page = 1): MappingField {
  return { id: nextFieldId(fields), page, section: "", label: "", position: "", shape: "text", options: [], item: null, removed: false, ai: null };
}

// ---------- 人が選ぶ欄（T120） ----------

/** 同意・承諾の欄（決まりで AI が項目なしにする。取りこぼすと全部の紙で空く。評価の 1 回目の 11） */
const CONSENT_LIKE = /同意|承諾/;

/**
 * 台帳の項目なしで、人が選ぶ欄か（確かめの画面で目立たせる）。外した欄・手書きの欄は除く。
 * AI が候補を挙げた欄と、同意・承諾の欄（候補が無くても）
 */
export function needsPick(f: MappingField): boolean {
  if (f.removed || f.item !== null || f.shape === "handwrite") return false;
  return f.ai?.candidate !== undefined || CONSENT_LIKE.test(`${f.section} ${f.label}`);
}
