// 訓練の講評（docs/tasks/T22.md）。Opus に 1 回。数字は機械（lib/drill/score.ts）で、言葉だけ Opus。
//
// - 入力は機械で数えた結果と手の履歴の文だけ。本人は仮名（A さん、lib/pseudonym の pseudonymize の並び）、連絡先は区分・続柄
//   （「家族 娘」）で、名前・住所・電話・町名を渡さない。文は pseudonymizeText を通す（監督の理由など、訓練記録に氏名が戻っている物も伏せる）
// - 返事の形: { summary, findings: [{ person, kind, text, basis }] }。basis は出典の登録簿（lib/sources）の id か「根拠なし」。
//   登録簿に無い根拠の指摘は捨てる（作った根拠を残さない）。kind・basis は文字で受け、コードで絞る（1 つの外れで全部を落とさない）
// - 行動の評価だけ（手の順番・報告の時刻・空欄・着信への応答）。診断・病名・薬・処置・医療の助言を書かせない（system と言葉の検査）。
//   「死亡」「関連死」と書かせない（「条件に達した」まで）。検査に掛かった指摘は捨てる
// - 仮名は氏名に戻して残す（サーバーと画面の中だけ。ケアマネの画面は名前を出す）
// - 出力は下書き。画面に AI の印を付け、ケアマネが直せる（直した物は別に残す。lib/drill/record.ts）

import * as z from "zod";
import { askJson, type AskJsonContext, type AskJsonRequest } from "../claude/call.ts";
import { OPUS, type PurposeSpec } from "../claude/models.ts";
import { AiBadOutput, AiCallFailed, AiLimitReached, AiNotConfigured, AiRefused } from "../claude/errors.ts";
import type { DrillScenario, DrillStatus } from "../db/types.ts";
import { COLOR_LABELS } from "../labels.ts";
import {
  maskReply,
  pseudonymize,
  pseudonymizeText,
  PseudonymLeakError,
  restoreText,
  type ForClaude,
  type PseudonymInput,
  type PseudonymKey,
} from "../pseudonym/index.ts";
import { isSourceId, type SourceId } from "../sources/index.ts";
import { NO_BASIS } from "../sources/prompt.ts";
import { ACTION_CATALOG, type ActionRow } from "./action-catalog.ts";
import { FREE_WAY_LABELS } from "./action-terms.ts";
import { NO_CALL } from "./event-catalog.ts";
import { officePlaces } from "./area.ts";
import { personOfAlias } from "./director.ts";
import type { TalkLine } from "./dialogue.ts";
import type { ActionRecord } from "./engine.ts";
import { ACTION_LABELS, SCENARIO_LABELS, STATUS_LABELS } from "./labels.ts";
import type { CallRecord } from "./responses.ts";
import { scenarioOf, type Ask } from "./scenarios.ts";
import { askWords, factWords, FORM9_PLAN_LABELS, minuteText, personWords, reachedText } from "./score-labels.ts";
import { PLAN_ACT_WORDS, PLAN_NEED_WORDS, sameWording } from "./person-facts.ts";
import {
  extrasCount,
  gapBefore,
  knownOf,
  reachedAt,
  rowOf,
  talkOf,
  talkTurns,
  visitOf,
  type DrillScore,
  type ScoreNumbers,
  type TickWorld,
  type WasteWhy,
} from "./score.ts";

// ---------- 形 ----------

/** 指摘の種類。choice は手の選び方（T94: その時に分かっていた事実と表の手の名前で） */
export const REVIEW_KINDS = ["order", "report", "blank", "reached", "call", "choice", "other"] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

export type ReviewFinding = {
  /** 本人（台帳の id）。全体のことは null */
  person: string | null;
  kind: ReviewKind;
  text: string;
  /** 出典の登録簿の id。根拠なしは null */
  basis: SourceId | null;
};

/**
 * 全体の講評の項目（T185）。連絡の順・電話の聞き取りと伝え方・訪問と手配・報告（市と様式 9）・時計と機器。良かった所は good に別に
 */
export const REVIEW_TOPICS = ["order", "talk", "visit", "report", "clock"] as const;
export type ReviewTopic = (typeof REVIEW_TOPICS)[number];
export type ReviewSection = { topic: ReviewTopic; text: string };

/**
 * 講評の本体。sections・good は T185 から（前に保存した講評には無い。無ければ今までの総評と指摘だけを出す）
 */
export type ReviewBody = { summary: string; findings: ReviewFinding[]; sections?: ReviewSection[]; good?: string[] };

/** 項目ごとの文・良かった所の字数（指示に書く数と、切る数） */
export const SECTION_ASK = 120;
export const SECTION_TEXT_MAX = 200;
export const GOOD_MAX = 3;
export const GOOD_ASK = 60;
export const GOOD_TEXT_MAX = 100;

/** 項目の中身の無いときの言葉（画面はこの項目を出さない） */
export const SECTION_NONE = "該当なし";

/** 講評の失敗（lib/claude の失敗の名前。画面と記録に残す） */
export type ReviewError = "not_configured" | "limit" | "refused" | "bad_output" | "failed" | "leak";

/**
 * 講評が引ける出典。行動（避難の支援・連絡・BCP・記録）の文書だけで、健康の助言を要旨に持つ物（呼吸・インスリン・循環・
 * 血栓・認知症・救急の文書）は渡さない（要旨が system に入り、その言葉を講評に写しうるため。medical-reviewer の指摘、
 * docs/progress/t22.md の「決めた所」）
 */
export const REVIEW_SOURCES: ReadonlyArray<SourceId> = [
  "cao-shishin-2021",
  "mhlw-bcp-2020",
  "nanbyo-shishin-2017",
  "nanbyo-tsuiho-2022",
  "jadp-dialysis-2023",
  "saigai-kiroku-2018",
];

/** 指摘の数・文の長さの上限 */
/**
 * 指摘の数の形の上限（返事が長すぎる時の安全の上限だけ。指示には書かない）。指摘の数は種類ごとの候補（findingRooms）で決まる（T139。
 * 評価の 4 回目で、指示に「8 個まで」が残り、どの回もちょうど 8 件だった）
 */
export const FINDINGS_MAX = 12;
export const FINDING_TEXT_MAX = 120;
export const SUMMARY_MAX = 240;

/**
 * 講評の指摘の数の目安（T141）。重い順に種類ごとの数（KIND_ROOM）まで、合わせてこれまで。評価の 5 回目で、指摘が 2 回とも上限 12 に
 * 張り付き（順番が 9・7）、終わりの待ちが 56〜57 秒に延びた（4 回目の 8 件は 26〜42 秒）
 */
export const REVIEW_LIMIT = 6;
/** 指示に書く指摘・要約の字数（T141。出力を短くして待ちを減らす。切るのは FINDING_TEXT_MAX・SUMMARY_MAX のまま） */
export const FINDING_ASK = 70;
export const SUMMARY_ASK = 140;
/** 重い順（T141）。時計が切れるまで手が届かなかった人・対応の順番・赤の着信・手の選び方・報告・空欄 */
export const REVIEW_WEIGHT: ReadonlyArray<ReviewKind> = ["reached", "order", "call", "choice", "report", "blank", "other"];
/** 種類ごとの指摘の数の上限（T141。同じ種類は 1 つにまとめる。条件に達した人と手の選び方だけ 2 つまで） */
export const KIND_ROOM: Readonly<Record<ReviewKind, number>> = { reached: 2, order: 1, call: 1, choice: 2, report: 1, blank: 1, other: 1 };
/** 報告が遅いと見る時刻（分。T141 の案。これより後の報告は指摘の候補） */
export const REPORT_LATE_MINUTES = 24 * 60;

/** 講評が名指しする手の言葉（手の表の label、画面の並び。自由対応は読み替えた手の名前で書くので入れない） */
export const REVIEW_ACTION_LABELS: ReadonlyArray<string> = ACTION_CATALOG.filter((r) => r.id !== "free").map((r) => r.label);

const labelsWhere = (f: (r: ActionRow) => boolean) =>
  ACTION_CATALOG.filter((r) => r.id !== "free" && f(r))
    .map((r) => r.label)
    .join("・");

/** 道が通行止だと届かない手（世界の返事 lib/drill/world-reply.ts: 訪問・訪問依頼と、本人の家へ向かう手配） */
const ROAD_BOUND = (r: ActionRow) =>
  r.decide.type === "visit" || r.decide.type === "dispatch" || (r.decide.type === "arrange" && r.effects.some((e) => e.kind === "arrival"));

/** 手の言葉と、事実で結果の決まる手（全体の講評と人ごとの講評〔T185〕で同じ物） */
export const REVIEW_WORLD_LINES: ReadonlyArray<string> = [
  `手の言葉（表の手の名前。これのほかの手を書かない）: ${REVIEW_ACTION_LABELS.join("・")}`,
  "",
  "事実で結果の決まる手（世界の返事の決まり）:",
  // 通信の段（T125、lib/drill/comms.ts）。通話の規制は全部を止めない
  `- 家の電話 ${NO_CALL}: 本人電話・本人への 119勧奨は届かない（停電の家の固定電話・家の電話の印。携帯のある人と、ほかの相手の電話はかけられる）`,
  "- 電話 規制: 電話の手はかけ直せば時々つながる（全部は止まらない。事業所の職員への訪問依頼は電話が要らない）",
  "- 携帯 電波不通: 家族・支援者・業者の携帯にかからず、メッセージも届かない（事業所の職員・市役所への手は届く）",
  `- 道 通行止: ${labelsWhere(ROAD_BOUND)}は届かない`,
  "- 職員 0: 事業所の職員への訪問依頼は出せない（訪問看護への訪問依頼は別）",
  "- 透析先 休止: その透析施設への透析調整・電話は受けられない",
];

export const REVIEW_SYSTEM = [
  "災害の訓練（発災から 72 時間。人は全部架空）の講評を書く。ケアマネが打った手の順番と選び方（空振り・重複・頼み事への対応）、市役所への報告の時刻、",
  "様式 9（災害時利用者一覧表）の空欄、着信への応答を、機械で数えた結果と手の履歴から振り返り、次の訓練で直す所を示す。入力は JSON の「記録」。",
  "",
  ...REVIEW_WORLD_LINES,
  "",
  "返す JSON:",
  `- summary: 全体の講評（${SUMMARY_ASK} 字まで）。次の訓練で試す事を 1〜2 つ。`,
  `- findings: 指摘の配列。重い順（${REVIEW_WEIGHT.join(" → ")}）に、「指摘の候補（種類ごと）」の数まで、合わせて ${REVIEW_LIMIT} つまで。数をそろえない・埋めない（指摘する事が無ければ空の配列）。同じ種類は 1 つにまとめ、人が多ければ代表の人と人数で書く（person は「全体」でよい）。候補の無い種類は書かない。`,
  "  - person: 本人の仮名（「A さん」）。全体のことは「全体」。",
  "  - kind: order（対応の順番）・report（市役所への報告）・blank（様式 9 の空欄）・reached（時計が切れるまで手が届かなかった）・call（着信への応答）・choice（手の選び方。空振り・重複・頼み事への対応）・other のどれか。",
  `  - text: 行動についての 1 文（${FINDING_ASK} 字まで）。いつ・誰に・どの手を打てばよかったかを、上の手の言葉で書く。`,
  `  - basis: 根拠の出典の id。当てはまる物が無ければ「${NO_BASIS}」。`,
  `- sections: 項目ごとの講評の配列。項目は ${REVIEW_TOPICS.join("・")} の順に 1 つずつ（いつも 5 つ）。各 ${SECTION_ASK} 字まで。その項目で良かった手と、次の訓練で試す事を、機械の数・手の履歴・人ごとの講評の要旨から、時刻と手の名前で具体的に書く。その項目の中身が訓練に無ければ text を「${SECTION_NONE}」とだけ。`,
  "  - topic: order（連絡の順。左の表の上から手が届いたか）・talk（電話の聞き取りと伝え方。通話の言葉から、聞けた事・伝えた事・聞き漏らした事。伝えた事は連絡の順と頼み事への答えで書き、体や薬の扱いの話は書かない）・visit（訪問と手配。届いたか・空振り・重複・頼み事への対応）・report（市役所への報告の時刻と様式 9 の空欄）・clock（時計の期限までに手が届いたか）のどれか。",
  `- good: 良かった所の配列（${GOOD_MAX} つまで、1 つ ${GOOD_ASK} 字まで）。手の名前と時刻で具体的に。無ければ空の配列。`,
  "",
  "決まり:",
  "1. 数字は機械で数えた物。数え直さない・変えない・新しい数字を作らない。",
  "2. 書くのは行動の評価（手の順番・選び方・時刻・様式 9 の空欄・着信への応答）だけ。病気の名前・薬の名前・薬の量・処置・医療の助言を書かない（手の名前の薬手配と、頼み事の「薬」は書いてよい）。本人の体の状態を言い切らない。",
  "3. 時計が切れるまでにその人へ手が届かなかったことは「条件に達した」とだけ書く。その先に起きる事を想像して書かない。",
  "   時計は入力の書き方（「〇〇 N 時間を超過」）のまま写す。時計の名前は入力のまま写してよいが、電池・薬・機器が今どうなったかを言い切らない。",
  "4. 色と順位はルールの表が決めた物。色・順位を付け直す・変えることを書かない。",
  "5. 仮名と役割名のほかの名前、場所の名前を書かない。",
  "6. 責める書き方をしない。次の訓練で試す形で書く。",
  "7. 手の選び方は、その時に分かっていた事実（手の履歴の［事実］）と、表にある別の手の名前で書く（例: 道が通行止と分かっていたので、訪問でなく見守依頼か連絡先電話）。無かった手を作らない。",
  "8. 頼み事に応えなかった事は、その頼み事と、応えられた手の名前で書く（例: 薬の頼み事には薬手配）。",
  "9. 「計画で動けた人」「計画が無く手が要った人」は、計画を作る・見直す話として書いてよい（計画の中身の名前・場所は書かない）。",
].join("\n");

export const ReviewSchema = z.object({
  summary: z.string(),
  findings: z.array(
    z.object({
      person: z.string(),
      kind: z.string(),
      text: z.string(),
      basis: z.string(),
    }),
  ),
  // T185。前の形の返事（偽の AI・前の評価の写し）も読めるように任意（指示ではいつも返させる）
  sections: z.array(z.object({ topic: z.string(), text: z.string() })).optional(),
  good: z.array(z.string()).optional(),
});

export type ReviewAnswer = z.output<typeof ReviewSchema>;

/**
 * 全体の講評の呼び方（T185）。用途は scoring（ai_calls の CHECK はそのまま）。Opus・medium: 人ごとの講評（訓練の間に Haiku）を
 * 入力に使い、出力に項目ごとの文と良かった所が増えた分を、考える深さを high から下げて最後の待ち（T141 で 24〜28 秒）に収める。
 * 待ちと上限は用途 scoring の既定のまま（16000・180 秒）
 */
export const REVIEW_SPEC: PurposeSpec = { model: OPUS, effort: "medium", maxTokens: 16000, timeoutMs: 180_000 };

/** Claude に渡す要求。入力は伏せた文だけ（型で縛る）。モデルと考える深さは REVIEW_SPEC（Opus・medium） */
export function buildReviewRequest(record: ForClaude<{ text: string }>): AskJsonRequest<typeof ReviewSchema> {
  return {
    purpose: "scoring",
    spec: REVIEW_SPEC,
    system: REVIEW_SYSTEM,
    input: { 記録: record },
    schema: ReviewSchema,
    sources: REVIEW_SOURCES,
  };
}

// ---------- 入力の文 ----------

export type ReviewIncident = { at: number; text: string; person?: string | null };

/** 講評に渡す物（id のまま。文にするときに仮名にする） */
export type ReviewContext = {
  scenario: DrillScenario;
  status: DrillStatus;
  score: DrillScore;
  actions: ReadonlyArray<ActionRecord>;
  calls: ReadonlyArray<CallRecord>;
  incidents: ReadonlyArray<ReviewIncident>;
  /** 同じ事業所の前の訓練の数字。無ければ null */
  previous: (ScoreNumbers & { scenario: DrillScenario }) | null;
  /** 刻みのあとの世界の写し（手を打った時の電話・施設の休止。T94 の「その時に分かっていた事実」）。無ければ手の前の状態だけ */
  ticks?: ReadonlyArray<TickWorld>;
  /** 終わりの世界の頼み事（通話の往復で頼まれた物。T93） */
  asks?: Readonly<Record<string, ReadonlyArray<Ask>>>;
  /** 人ごとの講評の要旨（T185。訓練の間に作った物。無い人は機械の数だけ） */
  persons?: ReadonlyArray<PersonDigest>;
};

/** 全体の講評に渡す人ごとの講評の要旨（T185。氏名は入れない。本人は id で、文にするときに仮名にする） */
export type PersonDigest = { person: string; good: ReadonlyArray<string>; next: ReadonlyArray<string> };

const SCENE_WORDS = { heavy_rain: "大雨（警戒レベル 3 → 4 → 浸水）", earthquake: "地震（南海トラフ 震度 6強・津波・停電）" } as const;
/** 仮想モード（T50）: 街の出来事は世界の部屋が刻みごとに決めた（固定の筋が無い） */
const VIRTUAL_WORDS = "仮想（実在の地域の地理の上で、想定の出来事と架空の人の結末を刻みごとに AI が決めた。結末の数は時計の計算の「条件に達した人」とは別）";

/** 状態の色の言葉（左の表の色。lib/triage の色の名前） */
const triageWord = (c: string | undefined) => (c && c in COLOR_LABELS ? COLOR_LABELS[c as keyof typeof COLOR_LABELS] : null);

const MISS_WORDS = {
  late: "先に別の人へ手",
  missing: "手なし",
  declined: "赤の着信を拒否",
  unknown: "並びの記録なし",
} as const;

export const RESULT_WORDS: Readonly<Record<string, string>> = {
  ringing: "呼出",
  connected: "通話",
  noLine: NO_CALL,
  closed: "休止",
  arrived: "到着",
  blocked: "通行止",
  turnedBack: "引返し",
  dispatched: "手配済",
  noDispatch: "手配不可",
  accepted: "受入",
  refused: "断られた",
  reported: "報告済",
  evacuated: "避難済",
  noted: "記録済",
  done: "実施",
  unchanged: "変化なし",
  noAnswer: "応答なし",
  silent: "無言",
  noNumber: "番号なし",
};

/** 空振りの理由の言い方（講評の入力。手の履歴の事実と同じ言葉） */
export const WASTE_WORDS: Readonly<Record<WasteWhy, string>> = {
  phone: `家の電話 ${NO_CALL}`,
  road: "道 通行止",
  staff: "職員 0",
  closed: "頼り先の施設 休止",
  nurse: "訪問看護 来られない",
};

/**
 * 手の言葉。自由対応は「自由対応（扱い: 薬手配）」（ケアマネの文は渡さない。T129 で「読み替え」から）。何も起きない文は「自由対応（変化なし）」。
 * そのままの手（T110）は「自由対応（電話 15 分: 近所の人に発電機の貸し出しを頼んだ）」（AI が伏せた文から作った 1 文。名前・町名なし）
 */
function actionName(a: Pick<ActionRecord, "kind" | "as" | "way" | "words" | "minutes" | "idle">): string {
  if (a.kind !== "free") return ACTION_LABELS[a.kind];
  // 何も起きない文（T129。「変化なし」）は何かをしたと読ませない
  if (a.idle) return `${ACTION_LABELS.free}（変化なし）`;
  if (a.as) return `${ACTION_LABELS.free}（扱い: ${ACTION_LABELS[a.as]}）`;
  if (a.way) return `${ACTION_LABELS.free}（${FREE_WAY_LABELS[a.way]} ${a.minutes} 分${a.words ? `: ${a.words}` : ""}）`;
  return ACTION_LABELS.free;
}

/** 通話の往復の間に頼まれた事（T93。その人の頼み事のうち、手を打った時刻から最後の往復の時刻まで） */
function talkAsks(a: ActionRecord, asks: ReviewContext["asks"]): string {
  if (!a.person) return "";
  const talk = talkOf(a);
  const until = Math.max(a.result?.atMinute ?? a.atMinute, ...talk.map((x) => x.minute ?? 0));
  const kinds = [...new Set((asks?.[a.person] ?? []).filter((x) => x.at >= a.atMinute && x.at <= until).map((x) => x.kind))];
  return kinds.length > 0 ? askWords(kinds) : "";
}

/** 講評の入力の文（仮名で書く。aliasOf: 台帳の id → 仮名）。数字は score の物だけ */
export function reviewText(
  ctx: ReviewContext,
  aliasOf: ReadonlyMap<string, string>,
  /** 通話の言葉を渡す前の検査（T155。伏せきれない行は null で渡さない）。無ければ言葉の欄を作らない */
  opts: { words?: (text: string) => string | null } = {},
): string {
  const who = (p: string | null | undefined) => (p && aliasOf.has(p) ? aliasOf.get(p)! : "（不明）");
  const s = ctx.score;
  const kind = scenarioOf(ctx.scenario).kind;
  const lines: string[] = [];
  lines.push(
    `想定: ${ctx.scenario === "virtual" ? VIRTUAL_WORDS : SCENE_WORDS[kind]}${ctx.scenario === "short" ? `（${SCENARIO_LABELS.short}）` : ""}。発災から 72 時間。訓練の終わり ${minuteText(s.endMinute)}（${STATUS_LABELS[ctx.status]}）`,
    `参加者: ${s.participants.map(who).join("・")}（${s.participants.length} 人）`,
    "",
    "機械で数えた結果（数え直さない）:",
  );
  // 種類ごとの要約（T141。評価の 5 回目で、順番の外れの人を 1 人 1 行で並べた入力から、指摘の大半が順番になった。種類ごとに短く並べる）
  lines.splice(lines.length - 1, 0, ...kindSummary(s, who), "");
  // 順番（外れは訳ごとにまとめる。T141）
  lines.push(`- 対応の順番の一致: ${s.order.matched}/${s.order.total}（その人への最初の手が、その時の左の表で手のまだ無い人の一番上か）`);
  for (const w of ["late", "missing", "declined", "unknown"] as const) {
    const ms = s.order.misses.filter((m) => m.why.includes(w));
    if (ms.length === 0) continue;
    const names = ms.map((m) => (w === "late" && m.expected ? `${who(m.person)}（その時の一番上は ${who(m.expected)}）` : who(m.person)));
    lines.push(`  - ${MISS_WORDS[w]} ${ms.length} 人: ${names.join("・")}`);
  }
  // 報告
  lines.push(
    s.report.minute === null
      ? `- 市役所への報告: 未報告（行政報告の手 ${s.report.tries} 回）`
      : `- 市役所への報告: 発災から ${minuteText(s.report.minute)}に届いた（行政報告の手 ${s.report.tries} 回）`,
  );
  // 様式 9
  lines.push(`- 様式 9 の空欄: ${s.form9.blanks}`);
  for (const r of s.form9.rows) lines.push(`  - ${who(r.person)}: ${r.columns.map((c) => FORM9_PLAN_LABELS[c]).join("・")}`);
  // 条件（時計の計算）と、仮想モードの結末（AI の筋書き）。同じ数に見せない（T53）
  lines.push(
    `- 条件に達した人（時計の計算。時計が切れるまでに、その人へ届いた手が無い）: ${s.reached.length}`,
  );
  for (const r of s.reached) {
    lines.push(`  - ${who(r.person)}: ${reachedText(r)}（切れた時刻 ${minuteText(r.outMinute)}、切れるまでの届かなかった手 ${r.tries}）`);
  }
  if (s.ended) {
    lines.push(`- 結末（AI の筋書き。世界が流れの中で決めた。上の時計の計算とは別の数）: ${s.ended.length}`);
    for (const e of s.ended) {
      lines.push(`  - ${who(e.person)}: ${minuteText(Math.round(e.at * 60))}${e.reason ? `（世界の事実: ${e.reason}）` : ""}`);
    }
  }
  // 着信
  const c = s.calls;
  lines.push(`- 着信: ${c.total} 件（出た ${c.answered}・出なかった ${c.declined}・未応答 ${c.open}。赤で出なかった ${c.redDeclined}）`);
  // 手の選び方（T94。内訳の数。T94 より前の採点は数え直した物が渡る）
  const n = extrasCount(s);
  const byId = new Map(ctx.actions.map((a) => [a.id, a]));
  const actLine = (id: string, m: number, kind: string, p: string | null) => `${minuteText(m)} ${byId.get(id) ? actionName(byId.get(id)!) : kind} → ${p ? who(p) : "全体"}`;
  lines.push(`- 空振り（打った時に分かっていた事実で、結果の決まっていた手）: ${n.wasted}`);
  for (const r of s.wasted?.rows ?? []) lines.push(`  - ${actLine(r.action, r.atMinute, ACTION_LABELS[r.kind], r.person)}（${WASTE_WORDS[r.why]}）`);
  lines.push(`- 重複（同じ人に同じ手を、その人の新しい連絡・状況・到着が無いまま 30 分以内にもう一度）: ${n.repeat}`);
  for (const r of s.repeat?.rows ?? []) lines.push(`  - ${actLine(r.action, r.atMinute, ACTION_LABELS[r.kind], r.person)}（前の同じ手から ${r.gap} 分）`);
  lines.push(`- 頼み事の未対応（訓練の終わりまでに済まなかった頼み事）: ${n.asksOpen}`);
  for (const r of s.asks?.rows ?? []) lines.push(`  - ${who(r.person)}: ${askWords(r.kinds)}`);
  lines.push(
    `- 通話の往復: ${n.talks}${s.talks && s.talks.calls > 0 ? `（${s.talks.calls} 件の通話${s.talks.voiced ? `。うち声で入れた言葉 ${s.talks.voiced}` : ""}）` : ""}`,
  );
  // 計画で動けた人と、計画が無く手が要った人（T130。台帳の計画の中身の名前は書かない）
  if (s.plans) {
    const acted = s.plans.rows.filter((r) => r.acted.length > 0);
    const needed = s.plans.rows.filter((r) => r.needed.length > 0);
    lines.push(`- 計画で動けた人（台帳の計画どおり、連絡が取れなくても動いた）: ${acted.length}`);
    for (const r of acted) lines.push(`  - ${who(r.person)}: ${r.acted.map((a) => PLAN_ACT_WORDS[a]).join("・")}`);
    lines.push(`- 計画が無く手が要った人（計画に無く、ケアマネの手が要った事）: ${needed.length}`);
    for (const r of needed) lines.push(`  - ${who(r.person)}: ${r.needed.map((a) => PLAN_NEED_WORDS[a]).join("・")}`);
  }
  // 指摘の候補（T130・T139。評価の 3・4 回目で指摘がいつも 8 件だった。種類ごとの数を中身に合わせる）
  const rooms = findingRooms(s);
  const roomWords = REVIEW_KINDS.filter((k) => (rooms[k] ?? 0) > 0).map((k) => `${k} ${rooms[k]}`);
  lines.push(`- 指摘の候補（種類ごと。上の機械の数の中身の数。種類ごとにこれより多く書かない。無い種類は書かない）: ${roomWords.length > 0 ? roomWords.join("・") : "なし（指摘なし）"}`);
  // 前回
  const p = ctx.previous;
  lines.push(
    p
      ? `前回（同じ事業所の前の訓練、${SCENARIO_LABELS[p.scenario]}）: 順番 ${p.order.matched}/${p.order.total}・報告 ${p.report === null ? "未報告" : minuteText(p.report)}・空欄 ${p.form9}・条件 ${p.reached}${p.ended !== undefined ? `・結末（AI） ${p.ended}` : ""}`
      : "前回: なし",
  );

  // 手の履歴と着信（時刻の順）
  lines.push(
    "",
    "手の履歴（時刻は発災から。色と順位はその手の前の左の表。［事実］はその手を打った時に分かっていた事、→ のあとは結果）:",
    ...historyLines(ctx, who),
  );

  // 人ごとの講評の要旨（T185。訓練の間に人ごとに作った物。良かった手と次に試す事だけ）
  const digests = (ctx.persons ?? []).filter((d) => aliasOf.has(d.person) && (d.good.length > 0 || d.next.length > 0));
  if (digests.length > 0) {
    lines.push("", "人ごとの講評の要旨（訓練の間に人ごとに作った物。数字は上の機械の数が正）:");
    for (const d of digests) {
      const parts = [d.good.length > 0 ? `良: ${d.good.join(" / ")}` : null, d.next.length > 0 ? `次: ${d.next.join(" / ")}` : null].filter(Boolean);
      lines.push(`- ${who(d.person)}: ${parts.join("。")}`);
    }
  }

  if (opts.words) lines.push(...talkWordsSection(ctx, who, opts.words));

  lines.push("", "状況（想定の表と監督の差し込み）:");
  if (ctx.incidents.length === 0) lines.push("- なし");
  for (const e of ctx.incidents) lines.push(`- ${minuteText(Math.round(e.at * 60))} ${e.text}${e.person && aliasOf.has(e.person) ? `（${who(e.person)}）` : ""}`);
  return lines.join("\n");
}

/**
 * 手の履歴と着信の行（時刻の順、「- 」付き）。only を渡すとその人への手と、その人の着信だけ（人ごとの講評、T185）
 */
export function historyLines(ctx: Pick<ReviewContext, "score" | "actions" | "calls" | "ticks" | "asks">, who: (p: string | null | undefined) => string, only?: string): string[] {
  const s = ctx.score;
  type Line = { at: number; order: number; text: string };
  const hist: Line[] = [];
  const wasted = new Set((s.wasted?.rows ?? []).map((r) => r.action));
  const repeated = new Set((s.repeat?.rows ?? []).map((r) => r.action));
  ctx.actions.forEach((a, i) => {
    if (only !== undefined && a.person !== only) return;
    const t = a.before.triage;
    const color = triageWord(t?.color);
    const before = a.person ? `（${[color, t?.rank != null ? `${t.rank} 位` : null].filter(Boolean).join(" ") || "色なし"}）` : "";
    const target = [a.person ? who(a.person) : "全体", a.calleeLabel].filter(Boolean).join(" ");
    // その時に分かっていた事実: 世界（電話・道・職員・施設の休止）、本人の最後の連絡、同じ人への前の手からの分
    const known = knownOf(a, ctx.ticks);
    const row = rowOf(a);
    const gap = gapBefore(ctx.actions, a);
    const facts = [
      ...factWords(known, row?.id ?? a.kind),
      ...(a.person ? [personWords(known)] : []),
      ...(gap !== null ? [`前の手から ${gap} 分`] : []),
    ];
    // 結果: 表の status の言葉と、そうなった世界の事実。向かった人の着く時刻
    let result = "返事なし";
    if (a.result) {
      result = RESULT_WORDS[a.result.status] ?? a.result.status;
      if (a.result.because) result += `（${a.result.because}）`;
      const arrive = row?.reach?.at === "arrival" ? reachedAt(a) : null;
      if (arrive !== null) result += `（着く ${minuteText(arrive)}）`;
    }
    // 通話の往復（T93）と訪問の頼み事（T93）は数と頼み事の種類だけ（言葉は渡さない）
    const turns = talkTurns(a);
    const asked = turns > 0 ? talkAsks(a, ctx.asks) : "";
    const visit = visitOf(a);
    const extra = [
      turns > 0 ? `通話 ${turns} 往復${asked ? `（頼み事: ${asked}）` : ""}` : null,
      visit && visit.asks.length > 0 ? `訪問の頼み事: ${askWords(visit.asks)}` : null,
      wasted.has(a.id) ? "空振り" : null,
      repeated.has(a.id) ? "重複" : null,
    ].filter(Boolean);
    hist.push({
      at: a.atMinute,
      order: i * 2,
      text: `${minuteText(a.atMinute)} ${actionName(a)} → ${target}${before}${facts.length > 0 ? `［事実: ${facts.join("・")}］` : ""} → ${result}${extra.length > 0 ? `・${extra.join("・")}` : ""}`,
    });
  });
  ctx.calls.forEach((x, i) => {
    if (only !== undefined && x.person !== only) return;
    const res = x.response === "answer" ? "出た" : x.response === "decline" ? "出なかった" : "未応答";
    const color = x.color === "red" ? "赤" : x.color === "green" ? "緑" : "安否不明";
    // 着信の往復（T127）は数だけ（ケアマネの文と相手の言葉は講評に渡さない）
    const rounds = (x.talk ?? []).filter((l) => l.who === "cm").length;
    hist.push({ at: x.minute, order: i * 2 + 1, text: `${minuteText(x.minute)} 着信 ${who(x.person)}（${color}）→ ${res}${rounds > 0 ? `・${rounds} 往復話した` : ""}` });
  });
  hist.sort((a, b) => a.at - b.at || a.order - b.order);
  if (hist.length === 0) return ["- なし"];
  return hist.map((h) => `- ${h.text}`);
}

/** 講評に渡す通話の言葉の行の長さと数（T155。長い会話で入力が膨らまないように） */
export const REVIEW_TALK_LINE_MAX = 80;
export const REVIEW_TALK_LINES_MAX = 60;

/**
 * 通話の言葉（T155）。外へ掛けた電話と掛かってきた電話の往復を、時刻の順に通話ごとに。自分の言葉は「自分」（声で入れた物は「自分（声）」）、
 * 相手は区分の言葉。words で検査した行だけ（伏せきれない行は渡さない）。行の数と長さに上限
 */
export function talkWordsSection(
  ctx: Pick<ReviewContext, "actions" | "calls">,
  who: (p: string | null | undefined) => string,
  words: (t: string) => string | null,
  only?: string,
): string[] {
  type Call = { at: number; head: string; talk: ReadonlyArray<TalkLine> };
  const calls: Call[] = [];
  for (const a of ctx.actions) {
    const talk = a.result?.talk ?? [];
    if (talk.length === 0) continue;
    if (only !== undefined && a.person !== only) continue;
    calls.push({ at: a.atMinute, head: `${minuteText(a.atMinute)} 発信 ${who(a.person)}（${a.calleeLabel ?? "相手"}）`, talk });
  }
  for (const c of ctx.calls) {
    const talk = c.talk ?? [];
    if (talk.length === 0) continue;
    if (only !== undefined && c.person !== only) continue;
    calls.push({ at: c.minute, head: `${minuteText(c.minute)} 着信 ${who(c.person)}（${c.callee?.label ?? "相手"}）`, talk });
  }
  if (calls.length === 0) return [];
  calls.sort((x, y) => x.at - y.at);
  const out = ["", "通話の言葉（自分はケアマネ。声は声で入れた言葉。相手の言葉は AI が演じた架空の人）:"];
  let n = 0;
  for (const c of calls) {
    if (n >= REVIEW_TALK_LINES_MAX) break;
    out.push(`- ${c.head}`);
    for (const l of c.talk) {
      if (n >= REVIEW_TALK_LINES_MAX) break;
      const t = words(Array.from(l.text.replace(/\s+/g, " ").trim()).slice(0, REVIEW_TALK_LINE_MAX).join(""));
      if (!t) continue;
      out.push(`  - ${l.who === "cm" ? (l.voice ? "自分（声）" : "自分") : "相手"}: 「${t}」`);
      n++;
    }
  }
  return out;
}

/** 名前を 3 人まで並べ、ほかは人数で（T141） */
function someNames(names: ReadonlyArray<string>, max = 3): string {
  const uniq = [...new Set(names)];
  return uniq.length <= max ? uniq.join("・") : `${uniq.slice(0, max).join("・")} ほか ${uniq.length - max} 人`;
}

/**
 * 種類ごとの要約（T141）。重い順に 1 種類 1 行で、数と代表の人。講評はこれを見て、種類ごとに 1 つにまとめて書く
 */
export function kindSummary(s: DrillScore, who: (p: string | null | undefined) => string): string[] {
  const n = kindCounts(s);
  const rows: Record<Exclude<ReviewKind, "other">, string> = {
    reached:
      s.reached.length > 0
        ? `条件に達した人 ${s.reached.length} 人（${someNames(s.reached.map((r) => who(r.person)))}）`
        : "条件に達した人 なし",
    order: `対応の順番 一致 ${s.order.matched}/${s.order.total}${s.order.misses.length > 0 ? `、外れ ${s.order.misses.length} 人（${someNames(s.order.misses.map((m) => who(m.person)))}）` : ""}`,
    call: `着信 ${s.calls.total} 件（未応答 ${s.calls.open}・赤で出なかった ${s.calls.redDeclined}）`,
    choice: `手の選び方 空振り ${s.wasted?.rows.length ?? 0}・重複 ${s.repeat?.rows.length ?? 0}・頼み事の未対応 ${s.asks?.rows.length ?? 0} 人・計画が無く手が要った人 ${s.plans?.needed ?? 0}`,
    report: s.report.minute === null ? "市役所への報告 未報告" : `市役所への報告 ${minuteText(s.report.minute)}${s.report.minute > REPORT_LATE_MINUTES ? `（${REPORT_LATE_MINUTES / 60} 時間より後）` : ""}`,
    blank: s.form9.rows.length > 0 ? `様式 9 の空欄 ${s.form9.rows.length} 人（${someNames(s.form9.rows.map((r) => who(r.person)))}）` : "様式 9 の空欄 なし",
  };
  return [
    "種類ごとの要約（重い順。指摘は種類ごとに 1 つにまとめる）:",
    ...REVIEW_WEIGHT.filter((k) => k !== "other").map((k) => `- ${k}: ${rows[k as Exclude<ReviewKind, "other">]}${(n[k] ?? 0) === 0 ? "（直す所なし）" : ""}`),
  ];
}

/**
 * 種類ごとの指摘の候補の数（T139）。機械で数えた中身から: order 順番の外れ・report 市役所への報告（未報告と報告の時刻。いつも 1）・
 * blank 様式 9 の空欄の人・reached 条件に達した人・call 赤の着信に出ない／未応答・choice 空振りと重複の人・頼み事の未対応の人・計画が無く手が要った人・
 * other ほかの種類に何かあれば 1（前の「中身の数 ＋ 1」の 1）。0 の種類は書かない
 */
export function findingRooms(s: DrillScore): Partial<Record<ReviewKind, number>> {
  const n = kindCounts(s);
  // 重い順に、種類ごとの上限（KIND_ROOM）まで、合わせて REVIEW_LIMIT まで（T141。同じ種類は 1 つにまとめる）
  const out: Partial<Record<ReviewKind, number>> = {};
  let left = REVIEW_LIMIT;
  for (const k of REVIEW_WEIGHT) {
    const room = Math.min(n[k] ?? 0, KIND_ROOM[k], left);
    if (room > 0) {
      out[k] = room;
      left -= room;
    }
  }
  return out;
}

/**
 * 種類ごとの中身の数（T141。機械で数えた物から）。order 順番の外れ・report 未報告か遅い報告（REPORT_LATE_MINUTES より後）・
 * blank 様式 9 の空欄の人・reached 条件に達した人・call 赤の着信に出ない／未応答・choice 空振りと重複の人・頼み事の未対応の人・計画が無く手が要った人
 */
export function kindCounts(s: DrillScore): Partial<Record<ReviewKind, number>> {
  const people = (rows: ReadonlyArray<{ person: string | null }> | undefined) => new Set((rows ?? []).map((r) => r.person ?? "全体")).size;
  const n = {
    reached: s.reached.length,
    order: s.order.misses.length,
    call: s.calls.redDeclined + s.calls.open > 0 ? 1 : 0,
    choice: people(s.wasted?.rows) + people(s.repeat?.rows) + (s.asks?.rows.length ?? 0) + (s.plans?.needed ?? 0),
    report: s.report.minute === null || s.report.minute > REPORT_LATE_MINUTES ? 1 : 0,
    blank: s.form9.rows.length,
  };
  // ほかの種類（other）は、直す所が何かあるときだけ 1 つ（いちばん軽い。空きがあれば）
  return { ...n, other: Object.values(n).some((x) => x > 0) ? 1 : 0 };
}

/**
 * 指摘にしてよい数（T130）。機械で数えた中身のうち、直す所の数（人ごと・全体ごと）。順番の外れ・未報告・様式 9 の空欄の人・条件に達した人・
 * 赤の着信に出なかった・未応答・空振りと重複の人・頼み事の未対応の人・計画が無く手が要った人。何かあれば手の選び方の 1 つを足す。
 * 何も無ければ 0（指摘なし）。FINDINGS_MAX を超えない
 */
export function findingRoom(s: DrillScore): number {
  // 種類ごとの候補の合計（T139・T141。重い順に REVIEW_LIMIT まで）
  const n = Object.values(findingRooms(s)).reduce((x, k) => x + (k ?? 0), 0);
  return Math.min(FINDINGS_MAX, REVIEW_LIMIT, n);
}

// ---------- 返事の検査 ----------

/**
 * 講評に書かせない言葉。検査の前に NFKC（全角の英数字を半角に）を掛け、英字は大文字・小文字を区別しない。
 * - 言い切り・生き死に: 診断・判定・重症・危険・疑い・死・亡くな・心停止・意識…
 * - 病名・状態: 低血糖・高血糖・血栓・塞栓・脱水・熱中症・低体温・肺炎・感染・発作・急変・悪化・容体・症状・病名・呼吸が止まる/苦しい
 * - 機器の状態の言い切り: 電池が切れた・ボンベが空・機器/呼吸器/濃縮器が止まった・尽きた
 * - 薬の量: 投与・処方・用量・服用・服薬・増量・減量・mg・ミリグラム・単位・錠・mL・L/分・リットル
 * - 医療の助言: 受診・注射・点滴・流量・血糖値・血圧・水分・飲む/飲ませる・脚を動かす・安静・やめない・薬を続ける・医療者に相談・購入・買う
 */
export const REVIEW_BANNED = new RegExp(
  [
    "診断|判定|重症|緊急度|優先度|札|危険|危な|疑い|疑われ|おそれ|恐れ|病気が(?:わか|分か)|死|亡くな|心肺停止|心停止|意識が(?:ない|無い)|意識不明",
    "低血糖|高血糖|血栓|塞栓|脱水|熱中症|低体温|肺炎|感染|発作|急変|悪化|容[体態]|症状|病名|呼吸が?(?:止|苦)|体調|具合|衰弱|息苦し|発熱|出血",
    "電池が切れ(?:た|て)|電池切れ|酸素が止ま|ボンベが(?:空|切れ)|尽き|(?:機器|呼吸器|濃縮器)が止ま",
    "投与|処方|用量|薬の量を|量を(?:減|増)|中止|冷や(?:して|す)|服用|服薬|増量|減量|mg|ミリグラム|単位|錠|ml|l/分|リットル",
    "受診|注射|点滴|流量|血糖値|血圧|水分|飲ん|飲ま|飲む|脚を動か|安静|やめない|薬を続け|医療者に相談|購入|買っ|買う",
  ].join("|"),
  "i",
);

/** 書かせない言葉に掛かるか（NFKC のあと） */
export function reviewBanned(text: string): boolean {
  return REVIEW_BANNED.test(text.normalize("NFKC"));
}

/**
 * 文 1 つの検査: 空・使わない言葉・元の情報（台帳の名前・電話）が残る物は null。作った名前・住所の形は伏せ字に（T74 の続き）。
 * 仮名は氏名に戻し、長さで切る
 */
export function reviewWords(raw: string, key: PseudonymKey, max: number): string | null {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (reviewBanned(t)) return null;
  const masked = maskReply(t, key);
  if (masked === null) return null;
  return Array.from(restoreText(masked, key)).slice(0, max).join("");
}

/**
 * 数文の文の検査（T185。人ごとの講評・項目ごとの文）。「。」・改行で割り、使わない言葉に掛かった文だけ捨てる（1 語で全部を落とさない）。
 * 残りの文をつないで reviewWords に通す。何も残らなければ null
 */
export function reviewSentences(raw: string, key: PseudonymKey, max: number): string | null {
  const parts = raw
    .split(/(?<=[。！？\n])/)
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter((x) => x && !reviewBanned(x));
  if (parts.length === 0) return null;
  return reviewWords(parts.join(""), key, max);
}

const isReviewTopic = (v: string): v is ReviewTopic => (REVIEW_TOPICS as readonly string[]).includes(v);

/** 項目ごとの文と良かった所を読む（T185）。知らない項目・重ねた項目・検査に掛かった文は捨て、項目の順に並べる */
export function reviewSections(
  answer: Pick<ReviewAnswer, "sections" | "good">,
  key: PseudonymKey,
): { sections: ReviewSection[]; good: string[] } {
  const got = new Map<ReviewTopic, string>();
  for (const s of answer.sections ?? []) {
    const topic = s.topic.trim();
    if (!isReviewTopic(topic) || got.has(topic)) continue;
    const text = reviewSentences(s.text, key, SECTION_TEXT_MAX);
    if (text) got.set(topic, text);
  }
  const sections = REVIEW_TOPICS.filter((t) => got.has(t)).map((t) => ({ topic: t, text: got.get(t)! }));
  const good: string[] = [];
  for (const g of answer.good ?? []) {
    if (good.length >= GOOD_MAX) break;
    const text = reviewSentences(g, key, GOOD_TEXT_MAX);
    if (text && !good.some((x) => sameWording(x, text))) good.push(text);
  }
  return { sections, good };
}

const isReviewKind = (v: string): v is ReviewKind => (REVIEW_KINDS as readonly string[]).includes(v);

/**
 * 返事を講評にする。知らない仮名・登録簿に無い根拠・検査に掛かった文の指摘は捨てる。kind が一覧の外なら other。
 * members は参加者（仮名を戻す先）。summary が検査に掛かれば空
 */
export function reviewBody(
  answer: ReviewAnswer,
  ctx: { key: PseudonymKey; members: ReadonlySet<string>; max?: number; rooms?: Partial<Record<ReviewKind, number>> },
): ReviewBody {
  const findings: ReviewFinding[] = [];
  // 指摘の数は中身に合わせる（T130。findingRoom。無ければ FINDINGS_MAX まで）
  const max = Math.min(FINDINGS_MAX, ctx.max ?? FINDINGS_MAX);
  for (const f of answer.findings) {
    if (findings.length >= max) break;
    const target = f.person.trim();
    let person: string | null = null;
    if (target !== "全体" && target !== "") {
      person = personOfAlias(target, ctx.key);
      if (!person || !ctx.members.has(person)) continue;
    }
    const b = f.basis.trim();
    let basis: SourceId | null = null;
    if (b !== NO_BASIS && b !== "") {
      if (!isSourceId(b) || !REVIEW_SOURCES.includes(b)) continue;
      basis = b;
    }
    const text = reviewWords(f.text, ctx.key, FINDING_TEXT_MAX);
    if (!text) continue;
    const k = f.kind.trim();
    const kind: ReviewKind = isReviewKind(k) ? k : "other";
    // 同じ人・同じ種類で同じ言い回しの指摘を重ねない（T130。数を埋めた形）
    if (findings.some((x) => x.person === person && x.kind === kind && sameWording(x.text, text))) continue;
    // 種類ごとの候補の数まで（T139。rooms が無ければ見ない。other は候補に無いので rooms があれば使わない）
    if (ctx.rooms && findings.filter((x) => x.kind === kind).length >= (ctx.rooms[kind] ?? 0)) continue;
    findings.push({ person, kind, text, basis });
  }
  // 重い順に並べる（T141。同じ種類の中は返った順）
  const rank = (k: ReviewKind) => (REVIEW_WEIGHT.indexOf(k) < 0 ? REVIEW_WEIGHT.length : REVIEW_WEIGHT.indexOf(k));
  const ordered = findings.map((f, i) => ({ f, i })).sort((a, b) => rank(a.f.kind) - rank(b.f.kind) || a.i - b.i).map((x) => x.f);
  // 項目ごとの文と良かった所（T185。残った物だけ。無ければ前の形のまま）
  const { sections, good } = reviewSections(answer, ctx.key);
  return {
    summary: reviewWords(answer.summary, ctx.key, SUMMARY_MAX) ?? "",
    findings: ordered,
    ...(sections.length > 0 ? { sections } : {}),
    ...(good.length > 0 ? { good } : {}),
  };
}

// ---------- 呼び口 ----------

export type ReviewDeps = {
  /** 事業所の本人の台帳（仮名化の前）。lib/drill/persona.ts の loadPersonaSources */
  sources: ReadonlyMap<string, PseudonymInput>;
  ai: AskJsonContext;
  /** 年齢を数える日（JST、YYYY-MM-DD） */
  on?: string;
};

export type ReviewOutcome = { ok: true; body: ReviewBody; model: string } | { ok: false; error: ReviewError };

export function reviewError(e: unknown): ReviewError | null {
  if (e instanceof AiNotConfigured) return "not_configured";
  if (e instanceof AiLimitReached) return "limit";
  if (e instanceof AiRefused) return "refused";
  if (e instanceof AiBadOutput) return "bad_output";
  if (e instanceof AiCallFailed) return "failed";
  if (e instanceof PseudonymLeakError) return "leak";
  return null;
}

/**
 * 講評を 1 回作る。参加者を並びの順に A さん・B さん…と伏せ、記録の文を pseudonymizeText に通して Opus に渡す。
 * 指摘も要約も残らなければ形の違い（bad_output）
 */
/**
 * 講評の仮名の鍵（参加者を並びの順に A さん・B さん…）。全体の講評と人ごとの講評（T185）で同じ仮名になる
 */
export function reviewKeyOf(
  deps: Pick<ReviewDeps, "sources" | "on"> & { ai: Pick<AskJsonContext, "office"> },
  participants: ReadonlyArray<string>,
): { key: PseudonymKey; members: string[]; aliasOf: Map<string, string> } {
  const members = participants.filter((p) => deps.sources.has(p));
  const list = members.map((p) => deps.sources.get(p)!);
  // 町名は地区の別名で渡す（T88。記録の文の町名〔世界の出来事・結末の理由〕も、参加者の台帳の町名から作った別名に）
  const places = officePlaces(deps.ai.office.id, list.map((x) => x.ledger));
  const { key } = pseudonymize(list, { ...(deps.on ? { on: deps.on } : {}), places });
  return { key, members, aliasOf: new Map(key.people.map((p) => [p.personId, p.alias])) };
}

export async function createReview(deps: ReviewDeps, ctx: ReviewContext): Promise<ReviewOutcome> {
  try {
    const { key, members, aliasOf } = reviewKeyOf(deps, ctx.score.participants);
    // 通話の言葉（T155）は 1 行ずつ伏せられるかを見て、伏せきれない行は渡さない（講評ごと止めない）
    const record = pseudonymizeText(reviewText(ctx, aliasOf, { words: (t) => maskReply(t, key) }), key);
    const r = await askJson(buildReviewRequest(record), deps.ai);
    const body = reviewBody(r.value, { key, members: new Set(members), max: findingRoom(ctx.score), rooms: findingRooms(ctx.score) });
    if (!body.summary && body.findings.length === 0 && !body.sections?.length) return { ok: false, error: "bad_output" };
    return { ok: true, body, model: r.model };
  } catch (e) {
    const code = reviewError(e);
    if (code) return { ok: false, error: code };
    console.error("講評に失敗", e instanceof Error ? e.name : typeof e);
    return { ok: false, error: "failed" };
  }
}

