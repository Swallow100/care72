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
// 伏せきれない物: 敬称の無い名前（「田中が来る」）、町の名前だけ（番地の無い住所）、かなの名前の一部（「山田 はな」の姓）。
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
相談員 支援員 職員 事務員 店員 スタッフ ヘルパー ケアマネ ケアマネージャー マネージャー ナース ドクター ボランティア
運転手 運転士 ドライバー 配達員 配達 宅配 郵便屋 消防士 消防団 消防 救急隊 隊員 警察官 警官 警察 巡査 駐在 巡り
弁護士 司法書士 行政書士 税理士 住職 和尚 神主 牧師 神父
業者 電気屋 ガス屋 水道屋 灯油屋 米屋 酒屋 八百屋 魚屋 肉屋 床屋 薬屋 本屋 新聞屋 植木屋 大工
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

/** 様・さまの前だけ除く語（同様・模様・仕様・王様・神様）。王・神は名字にもあるので、さん・氏の前では伏せる */
const NOT_NAMES_SAMA = [..."同模仕異一多有文図左王神仏殿"];
/** 氏の前だけ除く語（同氏・両氏・彼氏） */
const NOT_NAMES_SHI = [..."同両彼各諸某貴"];
/** 先生の前だけ除く語（大先生・若先生） */
const NOT_NAMES_SENSEI = [..."大若老女"];

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
  const extra = honorific === "様" || honorific === "さま" ? NOT_NAMES_SAMA : honorific === "氏" ? NOT_NAMES_SHI : honorific === "先生" ? NOT_NAMES_SENSEI : [];
  for (const t of [token, bare]) {
    if (t === "") return true;
    if (EXACT.has(t) || extra.includes(t)) return true;
  }
  return SUFFIX.some((w) => token.endsWith(w));
}

// ---------- 敬称つきの名前 ----------

const HONORIFIC = /さん|さま|様|氏|ちゃん|くん|先生/gu;
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
export function nameSpans(text: string): Span[] {
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

function nameStart(text: string, at: number, honorific: string, floor: number): number | null {
  const after = text.slice(at + honorific.length, at + honorific.length + 3);
  if (notHonorific(honorific, after)) return null;
  const { start: runStart, run } = runBefore(text, at, floor);
  if (run === "") return null;
  const last = [...run].at(-1)!;
  // 敬称のすぐ前の「を」、先生・様の前の「の」（かかりつけの先生・近くの先生）は名前の終わりでない
  if (last === "を") return null;
  if (last === "の" && (honorific === "先生" || honorific === "様" || honorific === "さま")) return null;
  const { offset, token } = afterBreak(run);
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
function addressSpan(m: RegExpMatchArray): Span | null {
  const body = m[1];
  const g = m.groups ?? {};
  if (g.triple !== undefined && !PLACE_IN.test(body)) return null;
  if (g.pair !== undefined && !PLACE_END.test(body)) return null;
  const at = m.index!;
  const cs = [...body];
  // 「長男は松山市…」の「長男は」は残す（切れ目のあとに市区町村などの字があるときだけ切る。丸の内・桜が丘は切らない）
  for (let x = cs.length - 2; x >= 1; x--) {
    if (!PARTICLES.has(cs[x])) continue;
    const prevOk = isWordStart(cs[x - 1]) || cs[x - 1] === "）";
    const nextOk = isWordStart(cs[x + 1]) || cs[x + 1] === "（";
    const rest = cs.slice(x + 1).join("");
    if (prevOk && nextOk && PLACE_IN.test(rest)) {
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

function replaceAll(text: string, re: RegExp, mark: string): { text: string; count: number } {
  let count = 0;
  const out = text.replace(re, () => (count++, mark));
  return { text: out, count };
}

/** メール・郵便番号（電話の前に。〒 0 で始まる番号を電話と取り違えない） */
export function maskContactForms(text: string): { text: string; count: number } {
  const a = replaceAll(text, MAIL, MAIL_MARK);
  const b = replaceAll(a.text, POSTAL, POSTAL_MARK);
  return { text: b.text, count: a.count + b.count };
}

/** 住所・敬称つきの名前（電話のあとに。電話の並び 089-000-0000 を住所の 1-2-3 と取り違えない） */
export function maskPlaceAndNameForms(text: string): { text: string; count: number } {
  const a = replaceSpans(text, addressSpans(text), ADDRESS_MARK);
  const b = replaceSpans(a.text, nameSpans(a.text), NAME_MARK);
  return { text: b.text, count: a.count + b.count };
}

/** 形で見つかる物（findLeaks の門の確かめ）。値は返さない */
export function formLeaks(text: string): string[] {
  const found: string[] = [];
  if (nameSpans(text).length > 0) found.push("敬称つきの名前");
  if (addressSpans(text).length > 0) found.push("住所らしい並び");
  if (new RegExp(POSTAL.source, "u").test(text)) found.push("郵便番号らしい並び");
  if (new RegExp(MAIL.source, "u").test(text)) found.push("メールらしい並び");
  return found;
}
