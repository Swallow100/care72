// 入れる欄の「次の問い」（T03）。空欄から 1 問ずつ。問いの文は定型（Claude に作らせない）。
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
  /** 問いの文（定型） */
  text: string;
  /** Claude に渡す言葉（コードの定数だけ。名前・台帳の値を入れない） */
  focus: string;
  answer: QuestionAnswer;
};

/** その他の欄の問いの文。無ければ欄の名前 */
const FIELD_QUESTIONS: Record<string, string> = {
  "medical.allergies": "アレルギー・禁忌食物はあるか",
  "medical.history": "既往症は",
  "medical.vaccinations": "予防接種の記録は",
  "evacuation.destination1": "避難先（市の指定避難所）は",
  "evacuation.destination2": "事前に避難する所は",
  "evacuation.transport": "避難の手段は",
  "evacuation.support": "支援者は何を手伝うか",
  "evacuation.route": "避難の経路は",
  "evacuation.barriers": "家の段差・階段は",
  "basic.housing.floor": "住んでいる階は",
  "basic.housing.floors": "建物は何階建てか",
  "basic.housing.structure": "建物の構造は",
  "basic.housing.builtYear": "建てた年は",
  "basic.housing.bedroom": "寝室はどこか",
  "evacuation.carryItems": "持ち出す物は",
  "evacuation.pets": "ペットはいるか",
  "evacuation.myTimeline": "マイ・タイムラインを作ったか",
  "local.watcher": "みまもり員はいるか",
  "basic.sex": "性別は",
  "basic.household": "世帯は",
  "basic.contactMeans.landline": "固定電話はあるか",
  "basic.contactMeans.mobile": "携帯電話はあるか",
  "basic.contactMeans.email": "メールを使うか",
  "basic.contactMeans.smartphone": "スマホを使えるか",
  "care.careLevel": "要介護度は",
  "care.walking": "歩けるか",
  "care.hearing": "聞こえるか",
  "care.vision": "見えるか",
  "care.understanding": "話を理解できるか",
  "care.judgment": "自分で判断できるか",
  "care.orientation": "日時・場所が分かるか",
  "care.bedridden": "寝たきりか",
  "care.dementia": "認知症と言われているか",
  "care.handbook": "障害者手帳は",
  "care.intractableDisease": "難病の指定は",
};

/** その他で問わない欄（書き足しの欄） */
const NOT_ASKED = new Set(["evacuation.supportNote"]);

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
    out.push({
      key: pendingKeyOf(ledger, match, `clocks.${k.id}`),
      section: "medical",
      group: "medical",
      label: `${k.label} ${device ? "時間" : MED_PARTS.remaining}`,
      text: device ? `${k.label}は何時間もつか` : `${k.label}の残りは何日分か`,
      focus: device ? "機器の電池の時間" : "薬・物の残りの日数",
      answer: { kind: "clock", clockId: k.id, medIndex: null, clockLabel: k.label, unit: device ? "hour" : "day" },
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
        text: `${m.name}の残りは何日分か`,
        focus: "薬の残りの日数",
        answer: { kind: "clock", clockId: null, medIndex: i, clockLabel: m.name, unit: "day" },
      });
    }
    const parts = [
      ["schedule", "回数", "の飲む回数は", "薬の回数"],
      ["amount", MED_PARTS.amount, "の用量（処方のとおり）は", "薬の用量"],
      ["storage", MED_PARTS.storage, "の保管場所は", "薬の保管場所"],
    ] as const;
    for (const [part, partLabel, q, focus] of parts) {
      if (isFilled(m[part]) || answered(ledger, at(part))) continue;
      out.push({
        key: pendingKeyOf(ledger, at(part), `medical.medications.${i}.${part}`),
        section: "medical",
        group: "medical",
        label: `${m.name} ${partLabel}`,
        text: `${m.name}${q}`,
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
      text: "夜間に来られる人は",
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
      text: "避難を手伝う人は",
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
        text: FIELD_QUESTIONS[f.key] ?? f.label,
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

