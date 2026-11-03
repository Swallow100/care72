// 赤のあとの聞き取りの問いの表（docs/tasks/T49.md）。本人・家族のスマホの 1 画面 1 問と、声で読む問いは全部ここの 1 か所から。
//
// - 聞くのは事実だけ。重さ・点数・緊急度・診断を聞かない（アドバイザーの返事 11/3 14:1x。問診票を内容を変えずに電子化する側）。
//   「からだの つらさ」は本人の言葉を欄に残すためで、どのくらいかは聞かない
// - 答えは信号の answers（JSON）に { 問いの id: { choice, via } } で持つ。今の 4 問（injured・atHome・canMove・hasMedicine）は
//   表の先頭に置き、同じ値を信号の 4 つの列にも書く（legacyColumnsOf。ルールの表と採点が読むのはこの 4 つの列だけ）。
//   ほかの答えはルールの表に渡さない（lib/triage の入力の型に answers は無い。テストで確かめる）
// - どの問いにも「わからない」の選択肢と「とばす」を置く。押すたびに送るので、どこで止めても答えた所までは届く
// - 声の答えは言葉の一致だけ（matchVoiceAnswer。Claude は使わない）
// - 言葉: 本人・家族の画面はやさしい日本語（{漢字|よみ}）、ケアマネの画面は短い言葉（label）。設計の側があとで Gemini に通す

/** 聞き取りの欄（Claude の聞き取りメモと同じ欄。欄の名前は lib/labels.ts の HEARING_FIELD_LABELS） */
export const HEARING_FIELDS = [
  "place",
  "trapped",
  "body",
  "injury",
  "water",
  "fireGas",
  "device",
  "medicine",
  "nearby",
  "contact",
  "request",
] as const;
export type HearingField = (typeof HEARING_FIELDS)[number];

export const QUESTION_IDS = [
  "injured",
  "injuryPart",
  "bleeding",
  "atHome",
  "floor",
  "room",
  "place",
  "shelterWhich",
  "canMove",
  "exit",
  "trappedBy",
  "body",
  "water",
  "fireGas",
  "device",
  "hasMedicine",
  "nearby",
  "contact",
  "request",
] as const;
export type QuestionId = (typeof QUESTION_IDS)[number];

/** 「わからない」の選択肢の id（どの問いにも置く） */
export const UNKNOWN_CHOICE = "unknown";

export type Choice = {
  id: string;
  /** 本人・家族の画面のボタン（やさしい日本語、{漢字|よみ}） */
  easy: string;
  /** ケアマネの画面の言葉（短く） */
  label: string;
  /** 声の答えで当てる言葉（漢字とかなの両方。空白は落として比べる） */
  words: readonly string[];
  /** 声の「はい」系（はい・うん・ある）をこの選択肢に当てる */
  yes?: true;
  /** 声の「いいえ」系（いいえ・ない）をこの選択肢に当てる */
  no?: true;
  /** この答えのあとの問い。無ければ問いの next */
  next?: QuestionId | null;
  /**
   * 見た目の印（T69b）。本人・家族の画面の選択肢の左の帯の色だけで、ルールの表に渡さない（送る答えにも入らない）。
   * urgent（赤）は表が至急にする答えだけ（けが ある・動けない）、check（黄）はケアマネが見に行く手がかりになる答え、
   * ok（緑）は同じ問いの「問題なし」の側。本人が押す申告の色で、仕組みの結論ではない。
   * わからない・とばす・ほか・場所・部位・体の訴え・そばの人・頼みたいことには付けない
   */
  tone?: ChoiceTone;
  /**
   * 押した・声で一致したら、残りの問いを飛ばして定型文と録音へ（T69b。けが・動けない・出られない・水・火やガス・機器の停止）。
   * 表が読む 2 問を落とさないため、けが ある のあとに動けるかがまだ無ければ、その 1 問だけ聞いてから（toRecordingNext）。
   * 家族の画面には録音が無いので、送れたかの画面へ。色と連絡順は変えない（飛ばした問いは answers に入らないだけ）
   */
  toRecording?: true;
  /**
   * 押したら、本人の画面だけ「いまの 場所を おくりますか」の 1 画面（T69b。車・ほかの ところ）。はい なら端末の位置を信号に添える。
   * 家族の画面と声の問いでは聞かない。位置は Claude に渡さない
   */
  asksLocation?: true;
};

/** 選択肢の見た目の印の 3 つ（T69b。状態の色の変数で描く。表の入力ではない） */
export const CHOICE_TONES = ["urgent", "check", "ok"] as const;
export type ChoiceTone = (typeof CHOICE_TONES)[number];

export type Question = {
  id: QuestionId;
  field: HearingField;
  /** 本人の画面の問い（やさしい日本語） */
  easy: string;
  /** 家族の画面の問い（頭に「お母さんは」などの呼び方が付く）。無ければ easy */
  familyEasy?: string;
  /** ケアマネの画面の問いの短い名前 */
  label: string;
  /** 声で読む文（ふりがなを落とした文）。選択肢は読み上げのときに続ける */
  voice: string;
  choices: readonly Choice[];
  /** とばした・声で答えが取れなかったときの次の問い。null は終わり */
  next: QuestionId | null;
  /** 台帳に機器がある人だけ聞く */
  needsDevice?: true;
  /** 本人だけ聞く（家族はその場にいないことが多い・録音は本人だけ） */
  selfOnly?: true;
  /** 台帳に避難先（1・2）がある人だけ聞く（T69b。選択肢の名前は台帳から画面に渡す） */
  needsShelter?: true;
  /** 押す画面だけで聞く（T69b。声の問いでは聞かない。台帳の名前は表の言葉に無く、声の言葉の一致で当てられない） */
  pressOnly?: true;
  /**
   * 声の問いだけで聞く（T77）。押して答えている人には聞かない: 押せている事が答え（連絡手段の「この スマホ」）。
   * 前の答えを読むため（parseAnswers）表からは消さない
   */
  voiceOnly?: true;
  /** マイクが使える人だけ聞く（T77。「はなす」で録音へ進む問い。マイクが無い・許されていない端末では聞かない） */
  needsMic?: true;
  /**
   * それまでの答えで決まっているときは聞かない（T77）。家の外・避難所・車にいると答えた人に「外に 出られますか」を聞かない
   */
  settledBy?: (answers: Answers) => boolean;
};

/** 家の外にいると答えた（いまは家ですか いいえ・家の どこ 外）。外に出られるかは聞かなくても決まっている（T77） */
export function answeredOutside(answers: Answers): boolean {
  return answers.atHome?.choice === "no" || answers.floor?.choice === "outside";
}

/** 避難所の問いの選択肢のうち、台帳の避難先 1・2（T69b）。言葉は台帳の名前を画面で出し、表と答えには id だけ */
export const SHELTER_CHOICE_IDS = ["d1", "d2"] as const;
export type ShelterChoiceId = (typeof SHELTER_CHOICE_IDS)[number];
/** 画面に渡す避難先（台帳の名前。やさしい日本語の変換を通さずそのまま）。サーバーが台帳から作り、Claude には渡さない */
export type ShelterOption = { id: ShelterChoiceId; easy: string };

const unknown: Choice = {
  id: UNKNOWN_CHOICE,
  easy: "わからない",
  label: "不明",
  words: ["わからない", "分からない", "わかんない", "わかりません", "分かりません"],
};

/** 赤のあとの問い。表の順が画面の順（枝で飛ぶ所は choice.next） */
export const QUESTIONS: readonly Question[] = [
  {
    id: "injured",
    field: "injury",
    easy: "けがは ありますか",
    familyEasy: "けがを して いますか",
    label: "けが",
    voice: "けがはありますか",
    choices: [
      { id: "yes", easy: "ある", label: "あり", words: ["ある", "あります", "けがした", "怪我した"], yes: true, next: "injuryPart", tone: "urgent", toRecording: true },
      { id: "no", easy: "ない", label: "なし", words: ["ない", "ありません", "してない"], no: true, tone: "ok" },
      unknown,
    ],
    next: "atHome",
  },
  {
    id: "injuryPart",
    field: "injury",
    easy: "けがは どこですか",
    familyEasy: "どこを けがして いますか",
    label: "部位",
    voice: "けがはどこですか",
    choices: [
      { id: "head", easy: "あたま", label: "頭", words: ["あたま", "頭"] },
      { id: "chest", easy: "むね", label: "胸", words: ["むね", "胸"] },
      { id: "belly", easy: "おなか", label: "腹", words: ["おなか", "お腹", "腹", "はら"] },
      { id: "arm", easy: "うで・て", label: "腕・手", words: ["うで", "腕", "て", "手"] },
      { id: "leg", easy: "あし", label: "脚・足", words: ["あし", "足", "脚"] },
      { id: "other", easy: "ほか", label: "ほか", words: ["ほか", "他", "そのほか"] },
      unknown,
    ],
    next: "bleeding",
  },
  {
    id: "bleeding",
    field: "injury",
    easy: "{血|ち}は {出|で}て いますか",
    familyEasy: "{血|ち}が {出|で}て いますか",
    label: "出血",
    voice: "血は出ていますか",
    choices: [
      { id: "yes", easy: "{出|で}て いる", label: "あり", words: ["でている", "出ている", "でてる", "出てる"], yes: true, tone: "check" },
      { id: "no", easy: "{出|で}て いない", label: "なし", words: ["でていない", "出ていない", "でてない", "出てない"], no: true, tone: "ok" },
      unknown,
    ],
    next: "atHome",
  },
  {
    id: "atHome",
    field: "place",
    easy: "いまは {家|いえ}ですか",
    familyEasy: "いまは {家|いえ}ですか",
    label: "自宅",
    voice: "いまは家ですか",
    choices: [
      { id: "yes", easy: "はい", label: "自宅", words: ["いえ です", "家です", "うち"], yes: true, next: "floor" },
      { id: "no", easy: "いいえ", label: "自宅外", words: ["そと", "外"], no: true, next: "place" },
      unknown,
    ],
    next: "canMove",
  },
  {
    id: "floor",
    field: "place",
    easy: "{家|いえ}の どこですか",
    familyEasy: "{家|いえ}の どこに いますか",
    label: "階",
    voice: "家のどこですか",
    choices: [
      { id: "f1", easy: "1かい", label: "1階", words: ["1かい", "一階", "1階", "いっかい"], next: "room" },
      { id: "f2", easy: "2かい", label: "2階", words: ["2かい", "二階", "2階", "にかい"], next: "room" },
      { id: "outside", easy: "{外|そと}", label: "屋外", words: ["そと", "外", "にわ", "庭"] },
      unknown,
    ],
    next: "canMove",
  },
  {
    id: "room",
    field: "place",
    easy: "どの {部屋|へや}ですか",
    familyEasy: "どの {部屋|へや}に いますか",
    label: "部屋",
    voice: "どのへやですか",
    choices: [
      { id: "bedroom", easy: "ねる {部屋|へや}", label: "寝室", words: ["しんしつ", "寝室", "ねるへや", "寝る部屋", "ベッド"] },
      { id: "living", easy: "いま", label: "居間", words: ["いま", "居間", "リビング"] },
      { id: "toilet", easy: "トイレ", label: "トイレ", words: ["トイレ", "便所"] },
      { id: "bath", easy: "おふろ", label: "風呂", words: ["ふろ", "風呂", "おふろ", "お風呂"] },
      { id: "kitchen", easy: "だいどころ", label: "台所", words: ["だいどころ", "台所", "キッチン"] },
      { id: "entrance", easy: "げんかん", label: "玄関", words: ["げんかん", "玄関"] },
      { id: "other", easy: "ほか", label: "ほか", words: ["ほか", "他"] },
      unknown,
    ],
    next: "canMove",
  },
  {
    id: "place",
    field: "place",
    easy: "いまは どこですか",
    label: "場所",
    voice: "いまはどこですか",
    choices: [
      { id: "shelter", easy: "{避難所|ひなんじょ}", label: "避難所", words: ["ひなんじょ", "避難所", "がっこう", "学校", "こうみんかん", "公民館"], next: "shelterWhich" },
      { id: "car", easy: "{車|くるま}", label: "車", words: ["くるま", "車"], asksLocation: true },
      { id: "other", easy: "ほかの ところ", label: "ほか", words: ["ほか", "他"], asksLocation: true },
      unknown,
    ],
    next: "canMove",
  },
  {
    // 避難所を押した人に、計画の避難先 1・2 から選んでもらう（T69b）。選択肢の言葉は台帳の名前を画面で出す（ここは名前の無い既定）。
    // 答えは id だけ（d1・d2）。ケアマネの聞き取りの欄で台帳の名前に引く（lib/signals/hearing.ts）
    id: "shelterWhich",
    field: "place",
    easy: "どこの {避難所|ひなんじょ}ですか",
    label: "避難所",
    voice: "どこの避難所ですか",
    choices: [
      { id: "d1", easy: "{避難先|ひなんさき} 1", label: "避難先1", words: ["ひなんさきいち", "避難先1"] },
      { id: "d2", easy: "{避難先|ひなんさき} 2", label: "避難先2", words: ["ひなんさきに", "避難先2"] },
      { id: "other", easy: "ほかの {避難所|ひなんじょ}", label: "ほか", words: ["ほか", "他"] },
      unknown,
    ],
    next: "canMove",
    needsShelter: true,
    pressOnly: true,
  },
  {
    id: "canMove",
    field: "trapped",
    easy: "{動|うご}けますか",
    familyEasy: "{動|うご}けますか",
    label: "動けるか",
    voice: "動けますか",
    choices: [
      { id: "yes", easy: "{動|うご}ける", label: "動ける", words: ["うごける", "動ける", "うごけます", "動けます"], yes: true, tone: "ok" },
      { id: "no", easy: "{動|うご}けない", label: "動けない", words: ["うごけない", "動けない", "うごけません", "動けません"], no: true, tone: "urgent", toRecording: true },
      unknown,
    ],
    next: "exit",
  },
  {
    id: "exit",
    field: "trapped",
    easy: "{外|そと}に {出|で}られますか",
    label: "外へ",
    voice: "外に出られますか",
    choices: [
      { id: "yes", easy: "{出|で}られる", label: "出られる", words: ["でられる", "出られる", "でれる", "出れる"], yes: true, tone: "ok" },
      { id: "no", easy: "{出|で}られない", label: "出られない", words: ["でられない", "出られない", "でれない", "出れない"], no: true, next: "trappedBy", tone: "check", toRecording: true },
      unknown,
    ],
    next: "body",
    // 家の外・避難所・車にいると答えた人には聞かない（T77。答えから決まる）
    settledBy: answeredOutside,
  },
  {
    id: "trappedBy",
    field: "trapped",
    easy: "なにで {出|で}られませんか",
    label: "妨げ",
    voice: "なにで出られませんか",
    choices: [
      { id: "door", easy: "ドアが あかない", label: "ドア", words: ["ドア", "とびら", "扉", "あかない", "開かない"], tone: "check", toRecording: true },
      { id: "furniture", easy: "{家具|かぐ}", label: "家具", words: ["かぐ", "家具", "たんす", "タンス", "はさまれ", "挟まれ"], tone: "check", toRecording: true },
      { id: "fallen", easy: "たおれた もの", label: "倒れた物", words: ["たおれた", "倒れた", "くずれた", "崩れた"], tone: "check", toRecording: true },
      { id: "water", easy: "{水|みず}", label: "水", words: ["みず", "水"], tone: "check", toRecording: true },
      { id: "other", easy: "ほか", label: "ほか", words: ["ほか", "他"] },
      unknown,
    ],
    next: "body",
  },
  {
    // 本人の言葉を欄に残すための問い。どのくらいつらいか（重さ・点数）は聞かない
    id: "body",
    field: "body",
    easy: "からだで つらい ことは ありますか",
    familyEasy: "からだで つらい ことが ありますか",
    label: "体の訴え",
    voice: "からだでつらいことはありますか",
    choices: [
      { id: "breath", easy: "{息|いき}が くるしい", label: "息がくるしい", words: ["いきがくるしい", "息が苦しい", "息がくるしい", "いきぐるしい", "息苦しい"] },
      { id: "chest", easy: "{胸|むね}が いたい", label: "胸がいたい", words: ["むねがいたい", "胸が痛い", "胸がいたい"] },
      { id: "dizzy", easy: "めまい", label: "めまい", words: ["めまい", "目まい", "ふらふら"] },
      { id: "nausea", easy: "はきけ", label: "はきけ", words: ["はきけ", "吐き気", "きもちわるい", "気持ち悪い"] },
      { id: "none", easy: "ない", label: "なし", words: ["ない", "ありません", "だいじょうぶ", "大丈夫"], no: true },
      { id: "other", easy: "ほか", label: "ほか", words: ["ほか", "他"] },
      unknown,
    ],
    next: "water",
  },
  {
    id: "water",
    field: "water",
    easy: "{水|みず}は きて いますか",
    familyEasy: "{水|みず}が きて いますか",
    label: "水",
    voice: "水はきていますか",
    choices: [
      { id: "none", easy: "きて いない", label: "なし", words: ["きていない", "来ていない", "きてない", "来てない"], no: true, tone: "ok" },
      { id: "floor", easy: "ゆか まで", label: "床まで", words: ["ゆか", "床"], tone: "check", toRecording: true },
      { id: "knee", easy: "ひざ まで", label: "膝まで", words: ["ひざ", "膝"], tone: "check", toRecording: true },
      { id: "waist", easy: "こしより うえ", label: "腰より上", words: ["こし", "腰", "むね", "胸"], tone: "check", toRecording: true },
      unknown,
    ],
    next: "fireGas",
  },
  {
    id: "fireGas",
    field: "fireGas",
    easy: "{火|ひ}や ガスの においは しますか",
    familyEasy: "{火|ひ}や ガスの においが しますか",
    label: "火・ガス",
    voice: "火やガスのにおいはしますか",
    choices: [
      { id: "yes", easy: "する", label: "あり", words: ["する", "します", "におう", "臭う", "匂う", "けむり", "煙"], yes: true, tone: "check", toRecording: true },
      { id: "no", easy: "しない", label: "なし", words: ["しない", "しません"], no: true, tone: "ok" },
      unknown,
    ],
    next: "device",
  },
  {
    id: "device",
    field: "device",
    easy: "{機械|きかい}は {動|うご}いて いますか",
    familyEasy: "{機械|きかい}が {動|うご}いて いますか",
    label: "機器",
    voice: "機械は動いていますか",
    choices: [
      { id: "running", easy: "{動|うご}いて いる", label: "動作中", words: ["うごいている", "動いている", "うごいてる", "動いてる"], yes: true, tone: "ok" },
      { id: "stopped", easy: "{止|と}まった", label: "停止", words: ["とまった", "止まった", "とまってる", "止まってる", "うごかない", "動かない"], no: true, tone: "check", toRecording: true },
      unknown,
    ],
    next: "hasMedicine",
    needsDevice: true,
  },
  {
    id: "hasMedicine",
    field: "medicine",
    easy: "くすりは ありますか",
    familyEasy: "くすりが ありますか",
    label: "薬",
    voice: "くすりはありますか",
    choices: [
      { id: "yes", easy: "ある", label: "あり", words: ["ある", "あります"], yes: true, tone: "ok" },
      { id: "no", easy: "ない", label: "なし", words: ["ない", "ありません"], no: true, tone: "check" },
      unknown,
    ],
    next: "nearby",
  },
  {
    id: "nearby",
    field: "nearby",
    easy: "そばに {誰|だれ}か いますか",
    label: "そばの人",
    voice: "そばにだれかいますか",
    choices: [
      { id: "alone", easy: "ひとり", label: "ひとり", words: ["ひとり", "一人", "いない", "いません"], no: true },
      { id: "family", easy: "{家族|かぞく}", label: "家族", words: ["かぞく", "家族", "むすめ", "娘", "むすこ", "息子", "おっと", "夫", "つま", "妻"] },
      { id: "neighbor", easy: "{近所|きんじょ}の {人|ひと}", label: "近所の人", words: ["きんじょ", "近所", "となり", "隣"] },
      { id: "other", easy: "ほかの {人|ひと}", label: "ほか", words: ["ほか", "他"] },
      unknown,
    ],
    next: "contact",
  },
  {
    id: "contact",
    field: "contact",
    easy: "{連絡|れんらく}は できますか",
    label: "連絡手段",
    voice: "れんらくはできますか",
    choices: [
      { id: "phone", easy: "この スマホ", label: "このスマホ", words: ["スマホ", "すまほ", "けいたい", "携帯"], tone: "ok" },
      { id: "tel", easy: "{電話|でんわ}", label: "電話", words: ["でんわ", "電話"], tone: "ok" },
      { id: "none", easy: "できない", label: "なし", words: ["できない", "できません", "ない"], no: true, tone: "check" },
      unknown,
    ],
    next: "request",
    selfOnly: true,
    // 押して答えている人には聞かない（T77。このスマホで押せている事が答え）。声の問いの人だけ
    voiceOnly: true,
  },
  {
    // 頼みたいことは声で（録音へ）。「はなす」で定型文と録音に進む。マイクが無い・許されていない端末では聞かない（T77）
    id: "request",
    field: "request",
    easy: "たのみたい ことは ありますか",
    label: "頼みたいこと",
    voice: "たのみたいことはありますか",
    choices: [
      { id: "speak", easy: "{話|はな}す", label: "録音へ", words: ["はなす", "話す", "ある", "あります", "はい"], yes: true },
      { id: "none", easy: "ない", label: "なし", words: ["ない", "ありません", "いいえ"], no: true },
      unknown,
    ],
    next: null,
    selfOnly: true,
    needsMic: true,
  },
];

const BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));

export function questionOf(id: QuestionId): Question {
  const q = BY_ID.get(id);
  if (!q) throw new Error(`問いが無い: ${id}`);
  return q;
}

export function isQuestionId(v: string): v is QuestionId {
  return BY_ID.has(v as QuestionId);
}

/** 最初の問い */
export const FIRST_QUESTION: QuestionId = "injured";

/** 答えの出どころ。press は押した、voice は声の言葉の一致（コードの決まり。Claude ではない） */
export type AnswerVia = "press" | "voice";
export type Answer = { choice: string; via: AnswerVia };
/** 答えの全部（押した・声で取れた所だけ。とばした問いは入らない） */
export type Answers = Partial<Record<QuestionId, Answer>>;

/**
 * 誰の画面か。家族は本人だけの問いを聞かない。shelters は台帳の避難先の数（T69b。0 なら避難所の問いを聞かない）、
 * voice は声の問いで進んでいる（押す画面だけの問いを聞かない・声だけの問いを聞く）、
 * mic が false はマイクが無い・許されていないと分かった（T77。録音へ進む問いを聞かない。分からない間は undefined）
 */
export type Asker = { who: "self" | "family"; hasDevice: boolean; shelters?: number; voice?: boolean; mic?: boolean };

/** この人に聞くか。answers はそれまでの答え（答えで決まっている問いを飛ばす。T77） */
export function asks(q: Question, a: Asker, answers: Answers = {}): boolean {
  if (q.needsDevice && !a.hasDevice) return false;
  if (q.selfOnly && a.who !== "self") return false;
  if (q.needsShelter && !(a.shelters && a.shelters > 0)) return false;
  if (q.pressOnly && a.voice) return false;
  if (q.voiceOnly && !a.voice) return false;
  if (q.needsMic && a.mic === false) return false;
  if (q.settledBy?.(answers)) return false;
  return true;
}

/** 画面に出す選択肢（T69b）。避難所の問いは台帳にある避難先だけ（名前は ShelterOption）、ほかは表のまま */
export function choicesFor(q: Question, shelters: ReadonlyArray<ShelterOption> = []): Array<Choice & { name?: string }> {
  if (q.id !== "shelterWhich") return [...q.choices];
  const names = new Map(shelters.map((s) => [s.id, s.easy]));
  return q.choices.flatMap((c) => {
    if (!(SHELTER_CHOICE_IDS as readonly string[]).includes(c.id)) return [c];
    const name = names.get(c.id as ShelterChoiceId);
    return name ? [{ ...c, name }] : [];
  });
}

/** 聞かない問いを飛ばして、聞く問いに着くまで進める */
function settle(id: QuestionId | null, a: Asker, answers: Answers): QuestionId | null {
  let cur = id;
  for (let i = 0; cur !== null && i <= QUESTIONS.length; i++) {
    const q = questionOf(cur);
    if (asks(q, a, answers)) return cur;
    cur = q.next;
  }
  return null;
}

/** 最初に聞く問い */
export function firstQuestion(a: Asker): QuestionId | null {
  return settle(FIRST_QUESTION, a, {});
}

/**
 * 次の問い。choice が null ならとばした（問いの next）。null は終わり。
 * answers はこの答えまで入れた全部（答えで決まっている問いを飛ばす。T77。渡さなければ答えで飛ばさない）
 */
export function nextQuestion(id: QuestionId, choice: string | null, a: Asker, answers: Answers = {}): QuestionId | null {
  const q = questionOf(id);
  const c = choice === null ? undefined : q.choices.find((x) => x.id === choice);
  const to = c && c.next !== undefined ? c.next : q.next;
  return settle(to, a, answers);
}

export function choiceOf(id: QuestionId, choice: string): Choice | undefined {
  return questionOf(id).choices.find((c) => c.id === choice);
}

/** この答えで残りを飛ばして録音へ（T69b） */
export function rushesToRecording(id: QuestionId, choice: string | null): boolean {
  return choice !== null && choiceOf(id, choice)?.toRecording === true;
}

/**
 * 録音へ急ぐときの次の問い（T69b）。表が読む 2 問（けが・動けるか）を落とさないため、けが のあとに 動けるか がまだ無く
 * この人に聞く問いなら「動けますか」の 1 問だけ。ほかは null（問いの終わり。本人は定型文と録音、家族は送れたか）
 */
export function rushNext(id: QuestionId, answers: Answers, a: Asker): QuestionId | null {
  if (id === "injured" && !answers.canMove && asks(questionOf("canMove"), a)) return "canMove";
  return null;
}

// ---------- 今の 4 問の列（ルールの表と採点が読む） ----------

/** 信号の 4 つの列に書く値。はい=true・いいえ=false・わからない・答えなし=null */
export type LegacyColumns = { injured: boolean | null; atHome: boolean | null; canMove: boolean | null; hasMedicine: boolean | null };

const LEGACY = ["injured", "atHome", "canMove", "hasMedicine"] as const satisfies readonly QuestionId[];

function yesNo(id: (typeof LEGACY)[number], answers: Answers): boolean | null {
  const a = answers[id];
  if (!a) return null;
  const c = choiceOf(id, a.choice);
  return c?.yes ? true : c?.no ? false : null;
}

/** 答えから 4 つの列の値（この関数の外で 4 つの列を作らない） */
export function legacyColumnsOf(answers: Answers): LegacyColumns {
  return {
    injured: yesNo("injured", answers),
    atHome: yesNo("atHome", answers),
    canMove: yesNo("canMove", answers),
    hasMedicine: yesNo("hasMedicine", answers),
  };
}

// ---------- 送る形の確かめ ----------

/** 送られた答えを確かめる。知らない問い・知らない選択肢・形の違いは null */
export function parseAnswers(v: unknown): Answers | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Answers = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!isQuestionId(k) || !raw || typeof raw !== "object") return null;
    const { choice, via } = raw as { choice?: unknown; via?: unknown };
    if (typeof choice !== "string" || (via !== "press" && via !== "voice")) return null;
    if (!choiceOf(k, choice)) return null;
    out[k] = { choice, via };
  }
  return out;
}

/** 表に書いた答えを読む（壊れていれば空） */
export function readAnswers(text: string | null | undefined): Answers {
  if (!text) return {};
  try {
    return parseAnswers(JSON.parse(text)) ?? {};
  } catch {
    return {};
  }
}

// ---------- 声の答え（言葉の一致だけ） ----------

const YES_WORDS = ["はい", "うん", "ええ", "ある", "あります", "そう"];
const NO_WORDS = ["いいえ", "いや", "ない", "ありません", "ちがう", "違う"];

const squash = (s: string) => s.replace(/[\s　、。,.!！?？]/g, "");

/**
 * 声の文字起こしから答えを選ぶ。選択肢の言葉・「わからない」・はい系・いいえ系のうち、いちばん長く一致した物。
 * 長さが同じなら 選択肢の言葉 → わからない → いいえ → はい の順（「わからない」の「ない」を「いいえ」に取らない）。
 * 何も一致しなければ null（呼ぶ側は答えなしで次の問いへ）
 */
export function matchVoiceAnswer(transcript: string | null, id: QuestionId): string | null {
  const t = squash(transcript ?? "");
  if (!t) return null;
  const q = questionOf(id);
  type Hit = { choice: string; len: number; rank: number };
  let best: Hit | null = null;
  const consider = (choice: string | undefined, words: readonly string[], rank: number) => {
    if (!choice) return;
    for (const w of words) {
      const s = squash(w);
      if (!s || !t.includes(s)) continue;
      if (!best || s.length > best.len || (s.length === best.len && rank < best.rank)) best = { choice, len: s.length, rank };
    }
  };
  for (const c of q.choices) consider(c.id, c.words, c.id === UNKNOWN_CHOICE ? 1 : 0);
  consider(q.choices.find((c) => c.no)?.id, NO_WORDS, 2);
  consider(q.choices.find((c) => c.yes)?.id, YES_WORDS, 3);
  return (best as Hit | null)?.choice ?? null;
}

/** 声で読む文: 問いと選択肢（「けがはありますか。ある、ない、わからない」） */
export function voiceTextOf(id: QuestionId): string {
  const q = questionOf(id);
  const plain = (m: string) => m.replace(/\{([^|{}]+)\|[^|{}]+\}/g, "$1").replace(/ /g, "");
  return `${q.voice}。${q.choices.map((c) => plain(c.easy)).join("、")}`;
}

// ---------- 言葉の確かめ用 ----------

/** 本人・家族の画面に出る問いと選択肢の書き方の全部（ふりがなの確かめ用） */
export function allQuestionMarkups(): string[] {
  return QUESTIONS.flatMap((q) => [q.easy, ...(q.familyEasy ? [q.familyEasy] : []), ...q.choices.map((c) => c.easy)]);
}

/** 表の言葉の全部（禁じる語の確かめ用） */
export function allQuestionStrings(): string[] {
  return QUESTIONS.flatMap((q) => [
    q.easy,
    q.familyEasy ?? "",
    q.label,
    q.voice,
    ...q.choices.flatMap((c) => [c.easy, c.label, ...c.words]),
  ]).filter(Boolean);
}
