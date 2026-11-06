// 評価の台（docs/tasks/T108.md）の機械の検査。1 回の訓練の記録（読み戻し・AI の呼び出しの記録・ai_calls）から、引っかかった所を根拠つきで出す。
// 色と順位は決めない・付け直さない（lib/triage だけ）。ここは数えるだけ。
//
// 決まりの表は今の物を読む（写さない）: 本人役の禁じる語は lib/drill の dialogue.ts（SPEECH_DIAGNOSIS・SPEECH_DANGER・CONDITION_BANNED）・
// world-apply.ts（FORBIDDEN_WORDS・REASON_MEDICAL_WORDS）、名前・電話・町名は lib/pseudonym の鍵（findLeaks）。
// 薬の量・病名・助言の形と生年月日の書き方（tools/eval/shapes.ts）は台が自分で持つ目安（docs/progress/t108.md・t118.md）。
// 層の物差しを借りると層の穴を見つけられないので、ここは層より広めに取る。
// T118: 送った中身と画面の言葉の生年月日（和暦・略記・漢数字）と、1 訓練の数え（画面の AI 残）に入らない呼び出しも数える
// T159: 画面に出た（氏名）のうち、元の生の返事のその所に名前が無かった物（伏せ過ぎ）も数える

import { ACTION_CATALOG, isCatalogAction } from "../../../lib/drill/action-catalog.ts";
import { ACTION_WAYS, actionTerm, blockOf, dayHourOf, isDark, type TermCallee, type TermFacts } from "../../../lib/drill/action-terms.ts";
import { isPhoneTurn } from "../../../lib/drill/calls.ts";
import { CONDITION_BANNED, SPEECH_DANGER, SPEECH_DIAGNOSIS } from "../../../lib/drill/dialogue.ts";
import type { InjectKind } from "../../../lib/drill/event-catalog.ts";
import { drillHeaderMark, headerMarkText } from "../../../lib/drill/header-mark.ts";
import { changeMisfit, FIT_PROFILES, fitKindOf, forbiddenFor, waterActive, wordMisfit, type FitWorld } from "../../../lib/drill/fit.ts";
import type { DrillKind, PhoneState, WorldChange, WorldState } from "../../../lib/drill/scenarios.ts";
import type { DrillScenario, HazardKind } from "../../../lib/db/types.ts";
import { bandOf, TIMELINE, type TimeBandId } from "../../../lib/drill/time-odds.ts";
import { DEMO_AREA, facilityOf, RETIRED_DEMO_NAMES, roadOf, shelterOf } from "../../../lib/drill/area.ts";
import { FORBIDDEN_WORDS, REASON_MEDICAL_WORDS } from "../../../lib/drill/world-apply.ts";
import { findLeaks, MASK_MARKS, NAME_MARK, restoreText, type PseudonymKey } from "../../../lib/pseudonym/index.ts";
import { birthIn } from "../shapes.ts";
import { DRILL_START, type LooseAction, type LooseTurn, type RunOutcome } from "./drive.ts";
import { factHits, type FactPerson } from "./facts-check.ts";
import { talkHits, type TalkNumbers } from "./talk-check.ts";
import { jaccard, personKinds } from "./diversity.ts";
import type { AiRecord, LogRecord } from "./record.ts";
import { PERSONA_ROLES, type Role } from "./roles.ts";

// ---------- 決まりの表 ----------

/** 診断の語（lib/drill/dialogue.ts の本人役の決まり） */
export const DIAGNOSIS = SPEECH_DIAGNOSIS;
/** 薬の量（数と単位、量の言葉、酸素の流量）。台が足した目安 */
export const DOSE =
  /(?:\d+(?:\.\d+)?|[一二三四五六七八九十半]+)\s*(?:mg|ミリグラム|μg|錠|カプセル|包|単位|ml|ミリリットル|cc|滴|パフ|l\/分|リットル\/分)|酸素[^。]{0,8}\d+(?:\.\d+)?\s*(?:l|リットル)|用量|増量|減量|倍量|投与|処方/i;
/** 病名らしい語（REASON_MEDICAL_WORDS の病名の所と、よく出る病名）。言い切りかは見ない */
export const DISEASE = /肺炎|脳梗塞|心筋梗塞|低血糖|高血糖|脱水症|熱中症|低体温症|感染症|血栓|塞栓|心停止|骨折|インフルエンザ|糖尿病|認知症|心不全|腎不全/;
/** 医療の助言の形（本人役が言う事ではない）。台が足した目安 */
export const ADVICE = /(?:飲ん|飲ませ|安静に|冷や|温め|横にな|測っ)(?:で|て)(?:ください|下さい)|(?:飲んだ|飲ませた|打った|増やした|減らした)(?:ほう|方)が|した方がいい|しなさい|してはいけません/;
/** 仮名（A さん）が言葉に残った（本人役の決まり 6。画面では「本人」に置き換わるはず） */
export const ALIAS_LEFT = /(?<![A-Za-z])[A-Z]{1,3}[ 　]?さん/;

export type Rule = { id: string; re: RegExp };

/** 本人役の言葉に当てる表 */
export const PERSONA_RULES: ReadonlyArray<Rule> = [
  { id: "diagnosis", re: DIAGNOSIS },
  { id: "life", re: SPEECH_DANGER },
  { id: "dose", re: DOSE },
  { id: "disease", re: DISEASE },
  { id: "advice", re: ADVICE },
  { id: "alias", re: ALIAS_LEFT },
];
/** 訪問の様子の欄（体の具合の言い切り） */
export const CONDITION_RULE: Rule = { id: "condition", re: CONDITION_BANNED };
/** 世界・監督の文（人の生き死に・診断）と結末の理由（医療の語） */
export const WORLD_RULES: ReadonlyArray<Rule> = [{ id: "life_or_diagnosis", re: FORBIDDEN_WORDS }];
export const REASON_RULE: Rule = { id: "medical_reason", re: REASON_MEDICAL_WORDS };

/** 言葉と色の食い違いの語 */
const HURT = /けが|怪我|痛い|動けな|挟まれ|閉じ込め|血が|倒れて/;
const FINE = /無事です|大丈夫です|元気です|心配いりません/;
/**
 * けがを打ち消す言い方と、人でなく物が倒れた言い方（T121。評価の 1 回目で「緑なのにけが」の誤検知のほとんどがこれ）。
 * 文から外してから HURT を見る
 */
const NOT_HURT = [
  /(?:大きな|ひどい)?(?:けが|怪我)(?:は|も|など)?(?:ない|無い|ありません|なし|なく|していません|してない|しておりません)/gu,
  /痛く(?:ない|ありません|は(?:ない|ありません))/gu,
  /挟まれ(?:ては|て)?(?:いない|いません)/gu,
  /(?:木|倒木|棚|家具|タンス|塀|ブロック|電柱|本棚|看板|物|瓶|テレビ|壁|竹|枝|家の前の[^。、]{0,6})(?:が|も)倒れ(?:て|た)/gu,
];

/** けがの言葉があるか（打ち消しと物が倒れた言い方を外して）。台が足した目安 */
export function hurtIn(text: string): boolean {
  let t = text.normalize("NFKC");
  for (const re of NOT_HURT) t = t.replace(re, "");
  return HURT.test(t);
}

// ---------- 引っかかった所 ----------

export type CheckHit = {
  check: "world_place" | "banned" | "shape" | "leak" | "overmask" | "contradiction" | "time_odds" | "stop" | "op_failed" | "budget" | "terms" | "fit" | "free" | "facts" | "talk" | "persons";
  rule: string;
  /** banned: raw（モデルの生の返事）か shown（画面に出た物） */
  where?: "raw" | "shown" | "sent";
  role?: Role | string;
  /** 根拠の記録の番号（JSON Lines の seq） */
  seq?: number;
  person?: string | null;
  /** 発災からの分 */
  minute?: number | null;
  evidence: string;
};

const excerpt = (text: string, at: number, len = 24) => {
  const chars = Array.from(text);
  const i = Array.from(text.slice(0, Math.max(0, at))).length;
  return chars.slice(Math.max(0, i - len), i + len).join("");
};

function ruleHits(text: string, rules: ReadonlyArray<Rule>): Array<{ rule: string; evidence: string }> {
  const out: Array<{ rule: string; evidence: string }> = [];
  for (const r of rules) {
    const m = new RegExp(r.re.source, r.re.flags.replace("g", "")).exec(text.normalize("NFKC"));
    if (m) out.push({ rule: r.id, evidence: excerpt(text.normalize("NFKC"), m.index) });
  }
  return out;
}

/** 仮名化の層の漏れの見張り（findLeaks）が返す「敬称つきの名前」 */
const HONORIFIC_NAME = "敬称つきの名前";
/** 仮名化の層の漏れの見張り（findLeaks）が返す「名前らしい並び」 */
const NAME_LIKE = "名前らしい並び";
/**
 * 名前でないかなの言葉（行頭の言葉・続柄の「の」のあとの言葉。T139 の台の誤検知）。台が足した目安。かなの名前の形（続柄の「の」のあと・行頭の呼びかけ）に
 * 当たる言葉だけを外す（外したあとも名前が残れば拾う）
 */
const NOT_NAME_KANA =
  /(?:ひとまず|とりあえず|ここから|そこから|それから|これから|いまから|いま|まだ|もう|すこし|ちょっと|ゆっくり|しばらく|なんとか|やっと|ずっと|みんな|あの|その|えっと|ええと|あのう|はい|いいえ|うん|ほう|うち|よう|ため|こと|もの|へん|かた)(?=[、，,！!：:のでがはもにへとをや]|$)|(?:ところ|まわり|あたり|そば)/gu;
/** 「様」が人の名前の敬称でない言葉（様子・同様・模様・様々。T139 の台の誤検知） */
const NOT_NAME_SAMA = /様子|同様|模様|仕様|様々|様式|様態|お客様|皆様|皆さま|みなさま|ご家族様|奥様|旦那様|神様|仏様/gu;

/** 役・続柄・商いの呼び名に付いた敬称（人の名前でない）。台が足した目安 */
const ROLE_HONORIFIC =
  /(?:ケアマネ|ヘルパー|看護師|看護婦|民生委員|お医者|医者|先生|職員|業者|配達|運転手|大家|管理人|消防|救急隊|役所|お隣|隣|近所|ご近所|娘|息子|嫁|孫|兄|姉|弟|妹|おばあ|おじい|お母|お父|叔母|叔父|伯母|伯父|おば|おじ|奥|旦那|(?:酸素|薬|電気|米|魚|八百|酒|肉|パン|花|布団|ガス|灯油|燃料|水道)屋|[\p{Script=Han}\p{Script=Katakana}ー]{1,8}(?:屋|店|会社|業者|事業所|センター|病院|医院|薬局|局))(?:さん|さま|様|ちゃん|くん)/gu;

/**
 * 鍵の秘密（名前・カナ・町名・生年月日）と電話の形。町名を除くか（画面の文は町名に戻すので）。
 * 生年月日は台の表（tools/eval/shapes.ts の birthVariants。和暦・略記・漢数字）でも見る（T118。層の findLeaks を借りない）
 */
function leakHits(
  text: string,
  key: PseudonymKey,
  opts: { towns: boolean; extra?: ReadonlyArray<{ value: string; what: string }>; births?: ReadonlyArray<{ iso: string; what: string }> },
): Array<{ rule: string; evidence: string }> {
  let found = findLeaks(text, key).filter((w) => opts.towns || !/町名/.test(w));
  // 役の呼び名に付いた敬称（酸素屋さん・ケアマネさん・民生委員さん）は人の名前でない（T121。台の誤検知）。外して見直す
  if (found.includes(HONORIFIC_NAME)) {
    const again = findLeaks(text.replace(ROLE_HONORIFIC, "　").replace(NOT_NAME_SAMA, "　"), key);
    if (!again.includes(HONORIFIC_NAME)) found = found.filter((w) => w !== HONORIFIC_NAME);
  }
  // 名前らしい並びの形が、行頭の言葉（「ひとまず、」「ここから、」）や続柄の「の」のあとの言葉（「母のところ」）を拾った（T139。台の誤検知）。外して見直す
  if (found.includes(NAME_LIKE)) {
    const again = findLeaks(text.replace(NOT_NAME_KANA, "　"), key);
    if (!again.includes(NAME_LIKE)) found = found.filter((w) => w !== NAME_LIKE);
  }
  const out = found.map((what) => {
    const s = key.secrets.find((x) => x.what === what && text.includes(x.value));
    return { rule: `personal:${what}`, evidence: s ? excerpt(text, text.indexOf(s.value)) : "" };
  });
  for (const x of opts.extra ?? []) if (x.value && text.includes(x.value)) out.push({ rule: `personal:${x.what}`, evidence: excerpt(text, text.indexOf(x.value)) });
  for (const b of opts.births ?? []) {
    const hit = birthIn(text, b.iso);
    if (hit && !out.some((o) => o.rule === `personal:${b.what}`)) out.push({ rule: `personal:${b.what}`, evidence: hit });
  }
  return out;
}

/** 返った JSON の言葉の欄（本人役・通話・往復・訪問、世界・監督） */
function wordsOf(role: Role, value: unknown): Array<{ field: string; text: string }> {
  const v = (value ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof v[k] === "string" ? [{ field: k, text: v[k] as string }] : []);
  if (role === "persona") {
    // まとめて呼んだ本人役（T121）は answers の並び
    if (Array.isArray(v.answers)) return (v.answers as Array<Record<string, unknown>>).flatMap((a, i) => wordsOf(role, a).map((w) => ({ field: `answers.${i}.${w.field}`, text: w.text })));
    return [...s("speech"), ...s("condition"), ...s("action")];
  }
  if (role === "persona_call" || role === "persona_talk") return s("speech");
  if (role === "persona_visit") return [...s("speech"), ...s("condition")];
  if (role === "director") {
    const ev = Array.isArray(v.events) ? (v.events as Array<Record<string, unknown>>) : [];
    return ev.flatMap((e, i) => (typeof e.text === "string" ? [{ field: `events.${i}.text`, text: e.text }] : []));
  }
  if (role === "world" || role === "world_room") {
    const steps = role === "world_room" ? (Array.isArray(value) ? (value as unknown[]) : []) : [value];
    return steps.flatMap((st, k) => {
      const w = (st ?? {}) as Record<string, unknown>;
      const fw = Array.isArray(w.farewells) ? (w.farewells as Array<Record<string, unknown>>) : [];
      return [
        ...(typeof w.narration === "string" ? [{ field: `${k}.narration`, text: w.narration }] : []),
        ...fw.flatMap((f, i) => [
          ...(typeof f.text === "string" ? [{ field: `${k}.farewells.${i}.text`, text: f.text }] : []),
          ...(typeof f.reason === "string" ? [{ field: `${k}.farewells.${i}.reason`, text: f.reason }] : []),
        ]),
      ];
    });
  }
  return [];
}

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export type CheckContext = {
  /** 事業所の全員の鍵（地区の別名つき。町名も秘密に入る） */
  key: PseudonymKey;
  /** 鍵に入らない秘密（避難先の名前など） */
  extra: ReadonlyArray<{ value: string; what: string }>;
  /** 台帳の生年月日（台の表で和暦・略記・漢数字の書き方も見る。T118） */
  births?: ReadonlyArray<{ iso: string; what: string }>;
  /** 本人ごとの台帳のハザード（区域の種類。T125 の想定に合わない物の検査） */
  hazards?: Readonly<Record<string, ReadonlyArray<HazardKind>>>;
  /** 本人ごとの携帯（スマホを含む）の有無（T125。家の電話の印でも携帯でかけられる） */
  mobile?: Readonly<Record<string, boolean>>;
  /** 本人ごとの計画・同居・家族・ハザード（T130 の帳面の検査。無ければ帳面の検査をしない） */
  facts?: Readonly<Record<string, FactPerson>>;
};

type ShownWord = { text: string; person: string | null; minute: number | null; field: string };

/** 画面に出た本人役の言葉（刻みの安否の言う事・する事、手の返事の言葉・往復・訪問） */
function shownWords(outcome: RunOutcome): ShownWord[] {
  const shown: ShownWord[] = [];
  for (const t of outcome.replay?.ticks ?? []) {
    for (const u of t.turns) {
      const minute = Math.round((u.at ?? t.hour) * 60);
      if (u.saying) shown.push({ text: u.saying, person: u.person ?? null, minute, field: "saying" });
      if (u.doing) shown.push({ text: u.doing, person: u.person ?? null, minute, field: "doing" });
    }
  }
  for (const a of outcome.replay?.actions ?? []) {
    const r = a.result;
    if (!r) continue;
    const minute = r.atMinute ?? null;
    if (r.speech) shown.push({ text: r.speech, person: a.person ?? null, minute, field: "call.speech" });
    for (const l of r.talk ?? []) if (l.who !== "cm" && l.text) shown.push({ text: l.text, person: a.person ?? null, minute, field: "talk" });
    if (r.visit?.speech) shown.push({ text: r.visit.speech, person: a.person ?? null, minute, field: "visit.speech" });
    if (r.visit?.condition) shown.push({ text: r.visit.condition, person: a.person ?? null, minute, field: "visit.condition" });
  }
  return shown;
}

/** 1. 本人役の禁じる中身（生の返事と、画面に出た物）。世界・監督の文の禁じる語も */
export function bannedHits(records: ReadonlyArray<LogRecord>, outcome: RunOutcome, ctx: CheckContext): CheckHit[] {
  const hits: CheckHit[] = [];
  for (const r of records) {
    if (r.type !== "ai") continue;
    const a = r as AiRecord;
    if (!a.returned) continue;
    const value = parse(a.returned.text);
    if (value === null) continue;
    for (const w of wordsOf(a.role, value)) {
      if (PERSONA_ROLES.has(a.role)) {
        const rules = w.field === "condition" && a.role === "persona_visit" ? [...PERSONA_RULES, CONDITION_RULE] : PERSONA_RULES;
        for (const h of [...ruleHits(w.text, rules), ...leakHits(w.text, ctx.key, { towns: false, extra: ctx.extra, births: ctx.births })]) {
          hits.push({ check: "banned", where: "raw", role: a.role, seq: a.seq, rule: h.rule, evidence: `${w.field}: ${h.evidence}` });
        }
      } else {
        const rules = /reason$/.test(w.field) ? [...WORLD_RULES, REASON_RULE] : WORLD_RULES;
        for (const h of ruleHits(w.text, rules)) hits.push({ check: "banned", where: "raw", role: a.role, seq: a.seq, rule: h.rule, evidence: `${w.field}: ${h.evidence}` });
      }
    }
  }
  // 画面に出た物
  for (const s of shownWords(outcome)) {
    for (const h of [...ruleHits(s.text, PERSONA_RULES), ...leakHits(s.text, ctx.key, { towns: false, extra: ctx.extra, births: ctx.births })]) {
      hits.push({ check: "banned", where: "shown", role: "persona", person: s.person, minute: s.minute, rule: h.rule, evidence: `${s.field}: ${h.evidence}` });
    }
  }
  return hits;
}

/** 2. 仮名の漏れ（Claude と世界の部屋に送った中身の全文） */
export function leakSentHits(records: ReadonlyArray<LogRecord>, ctx: CheckContext): CheckHit[] {
  const hits: CheckHit[] = [];
  for (const r of records) {
    const text =
      r.type === "ai"
        ? [...(r as AiRecord).sent.system, (r as AiRecord).sent.user].join("\n")
        : r.type === "room_agent"
          ? JSON.stringify(r.system ?? "")
          : null;
    if (text === null) continue;
    for (const h of leakHits(text, ctx.key, { towns: true, extra: ctx.extra, births: ctx.births })) {
      hits.push({ check: "leak", where: "sent", role: (r as AiRecord).role ?? r.type, seq: r.seq, rule: h.rule, evidence: h.evidence });
    }
  }
  return hits;
}

/** 3. 形の失敗・断られた・時間切れ・つながらない（AI の呼び出しの記録と ai_calls） */
export function shapeHits(records: ReadonlyArray<LogRecord>): CheckHit[] {
  const hits: CheckHit[] = [];
  for (const r of records) {
    if (r.type !== "ai") continue;
    const a = r as AiRecord;
    if (a.error) hits.push({ check: "shape", rule: `error:${a.error}`, role: a.role, seq: a.seq, evidence: a.attempts.map((x) => x.error ?? "ok").join(" → ") });
    else if (a.parsed === false) hits.push({ check: "shape", rule: "not_json", role: a.role, seq: a.seq, evidence: Array.from(a.returned?.text ?? "").slice(0, 40).join("") });
    else if (a.returned && a.returned.stopReason && !["end_turn", null].includes(a.returned.stopReason) && a.role !== "world_room") {
      hits.push({ check: "shape", rule: `stop:${a.returned.stopReason}`, role: a.role, seq: a.seq, evidence: "" });
    }
  }
  return hits;
}

/** 4. 時間ごとの起きやすさとの食い違い（監督の差し込みの種類が、その帯の目安の外）。合否にしない */
export function timeOddsOf(outcome: RunOutcome): { checked: number; offBand: number; hits: CheckHit[] } {
  const listed = new Map<string, TimeBandId[]>();
  for (const [band, lines] of Object.entries(TIMELINE) as Array<[TimeBandId, (typeof TIMELINE)[TimeBandId]]>) {
    for (const l of lines) for (const k of l.kinds) listed.set(k, [...new Set([...(listed.get(k) ?? []), band])]);
  }
  let checked = 0;
  const hits: CheckHit[] = [];
  for (const t of outcome.replay?.ticks ?? []) {
    for (const e of t.incidents) {
      if (!e.ai || e.actor !== "director" || typeof e.inject !== "string" || !listed.has(e.inject)) continue;
      checked += 1;
      const at = e.at ?? t.hour;
      const band = bandOf(at).id;
      const bands = listed.get(e.inject)!;
      if (!bands.includes(band)) {
        hits.push({ check: "time_odds", rule: e.inject, person: e.person ?? null, minute: Math.round(at * 60), evidence: `帯 ${band}、目安の帯 ${bands.join("・")}` });
      }
    }
  }
  return { checked, offBand: hits.length, hits };
}

/** その人に手か到着が (from, to] 分にあったか */
function helped(person: string, from: number, to: number, actions: ReadonlyArray<LooseAction>, arrivals: ReadonlyArray<{ person?: string; arrive?: number }>): boolean {
  return (
    actions.some((a) => a.person === person && a.result && typeof a.result.atMinute === "number" && a.result.atMinute > from && a.result.atMinute <= to) ||
    arrivals.some((x) => x.person === person && typeof x.arrive === "number" && x.arrive > from && x.arrive <= to)
  );
}

/**
 * 5. 矛盾（けが → 手も到着も無いまま無事、結末のあとの連絡、言葉と色の食い違い）。facts（T130）があれば、計画で移った
 * （避難先と手段・手伝う人があり、緑の家の外）も手と同じに見る（本人役の門と同じ。lib/drill/person-facts.ts の screenTurn）
 */
export function contradictionHits(outcome: RunOutcome, facts?: Readonly<Record<string, FactPerson>>): CheckHit[] {
  const hits: CheckHit[] = [];
  const r = outcome.replay;
  if (!r) return hits;
  const byPerson = new Map<string, Array<LooseTurn & { at: number }>>();
  for (const t of r.ticks) for (const u of t.turns) if (u.person) byPerson.set(u.person, [...(byPerson.get(u.person) ?? []), { ...u, at: u.at ?? t.hour }]);
  const arrivals = Array.isArray(r.world.arrivals) ? r.world.arrivals : [];
  const ended = r.world.ended ?? {};
  for (const [person, turns] of byPerson) {
    turns.sort((a, b) => a.at - b.at);
    for (let i = 0; i < turns.length; i++) {
      const u = turns[i];
      const minute = Math.round(u.at * 60);
      const end = ended[person]?.at;
      if (typeof end === "number" && u.at > end) hits.push({ check: "contradiction", rule: "after_end", person, minute, evidence: `結末 ${Math.round(end * 60)} 分のあとに ${u.color}` });
      if (u.color === "green" && u.saying && hurtIn(u.saying)) hits.push({ check: "contradiction", rule: "green_but_hurt", person, minute, evidence: u.saying });
      if (u.color === "red" && u.saying && FINE.test(u.saying) && !hurtIn(u.saying)) hits.push({ check: "contradiction", rule: "red_but_fine", person, minute, evidence: u.saying });
      const next = turns[i + 1];
      // ふだんから動けない人（寝たきり・歩行 困難）の「動けない」はけが・閉じ込めでないので見ない（T139。本人役の門 person-facts.ts の hurt と同じ）
      const immobile = facts?.[person]?.plan.immobile === true;
      if (next && u.color === "red" && (u.injured === true || (u.canMove === false && !immobile)) && next.color === "green") {
        const to = Math.round(next.at * 60);
        const plan = facts?.[person]?.plan;
        const planMoved = !!plan?.move && plan.helper && (next.whereNow === "shelter" || next.whereNow === "other");
        if (!helped(person, minute, to, r.actions, arrivals) && !planMoved) {
          hits.push({ check: "contradiction", rule: "hurt_to_safe", person, minute: to, evidence: `${minute} 分に赤（${u.injured === true ? "けが" : "動けない"}）→ ${to} 分に緑、間に手・到着なし` });
        }
      }
    }
  }
  return hits;
}

/** 文の途中で終わったと見る長さ（字。これより短い言葉は句点が無くても切れたと見ない。T139） */
export const CUT_MIN = 50;
const SENTENCE_END = /[。！？!?」』）)…]$/u;

/**
 * 本人役の言葉が文の途中で終わった数（T139。評価の 4 回目で、上限 60 字で切れたまま画面に出た）。画面に出た言う事・する事・通話・往復・訪問の言葉のうち、
 * CUT_MIN 字以上で文の終わり（句点・感嘆・疑問・閉じかっこ・「…」）で終わらない物
 */
export function cutHits(outcome: RunOutcome): { checked: number; hits: CheckHit[] } {
  const hits: CheckHit[] = [];
  let checked = 0;
  const see = (text: string | null | undefined, person: string | null, minute: number | null, field: string) => {
    if (!text) return;
    checked += 1;
    const s = text.trim();
    if (Array.from(s).length >= CUT_MIN && !SENTENCE_END.test(s)) hits.push({ check: "shape", rule: "cut_mid", person, minute, evidence: `${field}: ${Array.from(s).length} 字` });
  };
  for (const t of outcome.replay?.ticks ?? []) for (const u of t.turns) if (u.ai) see(u.saying, u.person ?? null, Math.round((u.at ?? t.hour) * 60), "saying");
  for (const a of outcome.replay?.actions ?? []) {
    const r = a.result;
    if (!r) continue;
    see(r.speech, a.person ?? null, r.atMinute ?? null, "call.speech");
    for (const l of r.talk ?? []) if (l.who !== "cm") see(l.text, a.person ?? null, r.atMinute ?? null, "talk");
    see(r.visit?.speech, a.person ?? null, r.atMinute ?? null, "visit.speech");
  }
  return { checked, hits };
}

// ---------- 伏せ過ぎ（T159） ----------

const escRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** 画面の（氏名）の前後で突き合わせに使う字数 */
const SIDE = 6;

/** 画面の文の at にある伏せ字の前後の文（ほかの伏せ字の所で切る） */
function sidesOf(text: string, at: number, len: number): { before: string; after: string } {
  let before = text.slice(Math.max(0, at - SIDE), at);
  let after = text.slice(at + len, at + len + SIDE);
  for (const m of MASK_MARKS) {
    const b = before.lastIndexOf(m);
    if (b >= 0) before = before.slice(b + m.length);
    const a = after.indexOf(m);
    if (a >= 0) after = after.slice(0, a);
  }
  // 切れた伏せ字の片（「（氏」「名）」）も外す
  before = before.replace(/^[^（]*）/u, "");
  after = after.replace(/（[^）]*$/u, "");
  return { before, after };
}

const HAN_OR_KATA = /[\p{Script=Han}\p{Script=Katakana}]/u;
const HONORIFIC_END = /(?:さん|さま|様|氏|ちゃん|くん|先生|殿)$/u;
/** 名前でない呼び名に付いた敬称（ペット・役所・続柄・物。台が持つ目安。ROLE_HONORIFIC に足りない物） */
const PLAIN_HONORIFIC =
  /^(?:お|ご)?(?:ワン|ニャン|わん|にゃん|ねこ|いぬ|猫|犬|民生|自衛隊|保健所|両親|担当者|関係者|手伝い|日|月|寺|姑|舅|向こう|客|皆|みな)(?:さん|さま|様|ちゃん|くん)$/u;
/** かなの述語・断定の語尾（です・ます・だ・だよ）。かなだけの所がこれで終われば名前でない（素の よ・ね・わ は名前の終わりにもある〔あやね・はるよ〕ので入れない） */
const KANA_PREDICATE = /(?:です|でした|でしょう?|ます|ました|ません|ない|たい|しい|かった|った|って|だ|だよ|だね|じゃ)$/u;
/** 毎日の言葉（物・所・時・あいさつ）で始まるかな。台が持つ目安 */
const KANA_PLAIN_HEAD =
  /^(?:こと|もの|ため|ほう|ところ|とこ|うち|いえ|へや|ぶん|そう|はい|いい|だめ|いや|まあ|ええ|うん|いま|けさ|ゆうべ|おととい|きょう|あした|きのう|あさ|よる|めがね|つえ|おむつ|ふとん|くすり|ごはん|みず|でんわ|くるま|ねこ|いぬ|この|その|あの|ここ|そこ)/u;

/**
 * （氏名）の元の語に名前が無かったか（台の目安。層の物差しを借りない）。台帳の秘密・仮名・敬称つきの作った名前・漢字かカナの語は
 * 名前として数える（伏せ過ぎに入れない）。名前でないと数えるのは、役・物の呼び名に付いた敬称と、かなだけで述語の語尾か毎日の言葉の物、
 * かなだけで 5 字以上の物（かなの名前は 2〜4 字）
 */
export function notNameOrigin(orig: string, ctx: Pick<CheckContext, "key" | "extra">): boolean {
  const o = orig.trim();
  if (!o) return false;
  if (ctx.key.secrets.some((x) => o.includes(x.value)) || ctx.extra.some((x) => x.value && o.includes(x.value))) return false;
  if (ALIAS_LEFT.test(o)) return false;
  if (HONORIFIC_END.test(o)) {
    const whole = (re: RegExp) => [...o.matchAll(new RegExp(re.source, "gu"))].some((m) => m[0] === o);
    return PLAIN_HONORIFIC.test(o) || whole(ROLE_HONORIFIC) || whole(NOT_NAME_SAMA);
  }
  if (HAN_OR_KATA.test(o)) return false;
  return KANA_PREDICATE.test(o) || KANA_PLAIN_HEAD.test(o) || Array.from(o).length >= 5;
}

/**
 * 画面に出た（氏名）のうち、元の生の返事のその所に名前が無かった物（T159。評価の 6 回目で「母のことです」が「母の（氏名）」で出た）。
 * 画面の（氏名）の前後の文を、本人役の生の返事（仮名・地区の別名を画面と同じく戻した物）に当て、（氏名）の所の元の語を取り出す。
 * 層の伏せ方（maskReply）を借りないので、層が変わっても前の回の記録を同じに数えられる。
 * checked は元の語を取り出せた画面の（氏名）の数、hits はそのうち元の語が名前でない物（notNameOrigin）
 */
export function overmaskHits(
  records: ReadonlyArray<LogRecord>,
  outcome: RunOutcome,
  ctx: Pick<CheckContext, "key" | "extra">,
): { checked: number; hits: CheckHit[] } {
  const raws: Array<{ text: string; seq: number }> = [];
  for (const r of records) {
    if (r.type !== "ai") continue;
    const a = r as AiRecord;
    if (!a.returned || !PERSONA_ROLES.has(a.role)) continue;
    const value = parse(a.returned.text);
    if (value === null) continue;
    for (const w of wordsOf(a.role, value)) raws.push({ text: restoreText(w.text, ctx.key), seq: a.seq });
  }
  const hits: CheckHit[] = [];
  let checked = 0;
  for (const s of shownWords(outcome)) {
    for (let p = s.text.indexOf(NAME_MARK); p >= 0; p = s.text.indexOf(NAME_MARK, p + NAME_MARK.length)) {
      const { before, after } = sidesOf(s.text, p, NAME_MARK.length);
      if (!before && !after) continue;
      const re = new RegExp(`${escRe(before)}([\\s\\S]{1,16}?)${after ? escRe(after) : "(?=[。、，！？!?」』）)\\s]|$)"}`, "u");
      let found: { orig: string; seq: number } | null = null;
      for (const r of raws) {
        const m = re.exec(r.text);
        if (m && !m[1].includes(NAME_MARK)) {
          found = { orig: m[1], seq: r.seq };
          break;
        }
      }
      if (!found) continue;
      checked += 1;
      if (notNameOrigin(found.orig, ctx)) {
        hits.push({ check: "overmask", where: "shown", rule: "name_mark", role: "persona", seq: found.seq, person: s.person, minute: s.minute, evidence: `${s.field}: ${found.orig}` });
      }
    }
  }
  return { checked, hits };
}

/** 6. 止まった・失敗した刻み（「停止」「代替」の印、要求の失敗） */
/** 実在らしい名前の形（川・橋・町・学校・公民館。世界の 1 文に地理に無い名前を書いていないかの目安。T170） */
const PLACE_NAME_LIKE = /[\p{Script=Han}ァ-ヶ]{2,8}(?:川|橋|町|小学校|中学校|公民館)/gu;

/**
 * 仮想の回の世界の文（T170）。やめた架空の地名（種の町名・白波川・架空の道と避難所）が世界の文に出ない。結末の文も見る。
 * 地理に無い実在らしい名前（off_table）は Claude が知っている名前を書いた物の目安で、本物の回で見る数
 */
export function worldPlaceHits(outcome: RunOutcome): CheckHit[] {
  if (outcome.plan.scenario !== "virtual") return [];
  const hits: CheckHit[] = [];
  const known = [
    ...DEMO_AREA.rivers,
    ...DEMO_AREA.towns.map((t) => t.town),
    ...DEMO_AREA.roads.map((r) => r.name),
    ...DEMO_AREA.shelters.map((s) => s.name),
    ...DEMO_AREA.facilities.map((f) => f.name),
    // 開始の時に読んだ実の避難所の名前（出来事に出た物）
    ...(outcome.replay?.ticks ?? []).flatMap((t) => t.incidents.flatMap((e) => (e.change?.kind === "shelter" ? [String((e.change as { label?: unknown }).label ?? "")] : []))),
  ];
  for (const t of outcome.replay?.ticks ?? []) {
    for (const e of t.incidents) {
      if (e.ai !== true && e.change?.kind !== "narration") continue;
      const text = e.text ?? "";
      const minute = Math.round((e.at ?? t.hour) * 60);
      for (const name of RETIRED_DEMO_NAMES) if (text.includes(name)) hits.push({ check: "world_place", rule: `retired:${name}`, person: e.person ?? null, minute, evidence: excerpt(text, text.indexOf(name)) });
      if (e.change?.kind !== "narration") continue;
      for (const m of text.matchAll(PLACE_NAME_LIKE)) {
        if (!known.some((k) => k.includes(m[0]) || m[0].includes(k))) hits.push({ check: "world_place", rule: "off_table", minute, evidence: excerpt(text, m.index) });
      }
    }
  }
  return hits;
}

/** 世界の返事の名前を見る種類（道・避難所・施設。地理に無い名前は lib/drill/world-apply.ts の buildEvent が捨てる） */
const NAMED_KINDS = new Set(["road", "shelter", "facility", "welfare_shelter"]);

/** 世界の返事で捨てた名前の数（T174）。total は名前のある出来事、dropped は地理に当たらず捨てた物 */
export type WorldNameNumbers = { total: number; dropped: number; byKind: Record<string, number> };

/**
 * 世界の返事の道・避難所・施設の名前のうち、地理に無くて捨てた物を数える（T174。評価の 9 回目の「数の口が無い」の口）。アプリの当て方（world-apply.ts）と同じ引き方で、
 * 記録の返事（世界の部屋と 1 回呼び）を読む。道は地区や本人を書いていれば名前が無くても通るので、捨てるのは当たる所も無い時だけ。
 * 開始の時に読んだ実の避難所は表に無いので、出来事に出た名前を地理に足して見る（当たった名前は必ず出来事に出る）
 */
export function worldNameHits(records: ReadonlyArray<AiRecord>, outcome: RunOutcome): { numbers: WorldNameNumbers; hits: CheckHit[] } {
  const numbers: WorldNameNumbers = { total: 0, dropped: 0, byKind: {} };
  const hits: CheckHit[] = [];
  const applied = new Set((outcome.replay?.ticks ?? []).flatMap((t) => t.incidents.flatMap((e) => (e.change?.kind === "shelter" ? [String((e.change as { label?: unknown }).label ?? "")] : []))));
  for (const a of records) {
    if ((a.role !== "world" && a.role !== "world_room") || !a.returned?.text) continue;
    const value = parse(a.returned.text);
    const steps = a.role === "world_room" ? (Array.isArray(value) ? (value as unknown[]) : []) : [value];
    for (const st of steps) {
      const events = (st as { events?: unknown } | null)?.events;
      for (const e of Array.isArray(events) ? (events as Array<Record<string, unknown>>) : []) {
        const kind = typeof e.kind === "string" ? e.kind : "";
        const name = typeof e.name === "string" ? e.name.trim() : "";
        if (!NAMED_KINDS.has(kind) || !name) continue;
        numbers.total += 1;
        const known =
          kind === "road"
            ? roadOf(name) !== null || !!(typeof e.town === "string" && e.town.trim()) || !!(typeof e.target === "string" && e.target.trim())
            : kind === "facility"
              ? facilityOf(name) !== null
              : shelterOf(name) !== null || applied.has(name);
        if (known) continue;
        numbers.dropped += 1;
        numbers.byKind[kind] = (numbers.byKind[kind] ?? 0) + 1;
        hits.push({ check: "world_place", rule: `dropped_name:${kind}`, seq: a.seq, evidence: name });
      }
    }
  }
  return { numbers, hits };
}

export function stopHits(outcome: RunOutcome): CheckHit[] {
  const hits: CheckHit[] = [];
  for (const t of outcome.replay?.ticks ?? []) {
    for (const e of t.incidents) {
      const kind = e.change?.kind;
      if (kind === "ai_stop") hits.push({ check: "stop", rule: `ai_stop:${String((e.change as { stopped?: unknown }).stopped ?? "")}`, minute: Math.round((e.at ?? t.hour) * 60), evidence: e.text ?? "" });
      if (kind === "world_note") hits.push({ check: "stop", rule: `world_note:${String((e.change as { state?: unknown }).state ?? "")}`, minute: Math.round((e.at ?? t.hour) * 60), evidence: e.text ?? "" });
    }
  }
  for (const o of outcome.ops) {
    if (o.ok) continue;
    // 手の決まり（T110）・AI のできないで断った手（409 blocked）は決まりどおりの断り。失敗した要求に数えない（T121）
    if (o.status === 409 && o.error === "blocked") hits.push({ check: "terms", rule: `refused:${o.op}`, evidence: "" });
    else hits.push({ check: "op_failed", rule: `${o.op}:${o.status}`, evidence: o.error ?? "" });
  }
  return hits;
}

/** 手の打つ前の事実（手の記録の before。読む所だけ） */
type LooseBefore = { phone?: PhoneState; roadClosed?: boolean; staff?: number; marks?: Record<string, number | undefined> };

/**
 * 7. 手の決まり（T110 の terms、T121）。夜・停電・通行止め・電話の様子で押せない手が打てていないか（打つ前の事実 before から決まりの表
 * TERM_RULES で見直す）と、夜の訪問の所要が夜の足し分を含むか。開始に決まりを送った訓練では 0 のはず。送らない訓練は、送っていれば
 * 押せなかった手の数（比べるため）。浸水・施設の休止・出勤遅れ・電池は打つ前の記録に無いので見ない
 */
export function termHits(outcome: RunOutcome, ctx: Pick<CheckContext, "mobile"> = {}): CheckHit[] {
  const hits: CheckHit[] = [];
  const startedAt = new Date(DRILL_START).toISOString();
  for (const a of outcome.replay?.actions ?? []) {
    const kind = a.kind === "free" ? a.as : a.kind;
    if (!a.result || typeof kind !== "string" || !isCatalogAction(kind) || typeof a.atMinute !== "number") continue;
    const b = (a.before ?? {}) as LooseBefore;
    const marks = b.marks ?? {};
    const facts: TermFacts = {
      dark: isDark(dayHourOf(startedAt, a.atMinute, outcome.plan.night)),
      // 打つ前の記録の電話は本人の家の電話（家の電話の不通の印があれば不通。lib/drill/scenarios.ts の phoneOf）。印があるときは
      // 世界の電話が分からないので、家の電話の決まり（line_down）だけで見る
      phone: marks.lineDown !== undefined ? "ok" : (b.phone ?? "ok"),
      lineDown: marks.lineDown !== undefined,
      // 本人の家の通信（T125）: 打つ前の記録には家の電話の印だけ（停電の家の固定電話・電波は見ない）。携帯のある人は家の電話の印でもかけられる
      selfLine: marks.lineDown !== undefined && !(a.person && ctx.mobile?.[a.person]) ? "noCall" : "ok",
      selfMobile: "ok",
      radioAll: false,
      officeEvac: false,
      roadClosed: b.roadClosed === true,
      flood: false,
      staff: typeof b.staff === "number" ? b.staff : 1,
      nurseAway: marks.nurseAway !== undefined,
      closed: [],
      battery: false,
      late: false,
    };
    const term = actionTerm(kind, facts, { on: true });
    const callee = typeof a.callee === "string" ? (a.callee as TermCallee) : null;
    const block = blockOf(term, callee);
    const minute = a.atMinute;
    if (block) hits.push({ check: "terms", rule: `ran:${block}`, person: a.person ?? null, minute, evidence: `${kind}${callee ? `（${callee}）` : ""}` });
    else if (outcome.terms === true && facts.dark && ACTION_WAYS[kind] === "visit" && typeof a.minutes === "number" && a.minutes < term.minutes) {
      hits.push({ check: "terms", rule: "dark_minutes", person: a.person ?? null, minute, evidence: `${kind} ${a.minutes} 分（夜の決まりで ${term.minutes} 分以上）` });
    }
  }
  return hits;
}

// ---------- 想定に合わない物（T125） ----------

/** 文に残った内部の名前（手の id・英字の決まりの名前。画面に出さない物）。台が足した目安 */
export const INTERNAL_ID = /(?<![A-Za-z0-9])(?:[a-z][a-z0-9]*_[a-z0-9_]+|free|note)(?![A-Za-z0-9])/;

/** 区切りの順に世界の要る所だけを当てた跡（発災からの分 → その時の状態）。電話・電波も */
type FitTrack = Array<{ minute: number; w: FitWorld & { phone: string; radio: string; flooded?: string[] } }>;

const fitStart = (): FitWorld & { phone: string; radio: string; flooded?: string[] } => ({
  flood: false,
  alertLevel: null,
  quake: null,
  tsunami: "none",
  notes: {},
  weather: null,
  phone: "ok",
  radio: "ok",
});

/** 状況 1 つを当てる（台の写し。世界の当て方 lib/drill/scenarios.ts の要る所だけ） */
function foldFit(w: FitWorld & { phone: string; radio: string; flooded?: string[] }, c: { kind?: string; [k: string]: unknown }): FitWorld & { phone: string; radio: string; flooded?: string[] } {
  switch (c.kind) {
    case "town_flood": {
      // 町の浸水（仮想）の家の人は、家の辺りの浸水の印（手の所要の「浸水」の元）
      const persons = Array.isArray(c.persons) ? c.persons.filter((p): p is string => typeof p === "string") : [];
      return { ...w, flooded: [...new Set([...(w.flooded ?? []), ...persons])] };
    }
    case "alert":
      return { ...w, alertLevel: (c.level as 3 | 4 | 5 | null) ?? null };
    case "quake":
      return { ...w, quake: String(c.intensity ?? "") || w.quake };
    case "tsunami":
      return { ...w, tsunami: (c.state as FitWorld["tsunami"]) ?? w.tsunami };
    case "flood":
      return { ...w, flood: true };
    case "phone":
      return { ...w, phone: String(c.state ?? w.phone) };
    case "radio":
      return { ...w, radio: String(c.state ?? w.radio) };
    case "weather":
      return { ...w, weather: (c.state as FitWorld["weather"]) ?? null };
    case "note":
      return { ...w, notes: { ...(w.notes ?? {}), [String(c.topic)]: 0 } };
    default:
      return w;
  }
}

/** 台の想定の種類（仮想は回の規模、lib/drill/fit.ts の fitKindOf と同じ） */
function fitKindOfRun(outcome: RunOutcome): DrillKind | null {
  const s = outcome.plan.scenario as DrillScenario;
  return fitKindOf({ scenario: s, options: { scale: outcome.plan.scale ?? null } }, outcome.replay?.world as Partial<WorldState> | undefined);
}

/**
 * 8. 想定に合わない物（T125）。「起きてはいけない物」の一覧は想定の表（lib/drill/fit.ts の forbiddenFor）から作り、全部の想定で効く:
 * 出来事の種類と文（event・event_text・inject）、本人役の言葉（persona。画面に出た物）、自由対応の文と理由（free）、手の所要の理由
 * （terms: 区域でない人の「浸水」）、電話が通話不可・電波不通の間の着信（call_down）、画面の文に残った内部の名前（internal_id）
 */
export function fitHits(outcome: RunOutcome, ctx: Pick<CheckContext, "hazards">): { checked: number; hits: CheckHit[] } {
  const hits: CheckHit[] = [];
  const r = outcome.replay;
  if (!r) return { checked: 0, hits };
  const kind = fitKindOfRun(outcome);
  const profile = kind ? FIT_PROFILES[kind] : null;
  const bans = kind ? forbiddenFor(kind) : null;
  let checked = 0;
  let w = fitStart();
  const track: FitTrack = [{ minute: -1, w }];
  const ticks = [...r.ticks].sort((a, b) => a.step - b.step);
  const wordHit = (text: string | null | undefined, at: FitWorld, rule: string, person: string | null, minute: number | null, field: string) => {
    if (!text) return;
    checked += 1;
    const m = wordMisfit(profile, text, at);
    if (m) hits.push({ check: "fit", rule: `${rule}:${m}`, person, minute, evidence: `${field}: ${Array.from(text).slice(0, 40).join("")}` });
    if (INTERNAL_ID.test(text.normalize("NFKC"))) hits.push({ check: "fit", rule: `${rule}:internal_id`, person, minute, evidence: `${field}: ${Array.from(text).slice(0, 40).join("")}` });
  };
  for (const t of ticks) {
    const incidents = [...t.incidents].map((e, i) => ({ e, i })).sort((a, b) => (a.e.at ?? t.hour) - (b.e.at ?? t.hour) || a.i - b.i);
    for (const { e } of incidents) {
      const minute = Math.round((e.at ?? t.hour) * 60);
      const c = e.change ?? {};
      checked += 1;
      if (bans && typeof e.inject === "string" && bans.injects.includes(e.inject as InjectKind)) {
        hits.push({ check: "fit", rule: `inject:${e.inject}`, person: e.person ?? null, minute, evidence: e.text ?? "" });
      }
      const mis = changeMisfit(profile, c as WorldChange, w);
      if (mis) hits.push({ check: "fit", rule: `event:${mis}`, person: e.person ?? null, minute, evidence: e.text ?? "" });
      // 監督・世界の文（表の固定の文は表の試験で見る。AI の文だけ）
      if (e.ai) wordHit(e.text, w, "event_text", e.person ?? null, minute, String(c.kind ?? ""));
      w = foldFit(w, c);
      track.push({ minute, w });
    }
    // 訓練の画面の上の帯（lib/drill/header-mark.ts。刻みの終わりの世界で）
    const band = headerMarkText(drillHeaderMark({ scenario: outcome.plan.scenario as DrillScenario, options: { scale: outcome.plan.scale ?? null }, world: w, minute: Math.round(t.hour * 60) }));
    wordHit(band, w, "band", null, Math.round(t.hour * 60), "header");
    for (const u of t.turns) {
      const minute = Math.round((u.at ?? t.hour) * 60);
      const at = worldAt(track, minute);
      wordHit(u.saying, at, "persona", u.person ?? null, minute, "saying");
      wordHit(u.doing, at, "persona", u.person ?? null, minute, "doing");
      // 通話不可・電波不通の間の着信（電話の形の連絡。lib/drill/calls.ts の isPhoneTurn）
      if ((at.phone === "down" || at.radio === "down") && isPhoneTurn(u as Parameters<typeof isPhoneTurn>[0])) {
        hits.push({ check: "fit", rule: `call_down:${at.radio === "down" ? "radio" : "phone"}`, person: u.person ?? null, minute, evidence: `${u.source ?? ""} ${u.color ?? ""}` });
      }
    }
  }
  for (const a of r.actions) {
    const minute = typeof a.atMinute === "number" ? a.atMinute : null;
    const at = worldAt(track, minute ?? 0);
    const res = a.result;
    if (res) {
      wordHit(res.speech, at, "persona", a.person ?? null, minute, "call.speech");
      for (const l of res.talk ?? []) if (l.who !== "cm") wordHit(l.text, at, "persona", a.person ?? null, minute, "talk");
      wordHit(res.visit?.speech, at, "persona", a.person ?? null, minute, "visit.speech");
      wordHit(res.visit?.condition, at, "persona", a.person ?? null, minute, "visit.condition");
      const free = res as { text?: unknown; outcome?: unknown };
      if (typeof free.outcome === "string") wordHit(free.outcome, at, "free", a.person ?? null, minute, "outcome");
    }
    if (typeof a.reason === "string") wordHit(a.reason, at, "free", a.person ?? null, minute, "reason");
    // 手の所要の理由の「浸水」: 区域の浸水が、その人の区域で効いている時だけ（想定の表の条件）
    const adds = Array.isArray(a.adds) ? (a.adds as unknown[]).filter((x): x is string => typeof x === "string") : [];
    if (adds.includes("浸水")) {
      checked += 1;
      const zones = a.person ? (ctx.hazards?.[a.person] ?? []) : [];
      if (!waterActive(profile, zones, at) && !(a.person && at.flooded?.includes(a.person))) hits.push({ check: "fit", rule: "terms:浸水", person: a.person ?? null, minute, evidence: `${a.kind ?? ""} ${a.minutes ?? ""} 分` });
    }
  }
  return { checked, hits };
}

/** 跡のうち、その分の時点の世界 */
function worldAt(track: FitTrack, minute: number): FitWorld & { phone: string; radio: string; flooded?: string[] } {
  let w = track[0].w;
  for (const x of track) if (x.minute <= minute) w = x.w;
  return w;
}

// ---------- 自由対応（T129） ----------

/**
 * 手の内部の名前（英字の id）らしい語。「_」を含む語と、手・相手・やり方・効き目の id（lib/drill/free-action.ts の plainWords が置き換える物）。
 * 大文字だけの略語（AED）と仮名（A さん）は当てない
 */
export const INNER_NAME = new RegExp(
  `[A-Za-z0-9]*_[A-Za-z0-9_]*|(?<![A-Za-z])(?:${[
    ...ACTION_CATALOG.map((r) => r.id),
    "free",
    "none",
    "phone",
    "visit",
    "desk",
    "home",
    "move",
    "reach",
    "arrival",
    "self",
    "family",
    "supporter",
    "pharmacy",
    "hospital",
    "staff",
    "city",
    "shelter",
    "office",
  ].join("|")})(?![A-Za-z])`,
);

/** 何もしない（自由対応の答えの kind）。前の形の note も */
const IDLE_KIND = new Set(["none", "note", ""]);

type LooseJudge = { output?: { kind?: string; can?: boolean } | null; decided?: { as?: string | null; block?: string | null; idle?: boolean } };

/** 送った候補の一覧と返事（自由対応の生の記録から。読めなければ null） */
function freeRecordOf(a: AiRecord): { list: Array<{ id: string; 今?: string }>; out: Record<string, unknown> } | null {
  try {
    const user = a.sent.user;
    const input = JSON.parse(user.slice(user.indexOf("{"), user.lastIndexOf("}") + 1)) as { 手?: { 一覧?: Array<{ id: string; 今?: string }> } };
    const text = a.returned?.text ?? "";
    const out = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Record<string, unknown>;
    return { list: input.手?.一覧 ?? [], out };
  } catch {
    return null;
  }
}

/**
 * 自由対応の検査（T129）。
 * - inner_name:shown 画面に出た文（手の記録の理由・1 文・結果の文）に内部の名前が出た（0 のはず）
 * - inner_name:raw Claude の生の返事の文に内部の名前があった（画面では置き換えるので数えるだけ）
 * - dropped Claude が表の手に当てたのに、コードが「変化なし」に落とした（黙って落とさない。0 のはず）
 * - can_mismatch 候補の一覧で「不可」の手に当てたのに、Claude が「できる」と答えた（生の返事。コードの決まりが先なので数えるだけ）
 */
export function freeHits(records: ReadonlyArray<LogRecord>, outcome: RunOutcome): CheckHit[] {
  const hits: CheckHit[] = [];
  for (const a of outcome.replay?.actions ?? []) {
    if (a.kind !== "free") continue;
    const shown: Array<[string, unknown]> = [
      ["reason", a.reason],
      ["words", a.words],
      ["result", a.result?.text],
    ];
    for (const [field, v] of shown) {
      const m = typeof v === "string" ? INNER_NAME.exec(v) : null;
      if (m) hits.push({ check: "free", rule: "inner_name:shown", where: "shown", person: a.person ?? null, minute: a.atMinute ?? null, evidence: `${field}: ${m[0]}` });
    }
    const j = a.judge as LooseJudge | undefined;
    const kind = j?.output?.kind ?? "";
    if (j?.decided?.idle === true && isCatalogAction(kind) && kind !== "free" && kind !== "note") {
      hits.push({ check: "free", rule: "dropped", person: a.person ?? null, minute: a.atMinute ?? null, evidence: `${kind} → 変化なし` });
    }
  }
  for (const r of records) {
    if (r.type !== "ai" || (r as AiRecord).role !== "free") continue;
    const a = r as AiRecord;
    const got = freeRecordOf(a);
    if (!got) continue;
    for (const field of ["text", "reason", "whyNot", "alt", "outcome"]) {
      const v = got.out[field];
      const m = typeof v === "string" ? INNER_NAME.exec(v) : null;
      if (m) hits.push({ check: "free", rule: "inner_name:raw", where: "raw", role: a.role, seq: a.seq, evidence: `${field}: ${m[0]}` });
    }
    const kind = typeof got.out.kind === "string" ? got.out.kind : "";
    const row = got.list.find((c) => c.id === kind);
    if (!IDLE_KIND.has(kind) && row?.今?.startsWith("不可") && got.out.can !== false) {
      hits.push({ check: "free", rule: "can_mismatch", where: "raw", role: a.role, seq: a.seq, evidence: `${kind} ${row.今}` });
    }
  }
  return hits;
}

// ---------- 数 ----------

const quantile = (xs: ReadonlyArray<number>, q: number): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

export type RunNumbers = {
  scenario: string;
  status: string;
  advances: number;
  /** 発災からの分（どこまで進んだか） */
  minute: number;
  participants: number;
  acts: number;
  banned: { raw: number; shown: number; otherRaw: number; byRule: Record<string, number> };
  shape: { failed: number; notJson: number; retries: number; byError: Record<string, number> };
  aiCalls: { total: number; byPurpose: Record<string, number>; failed: number; byError: Record<string, number> };
  /**
   * 1 訓練の数え（world.counts の合計）と上限 150 との比、1 日の上限 200 との比（ai_calls の数）。
   * uncounted は訓練の AI の呼び出し（ai_calls の講評・声のほか）のうち 1 訓練の数えに入っていない数（連続の時計の訓練だけ。T118）
   */
  budget: { drillCounted: number; capRatio: number; dayRatio: number; uncounted: number };
  leaks: number;
  contradictions: { total: number; byRule: Record<string, number> };
  timeOdds: { checked: number; offBand: number; rate: number | null };
  stops: { aiStop: number; worldNote: number; opFailed: number; exceptions: number };
  /**
   * 手の決まり（T110 の terms、T121）。on は開始に送ったか、refused は決まりどおりに断った手、ran は打つ前の事実で押せない手が打てた数
   * （送った訓練では 0 のはず）、dark は夜の訪問の所要が夜の足し分より短い数
   */
  terms: { on: boolean; refused: number; ran: number; dark: number };
  /**
   * 想定に合わない物（T125）。checked は見た数、misfit は合わない物の数（直したあとは 0 のはず）、byRule は決まりごと、
   * gated は 1 つの門が捨てた・直した数（drills.world の gated。決まりごとの合計）
   */
  fit?: { checked: number; misfit: number; byRule: Record<string, number>; gated: number };
  /**
   * 自由対応（T129）。acts は打てた自由対応、innerShown は画面に出た内部の名前（0 のはず）、innerRaw は生の返事の内部の名前、
   * dropped は表の手に当てたのに変化なしに落ちた数（0 のはず）、canMismatch は不可の手を「できる」と答えた数（生の返事）
   */
  free?: { acts: number; innerShown: number; innerRaw: number; dropped: number; canMismatch: number };
  /**
   * 人ごとの事実の帳面との矛盾（T130、facts-check.ts）。checked は見た数、hits は矛盾の数（門が効いていれば 0 のはず）、byRule は決まりごと、
   * gated は門が落とした・直した数（drills.world の gated。決まりごと）
   */
  facts?: { checked: number; hits: number; byRule: Record<string, number>; gated: Record<string, number>; words?: number };
  /**
   * 通話の往復（T158、talk-check.ts）。repeats は同じ通話の前の返事とほぼ同じ返事、placeDrift は同じ通話の中のいる所の食い違い、
   * repeatRaw は往復の生の返事が送った「それまでの話」とほぼ同じ数（門の前）
   */
  talk?: TalkNumbers;
  /** 人ごとの筋（T165、personArcHits）。前の回の summary には無い */
  persons?: PersonArcNumbers;
  /** 世界の返事で捨てた名前（T174。前の回の summary には無い） */
  worldNames?: WorldNameNumbers;
  /** 本人役の言葉が文の途中で終わった数（T139、cutHits）。checked は見た言葉の数 */
  cut?: { checked: number; hits: number };
  /** 画面に出た（氏名）のうち元の語に名前が無かった数（T159、overmaskHits）。checked は突き合わせられた画面の（氏名）の数 */
  overmask?: { checked: number; hits: number };
  timing: { advanceP50: number | null; advanceP95: number | null; advanceMax: number | null; actP50: number | null; actP95: number | null };
  cost: { usd: number; inputTokens: number; outputTokens: number; roomSteps: number; unpricedCalls: number };
};

const tally = (xs: ReadonlyArray<string>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return out;
};

/**
 * 人ごとの事実（台帳・時計・前の連絡）と本人役の言葉の食い違いの型（T158。facts.words に数える）。いる所の言葉・電池の残りと流れ・
 * 一度起きた事・家に置いてきた物・同居と家族・声・止まった機器。安否の色やいる所の入れ替わり（place_flip）と出来事の重なりは入れない
 */
export const FACT_WORD_RULES: ReadonlySet<string> = new Set([
  "road_said",
  "place_text",
  "with_arrived",
  "absent_kin",
  "ask_after_power",
  "out_after_power",
  "spare_without_plan",
  "calm_while_down",
  "unknown_while_with",
  "remain_mismatch",
  "old_news",
  "voice_lost",
  "spare_unsaid",
  "left_remain",
  "clock_drift",
  "repeat_intent",
  "swap_news",
  "backstage",
  "power_said",
]);

/** 1 回の人ごとの筋の数（T165、diversity.ts の personKinds を回ごとに） */
export type PersonArcNumbers = {
  /** 参加者の数 */
  people: number;
  /** 人ごとの出来事の種類の数の平均 */
  kinds: number | null;
  /** その人を指す出来事が 1 つも無かった人の数 */
  noKind: number;
  /** 人どうしの種類の集合の重なり（Jaccard の平均。どちらも出来事のある組だけ） */
  kindJaccard: number | null;
  /** 種類の集合がそっくり同じ組の数（どちらも出来事のある組） */
  sameArc: number;
};

/** 12. 人ごとの筋（T165）。出来事の無い人（no_kind）と、出来事の種類の集合がそっくり同じ組（same_arc）を引っかかりに */
export function personArcHits(outcome: RunOutcome): { numbers: PersonArcNumbers; hits: CheckHit[] } {
  const m = personKinds(outcome);
  const hits: CheckHit[] = [];
  const sets = [...m.entries()];
  for (const [person, set] of sets) if (set.size === 0) hits.push({ check: "persons", rule: "no_kind", person, evidence: "その人を指す出来事が無い" });
  const js: number[] = [];
  let same = 0;
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const [pa, a] = sets[i];
      const [pb, b] = sets[j];
      if (a.size === 0 || b.size === 0) continue;
      const v = jaccard(a, b);
      if (v === null) continue;
      js.push(v);
      if (v === 1) {
        same += 1;
        hits.push({ check: "persons", rule: "same_arc", person: pa, evidence: `${pa} と ${pb}: ${[...a].sort().join("・")}` });
      }
    }
  }
  const sizes = sets.map(([, s]) => s.size);
  return {
    numbers: {
      people: sets.length,
      kinds: sizes.length > 0 ? sizes.reduce((x, y) => x + y, 0) / sizes.length : null,
      noKind: sizes.filter((n) => n === 0).length,
      kindJaccard: js.length > 0 ? js.reduce((x, y) => x + y, 0) / js.length : null,
      sameArc: same,
    },
    hits,
  };
}

export const DRILL_CAP = 150;
export const DAY_LIMIT = 200;

/** 1 回の検査を全部当て、引っかかった所と数を返す */
export function checkRun(records: ReadonlyArray<LogRecord>, outcome: RunOutcome, ctx: CheckContext): { hits: CheckHit[]; numbers: RunNumbers } {
  const banned = bannedHits(records, outcome, ctx);
  const leaks = leakSentHits(records, ctx);
  const shape = shapeHits(records);
  const odds = timeOddsOf(outcome);
  const contra = contradictionHits(outcome, ctx.facts);
  const stops = stopHits(outcome);
  const terms = termHits(outcome, ctx);
  const fit = fitHits(outcome, ctx);
  const free = freeHits(records, outcome);
  const facts = ctx.facts ? factHits(outcome, ctx.facts) : { checked: 0, hits: [] as CheckHit[] };
  const cut = cutHits(outcome);
  const overmask = overmaskHits(records, outcome, ctx);
  const talk = talkHits(outcome, records);
  const arcs = personArcHits(outcome);
  const worldPlace = worldPlaceHits(outcome);
  const ai = records.filter((r): r is AiRecord => r.type === "ai" && (r as AiRecord).role !== "judge");
  const worldNames = worldNameHits(ai, outcome);
  // 1 訓練の数え（画面の「AI 残」から。10 分版は数えないので本人役と監督の呼び出しの数）
  const drillCounted = outcome.callsLeft !== null ? DRILL_CAP - outcome.callsLeft : ai.filter((a) => a.role === "persona" || a.role === "director" || a.role === "world" || a.role === "world_room").length;
  // 7. 1 訓練の数えに入らない呼び出し（T118）: 訓練の呼び出し（ai_calls の講評 scoring と声 voice のほか）と数えの差。連続の時計の訓練だけ
  const drillAi = outcome.aiCalls.filter((c) => c.purpose !== "scoring" && c.purpose !== "voice").length;
  const uncounted = outcome.callsLeft !== null ? Math.max(0, drillAi - drillCounted) : 0;
  const budgetHits: CheckHit[] =
    uncounted > 0 ? [{ check: "budget", rule: "uncounted", evidence: `ai_calls ${drillAi} 回・1 訓練の数え ${drillCounted} 回（差 ${uncounted}）` }] : [];
  const ms = (op: string) => outcome.ops.filter((o) => o.op === op || o.op === `${op}_probe`).map((o) => o.took);
  const raw = banned.filter((h) => h.where === "raw");
  const numbers: RunNumbers = {
    scenario: outcome.plan.scenario,
    status: outcome.status,
    advances: outcome.advances,
    minute: outcome.replay?.minute ?? 0,
    participants: outcome.plan.participants.length,
    acts: outcome.ops.filter((o) => o.op === "act" || o.op === "act_probe").length,
    banned: {
      raw: raw.filter((h) => PERSONA_ROLES.has(h.role as Role)).length,
      shown: banned.filter((h) => h.where === "shown").length,
      otherRaw: raw.filter((h) => !PERSONA_ROLES.has(h.role as Role)).length,
      byRule: tally(banned.map((h) => `${h.where}:${h.rule.replace(/^personal:.*/, "personal")}`)),
    },
    shape: { failed: shape.length, notJson: shape.filter((h) => h.rule === "not_json").length, retries: ai.reduce((s, a) => s + a.retries, 0), byError: tally(shape.map((h) => h.rule)) },
    aiCalls: {
      total: outcome.aiCalls.length,
      byPurpose: tally(outcome.aiCalls.map((c) => c.purpose)),
      failed: outcome.aiCalls.filter((c) => c.status !== "ok").length,
      byError: tally(outcome.aiCalls.filter((c) => c.error).map((c) => c.error!)),
    },
    budget: { drillCounted, capRatio: drillCounted / DRILL_CAP, dayRatio: outcome.aiCalls.length / DAY_LIMIT, uncounted },
    leaks: leaks.length,
    contradictions: { total: contra.length, byRule: tally(contra.map((h) => h.rule)) },
    timeOdds: { checked: odds.checked, offBand: odds.offBand, rate: odds.checked > 0 ? odds.offBand / odds.checked : null },
    stops: {
      aiStop: stops.filter((h) => h.rule.startsWith("ai_stop")).length,
      worldNote: stops.filter((h) => h.rule.startsWith("world_note")).length,
      opFailed: stops.filter((h) => h.check === "op_failed").length,
      exceptions: outcome.errors.length,
    },
    terms: {
      on: outcome.terms === true,
      refused: stops.filter((h) => h.check === "terms").length,
      ran: terms.filter((h) => h.rule.startsWith("ran:")).length,
      dark: terms.filter((h) => h.rule === "dark_minutes").length,
    },
    fit: {
      checked: fit.checked,
      misfit: fit.hits.length,
      byRule: tally(fit.hits.map((h) => h.rule)),
      gated: Object.values((outcome.replay?.world as { gated?: Record<string, number> } | undefined)?.gated ?? {}).reduce((x, n) => x + (typeof n === "number" ? n : 0), 0),
    },
    free: {
      acts: (outcome.replay?.actions ?? []).filter((a) => a.kind === "free").length,
      innerShown: free.filter((h) => h.rule === "inner_name:shown").length,
      innerRaw: free.filter((h) => h.rule === "inner_name:raw").length,
      dropped: free.filter((h) => h.rule === "dropped").length,
      canMismatch: free.filter((h) => h.rule === "can_mismatch").length,
    },
    facts: {
      checked: facts.checked,
      hits: facts.hits.length,
      byRule: tally(facts.hits.map((h) => h.rule)),
      gated: { ...(outcome.gated ?? {}) },
      words: facts.hits.filter((h) => FACT_WORD_RULES.has(h.rule)).length,
    },
    talk: talk.numbers,
    persons: arcs.numbers,
    worldNames: worldNames.numbers,
    cut: { checked: cut.checked, hits: cut.hits.length },
    overmask: { checked: overmask.checked, hits: overmask.hits.length },
    timing: {
      advanceP50: quantile(ms("advance"), 0.5),
      advanceP95: quantile(ms("advance"), 0.95),
      advanceMax: ms("advance").length > 0 ? Math.max(...ms("advance")) : null,
      actP50: quantile(ms("act"), 0.5),
      actP95: quantile(ms("act"), 0.95),
    },
    cost: {
      usd: ai.reduce((s, a) => s + (a.costUsd ?? 0), 0),
      inputTokens: ai.reduce((s, a) => s + (a.usage?.input ?? 0), 0),
      outputTokens: ai.reduce((s, a) => s + (a.usage?.output ?? 0), 0),
      roomSteps: ai.filter((a) => a.role === "world_room").length,
      unpricedCalls: ai.filter((a) => a.costUsd === null && a.role !== "world_room").length,
    },
  };
  return { hits: [...worldPlace, ...worldNames.hits, ...banned, ...leaks, ...shape, ...odds.hits, ...contra, ...stops, ...terms, ...fit.hits, ...free, ...facts.hits, ...cut.hits, ...overmask.hits, ...talk.hits, ...arcs.hits, ...budgetHits], numbers };
}
