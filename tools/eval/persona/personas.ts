// 使う人と筋（docs/tasks/T156.md）。目標はアプリの今の画面に実在する流れだけ（README の「触り方」と lib/*/labels.ts の言葉）。
//
// - 目標ごとに達成の印（done）: 道（URL の道と query）・頁の字（見出し・本文・知らせ・上の帯）・印刷の画面を開いた旗・選んだ欄
//   のどれか。台が毎手の読みで確かめる（AI は決めない）
// - route は最短の手の並び（押す物の名前。コードと手元の画面で数えた物）。手数の差の物差しで、偽の使う人もこの並びをなぞる
// - 書く値は全部架空（名前は架空、電話は 090-0000-00NN、町名は架空、番地なし。CLAUDE.md の決まり）
// - 医療班の筋（T163）: 台が筋の前に事業所の「発災開始」を流し（setup、使う人の手に数えない）、種の受入依頼（連絡順の上から、山田の赤を含む）が
//   受入一覧の上の「受入依頼」に並んだ形から始める。使う人は医療班の役にして依頼の行の「受入」から受け入れる（前は訓練の外に依頼の道が無く、
//   氏名検索で探した。氏名検索は今もある）

/** 頁の字の物差し（どれも書いた所だけを見る。全部満たせば達成） */
export type Check = {
  /** URL の道と query（正規表現） */
  path?: string;
  /** 見出し・本文・知らせ・上の帯を 1 つにした字（正規表現） */
  text?: string;
  /** 上の帯の字（正規表現） */
  header?: string;
  /** 上の帯に無いはずの字（正規表現） */
  notHeader?: string;
  /** 印刷の画面を開いた（window.print） */
  printed?: boolean;
  /** この名前の押せる物が選ばれている（checkbox・aria-checked） */
  checked?: string;
};
export type Done = Check | { any: Check[] };

/** 最短の手 1 つ。名前は押せる物の名前（同じか、で始まる）。nth は同じ名前の何番目か（0 から）。optional は出ていれば押す物（訓練の着信の窓。最短に数えない） */
export type RouteMove =
  | { click: string; nth?: number; optional?: boolean }
  | { type: string; text: string; nth?: number }
  | { select: string; option: string }
  | { back: true };

export type Goal = {
  id: string;
  /** 使う人に渡す目標の文 */
  text: string;
  done: Done;
  route: RouteMove[];
  /** 最短の手数（無ければ route の長さ） */
  shortest?: number;
};

export type PersonaId = "first" | "veteran" | "admin" | "medical" | "judge10";

export type Persona = {
  id: PersonaId;
  label: string;
  /** 使う人の AI に渡す人物の文 */
  profile: string;
  /** 手持ちの情報（書く値・ID。パスワードは {{password}} の印だけ） */
  info: string[];
  /** 筋の前に台が入っておく（使う人の手に数えない） */
  prelogin: boolean;
  /** 入ったあと筋の前に台がする下ごしらえ（使う人の手に数えない）。disaster は事業所の「発災開始」（T163、種の受入依頼が入る） */
  setup?: "disaster";
  /** 初めに開く道 */
  start: string;
  goals: Goal[];
  /** この筋の手の上限（無ければ全体の上限） */
  maxSteps?: number;
};

export const PERSONA_IDS: readonly PersonaId[] = ["first", "veteran", "admin", "medical", "judge10"];

/** 手元の山本の ID（種の確認用の事業所の管理者。seed/people.ts） */
export const DEFAULT_LOGIN_ID = "yamamoto";

const LOGIN_GOAL = (loginId: string): Goal => ({
  id: "login",
  text: "ログインする",
  done: { path: "^/(?!login(?!/role))" },
  route: [{ type: "ID", text: loginId }, { type: "パスワード", text: "{{password}}" }, { click: "ログイン" }],
});

/** 架空の新しい利用者（初めて触るケアマネが足す人） */
export const NEW_PERSON = { name: "川辺 サクラ", kana: "カワベ サクラ", birth: "1941-03-15", place: "みずほし公民館" } as const;

const DRILL_GOAL: Goal = {
  id: "drill",
  text: "訓練で大雨の想定を始め、時間を進める",
  // 「経過 3 時間」「経過 0 時間 30 分」（lib/drill/labels.ts の経過の言い方）。0 時間ちょうどは始めたまま
  done: { path: "^/drill/[^/?]+", text: "経過 ([1-9]\\d* 時間|0 時間 [1-9]\\d* 分)" },
  route: [{ click: "訓練" }, { click: "大雨想定" }, { click: "出ない", optional: true }, { click: "次まで" }],
};

const DISASTER_GOAL: Goal = {
  id: "disaster",
  text: "事業所の画面で発災時の状態に切り替える（デモの大雨の想定）",
  // 上の帯の災害モードの語（「大雨 レベル 4 …」）。訓練の画面の「大雨想定」は数えない
  done: { header: "(^|\\s)(大雨|台風|土砂|地震|津波|その他)(\\s|$)", notHeader: "平時" },
  route: [{ click: "事業所" }, { click: "発災開始" }, { click: "開始" }],
};

export function personas(loginId: string = DEFAULT_LOGIN_ID): Persona[] {
  return [
    {
      id: "first",
      label: "初めて触るケアマネジャー",
      profile:
        "居宅介護支援事業所のケアマネジャー。このアプリを今日初めて開いた。パソコンは毎日の記録で使うが、新しい道具は説明書を読まずに画面の言葉を頼りに触る。分からない言葉があればそう思う。",
      info: [`ID は ${loginId}、パスワードは {{password}}`, `新しく担当になった利用者: 氏名 ${NEW_PERSON.name}（${NEW_PERSON.kana}）、生年月日 ${NEW_PERSON.birth}、女性`, `その人の避難先は ${NEW_PERSON.place}`],
      prelogin: false,
      start: "/login",
      goals: [
        LOGIN_GOAL(loginId),
        {
          id: "add",
          text: `新しい利用者 ${NEW_PERSON.name} をアプリに足す`,
          // 作成のあとは担当一覧のその人の行が開く（/?open=<id>）
          done: { text: NEW_PERSON.name, path: "^/(people/(?!new)[^/?]+|\\?open=)" },
          route: [{ click: "利用者追加" }, { type: "氏名", text: NEW_PERSON.name }, { type: "カナ", text: NEW_PERSON.kana }, { type: "生年月日", text: NEW_PERSON.birth }, { click: "女" }, { click: "作成" }],
        },
        {
          id: "ledger",
          text: `${NEW_PERSON.name} の避難先に ${NEW_PERSON.place} を入れて保存する`,
          // 本人のページは担当一覧の中にも開く（/?open=<id>。T162 で印を合わせた）
          done: { text: NEW_PERSON.place, path: "^/(people/(?!new)[^/?]+|\\?open=)" },
          route: [{ click: "編集", nth: 1 }, { type: "避難先1", text: NEW_PERSON.place }, { click: "保存" }],
        },
        {
          id: "plan",
          text: `${NEW_PERSON.name} の個別避難計画（計画書）を画面で見る`,
          done: { path: "^/people/[^/]+/forms/(matsuyama|cao|mapped)" },
          // 本人のページの書類の行の「表示」は書類の名前（事業所の使用様式。種は松山市）つきで読む（T162）
          route: [{ click: "計画書（松山市） 表示" }],
        },
        DRILL_GOAL,
        DISASTER_GOAL,
        {
          id: "print",
          text: "誰か 1 人の書類を印刷する（印刷の画面が開くところまで）",
          done: { any: [{ printed: true }, { path: "[?&]print=1" }] },
          // 書類の一覧の行の「印刷」は氏名と書類の名前つきで読む（T162）
          route: [{ click: "書類" }, { click: "山田 ハナ 計画書（松山市） 印刷" }],
        },
      ],
    },
    {
      id: "veteran",
      label: "慣れたケアマネジャー",
      profile: "このアプリを 1 か月使っているケアマネジャー。どこに何があるかはだいたい知っていて、近道で済ませたい。回り道をさせられると不満に思う。",
      info: ["担当の山田 ハナさんは在宅酸素を使っている"],
      prelogin: true,
      start: "/",
      goals: [
        {
          id: "person",
          text: "山田 ハナさんの本人のページを開き、未確認の項目を見る",
          // 名前を押すと担当一覧の中にその人の本人のページが開く（/?open=<id>）
          done: { path: "^/(people/[^/?]*p-01(\\?|$)|\\?open=[^&]*p-01)" },
          route: [{ click: "山田 ハナ" }],
        },
        {
          id: "plan",
          text: "山田 ハナさんの計画書を画面で見る",
          done: { path: "^/people/[^/]*p-01/forms/(matsuyama|cao|mapped)" },
          route: [{ click: "計画書（松山市） 表示" }],
        },
        DRILL_GOAL,
        DISASTER_GOAL,
        {
          id: "sheets",
          text: "担当全員の本人の 1 枚をまとめて印刷する（印刷の画面が開くところまで）",
          done: { any: [{ printed: true }, { path: "own-sheets.*print=1" }] },
          route: [{ click: "担当一覧" }, { click: "一括印刷" }],
        },
      ],
    },
    {
      id: "admin",
      label: "事業所の管理者",
      profile: "居宅介護支援事業所の管理者（主任ケアマネジャー）。職員の担当の割り振りと事業所の設定、事業所の書類を受け持つ。画面を細かく読む。",
      info: ["伊藤 フミさんの担当を西村さんに替える", "様式 9 は事業所の災害時利用者一覧表"],
      prelogin: true,
      start: "/",
      goals: [
        DISASTER_GOAL,
        {
          id: "assign",
          text: "伊藤 フミさんの担当を西村さんに替えて保存する",
          done: { path: "^/office", text: "西村\\s*1" },
          // 行の「変更」は担当を選んでから押せ、読み上げは「伊藤 フミ 担当変更」（T162）
          route: [{ click: "事業所" }, { click: "伊藤 フミ 担当" }, { click: "西村" }, { click: "伊藤 フミ 担当変更" }],
        },
        {
          id: "form9",
          text: "様式 9（災害時利用者一覧表）を印刷する（印刷の画面が開くところまで）",
          // 印刷の旗は様式 9 の画面で立った物だけ（T162。一括印刷で松山市の計画書の印刷が開いても達成に数えていた）
          done: { any: [{ printed: true, path: "^/office/form9" }, { path: "form9.*print=1" }] },
          route: [{ click: "書類" }, { click: "様式9" }, { click: "印刷" }],
        },
        {
          id: "reset",
          text: "事業所のデモのデータを最初の状態に戻す",
          done: { path: "reset=done" },
          // 印刷見本の間も上の帯は残る（T162）ので、見本を閉じずに「事業所」へ
          // 確認の窓の決める物は「戻す」（lib/ui/labels.ts の CONFIRM_LABELS.resetOk）
          route: [{ click: "事業所" }, { click: "最初に戻す" }, { click: "戻す" }],
        },
      ],
    },
    {
      id: "medical",
      label: "医療班（受け入れ側）",
      profile: "避難所に入った医療班の看護師。このアプリは初めて。避難所に着いた人を受け入れて、薬と機器の情報を確かめ、したことを記録に残したい。医療の判断は自分でする（アプリには求めない）。",
      info: [
        "事業所のケアマネから、山田 ハナさん（ヤマダ ハナ）の受け入れを頼んだと連絡があった",
        "避難所の名前は かわなぎ小学校",
        "記録に残す文: 2 階の和室に案内した",
      ],
      prelogin: true,
      setup: "disaster",
      start: "/",
      goals: [
        {
          id: "role",
          text: "医療班の立場で使い始める",
          done: { path: "^/staff" },
          route: [{ click: "役変更" }, { click: "医療班" }],
        },
        {
          id: "receive",
          text: "山田 ハナさんを探して、この避難所で受け入れる",
          done: { text: "受入一覧\\s*[1-9]" },
          // 受入依頼の行の「受入」（押せる物の名前は「受入 ヤマダ ハナ」。components/staff/StaffRequests.tsx）。行き先は依頼の避難所
          route: [{ click: "受入 ヤマダ ハナ" }],
        },
        {
          id: "summary",
          text: "受け入れた山田 ハナさんの薬と機器の情報を見る",
          done: { path: "^/people/[^/?]*p-01", text: "要約" },
          route: [{ click: "山田 ハナ" }],
        },
        {
          id: "note",
          text: "山田 ハナさんの記録に「2 階の和室に案内した」と書き足す",
          done: { text: "2 階の和室に案内した" },
          route: [{ type: "自由文", text: "2 階の和室に案内した" }, { click: "追記" }],
        },
      ],
    },
    {
      id: "judge10",
      label: "審査員の初めての 10 分",
      profile:
        "ハッカソンの審査員。介護の現場は知らない。README の冒頭だけ読んでログインし、10 分でこの道具の価値を確かめたい。README の冒頭: ログインしたら役を選ぶ。最初に見るなら、ケアマネの役で平時の担当一覧 →「訓練」→「大雨想定」を始めて「自動進行」→ 上の「事業所」の「発災開始」で発災時に入り、担当一覧が色と連絡順に並び替わる → 本人スマホで赤「無事じゃない」を押してからケアマネの担当一覧に戻る。",
      info: [`ID は ${loginId}、パスワードは {{password}}`],
      prelogin: false,
      start: "/login",
      maxSteps: 30,
      goals: [
        LOGIN_GOAL(loginId),
        {
          id: "auto",
          text: "訓練で大雨の想定を始め、自動進行で進める",
          done: { any: [{ path: "^/drill/[^/?]+", checked: "自動進行" }, { path: "^/drill/[^/?]+", text: "経過 ([3-9]|\\d{2,}) 時間" }] },
          route: [{ click: "訓練" }, { click: "大雨想定" }, { click: "出ない", optional: true }, { click: "自動進行" }],
        },
        DISASTER_GOAL,
        {
          id: "red",
          text: "本人スマホの立場で赤の「無事じゃない」を押す",
          // 赤のあとの 1 画面 1 問（「これは AI…が 聞いています」）。本人の画面は分かち書き
          done: { path: "^/me", text: "聞いています" },
          route: [{ click: "役変更" }, { click: "本人スマホ" }, { click: "無事じゃない" }],
        },
        {
          id: "back",
          text: "ケアマネの担当一覧に戻り、並び替わったのを見る",
          done: { path: "^/(\\?|$)", text: "至急" },
          route: [{ click: "役変更" }, { click: "ケアマネ" }],
        },
      ],
    },
  ];
}

export function personaOf(id: string, loginId?: string): Persona | null {
  return personas(loginId).find((p) => p.id === id) ?? null;
}

export function shortestOf(g: Goal): number {
  return g.shortest ?? g.route.filter((m) => !("click" in m && m.optional)).length;
}
