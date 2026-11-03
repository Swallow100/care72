// 入れる欄の「次の問い」（T03）。空欄から 1 問ずつ。問いの文は定型（Claude に作らせない）。
// 1 問で分かるように、何を聞くか（text）・なぜ要るか（why）・答えの例（example）の 3 つを持つ（T45）。
// 順は 医療依存（値の空いた時計・薬の残り・用量・保管）→ 夜間の支援者（避難の支援者）→ その他（本人のページの区分の順）。
// 「分からない」「答えない」と記録した欄（pending の unknown・declined）は問わない。「次回」（not_asked）と、
// 種のまま聞いていない欄（pending の not_asked）は問う。空欄は本人のページと計画に「未確認」と残る（view.unconfirmed と同じ元）。
// サーバーで作り、画面に順の列を渡す。画面はこの回で「次回」にした欄を飛ばす（nextQuestion）。

import { parseLedger, sameMedication } from "../db/ledger.ts";
import type { Ledger, MedicationCategory } from "../db/types.ts";
import { CONTACT_KIND_LABELS, MED_PARTS } from "../labels.ts";
import { pendingClockId, type PersonPageRows } from "../person.ts";
import { categoryTier } from "../triage/index.ts";
import { INTAKE_FIELDS, isFilled, ledgerValue, type IntakeField, type IntakeSection } from "./fields.ts";

export type QuestionGroup = "medical" | "night" | "other";

export type QuestionAnswer =
  /** 選択肢（enum・はい／いいえ）。multi は支援の内容のような複数 */
  | { kind: "choice"; field: string; options: ReadonlyArray<{ value: string; label: string }>; multi: boolean }
  | { kind: "text"; field: string }
  | { kind: "list"; field: string }
  | { kind: "int"; field: string; unit?: string }
  /** 時計の長さ（残り）。clockId が無ければ薬（medIndex）の時計を作る */
  | { kind: "clock"; clockId: string | null; medIndex: number | null; clockLabel: string; unit: "hour" | "day" }
  /** 薬の文字の所（回数・用量・保管） */
  | { kind: "medtext"; medIndex: number; part: "schedule" | "amount" | "storage"; name: string; category: MedicationCategory }
  /** 夜間に来られる人を連絡先から選ぶ（選ばなければ「なし」） */
  | { kind: "night"; contacts: ReadonlyArray<{ id: string; label: string; kind: Exclude<PersonPageRows["contacts"][number]["kind"], "self"> }> }
  /** 決まった形の無い問い（文で答えて Claude が分ける） */
  | { kind: "free" };

export type Question = {
  /** pending の場所（「分からない」を残す所） */
  key: string;
  section: IntakeSection;
  group: QuestionGroup;
  /** 欄の名前（画面に出す。薬の名前を含むことがある） */
  label: string;
  /** 問いの文（定型）。何を聞くかを 1 文で */
  text: string;
  /** なぜ要るか（何に使うか）を 1 文で（定型） */
  why: string;
  /** 答えの例（「例: 」で始まる。定型） */
  example: string;
  /** Claude に渡す言葉（コードの定数だけ。名前・台帳の値を入れない） */
  focus: string;
  answer: QuestionAnswer;
};

/** 問いの文の 3 つ: 何を聞くか・なぜ要るか・答えの例。全部定型（Claude に作らせない） */
export type QuestionWords = { text: string; why: string; example: string };

/**
 * その他の欄の問いの文。欄の表（lib/intake/fields.ts）の欄は、問わない欄（NOT_ASKED）のほか全部ここに持つ（テストで確かめる）。
 * 言葉は現場の物。「診断」「判定」「重症」を書かない。なぜは「何に使うか」だけを書き、本人の状態を言い切らない
 */
export const FIELD_QUESTIONS: Record<string, QuestionWords> = {
  "medical.allergies": {
    text: "薬や食べ物で、合わない物（アレルギー・食べてはいけない物）はありますか。",
    why: "避難所の食事や、医療班が薬を出すときに伝えます。",
    example: "例: ペニシリン・そば（無ければ「なし」）",
  },
  "medical.history": {
    text: "医師から言われている病名を教えてください（今治療中の物と、前の物）。",
    why: "医療班への要約に、言われたとおりの病名で載せます。",
    example: "例: 高血圧・心不全",
  },
  "medical.vaccinations": {
    text: "受けた予防接種と、その時期を教えてください。",
    why: "避難所で感染症がはやったとき、医療班が確かめます。",
    example: "例: インフルエンザ 2026 年 10 月・肺炎球菌",
  },
  "evacuation.destination1": {
    text: "市が指定する避難所のうち、本人が行く所はどこですか。",
    why: "計画書の避難先 1 に載せ、そこまでの道のりを確かめます。",
    example: "例: 近くの小学校の体育館",
  },
  "evacuation.destination2": {
    text: "避難所のほかに、早めに身を寄せる所はありますか。",
    why: "避難所で過ごすのが難しいとき、先に移る所として計画に載せます。",
    example: "例: 市内に住む長女の家",
  },
  "evacuation.stayHome": {
    text: "災害のときは家に留まる（在宅避難）と、本人・家族と決めていますか。",
    why: "家に留まるなら、備えの物と見回りに行く人を計画に書きます。",
    example: "例: あり（浸水の区域の外で、2 階に上がれる）",
  },
  "evacuation.transport": {
    text: "避難所まで、どうやって移りますか。",
    why: "手伝う人の数と、車や車いすの用意を計画に書きます。",
    example: "例: 家族の車・車いすを押して歩く",
  },
  "evacuation.support": {
    text: "避難のとき、手伝う人に何をしてもらいますか（いくつでも）。",
    why: "支援者に頼む事として計画に書き、訓練で確かめます。",
    example: "例: 声掛けと移動介助",
  },
  "evacuation.route": {
    text: "避難所までの道のりを教えてください。",
    why: "浸水や崖のそばを通らない道かを確かめ、計画書に載せます。",
    example: "例: 県道を北へ 300 m、川の橋は渡らない",
  },
  "evacuation.barriers": {
    text: "家の出入りの段差・階段と、エレベーターの有無を教えてください。",
    why: "運び出すのに人手や道具が要るかを決めます。",
    example: "例: 玄関に 30 cm の段差、2 階へは階段だけ",
  },
  "basic.housing.floor": {
    text: "本人は建物の何階で暮らしていますか。",
    why: "浸水のとき上の階へ移れるかと、運び出す手間を見ます。",
    example: "例: 1",
  },
  "basic.housing.floors": {
    text: "建物は何階建てですか。",
    why: "浸水の深さと比べて、上の階へ逃げる余地を見ます。",
    example: "例: 2",
  },
  "basic.housing.structure": {
    text: "建物は木造・鉄骨・鉄筋のどれですか。",
    why: "計画書の建物の欄に載せます。",
    example: "例: 木造",
  },
  "basic.housing.builtYear": {
    text: "建物が建った年を西暦で教えてください。",
    why: "計画書の建物の欄に載せます。",
    example: "例: 1978",
  },
  "basic.housing.bedroom": {
    text: "本人が寝ている部屋は、家のどこですか。",
    why: "夜の災害で、駆けつけた人がすぐ本人の所へ行けるようにします。",
    example: "例: 1 階 奥の和室",
  },
  "evacuation.carryItems": {
    text: "避難のとき持ち出す物を教えてください。",
    why: "持ち出し品の一覧として、計画と本人の 1 枚に載せます。",
    example: "例: 薬・お薬手帳・予備の電池・眼鏡",
  },
  "evacuation.pets": {
    text: "一緒に暮らしているペットはいますか。種類と数を教えてください。",
    why: "ペットと一緒に入れる避難先かを確かめます。",
    example: "例: 小型犬 1 匹（いなければ「なし」）",
  },
  "evacuation.myTimeline": {
    text: "災害のときの動きを時間の順に書いた表（マイ・タイムライン）を作っていますか。",
    why: "作っていれば計画と合わせ、無ければ次の訪問で一緒に作ります。",
    example: "例: あり（紙）",
  },
  "local.watcher": {
    text: "地域のみまもり員はついていますか。",
    why: "発災時に様子を見に行ける人として、連絡の順に入れます。",
    example: "例: あり（月に 1 回来る）",
  },
  "basic.sex": {
    text: "本人の性別を教えてください。",
    why: "避難所の部屋割りや着替えの配慮と、医療班への要約に使います。",
    example: "例: 女",
  },
  "basic.household": {
    text: "本人は誰と暮らしていますか。",
    why: "災害が起きたとき、家の中で最初に気づける人がいるかを見ます。",
    example: "例: 独居",
  },
  "basic.contactMeans.landline": {
    text: "家に固定電話はありますか。",
    why: "発災時に安否を聞く手段を決めます。",
    example: "例: あり",
  },
  "basic.contactMeans.mobile": {
    text: "本人は携帯電話を持っていますか。",
    why: "発災時に安否を聞く手段を決めます。",
    example: "例: なし",
  },
  "basic.contactMeans.email": {
    text: "本人はメールを読んだり送ったりできますか。",
    why: "発災時に知らせを送る手段を決めます。",
    example: "例: なし",
  },
  "basic.contactMeans.smartphone": {
    text: "本人はスマホを自分で使えますか。",
    why: "発災時に本人が安否のボタンを押せるかを決めます。",
    example: "例: 閲覧のみ（知らせは読めるが、ボタンは押せない）",
  },
  "care.careLevel": {
    text: "要介護度（要支援を含む）を教えてください。",
    why: "手伝う人の数と避難先の選び方の目安にします。",
    example: "例: 要介護3",
  },
  "care.walking": {
    text: "本人は一人で歩けますか。",
    why: "避難のとき、手を貸す人や車いすが要るかを決めます。",
    example: "例: 一部（杖で家の中は歩ける）",
  },
  "care.hearing": {
    text: "本人は呼びかけの声や電話の音が聞こえますか。",
    why: "避難の呼びかけや電話が届くか、直接行く人が要るかを決めます。",
    example: "例: 一部（大きな声なら聞こえる）",
  },
  "care.vision": {
    text: "本人は目で見て周りの様子が分かりますか。",
    why: "暗い中や知らない場所で、一人で動けるかを見ます。",
    example: "例: 問題なし",
  },
  "care.understanding": {
    text: "避難の話をしたとき、本人に分かってもらえますか。",
    why: "呼びかけだけで動けるか、そばで手伝う人が要るかを決めます。",
    example: "例: 一部（短い言葉なら分かる）",
  },
  "care.judgment": {
    text: "危ないとき、本人が自分で逃げると決められますか。",
    why: "誰が声をかけ、付き添うかを決めます。",
    example: "例: 困難（家族が決めている）",
  },
  "care.orientation": {
    text: "本人は今日の日付や、今いる場所が分かりますか。",
    why: "避難先で落ち着いて過ごせるか、付き添いが要るかの目安にします。",
    example: "例: 一部（日付があいまい）",
  },
  "care.bedridden": {
    text: "本人は一日の多くをベッドの上で過ごしていますか（寝たきり）。",
    why: "運び出すのに人手と道具が要るかを決めます。",
    example: "例: あり",
  },
  "care.dementia": {
    text: "本人は医師から認知症と言われていますか。",
    why: "本人の「大丈夫」の返事だけに頼らず、様子を見に行く人を決めます。",
    example: "例: なし",
  },
  "care.handbook": {
    text: "障害者手帳を持っていれば、種類と等級を教えてください。",
    why: "福祉避難所へ移るときの確かめに使います。",
    example: "例: 身体障害者手帳 2 級（無ければ「なし」）",
  },
  "care.intractableDisease": {
    text: "国や県の指定難病の受給者証を持っていれば、病名を教えてください。",
    why: "受給者証の病名を、医療班への要約に載せます。",
    example: "例: パーキンソン病（無ければ「なし」）",
  },
};

/** 時計・薬・人の問いの文（名前を差し込む物は関数）。全部定型 */
export const GENERATED_QUESTIONS = {
  /** 機器の内蔵電池（予備のボンベ・外部電池は別の時計で聞く） */
  deviceHours: (label: string): QuestionWords => ({
    text: `${label.replace(/ 内蔵電池$/, "")}は、停電したあと内蔵の電池だけで何時間使えますか。`,
    why: "停電からの時計に入れ、連絡の順を出す表の元にします。",
    example: "例: 4 時間（機器の説明書や業者に聞いた値）",
  }),
  /** 予備のボンベなど、時間で数える物 */
  supplyHours: (label: string): QuestionWords => ({
    text: `${label}は、今の使い方で何時間分ありますか。`,
    why: "停電からの時計に入れ、連絡の順を出す表の元にします。",
    example: "例: 8 時間（ボンベの本数と業者に聞いた値から）",
  }),
  /** 透析（次の回までの日数） */
  nextDialysis: (): QuestionWords => ({
    text: "次の透析は何日後ですか（通っている施設の予定のとおり）。",
    why: "発災からの時計に入れ、透析先へ連絡する順を出す表の元にします。",
    example: "例: 2 日後（月・水・金に通う）",
  }),
  remainingDays: (label: string): QuestionWords => ({
    text: `${label}は、手元にあと何日分ありますか。`,
    why: "手元の分が何日で尽きるかを時計に入れ、連絡の順を出す表の元にします。",
    example: "例: 7 日分",
  }),
  medSchedule: (name: string): QuestionWords => ({
    text: `${name}は、1 日に何回、いつ使いますか（処方のとおり）。`,
    why: "処方の回数と時間を、計画と医療班への要約に写します。",
    example: "例: 1 日 2 回 朝・夕食後",
  }),
  medAmount: (name: string): QuestionWords => ({
    text: `${name}の 1 回の量を、薬の袋やお薬手帳のとおりに教えてください。`,
    why: "医療班への要約に処方のまま写します（量を決めたり直したりはしません）。",
    example: "例: 1 回 1 錠",
  }),
  medStorage: (name: string): QuestionWords => ({
    text: `${name}は、家のどこに置いていますか。`,
    why: "避難のとき、持ち出す人がすぐ見つけられるようにします。",
    example: "例: 台所の引き出し・冷蔵庫のドアポケット",
  }),
  night: {
    text: "夜中に何かあったとき、駆けつけられる人を選んでください。",
    why: "夜に駆けつけられる人として、計画の連絡先に印を付けます。",
    example: "例: 近くに住む長男（車で 10 分）",
  } satisfies QuestionWords,
  supporter1: {
    text: "避難のとき本人を手伝う人は誰ですか。続柄と、何を手伝えるかを書いてください。",
    why: "計画の避難支援者として載せ、訓練で連絡がつくかを確かめます。",
    example: "例: 隣の家の人。声かけと車いすを押すのを手伝える",
  } satisfies QuestionWords,
} as const;

/** その他で問わない欄（書き足しの欄） */
export const NOT_ASKED = new Set(["evacuation.supportNote"]);

/** その他の問いの区分の順（本人のページの区分の順） */
const OTHER_ORDER: readonly IntakeSection[] = ["medical", "evacuation", "people", "basic"];

const BOOL_OPTIONS = [
  { value: "true", label: "あり" },
  { value: "false", label: "なし" },
] as const;

function fieldAnswer(f: IntakeField): QuestionAnswer {
  switch (f.shape.type) {
    case "enum":
      return { kind: "choice", field: f.key, options: f.shape.options, multi: false };
    case "enumList":
      return { kind: "choice", field: f.key, options: f.shape.options, multi: true };
    case "bool":
      return { kind: "choice", field: f.key, options: BOOL_OPTIONS, multi: false };
    case "int":
      return { kind: "int", field: f.key, unit: f.shape.unit };
    case "text":
      return { kind: "text", field: f.key };
    case "list":
      return { kind: "list", field: f.key };
  }
}

type Clock = PersonPageRows["clocks"][number];

const tierOfCategory = (c: Clock["category"] | MedicationCategory) =>
  categoryTier(c as Clock["category"]) ?? 9;

/** 時間で数える物の時計（電源で動く機器の予備。種の「酸素 予備ボンベ」は時間） */
const HOUR_SUPPLIES = new Set<Clock["category"]>(["oxygen", "ventilator", "suction"]);

/** 記録した答え（不明・無回答）。次回（not_asked）は記録でなく、また問う */
function answered(ledger: Ledger, match: (field: string) => boolean): boolean {
  return ledger.pending.some((p) => p.status !== "not_asked" && match(p.field));
}

/** pending の場所が残っていればそれ（種の「medical.medications.warfarin.remaining」など）、無ければ作った場所 */
function pendingKeyOf(ledger: Ledger, match: (field: string) => boolean, fallback: string): string {
  return ledger.pending.find((p) => match(p.field))?.field ?? fallback;
}

/** 来てくれる人の連絡先（夜間に来られるかを聞く相手） */
const COMES = new Set(["family", "supporter", "welfare_commissioner", "visiting_nurse"]);

/** 次の問いの順の列。全部の空欄 */
export function questionQueue(rows: PersonPageRows): Question[] {
  const ledger = parseLedger(rows.person.ledger);
  const clocks = [...rows.clocks].sort((a, b) => tierOfCategory(a.category) - tierOfCategory(b.category) || a.sort - b.sort);
  const out: Question[] = [];

  // ---- 医療依存: 値の空いた時計（機器の電池・物・薬の残り） ----
  for (const k of clocks) {
    if (k.kind === "condition" || k.value != null) continue;
    const match = (field: string) => pendingClockId(field, ledger, rows.clocks) === k.id;
    if (answered(ledger, match)) continue;
    const device = k.kind === "device";
    // 電源で動く機器の予備（酸素の予備ボンベなど）は時間で、透析は次の回までの日数で聞く
    const hours = device || (k.kind === "supply" && HOUR_SUPPLIES.has(k.category));
    const dialysis = k.category === "dialysis";
    out.push({
      key: pendingKeyOf(ledger, match, `clocks.${k.id}`),
      section: "medical",
      group: "medical",
      label: `${k.label} ${hours ? "時間" : MED_PARTS.remaining}`,
      ...(device
        ? GENERATED_QUESTIONS.deviceHours(k.label)
        : hours
          ? GENERATED_QUESTIONS.supplyHours(k.label)
          : dialysis
            ? GENERATED_QUESTIONS.nextDialysis()
            : GENERATED_QUESTIONS.remainingDays(k.label)),
      focus: device ? "機器の電池の時間" : hours ? "予備の時間" : dialysis ? "次の透析までの日数" : "薬・物の残りの日数",
      answer: { kind: "clock", clockId: k.id, medIndex: null, clockLabel: k.label, unit: hours ? "hour" : "day" },
    });
  }

  // ---- 医療依存: 薬の残り（時計の無い薬）・回数・用量・保管。骨格に入る区分の薬を先に ----
  const meds = ledger.medical.medications
    .map((m, i) => ({ m, i }))
    .sort((a, b) => tierOfCategory(a.m.category) - tierOfCategory(b.m.category) || a.i - b.i);
  for (const { m, i } of meds) {
    const at = (part: string) => (field: string) =>
      field === `medical.medications.${i}.${part}` || field === `medical.medications.${m.name}.${part}`;
    const hasClock = rows.clocks.some((k) => k.kind !== "device" && k.kind !== "condition" && sameMedication(k.label, m.name));
    if (!hasClock && !answered(ledger, at("remaining"))) {
      out.push({
        key: pendingKeyOf(ledger, at("remaining"), `medical.medications.${i}.remaining`),
        section: "medical",
        group: "medical",
        label: `${m.name} ${MED_PARTS.remaining}`,
        ...GENERATED_QUESTIONS.remainingDays(m.name),
        focus: "薬の残りの日数",
        answer: { kind: "clock", clockId: null, medIndex: i, clockLabel: m.name, unit: "day" },
      });
    }
    const parts = [
      ["schedule", "回数", GENERATED_QUESTIONS.medSchedule, "薬の回数"],
      ["amount", MED_PARTS.amount, GENERATED_QUESTIONS.medAmount, "薬の用量"],
      ["storage", MED_PARTS.storage, GENERATED_QUESTIONS.medStorage, "薬の保管場所"],
    ] as const;
    for (const [part, partLabel, words, focus] of parts) {
      if (isFilled(m[part]) || answered(ledger, at(part))) continue;
      out.push({
        key: pendingKeyOf(ledger, at(part), `medical.medications.${i}.${part}`),
        section: "medical",
        group: "medical",
        label: `${m.name} ${partLabel}`,
        ...words(m.name),
        focus,
        answer: { kind: "medtext", medIndex: i, part, name: m.name, category: m.category },
      });
    }
  }

  // ---- 夜間の支援者・避難の支援者 ----
  const contacts = [...rows.contacts].sort((a, b) => a.sort - b.sort);
  const nightKnown = contacts.some((c) => c.night_ok === 1) || contacts.some((c) => c.night_ok === 0);
  if (!nightKnown && !answered(ledger, (f) => f === "people.night_supporter")) {
    out.push({
      key: "people.night_supporter",
      section: "people",
      group: "night",
      label: "夜間支援",
      ...GENERATED_QUESTIONS.night,
      focus: "夜間に来られる人",
      answer: {
        kind: "night",
        contacts: contacts.flatMap((c) =>
          COMES.has(c.kind) && c.night_ok == null && c.kind !== "self"
            ? [{ id: c.id, kind: c.kind, label: [c.name ?? c.relation ?? CONTACT_KIND_LABELS[c.kind], c.name && c.relation ? c.relation : CONTACT_KIND_LABELS[c.kind]].join(" ") }]
            : [],
        ),
      },
    });
  }
  if (!contacts.some((c) => c.supporter_order != null) && !answered(ledger, (f) => f === "people.supporter1")) {
    out.push({
      key: "people.supporter1",
      section: "people",
      group: "night",
      label: "支援者1",
      ...GENERATED_QUESTIONS.supporter1,
      focus: "避難を手伝う人",
      answer: { kind: "free" },
    });
  }

  // ---- その他: 本人のページの区分の順 ----
  for (const section of OTHER_ORDER) {
    for (const f of INTAKE_FIELDS) {
      if (f.section !== section || NOT_ASKED.has(f.key)) continue;
      if (isFilled(ledgerValue(ledger, f.key))) continue;
      const match = (field: string) => field === f.key || field.startsWith(`${f.key}.`);
      if (answered(ledger, match)) continue;
      out.push({
        key: f.key,
        section: f.section,
        group: "other",
        label: f.label,
        // 表に無い欄（足したのに文を書き忘れた欄）は欄の名前だけ。テストで止める
        ...(FIELD_QUESTIONS[f.key] ?? { text: f.label, why: "", example: "" }),
        focus: f.label,
        answer: fieldAnswer(f),
      });
    }
  }
  return out;
}

/** 次の 1 問。この回で「次回」にした欄（skip）は飛ばす。空欄が無ければ null */
export function nextQuestion(queue: ReadonlyArray<Question>, skip: ReadonlyArray<string> = []): Question | null {
  return queue.find((q) => !skip.includes(q.key)) ?? null;
}

