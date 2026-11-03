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
  | "未照合";

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
  ],
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
  ],
};

/** 災害診療記録 2018（一般診療版）の 1 頁（基本情報）と 2 頁の既往症・予防接種。医療要約はこの順で値を並べる */
export const MEDICAL_AUDIT: FormAudit = {
  id: "medical",
  title: "医療要約（災害診療記録 2018 の順）",
  source: "災害診療記録2018（一般診療版。厚生労働省の通知の別添４、4 頁のうち 1・2 頁）",
  bold: [],
  rows: [
    { page: 1, original: "＊初診日", keys: [], result: "書かない", note: "医療班が書く欄" },
    { page: 1, original: "＊初診医師氏名", keys: [], result: "書かない", note: "医療班が書く欄" },
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
    { page: 1, original: "＊傷病名・＊開始・診察場所・＊所属・医師サイン", keys: [], result: "書かない", note: "医療班が書く欄" },
    { page: 1, original: "トリアージタグ", keys: [], result: "書かない", note: "医療班が書く欄" },
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
      original: "2 頁のほかの欄（J-SPEED・バイタルサイン・主訴・現病歴・診断・処置・処方など）",
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
    { where: "字の太さ", result: "直した", note: "様式に太字は無い（MS 明朝・MS ゴシックだけ）。前は値・薬の名前・中断注意・ID・見出しを太字にしていた" },
    {
      where: "アドバイザー（11/3 14:1x の (3)）: 内容を変えずに並べ替えるだけ",
      result: "表記",
      note: "値は台帳の言葉のまま並べ替える。並べ替えの外は 3 つ: 様式の □ の印（薬の区分・年齢・手帳から機械的に）、メディカル ID の組み立て（様式の決まりどおり）、中断注意の印（優先の骨格の段から。11/3 04:0x 確定）。中断注意の印を残すかは作者への問い",
    },
    {
      where: "アドバイザー（11/3 14:1x の (3)）: 元の記録と並べて見られる",
      result: "直した",
      note: "前は要約と根拠の脇だけ。画面の右に「原本」（本人のページの 基本・医療・避難・人。見る人の範囲のまま）を並べた。紙には出さない",
    },
    {
      where: "アドバイザー（11/3 14:1x の (3)）: 医師が書く判断の欄は空けたまま",
      result: "一致",
      note: "初診日・初診医師・傷病名・トリアージ・診断・処置などは前から書かない。紙の注に「医療班が書く欄で、ここには書かない」の 1 行を足した",
    },
  ],
};

/** 厚生労働省 介護施設・事業所の自然災害 BCP ひな形の様式9（Excel のシート） */
export const FORM9_AUDIT: FormAudit = {
  id: "form9",
  title: "様式9 災害時利用者一覧表",
  source: "介護施設・事業所における自然災害発生時の業務継続計画（ひな形）の Excel の「様式9」のシート",
  bold: ["様式9：災害時利用者一覧表 (安否確認優先順位)（題）"],
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
  const out: Record<AuditResult, number> = { 一致: 0, 直した: 0, 表記: 0, 名付け: 0, 様式外: 0, 書かない: 0, 未照合: 0 };
  for (const r of a.rows) out[r.result] += 1;
  for (const t of a.texts ?? []) out[t.result] += 1;
  return out;
}

const cell = (s: string) => s.replace(/\|/g, "／").replace(/\n/g, " ");

/** docs/progress/t47.md の照合の表（様式ごと） */
export function auditMarkdown(): string {
  const out: string[] = [];
  for (const a of FORM_AUDITS) {
    out.push(`### ${a.title}`, "", `元の様式: ${a.source}`, "");
    out.push(`様式で太い所: ${a.bold.length > 0 ? a.bold.join("、") : "なし"}`, "");
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
