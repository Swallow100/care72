// 元の様式とコードの欄の照合の表（docs/tasks/T47.md の 2）。様式ごとに、元の様式の欄を読む順に並べ、コードのどの欄に当たるかと、
// 一致・違いを持つ。lib/forms/form-audit.test.ts がコードの欄の一覧（MATSUYAMA_FIELDS・MEDICAL_FIELDS・FORM9_COLUMNS）と突き合わせて固定し、
// docs/progress/t47.md の照合の表は auditMarkdown() の出力そのもの（テストで同じかを見る）。
//
// 元の様式は 2026-11-03 にリポジトリの外で読んだ（PDF は pdf.js で字と書体の名前を、Excel はシートの XML を）。リポジトリには入れない。
// 欄の名前は様式の字のまま書く（CLAUDE.md: 欄の名前と順をコードに持つのはよい）。読む順は上から、同じ高さなら左から。
// 縦に並んだ欄の組（名前の列と電話の列など）は左の列から。

export type AuditResult =
  /** 名前・順・選択肢が様式のとおり */
  | "一致"
  /** 違いがあり、T47 で様式に合わせた */
  | "直した"
  /** 同じ欄で、書き方だけ違う（違いは note） */
  | "表記"
  /** 様式に欄の名前が無く、コードが呼び名を付けた（紙面には名前を出さない） */
  | "名付け"
  /** 様式に無い欄。紙面では様式の欄の外（松山市は特記事項の書き込み、医療要約は補足の段）に出す */
  | "様式外"
  /** 様式にあって、ケア72 が書かない欄（理由は note） */
  | "書かない"
  /** 様式から何の欄か読み取れなかった */
  | "未照合"
  /** 違いがあり、直すかは作者の判断待ち（docs/progress/t47.md の問い） */
  | "問い";

export type AuditRow = {
  /** 様式の何頁 */
  page: number;
  /** 様式の欄の名前（様式の字のまま）。名前の無い欄は "" */
  original: string;
  /** 選ぶ欄の選択肢（様式の字と順） */
  options?: readonly string[];
  /** コードの欄。書かない・未照合は [] */
  keys: readonly string[];
  /** コードの欄の名前（様式と書き方が違うとき。表記・名付けの欄は必ず） */
  code?: string;
  result: AuditResult;
  note?: string;
};

export type FormAudit = {
  id: "matsuyama" | "medical" | "form9";
  title: string;
  /** 照合した元の様式（版） */
  source: string;
  /** 様式で太い所（T47 の 1。紙面で太くしてよいのはここだけ） */
  bold: readonly string[];
  rows: readonly AuditRow[];
  /** 様式に刷ってある文（題・注・問い）の照合 */
  texts?: ReadonlyArray<{ where: string; result: AuditResult; note?: string }>;
  /** 元の様式の字と余白と頁（T85） */
  paper: PaperSpec;
};

// ---------- 字と余白（T85） ----------
// 2026-11-04 に元の様式を読み直した（リポジトリの外。PDF は pdf.js で字の塊ごとに書体の名前・大きさ・位置、塗りと線で太くした字、
// 罫線の位置。Excel はセルの書体・大きさ・太字、列幅、余白、印刷の倍率）。PDF・Excel・抜き出した字はリポジトリに入れない。
// 原本が BIZ UDゴシック・BIZ UDPゴシック（OFL で配れる）の字はその書体のまま（松山市の本文は BIZ UDゴシック。かなが等幅。11/4 15:4x 確定）。
// ほかの原本の書体（游明朝・MS 明朝・游ゴシック・MS ゴシック・MS P ゴシック・メイリオ UI）は配信に入れられないので置き換える:
// 明朝 → BIZ UDP明朝、ゴシック → BIZ UDPゴシック。大きさ（pt）は紙の上の大きさ（Excel は印刷の倍率を掛けた後）をそのまま使う。

/** ケア72 の紙の書体（components/forms/paper.css の --font-gothic・--font-ud-gothic・--font-mincho） */
export type PaperFace = "gothic" | "ud-gothic" | "mincho";
export const PAPER_FACE_NAMES: Record<PaperFace, string> = { gothic: "BIZ UDPゴシック", "ud-gothic": "BIZ UDゴシック", mincho: "BIZ UDP明朝" };

/** 原本の書体の名前から、紙の書体（BIZ UDゴシックはそのまま、明朝は BIZ UDP明朝、ほかは BIZ UDPゴシック） */
export function faceOf(original: string): PaperFace {
  if (/mincho|明朝/i.test(original)) return "mincho";
  return /^BIZ[- ]?UDGothic/i.test(original) ? "ud-gothic" : "gothic";
}

export type PaperType = {
  /** 原本の字の役と例（様式の字） */
  role: string;
  /** 原本の書体の名前（PDF の書体・Excel のセルの書体） */
  original: string;
  /** 原本の大きさ（紙の上の pt） */
  pt: number;
  /** 原本で太い（書体の Bold か、塗りと線で太くした字） */
  bold?: boolean;
  /** 原本で下線を引いた字 */
  underline?: boolean;
  /**
   * 紙面の中のどこか（その様式の紙面の根 [data-sheet] の中の CSS の選び方）。lib/forms/print-pages.test.ts が印刷の頁で
   * 書体・大きさ・太さ・下線を計算して確かめる。ケア72 が刷らない字は無し
   */
  sel?: string;
  /** 原本との違い・置き場所の注 */
  note?: string;
};

export type PaperSpec = {
  /** A4 の向き */
  orientation: "縦" | "横";
  /** 元の様式でケア72 が写す範囲の頁数（紙面の頁数はこれと同じにする） */
  pages: number;
  /** 余白（mm）。上は頁ごと（1 頁目・2 頁目…。足りない頁は最後の値） */
  margins: { top: readonly number[]; right: number; bottom: number; left: number };
  /** ケア72 の紙で原本と違う余白（理由は marginNote） */
  used?: Partial<{ top: readonly number[]; right: number; bottom: number; left: number }>;
  marginNote?: string;
  /** Excel の印刷の倍率（%）。字の大きさはこれを掛けた後 */
  scale?: number;
  /** 字の役ごとの書体・大きさ・太さ */
  type: readonly PaperType[];
  /** ケア72 が足した物（様式外の欄・頁の下の端）の字。原本に無いので大きさはケア72 が決めた */
  extra?: ReadonlyArray<{ where: string; pt: number; face: PaperFace; sel?: string }>;
};

const S = (n: 1 | 2) => `supporter${n}`;
const supporterRows = (n: 1 | 2): AuditRow[] => [
  { page: 1, original: `実施者${n === 1 ? "１" : "２"} フリガナ`, keys: [`${S(n)}.kana`], code: "フリガナ", result: "一致", note: "段の名前「実施者N」は縦書きの列" },
  { page: 1, original: "氏名", keys: [`${S(n)}.name`], result: "一致" },
  { page: 1, original: "住所", keys: [`${S(n)}.address`], result: "一致" },
  { page: 1, original: "電話番号", keys: [`${S(n)}.phone`], result: "一致" },
  { page: 1, original: "携帯番号", keys: [`${S(n)}.mobile`], result: "一致" },
  { page: 1, original: "関係", keys: [`${S(n)}.relation`], result: "一致", note: "紙面の並びを様式の列（氏名と住所／電話・携帯・関係／同意※）に直した" },
  {
    page: 1,
    original: "同意※",
    keys: [`${S(n)}.consent`],
    options: [],
    result: "表記",
    note: "様式は印を付ける枠だけ。コードは「同意・不同意」の □ を刷る",
  },
];

const shelterRows = (id: "pre" | "near" | "city", name: string, note?: string): AuditRow[] => [
  { page: 2, original: name, keys: [`shelter.${id}.place`], result: "一致", note },
  { page: 2, original: "【手段】", options: ["徒歩", "その他"], keys: [`shelter.${id}.means`], result: "一致" },
  { page: 2, original: "【時間】", keys: [`shelter.${id}.minutes`], result: "一致", note: "様式は「【時間】（　）分」。紙面も同じ形に直した（前は「時間（分）」）" },
];

/** 松山市「避難行動要支援者名簿登録申込書 兼 個別避難計画」様式【2026.9.10】（A4 2 頁） */
export const MATSUYAMA_AUDIT: FormAudit = {
  id: "matsuyama",
  title: "松山市 個別避難計画",
  source: "松山市 様式【2026.9.10】（市の PDF R8.9.10keikaku.pdf、2 頁）",
  bold: [
    "近親者及緊急時の連絡先",
    "避難支援等実施者(近隣協力員)",
    "避難支援等実施組織",
    "私の避難場所",
    "住居",
    "支援の内容（複数選択可）",
    "避難経路",
    "同意する・同意しない（選択肢の言葉）",
    "あり（アプリ・紙）・なし（選択肢の言葉）",
    "（安否確認ができたときの連絡先）（近親者の段の注）",
  ],
  paper: {
    orientation: "縦",
    pages: 2,
    // 表の外枠: 左 x=58.5pt・右 x=551pt。1 頁の上は様式の版の行の字、2 頁の上と下は外枠（y=796.8・44.8pt）
    margins: { top: [9, 15.8], right: 15.6, bottom: 15.8, left: 20.6 },
    type: [
      { role: "様式の版（左上）", original: "YuGothic-Regular", pt: 9.84, sel: '[data-tx="version"]' },
      { role: "番号の【　】（右上）", original: "YuGothic-Regular", pt: 10.68, sel: '[data-field="head.number"]' },
      { role: "題", original: "YuMincho-Regular", pt: 13.32, sel: '[data-tx="title"]' },
      { role: "あて先・年 月 日作成", original: "YuMincho-Regular", pt: 9.84, sel: '[data-tx="to"], [data-field="head.date"]' },
      {
        role: "段の名前「対象者」",
        original: "BIZ-UDGothic",
        pt: 12.48,
        sel: '[data-block="target"] > .blk-h',
        note: "様式は左の縦書きの列。ケア72 は段の上の帯",
      },
      {
        role: "段の名前（太い）「近親者及緊急時の連絡先・避難支援等実施者(近隣協力員)・避難支援等実施組織・私の避難場所・住居・避難経路」",
        original: "BIZ-UDGothic-Bold",
        pt: 10.68,
        bold: true,
        sel: ".blk-h.b",
      },
      { role: "段の名前「特記事項」", original: "BIZ-UDGothic", pt: 10.68, sel: '[data-block="notes"] > .blk-h' },
      { role: "段の名前「実施者１・２」（縦書き）", original: "BIZ-UDGothic", pt: 10.68, sel: ".vcap" },
      {
        role: "欄の名前「氏名・住所・地区・世帯・マイ・タイムラインの作成・続柄・組織・団体名称・本人：氏名」",
        original: "BIZ-UDGothic",
        pt: 10.68,
        sel: ':is([data-field$=".name"], [data-field$=".address"], [data-field="target.district"], [data-field="target.household"], [data-field="target.timeline"], [data-field="kin.relation"], [data-field="sign.self"]) > .f-l',
      },
      {
        role: "欄の名前「生年月日・電話番号・携帯番号・関係・同意※・計画作成者・団体・かかりつけ医・薬局・自宅のリスク・避難のタイミング・【手段】・【時間】・【種別】・普段いる部屋・寝室 ほか」",
        original: "BIZ-UDGothic",
        pt: 9.84,
        sel: ':is([data-field="target.birth"], [data-field$=".phone"], [data-field$=".mobile"], [data-field^="supporter"][data-field$=".relation"], [data-field$=".consent"], [data-field^="plan."], [data-field^="medical."], [data-field^="risk."], [data-field^="housing."], [data-field$=".means"], [data-field$=".minutes"]) > .f-l',
      },
      { role: "欄の名前「事前避難場所・市指定避難所」", original: "BIZ-UDGothic", pt: 9.84, sel: '[data-cap="pre"], [data-cap="city"]' },
      { role: "欄の名前「最寄りの避難場所」", original: "BIZ-UDGothic", pt: 8.16, sel: '[data-cap="near"]' },
      { role: "欄の名前「フリガナ」", original: "BIZ-UDGothic", pt: 7.08, sel: '[data-field$=".kana"] > .f-l' },
      { role: "欄の名前（太い）「支援の内容（複数選択可）」", original: "BIZ-UDGothic-Bold", pt: 9.84, bold: true, sel: '[data-field="support.kinds"] > .f-l' },
      { role: "欄の名前「民生・児童委員・みまもり員・事業所等」", original: "YuMincho-Regular", pt: 9.84, sel: '[data-field^="local."] > .f-l' },
      { role: "欄の名前「代理人：氏名（続柄）連絡先：」", original: "YuMincho-Regular", pt: 9.84, sel: '[data-field="sign.proxy"] > .f-l' },
      { role: "代理人の注「（やむを得ない理由により本人が記入できない場合）」", original: "YuMincho-Regular", pt: 5.4, sel: '[data-tx="proxyNote"]' },
      {
        role: "同意の問い 2 つ・「上記内容を確認し、了承しています。」",
        original: "YuMincho-Regular",
        pt: 9.84,
        sel: '[data-tx="consentRegistry"], [data-tx="consentPlanShare"], [data-tx="confirmed"]',
      },
      { role: "近親者の段の注「（安否確認ができたときの連絡先）」", original: "YuMincho-Regular", pt: 9.84, bold: true, underline: true, sel: '[data-tx="kinNote"]' },
      { role: "実施者・組織の段の注", original: "YuMincho-Regular", pt: 8.04, sel: '[data-tx="supportersNote"], [data-tx="orgNote"]' },
      { role: "※ 実施者の同意の注（1 頁の下）", original: "YuMincho-Regular", pt: 10.68, sel: '[data-tx="supporterConsentNote"]' },
      {
        role: "選択肢「男・女・大正…令和・ひとり暮らし…・戸建住宅…・土砂災害…・避難の声掛け…・あり・なし」",
        original: "BIZ-UDGothic",
        pt: 9.84,
        sel: ':is([data-field="target.sex"], [data-field="target.household"], [data-field^="housing."], [data-field="risk.home"], [data-field="support.kinds"], [data-field="notes.annex"], [data-field="route.map"]) .ch',
      },
      { role: "選択肢「高齢者（独居・要介護）…その他・徒歩・その他」", original: "BIZ-UDGothic", pt: 8.88, sel: ':is([data-field="target.category"], [data-field$=".means"]) .ch' },
      {
        role: "選択肢（太い）「同意する・同意しない・あり（アプリ・紙）・なし」",
        original: "BIZ-UDGothic-Bold",
        pt: 10.68,
        bold: true,
        sel: ".opt-b .ch",
      },
      { role: "選択肢「自主避難・レベル３高齢者等避難」", original: "BIZ-UDPGothic", pt: 10.68, sel: '[data-field="risk.timing"] .ch' },
      { role: "私の避難場所の注「（親戚宅や近くの安全な場所等）」", original: "BIZ-UDGothic", pt: 9.84, sel: '[data-tx="preNote"]' },
      { role: "特記事項の注", original: "BIZ-UDGothic", pt: 8.88, sel: '[data-tx="notesNote"]' },
      { role: "別紙", original: "BIZ-UDGothic", pt: 9.84, sel: '[data-field="notes.annex"]' },
      { role: "避難経路の注", original: "YuMincho-Regular", pt: 9.84, sel: '[data-tx="routeNote"]' },
      { role: "まつやま総合防災マップからの引用", original: "BIZ-UDGothic", pt: 10.68, sel: '[data-field="route.map"]' },
      { role: "2 頁の下の注 1 つ目（※自宅でできる…）", original: "YuMincho-Regular", pt: 10.68, underline: true, sel: '[data-tx="footPrepare"]' },
      { role: "2 頁の下の注 2 つ目（※この個別避難計画は…）", original: "YuMincho-Regular", pt: 10.68, sel: '[data-tx="footNoGuarantee"]' },
      { role: "2 頁の下の 1 文（この申込書に記載する情報は…）", original: "BIZ-UDGothic", pt: 10.68, sel: '[data-tx="footUse"]' },
      { role: "松山市長（2 頁の下）", original: "BIZ-UDGothic", pt: 9.84, sel: '[data-tx="mayor"]' },
      { role: "市受付印", original: "YuMincho-Regular", pt: 9.84, sel: '[data-field="city.stamp"]' },
      { role: "氏名の枠の中の「氏」「名」", original: "YuMincho-Regular", pt: 5.4, note: "姓と名の書き分けの印。ケア72 は値を書くので刷らない" },
      { role: "地域の支援者の行の「TEL(携帯)」", original: "YuMincho-Regular", pt: 7.56, note: "（携帯）は 5.52pt。ケア72 は値（電話番号）を書くので刷らない" },
    ],
    extra: [
      { where: "値（原本は空欄。欄の名前と同じ大きさ・本文の書体）", pt: 9.84, face: "ud-gothic", sel: '[data-field="target.phone"] > .f-v' },
      { where: "値（名前の大きい欄）", pt: 10.68, face: "ud-gothic", sel: '[data-field="target.name"] > .f-v' },
      { where: "フリガナの値", pt: 8.88, face: "ud-gothic", sel: '[data-field="target.kana"] > .f-v' },
      { where: "特記事項の中の段の頭（医療・本人の言葉・夜間支援・その他。様式の欄の名前ではない）", pt: 8.88, face: "ud-gothic", sel: ".part > .lead" },
      { where: "頁の下の端の文書名と頁番号", pt: 8, face: "ud-gothic", sel: ".paper-foot" },
    ],
  },
  rows: [
    { page: 1, original: "", keys: ["head.number"], code: "番号", result: "名付け", note: "右上の【　】。前は紙面に「番号」と刷っていた" },
    { page: 1, original: "年 月 日作成", keys: ["head.date"], result: "一致" },
    { page: 1, original: "フリガナ", keys: ["target.kana"], result: "一致", note: "段の名前「対象者」は縦書きの列（太字でない）" },
    { page: 1, original: "氏名", keys: ["target.name"], result: "一致" },
    { page: 1, original: "", options: ["男", "女"], keys: ["target.sex"], code: "性別", result: "名付け", note: "前は紙面に「性別」と刷っていた" },
    { page: 1, original: "生年月日", options: ["大正", "昭和", "平成", "令和"], keys: ["target.birth"], result: "一致" },
    { page: 1, original: "地区", keys: ["target.district"], result: "一致" },
    { page: 1, original: "住所", keys: ["target.address"], result: "一致" },
    { page: 1, original: "電話番号", keys: ["target.phone"], result: "一致" },
    { page: 1, original: "携帯番号", keys: ["target.mobile"], result: "一致" },
    {
      page: 1,
      original: "",
      options: ["高齢者", "障がい者", "難病患者", "小児慢性特定疾病児童", "その他"],
      keys: ["target.category"],
      code: "区分",
      result: "名付け",
      note: "高齢者（独居・要介護（　））・障がい者（身体・知的・精神）の中の □ も様式のとおり。前は紙面に「区分」と刷っていた",
    },
    { page: 1, original: "民生・児童委員", keys: ["local.welfare"], result: "直した", note: "順: 区分の右に並ぶ欄なので世帯の前へ。名前と（　）を 1 行に" },
    { page: 1, original: "みまもり員", keys: ["local.watcher"], result: "直した", note: "順を世帯の前へ" },
    { page: 1, original: "事業所等", keys: ["local.office"], result: "直した", note: "順を世帯の前へ" },
    {
      page: 1,
      original: "",
      keys: ["local.other"],
      code: "その他",
      result: "名付け",
      note: "様式は名前の無い（　）（TEL(携帯)　）の 2 行。前は紙面に「その他」と刷っていた",
    },
    { page: 1, original: "世帯", options: ["ひとり暮らし", "日中ひとり", "高齢者のみ", "障がい者等のみ", "その他"], keys: ["target.household"], result: "一致" },
    {
      page: 1,
      original: "マイ・タイムラインの作成",
      options: ["あり（アプリ・紙）", "なし"],
      keys: ["target.timeline"],
      result: "直した",
      note: "前は「あり（アプリ）・あり（紙）・なし」の 3 つ。様式の「あり（アプリ・紙）・なし」に",
    },
    {
      page: 1,
      original: "",
      options: ["同意する", "同意しない"],
      keys: ["consent.registry"],
      code: "名簿登録と平常時からの提供",
      result: "名付け",
      note: "欄は問いの文（名簿登録）。前は段の名前「同意」を足していた（様式に無いので外した）",
    },
    {
      page: 1,
      original: "",
      options: ["同意する", "同意しない"],
      keys: ["consent.planShare"],
      code: "個別避難計画の作成と事前の共有",
      result: "名付け",
      note: "欄は問いの文（計画の共有）",
    },
    { page: 1, original: "本人：氏名（自署）", keys: ["sign.self"], result: "直した", note: "前は「本人 氏名（自署）」" },
    {
      page: 1,
      original: "代理人：氏名（続柄）連絡先：",
      keys: ["sign.proxy"],
      result: "直した",
      note: "前は「代理人 氏名・続柄・連絡先（本人が書けないとき）」。注も様式の字に",
    },
    { page: 1, original: "近親者及緊急時の連絡先 フリガナ", keys: ["kin.kana"], code: "フリガナ", result: "一致" },
    { page: 1, original: "氏名", keys: ["kin.name"], result: "一致" },
    { page: 1, original: "続柄", keys: ["kin.relation"], result: "一致" },
    { page: 1, original: "電話番号", keys: ["kin.phone"], result: "一致" },
    { page: 1, original: "携帯番号", keys: ["kin.mobile"], result: "一致" },
    { page: 1, original: "住所", keys: ["kin.address"], result: "一致" },
    ...supporterRows(1),
    ...supporterRows(2),
    { page: 1, original: "組織・団体名称", keys: ["org.name"], result: "一致" },
    { page: 1, original: "電話番号", keys: ["org.phone"], result: "一致" },
    { page: 1, original: "同意※", keys: ["org.consent"], options: [], result: "表記", note: "様式は印を付ける枠だけ。コードは「同意・不同意」の □ を刷る" },
    { page: 2, original: "計画作成者・団体", keys: ["plan.author"], result: "一致" },
    { page: 2, original: "かかりつけ医・薬局", keys: ["medical.doctor"], result: "一致" },
    { page: 2, original: "医薬品情報", keys: ["medical.drugs"], result: "直した", note: "前は段の見出しにして様式に無い注「機器は特記事項、詳細は別紙」を足していた。様式どおりの行に" },
    {
      page: 2,
      original: "自宅のリスク（複数選択可）",
      options: ["土砂災害", "洪水", "高潮", "津波", "地震"],
      keys: ["risk.home"],
      result: "一致",
    },
    {
      page: 2,
      original: "（　～　）（　～　）",
      keys: [],
      result: "未照合",
      note: "自宅のリスクの □ の下の行にある 2 つの（　～　）。様式に名前が無く、何を書く欄か読み取れない（浸水の深さか）。コードに欄は無い",
    },
    { page: 2, original: "避難のタイミング", options: ["自主避難", "レベル３高齢者等避難"], keys: ["risk.timing"], result: "一致" },
    { page: 2, original: "避難にあたっての課題", keys: ["risk.issues"], result: "一致" },
    ...shelterRows("pre", "事前避難場所", "（親戚宅や近くの安全な場所等）の注も様式の字に（前は「など」）"),
    ...shelterRows("near", "最寄りの避難場所"),
    ...shelterRows("city", "市指定避難所"),
    { page: 2, original: "【種別】", options: ["戸建住宅", "共同住宅"], keys: ["housing.type"], result: "一致" },
    { page: 2, original: "", options: ["木造", "その他"], keys: ["housing.structure"], code: "構造", result: "名付け", note: "前は紙面に「構造」と刷っていた" },
    { page: 2, original: "【階層】", options: ["平屋", "２階建", "３階建以上"], keys: ["housing.floors"], result: "一致" },
    { page: 2, original: "普段いる部屋", keys: ["housing.room"], result: "一致", note: "様式は「（　）階」" },
    { page: 2, original: "寝室", keys: ["housing.bedroom"], result: "一致", note: "様式は「（　）階」" },
    {
      page: 2,
      original: "支援の内容（複数選択可）",
      options: ["避難の声掛け", "避難の誘導", "移動介助", "その他"],
      keys: ["support.kinds"],
      result: "直した",
      note: "前は住居の段の中の行。様式どおり住居の下の別の行に",
    },
    {
      page: 2,
      original: "特記事項",
      keys: ["notes.medical", "notes.words", "notes.other"],
      result: "表記",
      note: "様式は 1 つの書き込みの欄。中を段（医療・本人の言葉・その他。段の名前はケア72）に分けて書く。前は段を欄の名前の形で刷っていた",
    },
    {
      page: 2,
      original: "",
      keys: ["supporter.night"],
      code: "夜間支援",
      result: "様式外",
      note: "前は 1 頁の実施者の段の中に様式に無い行を足していた。特記事項の書き込みの中へ移した",
    },
    { page: 2, original: "別紙", options: ["あり", "なし"], keys: ["notes.annex"], result: "一致" },
    { page: 2, original: "避難経路", keys: ["route.text"], result: "一致" },
    { page: 2, original: "まつやま総合防災マップからの引用", options: ["あり", "なし"], keys: ["route.map"], result: "一致" },
    { page: 2, original: "市受付印", keys: ["city.stamp"], result: "一致" },
  ],
  texts: [
    { where: "様式の版（左上）・題・あて先", result: "一致" },
    { where: "題の太さ", result: "直した", note: "様式の題は細い明朝。前は太字" },
    { where: "同意の問い 2 つ・「上記内容を確認し、了承しています。」", result: "直した", note: "前は短く言い換え、了承の 1 文は無かった。様式の字のまま" },
    { where: "代理人の注・近親者・実施者・組織の段の注", result: "直した", note: "前は言い換え" },
    { where: "※ 実施者の同意の注（1 頁の下）", result: "直した", note: "前は言い換え" },
    { where: "特記事項・避難経路の注", result: "直した", note: "前は言い換え" },
    { where: "2 頁の下の注 2 つと最後の 1 文", result: "直した", note: "前は言い換え、最後の 1 文を 2 つ目の※に混ぜていた。様式どおり※の無い段落に" },
    { where: "2 頁の下の「※欄は松山市 様式による」", result: "直した", note: "様式に無い 1 行だったので外した（版は左上にある）" },
    {
      where: "字の書体・大きさと余白（T85）",
      result: "直した",
      note: "前はケア72 の決まり（全部 BIZ UDPゴシック、値 10pt・欄の名前 8.5pt・題 13pt、余白 上 12・下 14・左右 13mm）。原本の書体（本文の BIZ UDゴシックはそのまま。游明朝は BIZ UDP明朝、游ゴシックは BIZ UDPゴシックに置き換え）・大きさ・余白と、欄の名前・注の色（前は灰色、原本どおり黒。11/4 15:4x 確定）に",
    },
    {
      where: "近親者の段の注の太さと下線、2 頁の下の注 1 つ目の下線（T85）",
      result: "直した",
      note: "注は塗りと線で太くした字で、書体の名前は細い（T47 は書体の名前だけ見て細いとしていた）",
    },
  ],
};

/** 災害診療記録 2018（一般診療版）の 1 頁（基本情報）と 2 頁の既往症・予防接種。医療要約はこの順で値を並べる */
export const MEDICAL_AUDIT: FormAudit = {
  id: "medical",
  title: "医療要約（災害診療記録 2018 の順）",
  source: "災害診療記録2018（一般診療版。厚生労働省の通知の別添４、4 頁のうち 1・2 頁）",
  bold: ["【禁忌事項等】", "【特記事項（常用薬等）】", "＊は必須記録項目（ケア72 は刷らない）"],
  paper: {
    orientation: "縦",
    pages: 1,
    // 表の外枠: 左 x=57.5pt・右 x=547.5pt・下 y=19pt（メディカル ID の枠）。上は（別添４）の字
    margins: { top: [7.4], right: 16.9, bottom: 6.7, left: 20.3 },
    used: { bottom: 11 },
    marginNote: "下は原本 6.7mm。ケア72 の紙の決まりの頁の下の端（文書名と頁番号、下から 6mm）と重ならないよう 11mm",
    type: [
      {
        role: "題「災害診療記録２０１８」",
        original: "MS-PGothic",
        pt: 20.04,
        sel: ".title",
        note: "ケア72 の題「医療要約」に当てた（様式の題は右上の 1 行）",
      },
      { role: "（別添４）", original: "MS-Mincho", pt: 12, note: "通知の別添の番号。ケア72 は刷らない" },
      { role: "右上の頁の印「1頁/4頁」", original: "MS-Gothic", pt: 9, sel: ".top-col", note: "ケア72 は右上の版・作成・同意の小さな字に当てた" },
      {
        role: "段の名前（太い）「【禁忌事項等】・【特記事項（常用薬等）】」",
        original: "MS-PGothic",
        pt: 11.04,
        bold: true,
        sel: '[data-block="contra"] > .blk-h, [data-block="special"] > .blk-h',
      },
      {
        role: "欄の名前「＊初診日・＊初診医師氏名・＊患者氏名・（漢字等）・＊生年月日・年齢・[携帯]電話番号・＊住所・連絡先・アレルギー・禁忌食物・トリアージタグ・メディカル ID」",
        original: "MS-PGothic",
        pt: 11.04,
        sel: ':is([data-field="doctor.firstVisit"], [data-field="doctor.physician"], [data-field="doctor.triage"], [data-field="patient.kana"], [data-field="patient.name"], [data-field="patient.birth"], [data-field="patient.phone"], [data-field="patient.address"], [data-field="contact.kinds"], [data-field="contra.allergy"], [data-field="contra.food"]) > .f-l, .mid-label',
      },
      {
        role: "□ の行「抗血小板薬・抗凝固薬・糖尿病治療薬・ステロイド・抗てんかん薬・その他・透析・在宅酸素療法（HOT)」",
        original: "MS-PGothic",
        pt: 11.04,
        sel: '[data-block="special"] [data-field] > .f-v',
      },
      {
        role: "「（カタカナ）・性別：・状態：・避難先１：・避難先２：・【要保護者】の行・＊傷病名」と災害時要配慮者の □",
        original: "MS-PGothic",
        pt: 10.56,
        sel: ':is([data-field="patient.sex"], [data-field="patient.house"], [data-field="shelter.first"], [data-field="shelter.second"], [data-field="care.protect"], [data-field="doctor.disease"]) > .f-l, [data-field="care.vulnerable"] .ch',
      },
      { role: "連絡先の □「家族・知人・その他・連絡先なし」", original: "MS-PGothic", pt: 9, sel: '[data-field="contact.kinds"] .ch' },
      { role: "2 頁の欄の名前「既往症・予防接種」", original: "MS-PGothic", pt: 9, sel: ':is([data-field="history.disease"], [data-field="history.vaccination"]) > .f-l' },
      { role: "2 頁の □「高血圧…・麻疹…」", original: "MS-PGothic", pt: 8.04, note: "ケア72 は □ を刷らない。台帳の言葉を欄の名前と同じ 9pt で書く（照合の表の既往症・予防接種の行）" },
      {
        role: "注「最初の7文字をメディカル ID に転記・メディカル ID＝西暦生年月日 8 桁＋…」",
        original: "MS-PGothic",
        pt: 8.04,
        sel: ".small-note, .mid-text > .f-l",
      },
    ],
    extra: [
      { where: "値（原本は空欄。欄の名前と同じ大きさ）", pt: 11.04, face: "gothic", sel: '[data-field="patient.phone"] > .f-v' },
      { where: "補足（様式外の欄。原本に無い）と未確認の一覧の字（原本の注と同じ大きさ）", pt: 8.04, face: "gothic", sel: '[data-block="extra"] [data-field] > .f-v' },
      { where: "頁の下の端の文書名と頁番号", pt: 8, face: "gothic", sel: ".paper-foot" },
    ],
  },
  rows: [
    { page: 1, original: "＊初診日", keys: ["doctor.firstVisit"], result: "直した", note: "医師が書く欄。前は出していなかった。空欄で出す（docs/DECISIONS.md「書類」。T48）" },
    { page: 1, original: "＊初診医師氏名", keys: ["doctor.physician"], result: "直した", note: "同上" },
    { page: 1, original: "＊患者氏名（カタカナ）", keys: ["patient.kana"], result: "一致" },
    { page: 1, original: "（漢字等）", keys: ["patient.name"], code: "漢字等", result: "表記" },
    { page: 1, original: "性別：", options: ["男", "女"], keys: ["patient.sex"], code: "性別", result: "直した", note: "順: 様式は（漢字等）の右。前は生年月日のあと" },
    { page: 1, original: "＊生年月日・年齢", keys: ["patient.birth"], result: "一致" },
    { page: 1, original: "保険証情報", keys: [], result: "書かない", note: "台帳に無い" },
    { page: 1, original: "[携帯]電話番号", keys: ["patient.phone"], result: "直した", note: "前は「電話番号」" },
    { page: 1, original: "＊住所", keys: ["patient.address"], result: "直した", note: "順: 様式は電話番号の下で状態の左。前は状態のあと" },
    { page: 1, original: "状態：", options: ["健存", "半壊", "全壊"], keys: ["patient.house"], code: "状態", result: "直した", note: "前は紙面に「状態（家）」" },
    {
      page: 1,
      original: "避難先１：",
      options: ["避難所名（　）", "知人宅", "テント", "車内", "その他"],
      keys: ["shelter.first"],
      code: "避難先１",
      result: "表記",
      note: "様式の □ は付けず、計画の避難先の名前と移動の手段を書く",
    },
    {
      page: 1,
      original: "避難先２：",
      options: ["避難所名（　）", "知人宅", "テント", "車内", "その他"],
      keys: ["shelter.second"],
      code: "避難先２",
      result: "表記",
      note: "避難先１と同じ",
    },
    { page: 1, original: "連絡先", options: ["家族", "知人", "その他", "連絡先なし"], keys: ["contact.kinds"], result: "一致" },
    { page: 1, original: "職業", keys: [], result: "書かない", note: "台帳に無い" },
    { page: 1, original: "【禁忌事項等】アレルギー", keys: ["contra.allergy"], code: "アレルギー", result: "一致" },
    { page: 1, original: "禁忌食物", keys: ["contra.food"], result: "一致" },
    { page: 1, original: "【特記事項（常用薬等）】抗血小板薬", keys: ["drug.antiplatelet"], code: "抗血小板薬", result: "一致" },
    { page: 1, original: "抗凝固薬", keys: ["drug.anticoagulant"], result: "一致", note: "中の □ ワーファリン も" },
    { page: 1, original: "糖尿病治療薬", keys: ["drug.diabetes"], result: "一致", note: "中の □ インスリン・経口薬 も" },
    { page: 1, original: "ステロイド", keys: ["drug.steroid"], result: "一致" },
    { page: 1, original: "抗てんかん薬", keys: ["drug.antiepileptic"], result: "一致" },
    { page: 1, original: "その他", keys: ["drug.other"], result: "一致" },
    { page: 1, original: "透析", keys: ["drug.dialysis"], result: "一致" },
    { page: 1, original: "在宅酸素療法（HOT)", keys: ["drug.hot"], result: "一致" },
    {
      page: 1,
      original: "災害時要配慮者",
      options: ["高齢者", "障害者", "乳幼児", "妊婦", "日本語が不自由", "その他"],
      keys: ["care.vulnerable"],
      result: "一致",
    },
    {
      page: 1,
      original: "【要保護者】",
      options: ["支援者のいない要配慮者等"],
      keys: ["care.protect"],
      code: "要保護者",
      result: "一致",
      note: "該当状況（身体的・精神的・社会的・その他）は医療班が書く欄なので印を付けない",
    },
    {
      page: 1,
      original: "＊傷病名",
      keys: ["doctor.disease"],
      result: "直した",
      note: "医師が書く欄。空欄で出す（docs/DECISIONS.md「書類」。T48）。1 頁に収めるため、紙面では初診日の行に並べた",
    },
    { page: 1, original: "＊開始・診察場所・＊所属・医師サイン", keys: [], result: "書かない", note: "医療班が書く欄" },
    { page: 1, original: "トリアージタグ", keys: ["doctor.triage"], result: "直した", note: "傷病名と同じ" },
    { page: 1, original: "メディカル ID", keys: ["id.medical"], result: "直した", note: "順: 様式は 1 頁の下。前は 2 頁の既往症・予防接種のあと" },
    {
      page: 2,
      original: "既往症",
      options: ["高血圧", "糖尿病", "喘息", "その他"],
      keys: ["history.disease"],
      result: "一致",
      note: "台帳の言葉のまま。病名を推し量らない",
    },
    {
      page: 2,
      original: "予防接種",
      options: ["麻疹", "破傷風", "今期インフルエンザ", "肺炎球菌", "風疹", "その他"],
      keys: ["history.vaccination"],
      result: "一致",
    },
    {
      page: 2,
      original: "2 頁のほかの欄（J-SPEED・バイタルサイン・主訴・現病歴・処置・処方など）",
      keys: [],
      result: "書かない",
      note: "医療班が書く欄",
    },
    {
      page: 1,
      original: "",
      keys: ["patient.dwelling", "contact.people", "contact.others", "drug.devices", "meds.list", "meds.carry", "meds.notes"],
      result: "様式外",
      note: "住まい・連絡先の人・関係先・機器・常用薬の表・持出品・特記。前は様式の欄の間に混ぜていた。様式の欄のあとの「補足」の段にまとめた",
    },
  ],
  texts: [
    { where: "題", result: "表記", note: "要約の題は「医療要約」（様式そのものではない）。様式の題「災害診療記録２０１８」は右上の 1 行に" },
    {
      where: "字の太さ",
      result: "直した",
      note: "様式で太いのは【禁忌事項等】・【特記事項（常用薬等）】（と刷らない「＊は必須記録項目」）だけ。書体は MS P ゴシックで、太さは塗りと線で付けている（T85 で読み直した。T47 は書体の名前だけ見て太字なしとしていた）。前は値・薬の名前・中断注意・ID・見出しを太字にしていた",
    },
    {
      where: "字の書体・大きさと余白（T85）",
      result: "直した",
      note: "前はケア72 の決まり（値 10pt・欄の名前 8.5pt・題 13pt、余白 上 12・下 14・左右 13mm）。原本の大きさ（欄の名前 11.04pt・題 20.04pt ほか）と余白と、欄の名前の色（前は灰色、原本どおり黒）に。書体は MS P ゴシック・MS ゴシックを BIZ UDPゴシックに置き換え（原本の明朝は刷らない（別添４）だけ）",
    },
    {
      where: "医療の線引き: 内容を変えずに並べ替えるだけ",
      result: "直した",
      note: "値は台帳の言葉のまま並べる。並べ替えの外は 3 つ: 様式の □ の印（薬の区分・年齢・手帳から機械的に）、メディカル ID の組み立て（様式の決まりどおり）、中断注意の印（優先の骨格の段から）。中断注意の印は様式の特記事項の欄から外し、補足の段（常用薬の表・機器）にだけ出す（T48）。紙の注に「□ は薬の区分などから、補足の中断注意の印は薬の区分から機械的に付けた」と書いた",
    },
    {
      where: "医療の線引き: 元の記録と並べて見られる",
      result: "直した",
      note: "前は要約と根拠の脇だけ。画面の右に「原本」（本人のページの 基本・医療・避難・人。見る人の範囲のまま）を並べた。紙には出さない",
    },
    {
      where: "医療の線引き: 医師が書く判断の欄は空けたまま",
      result: "一致",
      note: "初診日・初診医師・傷病名・トリアージ・処置などは前から載せない（紙に枠も刷らない。医療班は災害診療記録の本紙に書く）。紙の注に「医療班が書く欄は載せていない」を足した",
    },
  ],
};

/** 厚生労働省 介護施設・事業所の自然災害 BCP ひな形の様式9（Excel のシート） */
export const FORM9_AUDIT: FormAudit = {
  id: "form9",
  title: "様式9 災害時利用者一覧表",
  source: "介護施設・事業所における自然災害発生時の業務継続計画（ひな形）の Excel の「様式9」のシート",
  bold: ["様式9：災害時利用者一覧表 (安否確認優先順位)（題）"],
  paper: {
    orientation: "横",
    pages: 1,
    // シートの余白（左右 0.709in・上下 0.748in・ヘッダーとフッター 0.315in）と印刷の範囲 A1:N27（20 人の行で 1 頁）
    margins: { top: [19], right: 18, bottom: 19, left: 18 },
    scale: 73,
    type: [
      { role: "題（セル 11pt 太字）", original: "Meiryo UI", pt: 8.03, bold: true, sel: ".title" },
      { role: "事業所名・作成（セル 11pt）", original: "Meiryo UI", pt: 8.03, sel: ".top" },
      { role: "列の見出し（セル 10pt）", original: "Meiryo UI", pt: 7.3, sel: "th" },
      { role: "No の列（セル 11pt）", original: "Meiryo UI", pt: 8.03, sel: "td.num" },
      { role: "欄（セル 9pt。ひな形の例の行の字）", original: "Meiryo UI", pt: 6.57, sel: "td:not(.num)" },
    ],
    extra: [
      { where: "列の注（※No から…ケア72 の欄）", pt: 8.03, face: "gothic", sel: ".small-note" },
      { where: "市町村への報告（下書き。発災時だけ、表のあと）", pt: 9, face: "gothic", sel: ".report-text" },
    ],
  },
  rows: [
    { page: 1, original: "No", keys: ["no"], result: "一致" },
    { page: 1, original: "優先順位※ 医療・介護", keys: ["medicalCare"], code: "優先順位（医療・介護）", result: "表記", note: "2 段の見出し。紙面は様式と同じ 2 段、CSV は 1 行の見出し" },
    { page: 1, original: "環境", keys: ["environment"], code: "優先順位（環境）", result: "表記", note: "同上" },
    { page: 1, original: "避難", keys: ["evacuation"], code: "優先順位（避難）", result: "表記", note: "同上" },
    { page: 1, original: "地域 区分", keys: ["area"], code: "地域／区分", result: "表記", note: "様式は 2 行の見出し。紙面は「地域・区分」" },
    { page: 1, original: "氏名　(年齢)", keys: ["nameAge"], result: "一致" },
    { page: 1, original: "住所(自治会)", keys: ["address"], result: "一致" },
    { page: 1, original: "想定される避難場所 避難所", keys: ["shelter"], code: "想定される避難場所（避難所）", result: "表記", note: "2 段の見出し" },
    { page: 1, original: "介護・医療機関", keys: ["facility"], code: "想定される避難場所（介護・医療機関）", result: "表記", note: "2 段の見出し" },
    { page: 1, original: "特記", keys: ["notes"], result: "一致" },
    { page: 1, original: "担当ケアマネ", keys: ["careManager"], result: "一致" },
    { page: 1, original: "安否確認 できた日", keys: ["checkedAt"], result: "一致", note: "時刻まで入れる" },
    {
      page: 1,
      original: "",
      keys: ["color", "reason", "emergency1", "emergency2", "means", "result", "manual"],
      result: "様式外",
      note: "ケア72 の欄。ひな形の列のあとに「ケア72 の欄」の見出しで分けて置く",
    },
  ],
  texts: [
    { where: "題・事業所名・作成", result: "一致" },
    { where: "字の太さ", result: "直した", note: "ひな形で太いのは題だけ。前は見出し・順位・氏名・色も太字" },
    {
      where: "字の書体・大きさと余白（T85）",
      result: "直した",
      note: "前はケア72 の決まり（表 8.5pt・題 13pt、余白 上 11・下 13・左右 8.5mm）。ひな形はセル 11・10・9pt を印刷の倍率 73% で刷るので、紙の上の大きさ（8.03・7.3・6.57pt）と余白（上下 19・左右 18mm）に。書体はメイリオ UI を BIZ UDPゴシックに置き換え",
    },
  ],
};

export const FORM_AUDITS: readonly FormAudit[] = [MATSUYAMA_AUDIT, MEDICAL_AUDIT, FORM9_AUDIT];

/** 比べるための書き方の揃え（NFKC、空白・改行・必須の＊・【】・末尾の：を除く） */
export function normalizeLabel(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[\s　]/gu, "")
    .replace(/^[＊*]/u, "")
    .replace(/[【】]/gu, "")
    .replace(/[:：]$/u, "");
}

/** 結果ごとの数 */
export function auditCounts(a: FormAudit): Record<AuditResult, number> {
  const out: Record<AuditResult, number> = { 一致: 0, 直した: 0, 表記: 0, 名付け: 0, 様式外: 0, 書かない: 0, 未照合: 0, 問い: 0 };
  for (const r of a.rows) out[r.result] += 1;
  for (const t of a.texts ?? []) out[t.result] += 1;
  return out;
}

const cell = (s: string) => s.replace(/\|/g, "／").replace(/\n/g, " ");

const mm = (n: number) => `${n}mm`;

/** 余白の 1 行（上は頁ごと） */
function marginText(m: PaperSpec["margins"]): string {
  const top = m.top.length > 1 ? `上 ${m.top.map((t, i) => `${i + 1} 頁 ${mm(t)}`).join("・")}` : `上 ${mm(m.top[0])}`;
  return `${top}・右 ${mm(m.right)}・下 ${mm(m.bottom)}・左 ${mm(m.left)}`;
}

/** 字と余白の表（T85） */
function paperMarkdown(p: PaperSpec): string[] {
  const out: string[] = [];
  const side = { top: "上", right: "右", bottom: "下", left: "左" } as const;
  const usedSides = Object.entries(p.used ?? {}).map(([k, v]) => {
    const value = typeof v === "number" ? mm(v) : (v as readonly number[]).map(mm).join("・");
    return `${side[k as keyof typeof side]} ${value}`;
  });
  const used = usedSides.length > 0 ? `。ケア72 の紙は ${usedSides.join("・")}（${p.marginNote ?? ""}）` : "";
  out.push(
    `字と余白（T85）: A4 ${p.orientation} ${p.pages} 頁。余白 ${marginText(p.margins)}${used}。${p.scale ? `Excel の印刷の倍率 ${p.scale}%（大きさは倍率を掛けた紙の上の pt）。` : ""}書体は BIZ UD の字はそのまま、ほかの明朝を ${PAPER_FACE_NAMES.mincho}、ほかのゴシックを ${PAPER_FACE_NAMES.gothic} に置き換えた`,
    "",
    "| 字の役 | 原本の書体 | 大きさ | 太さ・下線 | 紙の書体 | 注 |",
    "| --- | --- | --- | --- | --- | --- |",
  );
  for (const t of p.type) {
    const deco = [t.bold ? "太い" : "", t.underline ? "下線" : ""].filter(Boolean).join("・");
    out.push(
      `| ${cell(t.role)} | ${t.original} | ${t.pt}pt | ${deco} | ${t.sel ? PAPER_FACE_NAMES[faceOf(t.original)] : "刷らない"} | ${cell(t.note ?? "")} |`,
    );
  }
  for (const e of p.extra ?? []) out.push(`| ${cell(e.where)} | （ケア72） | ${e.pt}pt |  | ${PAPER_FACE_NAMES[e.face]} | 原本に無い字 |`);
  out.push("");
  return out;
}

/** docs/progress/t47.md の照合の表（様式ごと） */
export function auditMarkdown(): string {
  const out: string[] = [];
  for (const a of FORM_AUDITS) {
    out.push(`### ${a.title}`, "", `元の様式: ${a.source}`, "");
    out.push(`様式で太い所: ${a.bold.length > 0 ? a.bold.join("、") : "なし"}`, "");
    out.push(...paperMarkdown(a.paper));
    out.push("| 頁 | 様式の欄 | 選択肢 | コードの欄 | 結果 | 違い・直した所 |", "| --- | --- | --- | --- | --- | --- |");
    for (const r of a.rows) {
      const code = r.keys.length > 0 ? `${r.keys.map((k) => `\`${k}\``).join(" ")}${r.code ? `（${r.code}）` : ""}` : "—";
      out.push(
        `| ${r.page} | ${cell(r.original || "（名前なし）")} | ${cell(r.options?.join("・") ?? "")} | ${code} | ${r.result} | ${cell(r.note ?? "")} |`,
      );
    }
    if (a.texts && a.texts.length > 0) {
      out.push("", "| 刷ってある文 | 結果 | 違い・直した所 |", "| --- | --- | --- |");
      for (const t of a.texts) out.push(`| ${cell(t.where)} | ${t.result} | ${cell(t.note ?? "")} |`);
    }
    const c = auditCounts(a);
    out.push(
      "",
      `数: ${(Object.keys(c) as AuditResult[])
        .filter((k) => c[k] > 0)
        .map((k) => `${k} ${c[k]}`)
        .join("、")}`,
      "",
    );
  }
  return out.join("\n");
}
