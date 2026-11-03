// 画面の言葉。2〜4 字の漢語を基本にする（CLAUDE.md「画面の決まり」）。

import type {
  Ability,
  AuthorRole,
  CareLevel,
  CheckStatus,
  ClockCategory,
  ClockKind,
  ClockSource,
  ClockStart,
  ClockUnit,
  ConsentKind,
  ConsentStatus,
  ContactKind,
  ContactReach,
  DependsOn,
  DeviceKind,
  HazardKind,
  Household,
  Ledger,
  MedicationCategory,
  MyTimeline,
  PendingStatus,
  PlanStatus,
  Sex,
  SmartphoneUse,
  SupportKind,
  TimelineKind,
} from "./db/types.ts";
import type { Color, Tier } from "./triage/index.ts";

export const CARE_LEVEL_LABELS: Record<CareLevel, string> = {
  support1: "要支援1",
  support2: "要支援2",
  care1: "要介護1",
  care2: "要介護2",
  care3: "要介護3",
  care4: "要介護4",
  care5: "要介護5",
};

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  none: "未作成",
  draft: "下書き",
  consented: "同意済",
  trained: "訓練済",
};

/** 医療依存の短い印。並びは優先の骨格の順 */
export const DEPENDENCE_MARKS: ReadonlyArray<[ClockCategory, string]> = [
  ["ventilator", "呼吸器"],
  ["suction", "吸引"],
  ["oxygen", "酸素"],
  ["dialysis", "透析"],
  ["insulin", "インスリン"],
  ["tube_feeding", "経管栄養"],
  ["antiplatelet", "抗血小板"],
  ["anticoagulant", "抗凝固"],
  ["steroid", "ステロイド"],
  ["antiepileptic", "抗てんかん"],
  ["dementia", "認知症"],
];

/** 外の物に頼る時計の頼り先。理由の 1 行は「透析先 未確認」の形 */
export const DEPENDS_ON_LABELS: Record<DependsOn, string> = {
  dialysis_center: "透析先",
  refrigeration: "冷蔵",
  delivery: "配達",
  storage: "保管",
};

export const CHECK_STATUS_LABELS: Record<CheckStatus, string> = {
  confirmed: "確認済",
  unconfirmed: "未確認",
};

export const HAZARD_LABELS: Record<HazardKind, string> = {
  flood: "浸水",
  landslide: "土砂",
  tsunami: "津波",
};

/** 安否の 4 色 */
export const COLOR_LABELS: Record<Color, string> = {
  red: "至急",
  yellow: "要確認",
  gray: "不明",
  green: "無事",
};

/** 優先の骨格の名前（docs/SPEC.md「医療の芯」） */
export const TIER_LABELS: Record<Tier, string> = {
  1: "人工呼吸器・吸引",
  2: "在宅酸素",
  3: "透析",
  4: "インスリン・経管栄養",
  5: "抗血小板薬・抗凝固薬・ステロイド・抗てんかん薬",
  6: "認知症で独居",
  7: "寝たきりで支援者なし",
  8: "それ以外",
};

// ---------- 本人のページ（T02） ----------

/** 本人のページの区分。並びは lib/person.ts の sectionOrder */
export const SECTION_LABELS = {
  medical: "医療",
  evacuation: "避難",
  people: "人",
  basic: "基本",
  consent: "同意",
  documents: "書類",
  timeline: "経過",
} as const;

export const SEX_LABELS: Record<Sex, string> = { female: "女", male: "男", other: "その他" };

export const HOUSEHOLD_LABELS: Record<Household, string> = {
  alone: "独居",
  with_spouse: "夫婦",
  with_child: "子と同居",
  with_family: "家族と同居",
};

/** スマホ: 使える・見るだけ・持たない */
export const SMARTPHONE_LABELS: Record<SmartphoneUse, string> = { uses: "使用可", views: "閲覧のみ", none: "なし" };

/** 内閣府様式の裏の 6 項目 */
export const ABILITY_ITEM_LABELS: Record<
  "walking" | "hearing" | "vision" | "understanding" | "judgment" | "orientation",
  string
> = {
  walking: "歩行",
  hearing: "聴覚",
  vision: "視覚",
  understanding: "理解",
  judgment: "判断",
  orientation: "見当識",
};

export const ABILITY_LABELS: Record<Ability, string> = { ok: "問題なし", some: "一部", hard: "困難" };

/** マイ・タイムラインの作成（松山市の様式の選択肢） */
export const MY_TIMELINE_LABELS: Record<MyTimeline, string> = { app: "あり（アプリ）", paper: "あり（紙）", none: "なし" };

/** 支援の内容（松山市の様式の選択肢を短く） */
export const SUPPORT_KIND_LABELS: Record<SupportKind, string> = {
  call: "声掛け",
  guide: "誘導",
  assist: "移動介助",
  other: "その他",
};

type Structure = NonNullable<NonNullable<Ledger["basic"]["housing"]>["structure"]>;
export const STRUCTURE_LABELS: Record<Structure, string> = {
  wood: "木造",
  steel: "鉄骨",
  concrete: "鉄筋",
  other: "その他",
};

export const DEVICE_LABELS: Record<DeviceKind, string> = {
  oxygen: "在宅酸素",
  ventilator: "人工呼吸器",
  suction: "吸引",
  tube_feeding: "経管栄養",
  dialysis: "透析",
};

/** 災害診療記録 2018 の【特記事項（常用薬等）】の区分 */
export const MEDICATION_CATEGORY_LABELS: Record<MedicationCategory, string> = {
  antiplatelet: "抗血小板薬",
  anticoagulant: "抗凝固薬",
  insulin: "インスリン",
  oral_diabetes: "経口糖尿病薬",
  steroid: "ステロイド",
  antiepileptic: "抗てんかん薬",
  other: "その他",
};

/** 薬の印。中断すると危ない薬と、冷蔵が要る薬 */
export const MEDICATION_FLAG_LABELS = { interruptionRisk: "中断注意", needsRefrigeration: "要冷蔵" } as const;

/** 時計の 4 つ: A 機器・B 物・C 薬・D 本人の状態 */
export const CLOCK_KIND_LABELS: Record<ClockKind, string> = {
  device: "機器",
  supply: "物",
  medication: "薬",
  condition: "状態",
};

export const CLOCK_UNIT_LABELS: Record<ClockUnit, string> = { minute: "分", hour: "時間", day: "日", week: "週" };

/** 医療の印に添える時計の残りの短い形（「酸素 4h」「透析 2日」。11/3 03:3x の確定 8） */
export const CLOCK_UNIT_SHORT: Record<ClockUnit, string> = { minute: "分", hour: "h", day: "日", week: "週" };

/** 時計が走り出すきっかけ */
export const CLOCK_START_LABELS: Record<ClockStart, string> = { outage: "停電", disaster: "発災", none: "なし" };

/** 時計の値の出典 */
export const CLOCK_SOURCE_LABELS: Record<ClockSource, string> = {
  doctor: "主治医",
  device_manual: "説明書",
  pharmacy: "薬局",
  facility: "施設",
  family: "家族",
  self: "本人",
  care_manager: "ケアマネ",
};

export const CONTACT_KIND_LABELS: Record<ContactKind, string> = {
  self: "本人",
  family: "家族",
  supporter: "支援者",
  welfare_commissioner: "民生委員",
  visiting_nurse: "訪問看護",
  care_service: "介護事業所",
  home_doctor: "かかりつけ",
  pharmacy: "薬局",
  dialysis_center: "透析施設",
  city_office: "市役所",
};

export const CONTACT_REACH_LABELS: Record<ContactReach, string> = {
  together: "同居",
  nearby: "近所",
  in_city: "市内",
  out_of_pref: "県外",
  far: "遠方",
};

/** 連絡先の持ち物・来られる時間（夜間） */
export const CONTACT_FLAG_LABELS = {
  hasCar: "車",
  nightOk: "夜間可",
  nightNo: "夜間不可",
  nightUnknown: "夜間未確認",
  hasSmartphone: "スマホ",
} as const;

/** 薬・機器の行の中の小さな見出し */
export const MED_PARTS = { amount: "用量", remaining: "残り", storage: "保管", battery: "電池" } as const;

/** 心身の印 */
export const CARE_FLAG_LABELS = { bedridden: "寝たきり", dementia: "認知症" } as const;

/** 本人のページの上の段の見出し */
export const HEAD_LABELS = {
  age: "年齢",
  careLevel: "介護度",
  plan: "避難計画",
  unconfirmed: "未確認",
  priority: "連絡順",
  marks: "医療",
  clocks: "時計",
  emergency: "緊急連絡先",
  /** 災害モードの時計の今の残り（「残り 1.5 時間」「超過 30 分」「停電で開始」。担当一覧の行の詳細と同じ言い方） */
  left: "残り",
  over: "超過",
  startsOn: "で開始",
} as const;

/** 時計の行の中の小さな見出し */
export const CLOCK_PARTS = { confirmed: "確認", source: "出典", start: "起点" } as const;

/** 同意 4 つ */
export const CONSENT_KIND_LABELS: Record<ConsentKind, string> = {
  registry: "名簿登録",
  plan_share: "計画共有",
  supporters: "支援者提供",
  medical: "医療班提供",
};

export const CONSENT_STATUS_LABELS: Record<ConsentStatus, string> = {
  granted: "同意",
  refused: "不同意",
  unconfirmed: "未確認",
};

/** 空欄の理由（分からない・まだ聞いていない・答えない）。どれも画面には「未確認」と出し、横に添える */
export const PENDING_STATUS_LABELS: Record<PendingStatus, string> = {
  unknown: "不明",
  not_asked: "未聴取",
  declined: "無回答",
};

/** 空欄の言い方 */
export const BLANK_LABELS = { unconfirmed: "未確認", none: "なし" } as const;

export const TIMELINE_KIND_LABELS: Record<TimelineKind, string> = {
  signal: "安否",
  called: "電話",
  pickup: "迎え決定",
  safety_check: "安否確認",
  examined: "診察",
  medication_given: "配薬",
  transported: "搬送",
  arrived_shelter: "到着",
  // 医療班・行政が受け持ちに入れた（T23。受領は物を受け取る言葉なので「受入」。様式 9 の結果の列もこれを読む）
  received: "受入",
  released: "受持解除",
  override: "順番変更",
  consent: "同意",
  clock_check: "時計確認",
  self_report_mark: "印変更",
  note: "記録",
};

/** 種の表から作る経過の種類（台帳を作った・同意を記録した） */
export const DERIVED_TIMELINE_LABELS = { created: "入力", consent: "同意" } as const;

export const AUTHOR_ROLE_LABELS: Record<AuthorRole, string> = {
  self: "本人",
  family: "家族",
  supporter: "支援者",
  care_manager: "ケアマネ",
  medical: "医療班",
  government: "行政",
  system: "自動",
};

/** 入れる欄（T03）の言葉 */
export const INTAKE_LABELS = {
  title: "入力",
  tabText: "文字",
  tabManual: "手入力",
  placeholder: "様子・ケアプランを貼る",
  extract: "抽出",
  save: "保存",
  discard: "取消",
  edit: "修正",
  addMedication: "薬追加",
  addNote: "特記追加",
  changes: "変更点",
  question: "質問",
  marks: "付く印",
  noQuestion: "空欄なし",
  dropped: "除外",
  overwrite: "上書き",
  busy: "処理中",
  saved: "保存済",
  unchanged: "変更なし",
  aiNotConfigured: "AI 未設定",
  aiLimit: "上限到達",
  aiFailed: "AI 失敗",
  aiRefused: "AI 不可",
  leak: "送信不可",
  conflict: "競合",
  failed: "保存失敗",
  invalid: "入力不備",
  masked: "伏せ字",
  next: "次回",
  /** 話して入れる（T04、Web Speech）。「話す」は T04 の言葉のまま */
  speak: "話す",
  speakStop: "停止",
  listening: "認識中",
  micDenied: "マイク不可",
  noSpeech: "音声なし",
  speechFailed: "認識失敗",
  retry: "再試行",
  edited: "修正済",
  // ---- T45: 入れる欄を AI 専用に（文字・写真と PDF・小さなマイク）と会話の流れ ----
  /** 分ける（文を Claude が台帳の欄に分ける主のボタン） */
  split: "分ける",
  /** 写真・PDF を選んで読ませる */
  readFile: "写真・PDF 読取",
  reading: "読取中",
  fileType: "形式外",
  fileLarge: "容量超過",
  fileEmpty: "空ファイル",
  /** 会話の流れの見出しと吹き出しの書き手 */
  log: "やりとり",
  you: "入力",
  ask: "問い",
  answer: "答え",
  /** 残りの問い（「残り 4 問」） */
  left: "残り",
  leftUnit: "問",
  /** 本人のページの面の右上の「編集」と、その下の保存・取消 */
  sectionEdit: "編集",
  /** 時計の頼り先の確認（確認済にする・未確認に戻す） */
  checkOn: "確認",
  checkOff: "確認取消",
  addContact: "連絡先追加",
  addHazard: "ハザード",
  addDevice: "機器",
  /** 面の編集で行を外す・外す印を戻す（保存の前に確認の窓） */
  drop: "外す",
  undrop: "戻す",
  dropMark: "外す予定",
  /** 確認の窓の題と決める方のボタン */
  dropTitle: "外す確認",
  /** 時計の値を変えずに今日確かめた（clockSeen） */
  seen: "値確認",
  seenOff: "値確認取消",
  seenToday: "本日確認",
  /** 黒塗りの画面を通っていない写真・PDF（サーバーが断る。T52） */
  notRedacted: "未加工",
} as const;

/**
 * 写真・PDF を送る前に塗って隠す画面（T52。T45 の読む前の確認の窓「読取確認」を置き換えた）。
 * 写った氏名・住所・電話・町名を人が四角で黒く塗り、塗った後の画像だけを送る。元の写真・PDF はブラウザの外へ出さない。
 * ボタン・見出し・状態は 2〜4 字
 */
export const REDACT_LABELS = {
  /** 窓の題と、題の横の小さな字（塗る物。生年月日・保険者番号は 11/3 18:0x の T52-4 で足した） */
  title: "黒塗り",
  what: "氏名・住所・電話・町名・生年月日・保険者番号",
  /** 指・マウスで引くと塗る／画像を送る（拡大中）。2 つのどちらか */
  paint: "塗る",
  move: "移動",
  undo: "一手戻す",
  /** 押して選んだ四角を外す */
  remove: "外す",
  /** この頁の四角を全部外す */
  clear: "全解除",
  zoomIn: "拡大",
  zoomOut: "縮小",
  fit: "全体",
  prev: "前頁",
  next: "次頁",
  send: "送信",
  cancel: "取消",
  /** 写真・PDF を画像にしている間 */
  preparing: "準備中",
  /** 塗った後の画像にしている間・できなかった */
  encoding: "変換中",
  encodeFailed: "変換失敗",
  /** 「隠した所 3」（全部の頁）と「頁内 1」（今の頁。2 頁以上のときだけ） */
  hidden: "隠した所",
  onPage: "頁内",
  /** 読めなかった（壊れた PDF・形の違う物） */
  unreadable: "読込不可",
  /** 頁の上限を超えた PDF（「12 頁中 3 頁」） */
  pagesOf: (shown: number, total: number) => `${total} 頁中 ${shown} 頁`,
  /** 塗らずに送るときの確認の窓 */
  noneTitle: "隠す所なし",
  noneText: "塗った所の無い頁があります",
  noneOk: "隠す所は無い",
  noneBack: "戻る",
  /** 頁の呼び名（「お薬手帳.pdf 2 頁」）。1 頁の物はファイル名だけ */
  pageName: (file: string, page: number, pages: number) => (pages > 1 ? `${file} ${page} 頁` : file),
} as const;

/** 外す確認の窓の文（「ワーファリン・隣人 の 2 件を外します」） */
export const dropConfirmText = (names: readonly string[]) =>
  `${names.slice(0, 6).join("・")}${names.length > 6 ? ` ほか ${names.length - 6}` : ""} の ${names.length} 件を外します。経過に「ケアマネが外した」と残ります。`;

/** 会話の流れの AI と人の言葉（T45）。AI の言葉は Claude の出力の数を数えるだけで、文は定型 */
export const INTAKE_SAYS = {
  /** 「7 項目に分けました（医療 3・連絡先 2・避難 2）」 */
  split: (n: number, parts: string) => `${n} 項目に分けました${parts ? `（${parts}）` : ""}`,
  /** 分ける物が無かった */
  none: "本人のページに入る事は見つかりませんでした",
  /** 写真・PDF を読んだ（「お薬手帳.jpg を読みました」） */
  read: (name: string) => `${name} を読みました`,
  /** 黒塗りした画像を送った（入力の吹き出し。「お薬手帳.jpg（隠した所 3）」） */
  sent: (name: string, hidden: number) => `${name}（隠した所 ${hidden}）`,
  saved: (n: number) => `${n} 件を保存しました`,
  unchanged: "変わった所はありませんでした",
  discarded: "変更点を取り消しました",
  skipped: "次回に回しました",
  pending: (status: string) => `「${status}」と記録しました`,
  done: "空欄はありません",
} as const;

/** AI 失敗の理由（ai_calls の error に合わせる。形の違いのうち途中で切れた物だけ分ける） */
export const AI_FAIL_REASON_LABELS = {
  schema: "形式相違",
  max_tokens: "出力超過",
  refused: "拒否",
  timeout: "時間切れ",
  api_error: "呼出失敗",
} as const;

/** 差分の状態: 追加（空いた所に入る）・一致（今と同じ）・既入力（今と違う。既定では保存しない） */
export const DIFF_STATE_LABELS = { add: "追加", same: "一致", filled: "既入力" } as const;

/** 書類（T05〜T07 で作る）の入口 */
export const DOCUMENT_LABELS = { matsuyama: "計画書", medical: "医療要約", own: "本人の1枚", qr: "QR" } as const;
export const DOCUMENT_STATUS_LABELS = { pending: "準備中", ready: "表示" } as const;

/**
 * 赤のあとの聞き取りの欄（T49）。本人・家族が押した答えと、Claude の聞き取りメモ（文字起こしから写しただけ）を同じ欄で出す。
 * 事実の欄だけで、重さ・点数を持たない。欄の id は lib/signals/questions.ts の HEARING_FIELDS
 */
export const HEARING_FIELD_LABELS = {
  place: "場所",
  trapped: "閉込め",
  body: "体の訴え",
  injury: "けが",
  water: "水",
  fireGas: "火・ガス",
  device: "機器",
  medicine: "薬",
  nearby: "そばの人",
  contact: "連絡手段",
  request: "頼みごと",
} as const;

/** 聞き取りの欄の画面の言葉（ケアマネの行の詳細） */
export const HEARING_LABELS = {
  title: "聞き取り",
  field: "欄",
  value: "内容",
  pressed: "押下",
  voice: "声",
  edited: "修正済",
  edit: "修正",
  save: "保存",
  cancel: "取消",
  clear: "空欄",
  saving: "保存中",
  failed: "保存失敗",
  none: "未回答",
} as const;
