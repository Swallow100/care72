// D1 の表の型。列の名前は SQL のまま（snake_case）。値の形は migrations（0001_init.sql と、表を建て直した 0002 以降）の CHECK と同じにする。
// 選択肢を足すときは、ここの配列と SQL の CHECK の両方を直す（新しい migration で）。
//
// 人が付ける欄（people.self_report_unreliable、clocks.depends_on・depends_check）は台帳の JSON（Ledger）に入れず、
// 表の列に持つ。Claude が台帳を埋める道（Ledger）と、仮名化の層が Claude に渡す形（ClaudePerson）には入れない。
// Claude が自由文から推し量って付けることはしない。付けた・外したは経過（clock_check・self_report_mark）に残す。

// ---------- 選択肢 ----------

/** アンケートのリンクを作った人（T42）: ケアマネ（山本など）・審査員（試し。毎朝の戻しで消える） */
export const SURVEY_CREATOR_ROLES = ["care_manager", "judge"] as const;
export type SurveyCreatorRole = (typeof SURVEY_CREATOR_ROLES)[number];

/** デモ・ふつう・所属なし（医療班・行政がその場で作った人の置き場。1 行だけ、ケアマネはいない。T23） */
export const OFFICE_KINDS = ["demo", "regular", "unaffiliated"] as const;
export type OfficeKind = (typeof OFFICE_KINDS)[number];

/** ケアマネ・行政・医療班・審査員 */
export const ACCOUNT_ROLES = ["care_manager", "government", "medical", "judge"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/** 計画の状態: 未作成・下書き・同意済・訓練済 */
export const PLAN_STATUSES = ["none", "draft", "consented", "trained"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

/** 台帳を作った所: ケアマネ、または医療班がその場で最小の項目で */
export const PERSON_ORIGINS = ["care_manager", "on_site"] as const;
export type PersonOrigin = (typeof PERSON_ORIGINS)[number];

export const CONTACT_KINDS = [
  "self", // 本人の電話
  "family", // 家族
  "supporter", // 支援者（隣人など）
  "welfare_commissioner", // 民生委員
  "visiting_nurse", // 訪問看護
  "care_service", // 介護の事業所
  "home_doctor", // かかりつけ
  "pharmacy", // 薬局
  "dialysis_center", // 透析施設
  "city_office", // 市役所
] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

/** どこにいる人か: 同居・近所・市内・県外・遠方 */
export const CONTACT_REACHES = ["together", "nearby", "in_city", "out_of_pref", "far"] as const;
export type ContactReach = (typeof CONTACT_REACHES)[number];

/** 同意 4 つ: 名簿登録・計画の共有・支援者への提供・医療班への提供（決め方は docs/PROGRESS.md の問い） */
export const CONSENT_KINDS = ["registry", "plan_share", "supporters", "medical"] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

export const CONSENT_STATUSES = ["granted", "refused", "unconfirmed"] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

/** 時計の 4 つ: A 機器・B 物・C 薬・D 本人の状態 */
export const CLOCK_KINDS = ["device", "supply", "medication", "condition"] as const;
export type ClockKind = (typeof CLOCK_KINDS)[number];

/** 何で時間が決まるか。優先の骨格（lib/triage）はこの区分で引く */
export const CLOCK_CATEGORIES = [
  "ventilator", // 人工呼吸器
  "suction", // 吸引
  "oxygen", // 在宅酸素
  "dialysis", // 透析
  "insulin", // インスリン
  "tube_feeding", // 経管栄養
  "antiplatelet", // 抗血小板薬（11/3 に骨格の段 5 へ足した。docs/DECISIONS.md 11/3 04:0x の 2）
  "anticoagulant", // 抗凝固薬
  "steroid", // ステロイド
  "antiepileptic", // 抗てんかん薬
  "dementia", // 認知症
  "other",
] as const;
export type ClockCategory = (typeof CLOCK_CATEGORIES)[number];

export const CLOCK_UNITS = ["minute", "hour", "day", "week"] as const;
export type ClockUnit = (typeof CLOCK_UNITS)[number];

/** 時計が走り出すきっかけ: 停電・発災・走らない（本人の状態） */
export const CLOCK_STARTS = ["outage", "disaster", "none"] as const;
export type ClockStart = (typeof CLOCK_STARTS)[number];

/** 時計の値の出典: 主治医の指示・機器の説明書・薬局・施設・家族・本人・ケアマネの確認 */
export const CLOCK_SOURCES = [
  "doctor",
  "device_manual",
  "pharmacy",
  "facility",
  "family",
  "self",
  "care_manager",
] as const;
export type ClockSource = (typeof CLOCK_SOURCES)[number];

/**
 * 外の物に頼る時計の頼り先: 透析先・冷蔵・配達・保管。頼らない時計は null。
 * ルールの表の入力は透析先・配達だけ（lib/triage の TABLE_DEPENDS）。保管（暑さ・冷蔵）は「確認」の欄の項目で、表には使わない
 * （docs/DECISIONS.md 11/3 04:0x の 1。冷蔵は 11/3 より前の値で、表の入力から外した）
 */
export const DEPENDS_ON = ["dialysis_center", "refrigeration", "delivery", "storage"] as const;
export type DependsOn = (typeof DEPENDS_ON)[number];

/** 頼り先の確認: 確認済・未確認。人が付ける（ルールの表は未確認なら黄にする。docs/DECISIONS.md 案 1） */
export const CHECK_STATUSES = ["confirmed", "unconfirmed"] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export const DRILL_SCENARIOS = ["earthquake", "heavy_rain", "short"] as const;
export type DrillScenario = (typeof DRILL_SCENARIOS)[number];

export const DRILL_STATUSES = ["running", "finished", "abandoned"] as const;
export type DrillStatus = (typeof DRILL_STATUSES)[number];

export const DRILL_ACTORS = ["director", "persona", "care_manager", "world"] as const;
export type DrillActor = (typeof DRILL_ACTORS)[number];

export const DRILL_EVENT_KINDS = [
  "incident", // 監督の差し込み（停電・断水・道路寸断）
  "persona_turn", // ペルソナの 1 刻み
  "call_in", // 着信
  "red_button",
  "recording",
  "action", // ケアマネの手
  "result", // 手を打った結果（世界が返す）
  "score",
  "call_answer", // 着信に応答した（T22、migrations/0002）
  "call_decline", // 着信を拒否した（T22、migrations/0002。赤の拒否は順番の誤り）
] as const;
export type DrillEventKind = (typeof DRILL_EVENT_KINDS)[number];

/** 訓練のケアマネの手 7 つ（11/2 に確定） */
export const DRILL_ACTIONS = [
  "call_person", // 本人に電話
  "call_contact", // 家族・支援者に電話
  "visit", // 自分が出向く
  "dispatch", // 訪問看護・介護の人に出向いてもらう
  "request_welfare_shelter", // 福祉避難所に依頼
  "report_city", // 市役所に報告
  "evacuate_self", // 自分も避難
] as const;
export type DrillAction = (typeof DRILL_ACTIONS)[number];

/** 信号の色: 緑・赤・未知 */
export const SIGNAL_COLORS = ["green", "red", "unknown"] as const;
export type SignalColor = (typeof SIGNAL_COLORS)[number];

/** 誰の画面から来たか。agent は訓練のペルソナ */
export const SIGNAL_SOURCES = ["self", "family", "supporter", "care_manager", "agent"] as const;
export type SignalSource = (typeof SIGNAL_SOURCES)[number];

/** 緑の 1 問: どこにいますか */
export const WHERE_NOW = ["home", "shelter", "other"] as const;
export type WhereNow = (typeof WHERE_NOW)[number];

/** 録音と自由文の分類: けが・動けない・水が来た・機器が止まった・不明。Claude はこれに分けるだけ */
export const RECORDING_CLASSES = ["injury", "immobile", "water", "device_stopped", "unknown"] as const;
export type RecordingClass = (typeof RECORDING_CLASSES)[number];

export const CLASSIFIERS = ["claude", "care_manager"] as const;
export type Classifier = (typeof CLASSIFIERS)[number];

/**
 * 分類できなかった理由（signals.ai_error）。文字起こしが無い・AI 未設定・上限・断られた・形が違う・呼び出しの失敗・伏せきれない。
 * どれも classes は空のまま（色は答えだけで決まる）
 */
export const CLASSIFY_ERRORS = ["no_text", "not_configured", "limit", "refused", "bad_output", "failed", "leak"] as const;
export type ClassifyError = (typeof CLASSIFY_ERRORS)[number];

export const AUTHOR_ROLES = [
  "self",
  "family",
  "supporter",
  "care_manager",
  "medical",
  "government",
  "system",
] as const;
export type AuthorRole = (typeof AUTHOR_ROLES)[number];

export const TIMELINE_KINDS = [
  "signal", // 赤ボタン・緑・録音
  "called", // 電話した
  "pickup", // 迎え決定
  "safety_check", // 安否確認した
  "examined", // 診た
  "medication_given", // 薬を渡した
  "transported", // 搬送した
  "arrived_shelter", // 避難所に着いた
  "received", // 受入（医療班・行政が受け持つ。T23）
  "released", // 受け持ちから外す（搬送・退所）
  "override", // 色と順位の上書き
  "consent", // 同意を変えた
  "clock_check", // 時計の頼り先の確認を変えた（確認済・未確認）。人が付ける
  "self_report_mark", // 本人の報告を当てにしない印を付けた・外した。人が付ける
  "note", // 自由文
] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

/**
 * 入れる欄（T03）の保存は、経過の kind を note にして payload の source をこれにする（画面は「入力」と出す）。
 * 経過の kind に input を足すと timeline_entries の CHECK を作り直す migration が要り、配信済みの D1 の表を建て直すため。
 */
export const INTAKE_SOURCE = "intake";

/** 入れる欄の保存の経過の payload。値は持たず、変えた欄の場所だけ */
export type IntakePayload = {
  source: typeof INTAKE_SOURCE;
  /** Claude の分け方を使ったか（使ったときは画面に AI の印） */
  ai: boolean;
  /** 答えたモデル（ai のときだけ） */
  model: string | null;
  /** 本人のページの面の「編集」で手で直した（T45） */
  edit?: true;
  /** 変えた欄（台帳の場所・連絡先・時計） */
  fields: string[];
};

/** AI を呼ぶ用途。Claude の 7 つ（モデルは lib/claude/models.ts）と、声（Gemini TTS） */
export const AI_PURPOSES = [
  "form_read", // 様式の読み取り
  "director", // 訓練の監督
  "scoring", // 訓練の採点
  "ledger_input", // 入れる欄（文字・話した物 → 項目）
  "summary", // 要約
  "persona", // 訓練の本人役・家族役
  "classify", // 録音と自由文の分類
  "voice", // 声（Gemini TTS）
] as const;
export type AiPurpose = (typeof AI_PURPOSES)[number];

/** 呼び出しの状態。pending は呼んでいる途中（落ちたまま残っても上限には数える） */
export const AI_CALL_STATUSES = ["pending", "ok", "failed"] as const;
export type AiCallStatus = (typeof AI_CALL_STATUSES)[number];

/** 失敗の分け方。本文や応答は残さない */
export const AI_CALL_ERRORS = [
  "refused", // stop_reason が refusal
  "bad_output", // JSON でない・形が違う・max_tokens で切れた
  "timeout", // 時間切れ
  "api_error", // そのほかの API の失敗
] as const;
export type AiCallError = (typeof AI_CALL_ERRORS)[number];

// ---------- 台帳（people.ledger の JSON） ----------

export const SEXES = ["female", "male", "other"] as const;
export type Sex = (typeof SEXES)[number];

export const CARE_LEVELS = [
  "support1",
  "support2",
  "care1",
  "care2",
  "care3",
  "care4",
  "care5",
] as const;
/** 要支援 1・2、要介護 1〜5 */
export type CareLevel = (typeof CARE_LEVELS)[number];

/** 世帯: 独居・夫婦・子と・家族と */
export const HOUSEHOLDS = ["alone", "with_spouse", "with_child", "with_family"] as const;
export type Household = (typeof HOUSEHOLDS)[number];

/** スマホ: 使える・見るだけ・持たない */
export const SMARTPHONE_USE = ["uses", "views", "none"] as const;
export type SmartphoneUse = (typeof SMARTPHONE_USE)[number];

/** 内閣府様式の裏の 6 項目の答え: 問題なし・一部・困難 */
export const ABILITIES = ["ok", "some", "hard"] as const;
export type Ability = (typeof ABILITIES)[number];

export const HAZARD_KINDS = ["flood", "landslide", "tsunami"] as const;
export type HazardKind = (typeof HAZARD_KINDS)[number];

/** 災害診療記録 2018 の【特記事項（常用薬等）】の区分に合わせる */
export const MEDICATION_CATEGORIES = [
  "antiplatelet", // 抗血小板薬
  "anticoagulant", // 抗凝固薬
  "insulin", // 糖尿病治療薬（インスリン）
  "oral_diabetes", // 糖尿病治療薬（経口）
  "steroid",
  "antiepileptic",
  "other",
] as const;
export type MedicationCategory = (typeof MEDICATION_CATEGORIES)[number];

/** 医療機器・医療: 在宅酸素・人工呼吸器・吸引・経管栄養（胃ろう）・透析 */
export const DEVICE_KINDS = ["oxygen", "ventilator", "suction", "tube_feeding", "dialysis"] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

/** マイ・タイムラインの作成: あり（アプリ）・あり（紙）・なし（松山市の様式の選択肢） */
export const MY_TIMELINES = ["app", "paper", "none"] as const;
export type MyTimeline = (typeof MY_TIMELINES)[number];

/** 支援の内容: 避難の声掛け・避難の誘導・移動介助・その他（松山市の様式の選択肢） */
export const SUPPORT_KINDS = ["call", "guide", "assist", "other"] as const;
export type SupportKind = (typeof SUPPORT_KINDS)[number];

/** 空欄の理由: 分からない・まだ聞いていない・答えない。計画には「未確認」と残り、次の訪問の問いになる */
export const PENDING_STATUSES = ["unknown", "not_asked", "declined"] as const;
export type PendingStatus = (typeof PENDING_STATUSES)[number];

/** 緯度経度（世界測地系、度）。担当一覧の右の面の地図のピンに使う */
export type GeoPoint = { lat: number; lng: number };

export type Ledger = {
  basic: {
    sex?: Sex;
    /** 番地は持たない。市町村と町名まで */
    address?: { city: string; town: string };
    /**
     * 地図のピンの位置（T14）。種の 10 人は架空の位置で、町名からの変換はしない。
     * 入れる欄（lib/intake/fields.ts）に持たず、仮名化の層（lib/pseudonym）も渡さないので Claude には届かない
     */
    location?: GeoPoint;
    housing?: {
      /** 住んでいる階 */
      floor?: number;
      /** 建物の階数（平屋は 1） */
      floors?: number;
      structure?: "wood" | "steel" | "concrete" | "other";
      builtYear?: number;
      /** 寝室の場所（1 階 奥の和室 など） */
      bedroom?: string;
    };
    household?: Household;
    contactMeans?: {
      landline?: boolean;
      mobile?: boolean;
      email?: boolean;
      smartphone?: SmartphoneUse;
    };
  };
  care: {
    careLevel?: CareLevel;
    /** 障害者手帳 */
    handbook?: string;
    /** 難病 */
    intractableDisease?: string;
    walking?: Ability;
    hearing?: Ability;
    vision?: Ability;
    understanding?: Ability;
    judgment?: Ability;
    orientation?: Ability;
    bedridden?: boolean;
    dementia?: boolean;
  };
  medical: {
    devices: Array<{ kind: DeviceKind; detail?: string; schedule?: string }>;
    medications: Array<{
      name: string;
      category: MedicationCategory;
      /** 何日に 1 回・朝夕など */
      schedule?: string;
      amount?: string;
      storage?: string;
      needsRefrigeration?: boolean;
      /** 中断すると危ない薬の印 */
      interruptionRisk?: boolean;
    }>;
    allergies?: string[];
    /** 既往症 */
    history?: string[];
    vaccinations?: string[];
  };
  evacuation: {
    hazards: Array<{ kind: HazardKind; depthM?: number }>;
    destination1?: string;
    destination2?: string;
    /**
     * 在宅避難の印（T37、docs/DECISIONS.md 11/3 04:0x の 8）。住まいが安全で、計画で家に留まると決めた人だけ true。
     * 無ければ避難所へ（種は全員）。本人の 1 枚の地震の行を書き分ける
     */
    stayHome?: boolean;
    route?: string;
    /** 段差・エレベーター */
    barriers?: string;
    transport?: string;
    pets?: string;
    carryItems?: string[];
    /** マイ・タイムラインの作成 */
    myTimeline?: MyTimeline;
    /** 支援の内容（避難支援等実施者がすること） */
    support?: SupportKind[];
    /** 支援の内容の書き足し（その他の中身など） */
    supportNote?: string;
  };
  /** 地域の支援者のうち、連絡先の表に持たない人 */
  local?: {
    /** みまもり員（名前と書き足し）。名前なので Claude には有無だけを渡し、自由文では役割名に置き換える */
    watcher?: string;
  };
  /** 特記。本人の言葉は言い換えずにそのまま */
  notes: string[];
  /** 空欄の項目。field は台帳の中の場所（例 "medical.medications.warfarin.remaining"） */
  pending: Array<{ field: string; status: PendingStatus }>;
};

// ---------- 表の行 ----------

export type OfficeRow = {
  id: string;
  name: string;
  kind: OfficeKind;
  city: string;
  created_at: string;
};

/** アンケートの招待のリンク（migrations/0004_survey.sql、T42） */
export type SurveyLinkRow = {
  token: string;
  office_id: string;
  /** 宛先の控え（ケアマネ A など。本名でない） */
  memo: string;
  created_by: string | null;
  created_role: SurveyCreatorRole;
  created_at: string;
  opened_at: string | null;
  used_at: string | null;
  expires_at: string;
};

/** アンケートの答え。記号は tools/survey/questions.ts（a・b・c…）。問 3 は "bcf" のように並べる。答えなしは null */
export type SurveyAnswerRow = {
  token: string;
  role: string | null;
  experience: string | null;
  q1: string | null;
  q2: string | null;
  q3: string | null;
  q4: string | null;
  q5: string | null;
  q6: string | null;
  q7: string | null;
  q7_reason: string | null;
  quote: string | null;
  source_hash: string;
  submitted_at: string;
};

export type AccountRow = {
  id: string;
  office_id: string | null;
  role: AccountRole;
  is_office_admin: 0 | 1;
  display_name: string;
  login_id: string | null;
  password_hash: string | null;
  created_at: string;
};

export type PersonRow = {
  id: string;
  office_id: string;
  care_manager_id: string | null;
  name: string;
  kana: string;
  birth_date: string | null;
  plan_status: PlanStatus;
  origin: PersonOrigin;
  /** 本人の報告を当てにしない印（認知症など）。人が付ける。1 なら本人の緑を未知として扱う（docs/DECISIONS.md 案 4） */
  self_report_unreliable: 0 | 1;
  /** Ledger の JSON の文字列 */
  ledger: string;
  version: number;
  created_at: string;
  updated_at: string;
};

/**
 * 本人の行の「一覧から外した」印（people.unlisted_at、T30）。NULL は一覧にいる。消さずに印だけ。
 * PersonRow に入れないのは、種と本人のページの型に波及させないため（QR の列と同じ扱い）
 */
export type PersonListMark = { unlisted_at: string | null };

/**
 * 申告の年齢（people.reported_age、T23）。医療班・行政がその場で作った人で、生年月日が分からないとき。作った日の年齢。
 * PersonRow に入れないのは unlisted_at と同じ理由（種と本人のページの型に波及させない）
 */
export type PersonReportedAge = { reported_age: number | null };

export type ContactRow = {
  id: string;
  person_id: string;
  kind: ContactKind;
  /** 続柄・間柄（娘・夫・隣人） */
  relation: string | null;
  name: string | null;
  phone: string | null;
  reach: ContactReach | null;
  /** 緊急連絡先 ①② の順 */
  emergency_order: number | null;
  /** 避難支援等実施者 ①② の順。無ければ実施者でない */
  supporter_order: number | null;
  night_ok: 0 | 1 | null;
  has_car: 0 | 1 | null;
  has_smartphone: 0 | 1 | null;
  note: string | null;
  sort: number;
  created_at: string;
};

export type ConsentRow = {
  person_id: string;
  kind: ConsentKind;
  status: ConsentStatus;
  /** 範囲（区分・相手）の JSON */
  scope: string | null;
  recorded_by: string | null;
  recorded_at: string;
  expires_at: string | null;
  note: string | null;
};

export type ClockRow = {
  id: string;
  person_id: string;
  kind: ClockKind;
  category: ClockCategory;
  label: string;
  /** 時計の長さ。null は未確認 */
  value: number | null;
  unit: ClockUnit | null;
  starts_on: ClockStart;
  source: ClockSource | null;
  source_note: string | null;
  /** 値を確かめた時刻（頼り先の確認とは別） */
  confirmed_at: string | null;
  /** 外の物に頼る時計の頼り先。頼らない時計は null。人が付ける */
  depends_on: DependsOn | null;
  /** 頼り先の確認。depends_on があるときだけ値を持つ。人が付ける */
  depends_check: CheckStatus | null;
  note: string | null;
  sort: number;
};

export type DrillRow = {
  id: string;
  office_id: string;
  scenario: DrillScenario;
  status: DrillStatus;
  step: number;
  sim_hour: number;
  /** 監督の世界の状態の JSON */
  world: string;
  score: string | null;
  started_by: string | null;
  started_at: string;
  finished_at: string | null;
};

export type DrillEventRow = {
  id: string;
  drill_id: string;
  seq: number;
  step: number;
  sim_hour: number;
  person_id: string | null;
  actor: DrillActor;
  kind: DrillEventKind;
  payload: string;
  created_at: string;
};

export type SignalRow = {
  id: string;
  person_id: string;
  drill_id: string | null;
  color: SignalColor;
  source: SignalSource;
  where_now: WhereNow | null;
  /** 赤の 4 問: けが・家・動けるか・薬。null は答えていない */
  injured: 0 | 1 | null;
  at_home: 0 | 1 | null;
  can_move: 0 | 1 | null;
  has_medicine: 0 | 1 | null;
  /** R2 の鍵 */
  recording_key: string | null;
  transcript: string | null;
  /** RecordingClass[] の JSON。今効いている分類（人が直せば人の物） */
  classes: string | null;
  classified_by: Classifier | null;
  /** Claude の分類（RecordingClass[] の JSON）。人が直しても残す */
  ai_classes: string | null;
  /** Claude の確信（0〜1） */
  ai_confidence: number | null;
  /** 文字起こしからの引用（10 字まで。伏せた所は（氏名）のまま） */
  ai_quote: string | null;
  /** 答えたモデル */
  ai_model: string | null;
  /** 分類できなかった理由 */
  ai_error: ClassifyError | null;
  /** Claude の分類を試みた時刻 */
  ai_at: string | null;
  /** 赤のあとの聞き取りの答え（lib/signals/questions.ts の Answers の JSON。T49）。ルールの表に渡さない */
  answers: string | null;
  /** Claude の聞き取りメモ（欄ごとに文字起こしから写した 30 字まで。T49）。ルールの表に渡さない */
  ai_memo: string | null;
  /** ケアマネが直した聞き取りの欄（T49）。ルールの表に渡さない */
  memo: string | null;
  occurred_at: string;
  created_at: string;
};

export type TimelineEntryRow = {
  id: string;
  person_id: string;
  author_id: string | null;
  author_role: AuthorRole;
  kind: TimelineKind;
  body: string | null;
  payload: string | null;
  signal_id: string | null;
  occurred_at: string;
  created_at: string;
};

/** AI の呼び出し 1 回。入れた物・返った物（本文）は持たない */
export type AiCallRow = {
  id: string;
  office_id: string;
  purpose: AiPurpose;
  /** 呼んだモデル。終わったら答えたモデル（fallback で替わることがある） */
  model: string;
  /** 数える日（JST、YYYY-MM-DD）。1 日の上限はこの列で数える */
  day: string;
  status: AiCallStatus;
  error: AiCallError | null;
  input_tokens: number | null;
  output_tokens: number | null;
  started_at: string;
  finished_at: string | null;
};

/** ログインを試した 1 回（T41。lib/auth/lockout.ts）。パスワードは持たない */
export type LoginAttemptRow = {
  id: number;
  /** 打たれた ID（前後の空白を落とし 128 字まで）。無い ID も入る */
  login_id: string;
  /** 送信元（CF-Connecting-IP）。無ければ 'unknown' */
  ip: string;
  /** UNIX 秒 */
  at: number;
  ok: 0 | 1;
};

/** 様式 9 の並び: 平時（優先の骨格）・発災時（ルールの表） */
export const FORM9_MODES = ["normal", "disaster"] as const;
export type Form9Mode = (typeof FORM9_MODES)[number];

/** 様式 9 の優先順位の手直し 1 回。足すだけで消さない。今の順位は本人・並びごとのいちばん新しい行 */
export type Form9RankEditRow = {
  id: string;
  office_id: string;
  person_id: string;
  mode: Form9Mode;
  /** 手で決めた順位。NULL は「自動に戻す」 */
  rank: number | null;
  /** 直したときの自動の順位 */
  auto_rank: number;
  /** 直した理由（戻すときは空でもよい） */
  reason: string;
  set_by: string | null;
  set_at: string;
};

// ---------- 災害モード（T09） ----------

/** 事業所の状態: 平時・大雨・地震。平時のほかを「災害モード」と呼ぶ */
export const DISASTER_KINDS = ["normal", "heavy_rain", "earthquake"] as const;
export type DisasterKind = (typeof DISASTER_KINDS)[number];

/** 停電の範囲: 無し・事業所全体・地区（町名） */
export const OUTAGE_SCOPES = ["none", "office", "area"] as const;
export type OutageScope = (typeof OUTAGE_SCOPES)[number];

/** 警戒レベル（避難の様式の言葉）。人が入れる。ルールの表の入力には今は使わない（docs/DECISIONS.md） */
export const ALERT_LEVELS = [3, 4, 5] as const;
export type AlertLevel = (typeof ALERT_LEVELS)[number];

/**
 * 事業所の災害の状態。事業所ごとに 1 行。行が無ければ平時。
 * 平時に戻すと発災・停電・レベル・断水・道路は全部 NULL に戻す（次の災害で前の停電の時刻が時計を走らせないように）。
 * 変えるたびに事業所の経過（office_timeline_entries）に 1 行足す
 */
export type DisasterStateRow = {
  office_id: string;
  kind: DisasterKind;
  /** 発災（災害モードに切り替えた時刻）。平時は NULL */
  started_at: string | null;
  /** 災害モードに切り替えた人 */
  started_by: string | null;
  outage_scope: OutageScope;
  /** 停電の地区（町名の JSON の配列）。範囲が地区のときだけ */
  outage_towns: string | null;
  /** 停電の始まり。停電が無ければ NULL */
  outage_started_at: string | null;
  alert_level: AlertLevel | null;
  /** 断水（文字） */
  water: string | null;
  /** 道路（文字） */
  road: string | null;
  /** 版。画面で読んだ版のときだけ書く（重なった保存は片方だけ） */
  version: number;
  updated_by: string | null;
  updated_at: string;
};

/**
 * 事業所の経過の種類: 災害モードに入れた（種類を替えたも）・平時に戻した・災害の情報を変えた（T09）、
 * 利用者を足した・担当を変えた・一覧から外した・一覧に戻した・ケアマネを足した（T30）、
 * 所属なしの人を引き受けた（T23）
 */
export const OFFICE_TIMELINE_KINDS = [
  "disaster_on",
  "disaster_off",
  "disaster_info",
  "person_added",
  "person_assigned",
  "person_unlisted",
  "person_relisted",
  "care_manager_added",
  "person_taken",
] as const;
export type OfficeTimelineKind = (typeof OFFICE_TIMELINE_KINDS)[number];

/** 事業所の経過 1 行。本人の経過（timeline_entries）とは別の表。誰が・いつ・何を */
export type OfficeTimelineEntryRow = {
  id: string;
  office_id: string;
  author_id: string | null;
  author_role: AuthorRole;
  kind: OfficeTimelineKind;
  body: string | null;
  /** 変えたあとの状態の写し（JSON）。人の名前・住所は入れない */
  payload: string | null;
  occurred_at: string;
  created_at: string;
};

// ---------- 様式の対応表（T08） ----------

/** 読んだ物: 写真・PDF・手で作った */
export const FORM_SOURCE_KINDS = ["image", "pdf", "manual"] as const;
export type FormSourceKind = (typeof FORM_SOURCE_KINDS)[number];

/** 下書き（AI が読んだまま・作りかけ）・確認済（ケアマネが確かめた。差し込みに使うのはこれだけ） */
export const FORM_MAPPING_STATUSES = ["draft", "checked"] as const;
export type FormMappingStatus = (typeof FORM_MAPPING_STATUSES)[number];

/** 様式の対応表 1 つ。mapping は lib/forms/mapping.ts の FormMapping の JSON */
export type FormMappingRow = {
  id: string;
  office_id: string;
  title: string;
  /** 読んだ写真・PDF の SHA-256。手で作った物は null */
  form_hash: string | null;
  source_kind: FormSourceKind;
  mapping: string;
  status: FormMappingStatus;
  ai_model: string | null;
  created_by: string | null;
  created_at: string;
  checked_by: string | null;
  checked_at: string | null;
  version: number;
  updated_at: string;
};

// ---------- 受け持ち（T23） ----------

/** 受け持つ役（行政と医療班は同じ扱い。docs/SPEC.md「画面 6」） */
export const STAFF_ROLES = ["medical", "government"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** 受け入れの入口: QR・検索・避難所の一覧・その場で登録 */
export const CUSTODY_VIAS = ["qr", "search", "shelter", "on_site"] as const;
export type CustodyVia = (typeof CUSTODY_VIAS)[number];

/** 受け持ちを閉じる理由: 搬送・退所 */
export const RELEASE_KINDS = ["transported", "discharged"] as const;
export type ReleaseKind = (typeof RELEASE_KINDS)[number];

/** 受け持ち 1 行。開いている（released_at が null）間だけ本人のページを開ける */
export type CustodyRow = {
  id: string;
  person_id: string;
  /** 受け持つアカウント（審査員は acct-judge） */
  holder_id: string;
  holder_role: StaffRole;
  shelter: string;
  via: CustodyVia;
  received_at: string;
  released_at: string | null;
  release_kind: ReleaseKind | null;
  /** 搬送の行き先など。人の名前・電話は入れない */
  release_note: string | null;
  released_by: string | null;
};

/** 第三者提供の根拠: 同意あり・生命・身体の保護（個人情報保護法 27 条 1 項 2 号） */
export const PROVISION_BASES = ["consent", "vital"] as const;
export type ProvisionBasis = (typeof PROVISION_BASES)[number];

/** 第三者提供の記録 1 行（相手・範囲・時刻）。受け入れ 1 回に 1 行。消さない */
export type ThirdPartyProvisionRow = {
  id: string;
  person_id: string;
  custody_id: string | null;
  recipient_id: string | null;
  recipient_role: StaffRole;
  /** 渡したときの相手の名前の写し */
  recipient_name: string | null;
  recipient_judge: 0 | 1;
  basis: ProvisionBasis;
  /** 渡したときの医療班への提供の同意 */
  medical_consent: ConsentStatus;
  /** 渡した区分の JSON の配列（lib/custody/provision.ts の ProvisionSection） */
  scope: string;
  shelter: string;
  provided_at: string;
  /** 受け持ちを閉じた時刻 */
  closed_at: string | null;
};

// ---------- 訓練の JSON の形 ----------

/** ペルソナ（Haiku）が 1 刻みで返す決まった形。言葉は毎回違っても形は同じ */
export type PersonaTurn = {
  /** する事 */
  doing: string;
  /** 言う事 */
  saying: string;
  pressRed: boolean;
  contactCareManager: boolean;
};
