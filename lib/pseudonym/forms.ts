// 台帳に無くても形で伏せる物（docs/tasks/T74.md）。仮名化の層（./index.ts の scrub・findLeaks）だけが使う。
//
// 台帳にある氏名・町名・電話は ./index.ts の置き換えの表で伏せる。ここは、ケアマネが特記・入れる欄に書いた
// 台帳に無い人名（「隣の田中さん」「○○病院の佐藤先生」）・住所（「愛媛県松山市○○町 1-2-3」）・郵便番号（〒）・メールを、
// 形だけで（氏名）（住所）（郵便番号）（メール）にする。伏せた所は戻さない（restoreText は仮名 A さんだけを戻す）。
//
// 伏せ過ぎの守り: 敬称の前が続柄・役割・職業・時の言葉（お母さん・娘さん・ヘルパーさん・看護師さん・毎日ちゃんと）なら
// 人の名前でないので伏せない。除く語は下の NOT_NAMES の 1 か所に持つ（連絡先の役割名 KIND_ROLE と本人の呼び方の続柄
// RELATION_CALLS の語が全部入っていることは pseudonym.test.ts で縛る）。薬・病名・機器（ワーファリン・酸素）は
// 敬称が付かないので当たらない。単独の「先生」（「先生に聞く」）は前に語が無いので当たらない。
//
// 敬称の無い名前も、形で分かる所は伏せる（T88）: 見出しの後ろ（「患者氏名：」「本人：」「氏名:」）、続柄の後ろ（「長女 姓 名」）、
// 続柄・呼びかけの文脈のかなの名前（「孫の○○が」「○○、薬は？」・行頭の「○○：」・LINE の書き出しの名前の欄）。
// 一度名前と分かった語は、同じ文の中のほかの所（敬称の無い所）も伏せる。
//
// 伏せきれない物: 文脈の無い敬称なしの名前（「田中が来る」だけの文）、町の名前だけ（番地の無い住所）。
// README の本運用の条件に「特記に人名を書かない運用」として書く。

export const NAME_MARK = "（氏名）";
export const ADDRESS_MARK = "（住所）";
export const POSTAL_MARK = "（郵便番号）";
export const MAIL_MARK = "（メール）";
/** 台帳の町名の置き換え先（./index.ts の表が入れる）。住所の形の中に入っていても住所として伏せる */
const TOWN_MARK = "（町名）";

// ---------- 文字の種類 ----------

const HAN = /[\p{Script=Han}々〆]/u;
const KATA = /[\p{Script=Katakana}ー]/u;
const HIRA = /\p{Script=Hiragana}/u;
/** 伏せ字の代わりに人が書く印（○○病院・〇〇さん） */
const PLACEHOLDER = /[○◯〇●]/u;

const isHan = (c: string) => HAN.test(c);
const isKata = (c: string) => KATA.test(c);
const isHira = (c: string) => HIRA.test(c);
const isWordStart = (c: string) => isHan(c) || isKata(c) || PLACEHOLDER.test(c);
/** 名前の文字（漢字・カナ・かな・○ の印） */
const isNameChar = (c: string) => isHan(c) || isKata(c) || isHira(c) || PLACEHOLDER.test(c);

/** 助詞（名前の切れ目）。漢字・カナの語のあとで、次も漢字・カナのときだけ切れ目にする（かなの名前「とし子」「やす子」を切らない） */
const PARTICLES = new Set([..."のはがをにへとでもやか"]);

// ---------- 除く語（人の名前でない、敬称の付く語） ----------

/**
 * 敬称の前に来ても名前でない語。1 字の語・かなの語・「お」「ご」で始まる語は語全体が同じときだけ（「お子」が「なお子」に当たらない、
 * 「とう」が「さとう」に当たらない）、2 字以上の漢字・カナの語は語の終わりが同じとき（「民生委員」「訪問看護師」「デイサービス」）。
 * 語の頭の「お」「ご」「御」は外しても比べる（お母 → 母、ご近所 → 近所）
 */
const NOT_NAMES = `
家族 親族 親戚 身内 主人 旦那 亭主 女房 家内 嫁 婿 夫 妻 母 父 兄 姉 弟 妹 甥 姪 孫 子 娘 息子 子供 子ども 奥
祖母 祖父 義母 義父 実母 実父 養母 養父 継母 継父 叔母 伯母 叔父 伯父 義姉 義兄 義妹 義弟 兄弟 姉妹 兄嫁 弟嫁
長男 次男 三男 長女 次女 三女 末っ子 孫娘 孫息子 曾孫 ひ孫 赤 坊 嬢
隣 隣人 近所 隣家 向かい 町内 町内会 自治会 大家 家主 管理人 友人 知人 知り合い 友達 友だち 仲間 同僚 上司 部下 先輩 後輩 親友
民生委員 委員 みまもり員 見守り員 見守り 支援者 介護者 協力者 保護者 後見人 本人 患者 利用者 客 皆
医者 医師 医 歯医者 歯科医 主治医 担当医 訪問医 かかりつけ医 看護師 看護婦 看護 訪看 保健師 薬剤師 助産師 介護士 福祉士 療法士 栄養士
相談員 支援員 職員 事務員 店員 スタッフ ヘルパー ケアマネ ケアマネジャー ケアマネージャー マネージャー ナース ドクター ボランティア
運転手 運転士 ドライバー 配達員 配達 宅配 郵便屋 消防士 消防団 消防 救急隊 隊員 警察官 警官 警察 巡査 駐在 巡り
弁護士 司法書士 行政書士 税理士 住職 和尚 神主 牧師 神父
業者 電気屋 ガス屋 水道屋 灯油屋 米屋 酒屋 八百屋 魚屋 肉屋 床屋 薬屋 本屋 新聞屋 植木屋 大工
花屋 菓子屋 豆腐屋 弁当屋 時計屋 金物屋 布団屋 靴屋 呉服屋 写真屋 牛乳屋 不動産屋 便利屋 鍵屋 自転車屋 果物屋 雑貨屋 文具屋
定食屋 寿司屋 蕎麦屋 鮨屋 電器屋 古着屋 着物屋 茶屋 炭屋 畳屋 建具屋 仕出し屋 店 店主 保育士 衛生士 整備士 管理会社
店長 社長 会長 部長 課長 係長 所長 院長 園長 校長 教頭 担任 担当 師長 主任 室長 局長 署長 班長 区長 組長 隊長 理事長 施設長 管理者
病院 医院 診療所 クリニック 薬局 施設 事業所 会社 役所 市役所 役場 包括 社協 センター ステーション 郵便局 銀行 農協 生協
学校 保育園 幼稚園 デイ デイサービス ショート ショートステイ ホーム サービス 連絡先 かかりつけ
ママ パパ ばあば じいじ
毎日 毎朝 毎晩 毎回 毎食 毎週 毎月 今日 昨日 明日 今朝 今夜 今晩 最近 普段 自分 一人 二人 全部 本当 朝 昼 夜 前
疲れ 苦労 世話 馳走 互い 陰 愁傷 生憎 待ち遠 粗末 邪魔 毒 連れ 宅
おばあ ばあ おじい じい かあ とう にい ねえ おじ おば おく まご となり きんじょ いしゃ かんごし まわり あか ぼっ おっ あん じょう
たく みな その この あの どの あなた どなた どちら そちら こちら あちら つかれ くろう せわ かげ たがい ちそう まちどお
さん さま ちゃん くん
`
  .split(/\s+/)
  .filter(Boolean);

/** 様・さまの前だけ除く語（同様・模様・仕様・王様・神様・同じ様に）。王・神は名字にもあるので、さん・氏の前では伏せる */
const NOT_NAMES_SAMA = [..."同模仕異一多有文図左王神仏殿", "同じ"];
/** 氏の前だけ除く語（同氏・両氏・彼氏） */
const NOT_NAMES_SHI = [..."同両彼各諸某貴"];
/** 先生の前だけ除く語（大先生・若先生） */
const NOT_NAMES_SENSEI = [..."大若老女"];
/** 殿の前だけ除く語（宮殿・神殿・御殿・本殿・貴殿・沈殿） */
const NOT_NAMES_TONO = [..."宮神御本拝湯寝社正仏宝貴沈"];

/**
 * 語の終わりが職業・店の字なら名前でない（パン屋・そば屋・商店・庭師・配達員）。
 * 屋は前がカナ・かなのときだけ（漢字の「土屋」「守屋」は名字なので伏せる。漢字の店の語は NOT_NAMES に）
 */
function isTradeWord(token: string): boolean {
  const cs = [...token];
  if (cs.length < 2) return false;
  const last = cs.at(-1)!;
  if (last === "店" || last === "師" || last === "員") return true;
  if (last === "屋") return cs.slice(0, -1).every((c) => isKata(c) || isHira(c));
  return false;
}

/** かなの語のうち、語の終わりで比べる物（ひいおばあちゃん・もうたくさん）。ほかのかなの語は語全体で比べる */
const KANA_SUFFIX = new Set(["ばあ", "じい", "かあ", "たく"]);

function exactOnly(w: string): boolean {
  return [...w].length === 1 || /^[おご御]/u.test(w) || ([...w].every(isHira) && !KANA_SUFFIX.has(w));
}

const EXACT = new Set(NOT_NAMES.filter(exactOnly));
const SUFFIX = NOT_NAMES.filter((w) => !exactOnly(w));

/** 除く語の一覧（テストで役割名・続柄が入っているかを確かめる） */
export const NOT_NAME_WORDS: readonly string[] = NOT_NAMES;

/** 敬称の前の語が人の名前でない語か */
export function isNotName(token: string, honorific: string): boolean {
  const bare = token.replace(/^[おご御]/u, "");
  const extra =
    honorific === "様" || honorific === "さま"
      ? NOT_NAMES_SAMA
      : honorific === "氏"
        ? NOT_NAMES_SHI
        : honorific === "先生"
          ? NOT_NAMES_SENSEI
          : honorific === "殿"
            ? NOT_NAMES_TONO
            : [];
  for (const t of [token, bare]) {
    if (t === "") return true;
    if (EXACT.has(t) || extra.includes(t)) return true;
  }
  return SUFFIX.some((w) => token.endsWith(w)) || isTradeWord(token);
}

// ---------- 敬称つきの名前 ----------

const HONORIFIC = /さん|さま|様|氏|ちゃん|くん|先生|殿/gu;
/** 敬称の前を見る長さ（字）。これより長い漢字・かなの並びは後ろのこの長さだけ */
const RUN_MAX = 12;

/** text の at の直前の 1 字（サロゲートの組は 1 字） */
function charBefore(text: string, at: number): string {
  const lo = text.charCodeAt(at - 1);
  if (at >= 2 && lo >= 0xdc00 && lo <= 0xdfff) {
    const hi = text.charCodeAt(at - 2);
    if (hi >= 0xd800 && hi <= 0xdbff) return text.slice(at - 2, at);
  }
  return text.slice(at - 1, at);
}

/** 敬称のあとが言葉の続き（様子・様式・氏名・さまざま・さんぽ・ちゃんと）で、敬称でないか */
function notHonorific(honorific: string, after: string): boolean {
  switch (honorific) {
    case "様":
      return /^[子式々態相変な]/u.test(after);
    case "氏":
      return /^[名族神子]/u.test(after);
    case "さま":
      return after.startsWith("ざま");
    case "さん":
      return /^(?:ぽ|ざん)/u.test(after) || (after.startsWith("ま") && !after.startsWith("まで"));
    case "くん":
      return after.startsWith("せい");
    case "殿":
      return /^[下堂方様中]/u.test(after);
    default:
      return false;
  }
}

/** 漢字・カナの語の前の空き（「森 恵子さん」の姓） */
const SPACE = /^[ 　]$/u;

/**
 * 並び run（名前の文字だけ）の中の助詞の切れ目のあとの語。切れ目が無ければ run 全体。
 * 切れ目は、漢字・カナの語（か並びの頭）のあとの助詞（「の」はかなの語のあとも）で、次が
 * - 漢字・カナ（「隣の田中」「（氏名）の佐藤」）
 * - 「お」「ご」で始まる語（「父とお母」「母とおじ」）
 * - 「の」のあと、終わりまでかな 2〜4 字（「孫のゆう」「隣のはな」）
 * のとき。かなの名前の中（「とし子」「やす子」「田中ともこ」）では切らない（名字ごと伏せる）
 */
function afterBreak(run: string): { offset: number; token: string } {
  const cs = [...run];
  for (let x = cs.length - 2; x >= 0; x--) {
    if (!PARTICLES.has(cs[x])) continue;
    // かなの語のあとの「の」も、次が漢字・カナなら切れ目（「向かいの木下」「となりの田中」）
    const afterKanaNo = cs[x] === "の" && isWordStart(cs[x + 1]);
    if (!(x === 0 || isWordStart(cs[x - 1]) || afterKanaNo)) continue;
    const rest = cs.slice(x + 1);
    const kanaName = cs[x] === "の" && rest.length >= 2 && rest.length <= 4 && rest.every(isHira);
    if (isWordStart(cs[x + 1]) || /^[おご御]$/u.test(cs[x + 1]) || kanaName) {
      const offset = cs.slice(0, x + 1).join("").length;
      return { offset, token: run.slice(offset) };
    }
  }
  return { offset: 0, token: run };
}

/**
 * 漢字・カナで終わる語の前にかなが 3 字以上続けば、そのかなは言葉（「のもとに佐藤」「ところへ田中」）として残し、
 * 後ろの漢字・カナだけを名前にする。かなの名前の頭（ゆか子・のぶ子・くに子）は 2 字までなので切らない
 */
function kanaLead(b: { offset: number; token: string }): { offset: number; token: string } {
  const cs = [...b.token];
  let i = cs.length;
  while (i > 0 && !isHira(cs[i - 1])) i--;
  if (i === cs.length || i === 0) return b;
  let j = i;
  while (j > 0 && isHira(cs[j - 1])) j--;
  if (i - j < 3) return b;
  const lead = cs.slice(0, i).join("").length;
  return { offset: b.offset + lead, token: b.token.slice(lead) };
}

/** text の [floor, end) で、end の直前の名前の文字の並び */
function runBefore(text: string, end: number, floor: number): { start: number; run: string } {
  let j = end;
  let n = 0;
  while (j > floor && n < RUN_MAX) {
    const c = charBefore(text, j);
    if (!isNameChar(c)) break;
    j -= c.length;
    n++;
  }
  return { start: j, run: text.slice(j, end) };
}

export type Span = { start: number; end: number };

/** 敬称つきの名前の場所（敬称まで）。左から順、重ならない */
export function honorificSpans(text: string): Span[] {
  const out: Span[] = [];
  let floor = 0;
  for (const m of text.matchAll(HONORIFIC)) {
    const at = m.index;
    const honorific = m[0];
    const end = at + honorific.length;
    const start = nameStart(text, at, honorific, floor);
    // 前の敬称（伏せても伏せなくても）より前は見ない（「娘さん花子さん」の「娘さん」を巻き込まない）
    floor = end;
    if (start !== null) out.push({ start, end });
  }
  return out;
}

/** 動詞・助動詞・文の終わりのかな（名前の終わりでない） */
const VERB_END = /(?:ます|ました|です|でした|ません|った|って|ている|てる|ない|たい|よう|ので|から|けど|[ねよなわ])$/u;

/** 「姓 名 様」: 敬称の前の空き（2 字まで）を飛ばした所。空きの前が名前の文字でなければ at のまま（「A さん」は飛ばさない） */
function beforeSpaces(text: string, at: number, floor: number): number {
  let p = at;
  let n = 0;
  while (p > floor && n < 2 && SPACE.test(charBefore(text, p))) {
    p -= 1;
    n++;
  }
  return n > 0 && p > floor && isNameChar(charBefore(text, p)) ? p : at;
}

function nameStart(text: string, at: number, honorific: string, floor: number): number | null {
  const after = text.slice(at + honorific.length, at + honorific.length + 3);
  if (notHonorific(honorific, after)) return null;
  const end = beforeSpaces(text, at, floor);
  const spaced = end !== at;
  const { start: runStart, run } = runBefore(text, end, floor);
  if (run === "") return null;
  // 空きを挟んだ敬称（「浜野 きくゑ 様」）は、名前の形（漢字・カナで終わるか、終わりのかなが 2〜4 字）のときだけ。
  // 動詞・助動詞の終わり（「言いました 先生」「お願いします 様」）は名前にしない
  if (spaced) {
    const cs = [...run];
    let k = 0;
    while (k < cs.length && isHira(cs[cs.length - 1 - k])) k++;
    if (k === 1 || k > 4 || VERB_END.test(run)) return null;
  }
  const last = [...run].at(-1)!;
  // 敬称のすぐ前の「を」、先生・様の前の「の」（かかりつけの先生・近くの先生）は名前の終わりでない
  if (last === "を") return null;
  if (last === "の" && (honorific === "先生" || honorific === "様" || honorific === "さま")) return null;
  const broken = afterBreak(run);
  // 除く語は切る前の語でも見る（「みまもり員」を「員」に切ってから比べない）
  if (broken.token === "" || isNotName(broken.token, honorific)) return null;
  const { offset, token } = kanaLead(broken);
  if (token === "") return null;
  // 「それはちゃんと」「朝からちゃんと」: かなを含む語のあとの「ちゃんと」は言葉。漢字・カナの名前（花子ちゃんと）と、
  // 助詞の切れ目のあとの語（孫のゆうちゃんと）は名前として伏せる。「毎日ちゃんと」は除く語
  if (honorific === "ちゃん" && after.startsWith("と") && offset === 0 && [...token].some(isHira)) return null;
  if (isNotName(token, honorific)) return null;
  const chars = [...token];
  // かなだけの語は 2〜4 字（かなの名前「はな」「よしこ」）。長いかなの並び（かかりつけの）は名前でない
  if (chars.every(isHira) && (chars.length < 2 || chars.length > 4)) return null;
  let start = runStart + offset;
  // 「森 恵子さん」: 空きの前の漢字・カナの語（1〜4 字、除く語でない）も姓として伏せる
  if (offset === 0 && start > floor + 1 && SPACE.test(charBefore(text, start))) {
    const prev = runBefore(text, start - 1, floor);
    const sur = afterBreak(prev.run);
    const sc = [...sur.token];
    if (sc.length >= 1 && sc.length <= 4 && sc.some((c) => isHan(c) || isKata(c)) && !isNotName(sur.token, honorific) && !PARTICLES.has(sc.at(-1)!)) {
      start = prev.start + sur.offset;
    }
  }
  return start;
}

// ---------- 敬称の無い名前（見出し・続柄・呼びかけの文脈。T88） ----------

/** 見出しの後ろは名前（コロンのあと 1 語でも）。「病名」「薬品名」は入れない */
const NAME_LABELS = [
  "患者氏名",
  "利用者氏名",
  "本人氏名",
  "家族氏名",
  "介護者氏名",
  "連絡先氏名",
  "氏名カナ",
  "氏名",
  "患者名",
  "利用者名",
  "お名前",
  "名前",
  "姓名",
  "フリガナ",
  "ふりがな",
];
/** 続柄（後ろに空きかコロンで名前が来うる語。「長女 姓 名」） */
const RELATION_WORDS = [
  "長男", "次男", "三男", "長女", "次女", "三女", "息子", "娘", "妻", "夫", "嫁", "婿", "孫", "孫娘", "孫息子", "兄", "姉", "弟", "妹",
  "父", "母", "義母", "義父", "義姉", "義兄", "義妹", "義弟", "叔母", "叔父", "伯母", "伯父", "甥", "姪", "祖母", "祖父", "兄嫁", "弟嫁",
  "主人", "家内", "まご", "むすこ", "むすめ",
];
/** 弱い見出し・続柄: 後ろが「姓 名」（空きで 2 つ）か、かなの名前 1 つか、名前＋（年齢）のときだけ（「本人：元気です」を伏せない） */
const PERSON_LABELS = [
  "本人", "患者", "利用者", "家族", "主介護者", "介護者", "キーパーソン", "緊急連絡先", "連絡先", "主治医", "担当医", "医師",
  "担当者", "記入者", "記載者", "代理人", "保護者", "後見人", ...RELATION_WORDS,
];
/**
 * 「姓 名」の形に見えても名前でない語（「長男 同居 日中不在」「長女 市内 在住」）。どちらかの語がこれか除く語なら伏せない
 */
const COMMON_WORDS = new Set(
  `同居 別居 独居 市内 市外 県内 県外 町内 近所 近隣 遠方 在住 不在 日中 夜間 健在 他界 死去 入院 入所 通院 通所 退院 毎日 毎週 週末 平日
  仕事 勤務 会社員 自営 無職 学生 主婦 未婚 既婚 独身 協力的 不明 なし 無し 未記入 空欄 同上 未定 記載なし 本人 家族 介護 支援 連絡 対応
  内科 外科 整形外科 歯科 眼科 皮膚科 泌尿器科 循環器科 呼吸器科 消化器科 神経内科 精神科 小児科 耳鼻科 救急 病棟 外来 病院 医院 診療所`
    .split(/\s+/)
    .filter(Boolean),
);
/** 見出しの値が名前でない語（「氏名：不明」） */
const EMPTY_VALUES = new Set(["不明", "なし", "無し", "未記入", "空欄", "同上", "未定", "記載なし", "本人", "家族"]);

/**
 * かなの一般の語（「娘のところ」「孫のおもちゃ」「はい、」「あのね、」）。続柄の「の」の後ろ・行頭の呼びかけ・行頭の「○○：」で、
 * かなの語を名前にしない
 */
const KANA_COMMON = new Set(
  `こと もの ため ほう ところ とこ うち おうち いえ へや あと まえ うしろ よこ そば ちかく となり なか そと うえ した みぎ ひだり
  くるま にもつ くすり おくすり ごはん おかず おやつ みず おみず おちゃ ふく かお あし みみ こえ からだ あたま こし ひざ せなか
  でんわ けいたい すまほ はなし おはなし ようす ぐあい せわ おせわ かわり ぶん かぎ おかね しごと がっこう びょういん みせ おみせ
  いぬ ねこ おもちゃ ほん しゃしん なまえ ばしょ じかん よる あさ ひる ゆうがた きのう きょう あした あさって いま さっき
  みんな だれ だれか なに なにか どこ いつ どれ これ それ あれ ここ そこ あそこ こっち そっち あっち ほか ほかに
  ほんと ほんとう たぶん もう まだ すぐ ちょっと やっぱり ずっと いつも また でも だから それで そしたら じゃあ では ただ なお まず つぎ さて
  はい いいえ うん ええ いや いえ あの あのね あのさ ねえ ねぇ ほら よし さあ えっと ええと えーと うーん あれ あら まあ
  おはよう こんにちは こんばんは おやすみ ありがとう ありがと すみません ごめん ごめんね おねがい だいじょうぶ だいじょぶ
  まって はやく いそいで あぶない こわい さむい あつい いたい つらい くるしい ねむい だるい
  もしもし おーい ただいま おかえり よかった なるほど そっか そうか そう そうそう わかった わかりました りょうかい
  おかあ おとう おばあ おじい かあ とう ばあ じい にい ねえ あに あね いもうと おとうと むすこ むすめ まご おっと つま よめ
  きぶん げんき ぶじ ひなん ていでん だんすい みずびたし しんさい じしん つなみ ちょうし
  それから けれど けど だけど ところで そのあと このまえ そのまま とにかく いちおう とりあえず ちなみに つまり なので じつは もし
  もしかして たしか おそらく とても すごく かなり すこし ぜんぶ みな まあまあ いい だめ おなか くらい あかるい うるさい しずか へん
  おかしい かゆい さびしい こころぼそい すいた よろしく おつかれ おだいじに
  はあ はぁ へえ へぇ ほう あら おや えっ あっ おっ うわ わあ わぁ おい こら ちょ ああ あぁ うう ううん んー ふう やれやれ よいしょ
  どうも どうぞ どうか どうして なんで なんか なんだか なんとか どちら どなた どれか だれも なにも ぜひ たのむ たのみ`
    .split(/\s+/)
    .filter(Boolean),
);
const KANA_COMMON_LIST = [...KANA_COMMON];

/** かなの名前の後ろに来る助詞（「ひできが」「みつきに」）。か・よ・ね（文の終わり）は入れない */
const NAME_PARTICLES = new Set([..."がのはをにへとでもや"]);

const isKanaCommon = (w: string) => KANA_COMMON.has(w) || KANA_COMMON.has(w.replace(/^[おご]/u, "")) || /[てで]$/u.test(w);

/**
 * at から始まるかなの名前（2〜4 字）の終わり。かなが続くときは、後ろが助詞になる長い方から（「ひできがくる」→ ひでき）。
 * かなの一般の語・て形（たすけて）は名前にしない。無ければ null
 */
function kanaNameEnd(text: string, at: number): number | null {
  const cs: string[] = [];
  let p = at;
  while (p < text.length && cs.length < 9) {
    const c = text[p];
    if (!isHira(c)) break;
    cs.push(c);
    p += c.length;
  }
  if (cs.length < 2) return null;
  const ok = (w: string) => !isKanaCommon(w) && !isNotName(w, "さん");
  if (cs.length <= 4) {
    const w = cs.join("");
    // 「うちに」「ところへ」: 終わりの助詞を外した語が一般の語なら名前でない
    const stem = cs.length > 2 && NAME_PARTICLES.has(cs.at(-1)!) ? cs.slice(0, -1).join("") : w;
    if (!ok(w) || !ok(stem)) return null;
    // 名前の終わりにならない助詞（が・を・に・へ・で・も）は外す（「みつきが来る」→ みつき）。の・は・と・や は名前の字のことがある（しの・かずは・ゆうと・さや）
    return at + (stem !== w && /[がをにへでも]$/u.test(w) ? stem.length : w.length);
  }
  const run = cs.join("");
  for (let len = 4; len >= 2; len--) {
    if (!NAME_PARTICLES.has(cs[len])) continue;
    // 一般の語の途中で切らない（「ありがとう」を「ありが」と「と」に）
    if (KANA_COMMON_LIST.some((c) => c.length > len && run.startsWith(c))) return null;
    const w = cs.slice(0, len).join("");
    if (ok(w)) return at + w.length;
  }
  return null;
}

/** at から始まるカナの名前（2〜6 字、後ろがカナでない）の終わり */
function kataNameEnd(text: string, at: number): number | null {
  let p = at;
  let n = 0;
  while (p < text.length && isKata(text[p]) && n < 7) {
    p++;
    n++;
  }
  if (n < 2 || n > 6) return null;
  const w = text.slice(at, p);
  return isNotName(w, "さん") ? null : p;
}

/** at から始まる漢字の名前の 1 語（1〜max 字、後ろが漢字・カナでない） */
function hanWordEnd(text: string, at: number, max: number): number | null {
  let p = at;
  let n = 0;
  while (p < text.length && /[\p{Script=Han}々]/u.test(text[p])) {
    p++;
    n++;
    if (n > max) return null;
  }
  if (n === 0 || (p < text.length && (isKata(text[p]) || isHan(text[p])))) return null;
  return p;
}

/** at から始まる「姓 名」（漢字・カナの姓 1〜4 字、空き 1 つ、漢字 1〜3 字・カナ 2〜6 字・かな 2〜4 字・かな＋漢字の名）の終わり */
function fullNameEnd(text: string, at: number): number | null {
  let p = at;
  let n = 0;
  while (p < text.length && (isHan(text[p]) || isKata(text[p])) && n < 5) {
    p++;
    n++;
  }
  if (n === 0 || n > 4 || p >= text.length || !SPACE.test(text[p])) return null;
  const surname = text.slice(at, p);
  const g = p + 1;
  const given =
    hanWordEnd(text, g, 3) ??
    kataNameEnd(text, g) ??
    kanaNameEnd(text, g) ??
    // かな＋漢字の名（とし子・ゆき江）
    (() => {
      let q = g;
      let k = 0;
      while (q < text.length && isHira(text[q]) && k < 3) {
        q++;
        k++;
      }
      return k > 0 ? hanWordEnd(text, q, 1) : null;
    })();
  if (given === null) return null;
  const first = text.slice(g, given);
  if (COMMON_WORDS.has(surname) || COMMON_WORDS.has(first) || isNotName(surname, "さん") || isNotName(first, "さん")) return null;
  return given;
}

/** 見出し・続柄の前の切れ目（行頭か、漢字・カナ・（ でない字のあと） */
function labelBoundary(text: string, at: number): boolean {
  if (at === 0) return true;
  const c = charBefore(text, at);
  return !(isHan(c) || isKata(c) || c === "（" || c === "(");
}

const LABEL_RE = (() => {
  const words = [...new Set([...NAME_LABELS, ...PERSON_LABELS])].sort((a, b) => b.length - a.length);
  return new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})([ 　]*[：:][ 　]*|[ 　]+)`, "gu");
})();

/** 見出し・続柄の後ろの名前（「患者氏名：浜野 きくゑ」「本人：浜野 きくゑ」「長女 内藤 早苗」「長男：ひでき」） */
function labelSpans(text: string): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(LABEL_RE)) {
    const at = m.index;
    if (!labelBoundary(text, at)) continue;
    const label = m[1];
    const colon = /[：:]/u.test(m[2]);
    const v = at + m[0].length;
    if (v >= text.length) continue;
    const strong = NAME_LABELS.includes(label);
    let end = fullNameEnd(text, v);
    if (end === null && (colon || !strong)) {
      // 1 語: かなの名前（後ろが助詞・句読点・終わり）、カナの名前、強い見出しのあとは名前の文字の 1 続き、名前＋（年齢）
      const one = kanaNameEnd(text, v) ?? kataNameEnd(text, v);
      const kanaOk = one !== null && (one >= text.length || !isNameChar(text[one]) || NAME_PARTICLES.has(text[one]));
      if (kanaOk) end = one;
      else if (strong && colon) {
        // 漢字・カナの 1 続き（6 字まで）と、すぐ後ろのかなの名前（「浜野きくゑ」）
        let p = v;
        while (p < text.length && (isHan(text[p]) || isKata(text[p]) || PLACEHOLDER.test(text[p])) && p - v < 6) p++;
        if (p < text.length && isHira(text[p])) p = kanaNameEnd(text, p) ?? p;
        end = p > v ? p : null;
      } else {
        let p = v;
        while (p < text.length && isNameChar(text[p]) && p - v < 8) p++;
        end = p > v && /^[（(][ 　]*(?:[0-9０-９]|男|女|明治|大正|昭和|平成|令和|満)/u.test(text.slice(p, p + 4)) ? p : null;
      }
    }
    if (end === null) continue;
    const value = text.slice(v, end).trim();
    if (!value || EMPTY_VALUES.has(value) || COMMON_WORDS.has(value) || isNotName(value, "さん")) continue;
    out.push({ start: v, end });
  }
  return out;
}

/** 行の頭（行頭・文の終わりのあと・行頭の「○○：」のあと）か */
function lineHead(text: string, at: number): boolean {
  if (at === 0) return true;
  const before = text.slice(Math.max(0, at - 12), at);
  return /(?:^|[\n。！？!?])[ 　]*$/u.test(before) || /(?:^|\n)[^\n：:]{1,8}[：:][ 　]*$/u.test(before) || /\t$/u.test(before);
}

/** 続柄の「の」の後ろ（「孫のみつきが」「長男のひでき」） */
const RELATION_NO = new RegExp(`(?:${RELATION_WORDS.join("|")})の`, "gu");

/**
 * かなの名前（続柄・呼びかけの文脈だけ）: 続柄の「の」の後ろ、行頭の呼びかけ（「ひでき、」「みつき！」）、行頭の「○○：」（話す人）、
 * LINE の書き出し（時刻・名前・本文をタブで区切った行）の名前の欄
 */
function kanaContextSpans(text: string): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(RELATION_NO)) {
    const v = m.index + m[0].length;
    if (!labelBoundary(text, m.index)) continue;
    const end = kanaNameEnd(text, v);
    if (end !== null && (end >= text.length || !isHira(text[end]) || NAME_PARTICLES.has(text[end]))) out.push({ start: v, end });
  }
  for (let i = 0; i < text.length; i++) {
    if (!isHira(text[i]) || (i > 0 && isHira(text[i - 1])) || !lineHead(text, i)) continue;
    const end = kanaNameEnd(text, i);
    if (end === null || end >= text.length) continue;
    const next = text[end];
    // 呼びかけ（読点・感嘆）か、話す人（コロン）
    if (/[、，,！!：:]/u.test(next)) out.push({ start: i, end });
  }
  for (const m of text.matchAll(/(?:^|\n)[0-9０-９]{1,2}[:：][0-9０-９]{2}\t([^\t\n]{1,20})\t/gu)) {
    // もう伏せた欄（（氏名））は見ない
    if (/^（[^）]*）$/u.test(m[1].trim())) continue;
    const start = m.index + m[0].length - 1 - m[1].length;
    out.push({ start, end: start + m[1].length });
  }
  return out;
}

const HONORIFIC_TAIL = /[ 　]*(?:さん|さま|様|氏|ちゃん|くん|先生|殿)$/u;

/** 名前と分かった語（2 字以上）。同じ文のほかの所も伏せる */
function learnedNames(text: string, spans: ReadonlyArray<Span>): string[] {
  const out = new Set<string>();
  for (const s of spans) {
    const body = text.slice(s.start, s.end).replace(HONORIFIC_TAIL, "");
    for (const part of body.split(/[ 　]+/u)) {
      let w = part;
      // かなの名前の後ろの助詞（「ひできが」→ ひでき）
      if ([...w].every(isHira) && w.length > 2 && NAME_PARTICLES.has(w.at(-1)!)) w = w.slice(0, -1);
      if ([...w].length < 2 || !w.split("").every(isNameChar) || isNotName(w, "さん") || COMMON_WORDS.has(w) || isKanaCommon(w)) continue;
      out.add(w);
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

function learnedSpans(text: string, spans: ReadonlyArray<Span>): Span[] {
  const out: Span[] = [];
  for (const w of learnedNames(text, spans)) {
    const kana = [...w].every(isHira);
    for (let i = text.indexOf(w); i >= 0; i = text.indexOf(w, i + 1)) {
      const end = i + w.length;
      if (kana) {
        const prev = i > 0 ? text[i - 1] : "";
        const next = end < text.length ? text[end] : "";
        if (prev && isHira(prev) && !"のとや".includes(prev)) continue;
        if (next && isHira(next) && !NAME_PARTICLES.has(next)) continue;
      }
      out.push({ start: i, end });
    }
  }
  return out;
}

/** 重なる・接する所をまとめる（左から順） */
function mergeSpans(spans: ReadonlyArray<Span>): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out.at(-1);
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

/** 名前の場所（敬称つき・見出しと続柄の後ろ・かなの名前の文脈・同じ文のほかの所）。左から順、重ならない */
export function nameSpans(text: string): Span[] {
  const found = [...honorificSpans(text), ...labelSpans(text), ...kanaContextSpans(text)];
  return mergeSpans([...found, ...learnedSpans(text, found)]);
}

// ---------- 住所・郵便番号・メール ----------

const D = "[0-9０-９]";
const KD = "[0-9０-９一二三四五六七八九十〇]";
const SEP = "[-‐－ー−―の]";
/** 町の名前の文字（漢字・カナ・かな・○ の印・台帳の町名の伏せ字） */
const TOWN_CH = `(?:[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}ー々ヶ○◯●]|${TOWN_MARK})`;
/** 丁目・番地・番 N 号（住所にしか出ない形） */
const NUM_WORDS = `(?:${KD}{1,3}丁目(?:[ 　]?${D}{1,5}(?:番地?|号|${SEP})?){0,3}|${D}{1,5}番地(?:の?${D}{1,5})?(?:${SEP}${D}{1,5}){0,2}|${D}{1,5}番${D}{1,5}号)`;
const NUM_TRIPLE = `${D}{1,5}${SEP}${D}{1,5}${SEP}${D}{1,5}`;
const NUM_PAIR = `${D}{1,5}${SEP}${D}{1,5}`;
const ADDRESS = new RegExp(
  `(${TOWN_CH}{1,16}?)[ 　]?(?:(?<words>${NUM_WORDS})|(?<triple>${NUM_TRIPLE})|(?<pair>${NUM_PAIR}))(?![0-9０-９])`,
  "gu",
);
/** 市区町村・都道府県の字（番地の前の語が住所か） */
const PLACE_IN = /[都道府県市区町村郡]|（町名）|[○◯●]/u;
const PLACE_END = /(?:[都道府県市区町村郡台通丁]|（町名）|[○◯●])$/u;

/**
 * 住所の形の当たりのうち伏せる所。丁目・番地は前に語があれば住所、1-2-3 は前の語に市区町村などの字があるとき、
 * 2-3 は前の語が町・村などで終わるとき（「中村は週 2-3 回」を伏せない）。前の語の頭の「長男は」などは残す
 */
/**
 * 市区町村・丁目の字の無い 1-2-3（「中央3-4-5」。T88）を住所にしない前の語: 数を数える字・図表・番号・日付と時刻の語。
 * 前の語が漢字・カナを含まない（かなだけ）ときも住所にしない
 */
const NOT_PLACE_BEFORE = /(?:[回日時分秒年月週個本枚錠包粒歳才人件階段度点倍割円号番条項版頁図表第期]|ページ|番号|コード|品番|型番|血圧|体温|脈拍|期間|電話|内線|ID)$/u;

/** 1-2-3 が日付（2026-10-01）・時刻か */
const DATE_TRIPLE = /^(?:1[89]|20)[0-9]{2}[-‐－ー−―]/u;

function addressSpan(m: RegExpMatchArray): Span | null {
  const body = m[1];
  const g = m.groups ?? {};
  // 0 で始まる 10 桁以上の並びは電話（住所にしない。Claude の返事の電話は漏れとして捨てる。index.ts の maskReply）
  if (g.triple !== undefined && /^[0０]/u.test(g.triple) && g.triple.replace(/[^0-9０-９]/gu, "").length >= 10) return null;
  // 市区町村の字の無い 1-2-3: 前の語が漢字・カナの地名らしい語（数の字・番号・日付でない）なら住所（「中央3-4-5」）
  const placeless = g.triple !== undefined && !PLACE_IN.test(body);
  if (placeless) {
    const tail = body.replace(/^.*[のはがをにへとでもやか]/u, "");
    if (!tail || ![...tail].some((c) => isHan(c) || isKata(c)) || NOT_PLACE_BEFORE.test(tail) || DATE_TRIPLE.test(g.triple)) return null;
  }
  if (g.pair !== undefined && !PLACE_END.test(body)) return null;
  const at = m.index!;
  const cs = [...body];
  // 「長男は松山市…」の「長男は」は残す（切れ目のあとに市区町村などの字があるときだけ切る。丸の内・桜が丘は切らない）。
  // 市区町村の字の無い 1-2-3 は最後の切れ目のあとだけ（「自宅は中央3-4-5」の「自宅は」を残す）
  for (let x = cs.length - 2; x >= 1; x--) {
    if (!PARTICLES.has(cs[x])) continue;
    const prevOk = isWordStart(cs[x - 1]) || cs[x - 1] === "）";
    const nextOk = isWordStart(cs[x + 1]) || cs[x + 1] === "（";
    const rest = cs.slice(x + 1).join("");
    if (prevOk && nextOk && (PLACE_IN.test(rest) || placeless)) {
      return { start: at + cs.slice(0, x + 1).join("").length, end: at + m[0].length };
    }
  }
  return { start: at, end: at + m[0].length };
}

const POSTAL = new RegExp(`〒[ 　]*${D}{3}(?:[-‐－ー−]?[0-9０-９xX×＊*]{4})?|(?<=郵便番号[ 　:：は]*)${D}{3}[-‐－ー−]?${D}{4}(?![0-9０-９])`, "gu");
const MAIL = /[A-Za-z0-9Ａ-Ｚａ-ｚ０-９._%+\-＿．]+[@＠][A-Za-z0-9Ａ-Ｚａ-ｚ０-９\-－]+(?:[.．][A-Za-z0-9Ａ-Ｚａ-ｚ０-９\-－]+)*/gu;

function addressSpans(text: string): Span[] {
  return [...text.matchAll(ADDRESS)].flatMap((m) => addressSpan(m) ?? []);
}

/** 形で伏せる 1 回分（見つける所と印）。./index.ts の置き換えの記録（どの元の語をどの印にしたか）もこの順で当てる */
export type MaskPass = { mark: string; find: (text: string) => Span[] };

const matchSpans = (re: RegExp) => (text: string): Span[] => [...text.matchAll(re)].map((m) => ({ start: m.index, end: m.index + m[0].length }));

/** メール → 郵便番号（電話の前に。〒 0 で始まる番号を電話と取り違えない） */
export const CONTACT_PASSES: ReadonlyArray<MaskPass> = [
  { mark: MAIL_MARK, find: matchSpans(MAIL) },
  { mark: POSTAL_MARK, find: matchSpans(POSTAL) },
];

/** 住所 → 名前（電話のあとに。電話の並び 089-000-0000 を住所の 1-2-3 と取り違えない） */
export const PLACE_NAME_PASSES: ReadonlyArray<MaskPass> = [
  { mark: ADDRESS_MARK, find: addressSpans },
  { mark: NAME_MARK, find: nameSpans },
];

function applyPasses(text: string, passes: ReadonlyArray<MaskPass>): { text: string; count: number } {
  let out = text;
  let count = 0;
  for (const p of passes) {
    const r = replaceSpans(out, p.find(out), p.mark);
    out = r.text;
    count += r.count;
  }
  return { text: out, count };
}

/** spans を mark に置き換える（重なりは先の物を取る） */
function replaceSpans(text: string, spans: Span[], mark: string): { text: string; count: number } {
  let out = "";
  let last = 0;
  let count = 0;
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    if (s.start < last) continue;
    out += text.slice(last, s.start) + mark;
    last = s.end;
    count++;
  }
  return { text: out + text.slice(last), count };
}

/** メール・郵便番号（電話の前に。〒 0 で始まる番号を電話と取り違えない） */
export function maskContactForms(text: string): { text: string; count: number } {
  return applyPasses(text, CONTACT_PASSES);
}

/** 住所・名前（電話のあとに。電話の並び 089-000-0000 を住所の 1-2-3 と取り違えない） */
export function maskPlaceAndNameForms(text: string): { text: string; count: number } {
  return applyPasses(text, PLACE_NAME_PASSES);
}

/** 形で見つかる物（findLeaks の門の確かめ）。値は返さない */
export function formLeaks(text: string): string[] {
  const found: string[] = [];
  if (honorificSpans(text).length > 0) found.push("敬称つきの名前");
  if (labelSpans(text).length > 0 || kanaContextSpans(text).length > 0) found.push("名前らしい並び");
  if (addressSpans(text).length > 0) found.push("住所らしい並び");
  if (new RegExp(POSTAL.source, "u").test(text)) found.push("郵便番号らしい並び");
  if (new RegExp(MAIL.source, "u").test(text)) found.push("メールらしい並び");
  return found;
}
