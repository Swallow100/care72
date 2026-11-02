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
    { key: `${prefix}.relation`, group: "contacts", label: `${name} 続柄・関係`, hint: "車・夜間・スマホの有無も", ...c },
    { key: `${prefix}.phone`, group: "contacts", label: `${name} 電話`, hint: "固定と携帯の区別つき。メール・FAX は持たない", ...c },
    { key: `${prefix}.address`, group: "contacts", label: `${name} 住所`, hint: "住所は持たない。同居・近所・市内などの近さだけ", ...c },
  ];
};

/** 台帳の項目（聞き取りの項目表）。差し込み（lib/forms/mapped-sheet.ts）は全部の key の出し方を持つ */
export const LEDGER_ITEMS = [
  // ---- 本人 ----
  { key: "person.name", group: "person", label: "氏名" },
  { key: "person.kana", group: "person", label: "フリガナ" },
  { key: "person.birth", group: "person", label: "生年月日", hint: "和暦で出す" },
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
  { key: "medical.devices", group: "medical", label: "医療機器", hint: "酸素・人工呼吸器・吸引・経管栄養・透析と、電池と予備", consent: "plan_share" },
  { key: "medical.medications", group: "medical", label: "常用薬", hint: "薬の名前・回数・残り・保管場所", consent: "plan_share" },
  { key: "medical.doctor", group: "medical", label: "かかりつけ医・薬局", consent: "plan_share" },
  { key: "medical.dialysis", group: "medical", label: "透析先", consent: "plan_share" },
  { key: "medical.allergies", group: "medical", label: "アレルギー", consent: "plan_share" },
  { key: "medical.history", group: "medical", label: "既往症", consent: "plan_share" },
  { key: "medical.vaccinations", group: "medical", label: "予防接種", consent: "plan_share" },
  {
    key: "medical.notes",
    group: "medical",
    label: "医療の特記",
    hint: "機器・時計・透析先・アレルギー・既往・予防接種をまとめた物",
    consent: "plan_share",
  },
  { key: "medical.annex", group: "medical", label: "別紙（医療要約）", hint: "別紙の有無", consent: "plan_share" },

  // ---- 避難 ----
  { key: "evacuation.hazards", group: "evacuation", label: "自宅のリスク", hint: "浸水（深さ）・土砂・津波" },
  { key: "evacuation.destination1", group: "evacuation", label: "避難先1", hint: "市の指定避難所など。名称だけ（住所は持たない）" },
  { key: "evacuation.destination2", group: "evacuation", label: "避難先2", hint: "事前に行く所（親族の家など）" },
  { key: "evacuation.transport", group: "evacuation", label: "移動手段", hint: "徒歩・車いす・家族の車など" },
  { key: "evacuation.route", group: "evacuation", label: "避難経路" },
  { key: "evacuation.barriers", group: "evacuation", label: "段差・エレベーター" },
  { key: "evacuation.support", group: "evacuation", label: "支援の内容", hint: "声掛け・誘導・移動介助と書き足し" },
  { key: "evacuation.carryItems", group: "evacuation", label: "持出品" },
  { key: "evacuation.pets", group: "evacuation", label: "ペット" },
  { key: "evacuation.myTimeline", group: "evacuation", label: "マイ・タイムライン", hint: "作成の有無" },

  // ---- 住まい ----
  { key: "basic.housing.structure", group: "housing", label: "構造・築年", hint: "木造・鉄骨・鉄筋など" },
  { key: "basic.housing.floors", group: "housing", label: "建物の階数" },
  { key: "basic.housing.floor", group: "housing", label: "普段いる階" },
  { key: "basic.housing.bedroom", group: "housing", label: "寝室" },

  // ---- 連絡先・支援者 ----
  ...contactItems("emergency1", "緊急連絡先1"),
  ...contactItems("emergency2", "緊急連絡先2"),
  ...contactItems("supporter1", "避難支援者1", "supporters"),
  ...contactItems("supporter2", "避難支援者2", "supporters"),
  { key: "people.night", group: "contacts", label: "夜間支援", hint: "夜に来られる人", consent: "supporters" },
  { key: "people.welfare", group: "contacts", label: "民生委員" },
  { key: "local.watcher", group: "contacts", label: "みまもり員" },
  { key: "people.offices", group: "contacts", label: "事業所等", hint: "訪問看護・介護の事業所" },

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

/** AI が読んだときの対応（人が直しても残す） */
export type AiReading = {
  item: LedgerItemKey | null;
  confidence: Confidence;
  /** 対応の理由（短い） */
  reason: string;
  /** 台帳に無い項目名を返したとき、その名前（弾いて item は null） */
  rejected?: string;
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
};

export type FormMapping = {
  /** 様式の題名 */
  title: string;
  /** 出した所（内閣府・〇〇市）。分からなければ空 */
  issuer: string;
  pages: number;
  fields: MappingField[];
};

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
  notFound: "該当なし",
  forbidden: "権限なし",
  unconfirmed: "未確認",
  unmapped: "対応なし",
  withheld: "省略",
} as const;

// ---------- 長さの上限（画面・保存・AI の返事で同じ） ----------

/** 読む写真・PDF 1 つの上限。写真は API の上限（5 MB）、PDF も同じにそろえる（様式は数頁なので足りる） */
export const FORM_FILE_MAX_BYTES = 5 * 1024 * 1024;

export const LIMITS = { title: 80, issuer: 40, section: 40, label: 80, position: 60, reason: 120, option: 30, options: 16, fields: 200, pages: 20 } as const;

const clip = (s: string, n: number) => s.trim().slice(0, n);

/** 電話番号らしい並び（様式に見本の番号が印刷されていることがある）。対応表には残さない */
const PHONE_LIKE = /(?<![0-9０-９])[0０][0-9０-９]{1,4}[-‐－ー ]?[0-9０-９]{1,4}[-‐－ー ]?[0-9０-９]{3,4}(?![0-9０-９])/g;
const PHONE_MARK = "（番号）";

function clean(s: string, n: number): string {
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
    confidence: Confidence;
    reason: string;
  }>;
};

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
    // 手で書く欄に台帳の値は入れない
    const item = f.shape === "handwrite" ? null : known;
    fields.push({
      id,
      page: Math.min(Math.max(1, Math.trunc(f.page) || 1), pages),
      section: clean(f.section, LIMITS.section),
      label,
      position: clean(f.position, LIMITS.position),
      shape: f.shape,
      options: f.options.map((o) => clean(o, LIMITS.option)).filter((o) => o !== "").slice(0, LIMITS.options),
      item,
      removed: false,
      ai,
    });
  }
  return {
    mapping: { title: clean(r.title, LIMITS.title) || "様式", issuer: clean(r.issuer, LIMITS.issuer), pages, fields },
    rejected,
  };
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
    const options = Array.isArray(f.options) ? f.options.filter((x): x is string => typeof x === "string") : [];
    const ai = parseAi(f.ai);
    if (ai === undefined) {
      const aiItem = f.ai && typeof f.ai === "object" ? (f.ai as Record<string, unknown>).item : null;
      return { ok: false, error: aiItem !== null && aiItem !== undefined && !isLedgerItemKey(aiItem) ? "unknown_item" : "invalid", at: id };
    }
    const shape = f.shape as FieldShape;
    const cleanLabel = clean(label, LIMITS.label);
    if (!cleanLabel) return { ok: false, error: "invalid", at: id };
    fields.push({
      id,
      page: Math.min(Math.max(1, Math.trunc(f.page)), pages),
      section: clean(str(f.section) ?? "", LIMITS.section),
      label: cleanLabel,
      position: clean(str(f.position) ?? "", LIMITS.position),
      shape,
      options: options.map((x) => clean(x, LIMITS.option)).filter((x) => x !== "").slice(0, LIMITS.options),
      item: shape === "handwrite" ? null : (f.item as LedgerItemKey | null),
      removed: f.removed === true,
      ai,
    });
  }
  return { ok: true, mapping: { title: clean(title, LIMITS.title) || "様式", issuer: clean(issuer, LIMITS.issuer), pages, fields } };
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
};

export function fieldChanged(f: MappingField): boolean {
  return f.ai !== null && (f.removed || f.item !== f.ai.item);
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
