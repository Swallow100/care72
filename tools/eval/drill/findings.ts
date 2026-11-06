// 訓練の台（T108）の指摘（T157）。回ごとの引っかかり（checks.ts の CheckHit）と審査役の点を、指摘の共通の形（tools/eval/findings.ts）にまとめる。
// 決まりの中身（checks.ts）は変えない。ここは「どの原因か・どこを疑うか・何で確かめるか」の表だけを持つ。
// 決まりどおりに断った手（terms の refused）は問題ではないので指摘にしない。

import { clipEvidence, findingId, type Accept, type Finding, type Severity } from "../findings.ts";
import type { CheckHit } from "./checks.ts";
import type { JudgeScore } from "./judge.ts";
import { PERSONA_ROLES, type Role } from "./roles.ts";

type Meta = { cause: string; rule: string; title: string; severity: Severity; suspects: string[]; screen?: string; accept?: Accept };

/** 役ごとの作り手のファイル（形の失敗・生の返事の禁じた語の疑う所） */
const ROLE_FILES: Readonly<Record<string, string[]>> = {
  persona: ["lib/drill/persona.ts", "lib/drill/dialogue.ts"],
  persona_call: ["lib/drill/persona.ts", "lib/drill/calls.ts"],
  persona_talk: ["lib/drill/persona.ts", "lib/drill/talk-turn.ts"],
  persona_visit: ["lib/drill/persona.ts", "lib/drill/dialogue.ts"],
  director: ["lib/drill/director.ts"],
  world: ["lib/drill/world-oneshot.ts", "lib/drill/world-apply.ts"],
  world_room: ["lib/drill/world-room.ts", "lib/drill/world-apply.ts"],
  free: ["lib/drill/free-action.ts"],
  review: ["lib/drill/review.ts"],
};
const roleFiles = (role: string | undefined) => ROLE_FILES[role ?? ""] ?? ["lib/claude/call.ts"];

/** 病名・薬の量などの決まりの題（id は checks.ts の PERSONA_RULES の物） */
const BANNED_TITLES: Readonly<Record<string, string>> = {
  diagnosis: "医療の言い切り",
  life: "命の危うさの言い切り",
  dose: "薬の量",
  disease: "病名",
  advice: "医療の助言",
  alias: "仮名の残り",
  condition: "体の具合の言い切り",
  personal: "名前・電話・生年月日",
  life_or_diagnosis: "人の生き死に・医療の言い切り",
  medical_reason: "結末の理由の医療の語",
};

const head = (rule: string) => rule.split(":")[0];
const zero = (item: string): Accept => ({ item, op: "<=", value: 0 });

/** 引っかかり 1 つの原因（指摘にしない物は null） */
export function metaOf(h: CheckHit): Meta | null {
  switch (h.check) {
    case "banned": {
      const rule = h.rule.replace(/^personal:.*/, "personal");
      const what = BANNED_TITLES[rule] ?? rule;
      if (h.where === "shown") {
        return { cause: `drill:banned:shown:${rule}`, rule: `banned:${rule}`, title: `画面に出た本人役の言葉に${what}`, severity: "high", screen: "訓練 > 経過・通話・訪問", suspects: ["lib/drill/dialogue.ts", "lib/drill/gate.ts", "lib/drill/persona.ts"] };
      }
      const persona = PERSONA_ROLES.has(h.role as Role);
      return {
        cause: `drill:banned:raw:${persona ? "persona" : "world"}:${rule}`,
        rule: `banned:${rule}`,
        title: persona ? `本人役の生の返事に${what}（画面の前に門で落ちる物）` : `世界・監督の生の返事に${what}`,
        severity: "mid",
        suspects: roleFiles(h.role),
      };
    }
    case "overmask":
      return {
        cause: "drill:overmask:shown",
        rule: "overmask",
        title: "画面の（氏名）で元の語に名前が無い（伏せ過ぎ）",
        severity: "mid",
        screen: "訓練 > 経過・通話・訪問",
        suspects: ["lib/pseudonym/forms.ts", "lib/pseudonym/index.ts"],
        accept: zero("drill.overmask"),
      };
    case "leak":
      return { cause: "drill:leak:sent", rule: "leak", title: "Claude に送った中身に仮名化の漏れ", severity: "high", suspects: ["lib/pseudonym/index.ts", ...roleFiles(h.role)], accept: zero("drill.leaks") };
    case "shape": {
      if (h.rule === "cut_mid") return { cause: "drill:shape:cut_mid", rule: "cut_mid", title: "本人役の言葉が文の途中で終わる", severity: "mid", screen: "訓練 > 経過・通話", suspects: ["lib/drill/persona.ts", "lib/drill/clip.ts"], accept: zero("drill.cut") };
      const kind = head(h.rule);
      return { cause: `drill:shape:${kind}:${h.role ?? "other"}`, rule: `shape:${kind}`, title: `AI の返事の形の失敗（${kind}）`, severity: "mid", suspects: [...roleFiles(h.role), "lib/claude/call.ts"] };
    }
    case "contradiction":
      return {
        cause: `drill:contradiction:${h.rule}`,
        rule: `contradiction:${h.rule}`,
        title: CONTRADICTION_TITLES[h.rule] ?? `矛盾（${h.rule}）`,
        severity: "mid",
        screen: "訓練 > 経過",
        suspects: ["lib/drill/person-facts.ts", "lib/drill/state-rules.ts", "lib/drill/gate.ts"],
        ...(h.rule === "hurt_to_safe" ? { accept: zero("drill.hurtToSafe") } : {}),
      };
    case "time_odds":
      return { cause: "drill:time_odds", rule: "time_odds", title: "監督の差し込みが時間帯の目安の外", severity: "low", screen: "訓練 > 経過（出来事）", suspects: ["lib/drill/time-odds.ts", "lib/drill/director.ts"] };
    case "stop":
      return { cause: `drill:stop:${head(h.rule)}`, rule: `stop:${head(h.rule)}`, title: head(h.rule) === "ai_stop" ? "AI の上限で止まった" : "世界の代替・停止の印", severity: "mid", screen: "訓練 > 経過", suspects: ["lib/drill/ai-stop.ts", "lib/drill/world-room.ts"] };
    case "op_failed":
      return { cause: `drill:op_failed:${h.rule}`, rule: `op_failed:${h.rule}`, title: `訓練の要求の失敗（${h.rule}）`, severity: "high", screen: "訓練", suspects: ["lib/drill/http.ts", "lib/drill/actions.ts"] };
    case "budget":
      return { cause: "drill:budget:uncounted", rule: "budget:uncounted", title: "1 訓練の数えに入らない AI の呼び出し", severity: "low", screen: "訓練（AI 残）", suspects: ["lib/drill/clock.ts", "lib/drill/actions.ts"] };
    case "terms": {
      if (h.rule.startsWith("refused")) return null;
      const kind = head(h.rule);
      return {
        cause: `drill:terms:${kind}`,
        rule: `terms:${kind}`,
        title: kind === "ran" ? "手の決まりで押せない手が打てた" : "夜の訪問の所要が足りない",
        severity: kind === "ran" ? "mid" : "low",
        screen: "訓練 > 手の欄",
        suspects: ["lib/drill/action-terms.ts", "lib/drill/actions.ts"],
        accept: zero("drill.termsRan"),
      };
    }
    case "fit":
      return { cause: `drill:fit:${head(h.rule)}`, rule: `fit:${head(h.rule)}`, title: `想定に合わない物（${head(h.rule)}）`, severity: "mid", screen: "訓練 > 経過", suspects: ["lib/drill/fit.ts", "lib/drill/gate.ts"] };
    case "free": {
      const kind = h.rule;
      const shown = kind === "inner_name:shown" || kind === "dropped";
      return {
        cause: `drill:free:${kind}`,
        rule: `free:${kind}`,
        title: FREE_TITLES[kind] ?? `自由対応（${kind}）`,
        severity: shown ? "mid" : "low",
        screen: "訓練 > 自由対応",
        suspects: ["lib/drill/free-action.ts", "lib/drill/free-situation.ts"],
        ...(kind === "inner_name:shown" ? { accept: zero("drill.freeInner") } : {}),
      };
    }
    case "facts":
      return {
        cause: `drill:facts:${h.rule}`,
        rule: `facts:${h.rule}`,
        title: FACT_TITLES[h.rule] ?? `本人ごとの帳面との矛盾（${h.rule}）`,
        severity: "mid",
        screen: "訓練 > 経過",
        suspects: h.rule === "clock_drift" || h.rule === "spare_unsaid" ? ["lib/drill/person-facts.ts", "lib/drill/persona.ts"] : ["lib/drill/person-facts.ts", "lib/drill/cast-facts.ts"],
        ...(h.rule === "clock_drift" ? { accept: zero("drill.clockDrift") } : {}),
      };
    case "talk":
      return {
        cause: `drill:talk:${h.rule}`,
        rule: `talk:${h.rule}`,
        title: TALK_TITLES[h.rule] ?? `通話の往復（${h.rule}）`,
        severity: h.rule === "repeat_raw" ? "low" : "mid",
        screen: "訓練 > 通話",
        suspects: ["lib/drill/persona.ts", "lib/drill/hooks.ts", "lib/drill/person-facts.ts", "lib/drill/talk-turn.ts"],
        accept: h.rule === "place_drift" ? zero("drill.talkPlaceDrift") : h.rule === "repeat" ? { item: "drill.talkRepeat", op: "<=", value: 0.05 } : { item: `count:drill:talk:${h.rule}`, op: "<=", value: 0 },
      };
    case "persons":
      return {
        cause: `drill:persons:${h.rule}`,
        rule: `persons:${h.rule}`,
        title: PERSON_TITLES[h.rule] ?? `人ごとの筋（${h.rule}）`,
        severity: "low",
        screen: "訓練 > 経過（出来事）",
        suspects: ["lib/drill/director.ts", "lib/drill/event-catalog.ts", "lib/drill/time-odds.ts"],
        // 受け入れは同じ原因の数（count:drill:persons:…）。r7 で出来事の無い人は 36% なので、割合の線は本物の回の数で決める
      };
    default:
      return null;
  }
}

/** 帳面との矛盾のうち題を持つ物（T158） */
const FACT_TITLES: Readonly<Record<string, string>> = {
  clock_drift: "電池の残りの数が前に言った数と食い違う（予備に替えた・電気が戻ったと言わずに）",
  spare_unsaid: "予備で動いているのに残りの数を予備と言わない",
  left_remain: "家に置いてきた栄養剤の残りの時間を言う",
  place_text: "いる所と食い違う言葉",
  remain_mismatch: "電池・予備の残りの数が帳面と食い違う",
  old_news: "前に伝えた事を新しい事のように言う",
  repeat_intent: "前に言って済んでいない予定（119 へ掛ける・取りに行く）を新しく言い直す",
  swap_news: "前に予備に替えた事を、また替えたと言う",
  backstage: "本人役の言葉に訓練の裏側の言葉（問いの途中・訓練）",
};

/** 人ごとの筋の題（T165） */
const PERSON_TITLES: Readonly<Record<string, string>> = {
  no_kind: "その人を指す出来事が 1 つも無い人",
  same_arc: "出来事の種類の集合がそっくり同じ人の組",
};

/** 通話の往復の題（T158） */
const TALK_TITLES: Readonly<Record<string, string>> = {
  repeat: "通話の返事が同じ通話の前の返事とほぼ同じ",
  place_drift: "同じ通話の中でいる所の話が食い違う",
  repeat_raw: "往復の生の返事がそれまでの話とほぼ同じ（門の前）",
};

const CONTRADICTION_TITLES: Readonly<Record<string, string>> = {
  hurt_to_safe: "赤（動けない）から手も到着も無いまま緑",
  green_but_hurt: "緑なのに言葉にけが",
  red_but_fine: "赤なのに言葉は無事",
  after_end: "結末のあとの連絡",
};

const FREE_TITLES: Readonly<Record<string, string>> = {
  "inner_name:shown": "自由対応の画面に内部の名前",
  "inner_name:raw": "自由対応の生の返事に内部の名前",
  dropped: "表の手に当てたのに変化なしに落ちた",
  can_mismatch: "不可の手を「できる」と答えた（生の返事）",
  "probe:phone_down_ran": "状況違いの試し: 不通なのに電話が打てた",
  "probe:no_alt": "状況違いの試し: 不可の手に代わりが無い",
  "probe:dropped": "状況違いの試し: 変化なしに落ちた",
  "probe:inner_name": "状況違いの試し: 内部の名前",
  "probe:dark_visit": "状況違いの試し: 夜の訪問の所要",
};

/** 審査役の点がこれ以下なら指摘にする（5 段の 2） */
export const JUDGE_LOW = 2;
const JUDGE_TITLES: Readonly<Record<string, string>> = { realism: "本当らしさ", difficulty: "難しさ", variety: "多様さ", consistency: "人ごとの筋", learning: "学べるか" };

export type DrillRunHits = { index: number; scenario: string; hits: ReadonlyArray<CheckHit> };

const pad = (n: number) => String(n).padStart(2, "0");

/** 1 回の評価（runEval の回のフォルダ 1 つ）の指摘 */
export function drillFindings(args: {
  stamp: string;
  client: "fake" | "real";
  seed: string;
  runs: ReadonlyArray<DrillRunHits>;
  judge?: ReadonlyArray<JudgeScore>;
  /** free-probe.jsonl の引っかかり（T129） */
  probe?: ReadonlyArray<CheckHit>;
}): Finding[] {
  type Acc = { meta: Meta; count: number; refs: string[]; files: Set<string>; scenarios: Set<string>; evidence: string[] };
  const acc = new Map<string, Acc>();
  const add = (h: CheckHit, file: string, scenario: string | null) => {
    const meta = metaOf(h);
    if (!meta) return;
    const a = acc.get(meta.cause) ?? { meta, count: 0, refs: [], files: new Set<string>(), scenarios: new Set<string>(), evidence: [] };
    a.count += 1;
    a.files.add(file);
    if (scenario) a.scenarios.add(scenario);
    const at = typeof h.seq === "number" ? `seq ${h.seq}` : typeof h.minute === "number" ? `発災から ${h.minute} 分` : null;
    if (at && a.refs.length < 8) a.refs.push(`${file} ${at}`);
    if (h.evidence) a.evidence.push(h.evidence);
    acc.set(meta.cause, a);
  };
  for (const r of args.runs) for (const h of r.hits) add(h, `run-${pad(r.index)}.jsonl`, r.scenario);
  for (const h of args.probe ?? []) add(h, "free-probe.jsonl", null);

  const command = (scenarios: ReadonlySet<string>, n: number) => {
    const sc = scenarios.size > 0 ? ` --scenario ${[...scenarios].join(",")}` : "";
    return args.client === "real"
      ? `node --env-file=<鍵のファイル> tools/eval/drill/run.ts --real --runs ${n} --seed ${args.seed}${sc}`
      : `npm run eval:drill -- --runs ${n} --seed ${args.seed}${sc}`;
  };
  const out: Finding[] = [];
  for (const a of acc.values()) {
    const m = a.meta;
    out.push({
      id: findingId(m.cause),
      bench: "drill",
      cause: m.cause,
      rule: m.rule,
      title: m.title,
      where: { ...(m.screen ? { screen: m.screen } : {}), file: [...a.files].sort().join("・"), ...(a.refs.length > 0 ? { refs: a.refs } : {}) },
      severity: m.severity,
      count: a.count,
      repro: [
        command(a.scenarios, Math.max(1, args.runs.length)),
        `回のフォルダ ${args.stamp} の ${[...a.files].sort().join("・")} で、type check・rule ${m.rule.replace(/^[a-z_]+:/, "")} の行を見る`,
      ],
      suspects: [...new Set(m.suspects)],
      accept: m.accept ?? { item: `count:${m.cause}`, op: "<=", value: 0 },
      firstSeen: args.stamp,
      evidence: clipEvidence(a.evidence),
    });
  }
  // 審査役の点（5 段の 2 以下の物差し）
  const low = new Map<string, number[]>();
  for (const j of args.judge ?? []) for (const [axis, v] of Object.entries(j.scores ?? {})) if (typeof v === "number" && v <= JUDGE_LOW) low.set(axis, [...(low.get(axis) ?? []), j.run]);
  for (const [axis, runIndexes] of low) {
    const cause = `drill:judge:${axis}`;
    out.push({
      id: findingId(cause),
      bench: "drill",
      cause,
      rule: `judge:${axis}`,
      title: `審査役の${JUDGE_TITLES[axis] ?? axis}が ${JUDGE_LOW} 以下`,
      where: { screen: "訓練（72 時間の通し）", file: runIndexes.map((i) => `run-${pad(i)}.jsonl`).join("・"), refs: runIndexes.map((i) => `run-${pad(i)}.jsonl type judge`) },
      severity: axis === "consistency" ? "mid" : "low",
      count: runIndexes.length,
      repro: [command(new Set(), Math.max(1, args.runs.length)) + " --judge " + runIndexes.length, `回のフォルダ ${args.stamp} の run-NN.jsonl の type judge の notes を読む`],
      suspects: axis === "consistency" ? ["lib/drill/person-facts.ts", "lib/drill/persona.ts", "lib/drill/world-apply.ts"] : ["lib/drill/director.ts", "lib/drill/event-catalog.ts"],
      accept: axis === "consistency" ? { item: "drill.judge.consistency", op: ">=", value: 3 } : { item: `count:${cause}`, op: "<=", value: 0 },
      firstSeen: args.stamp,
    });
  }
  return out;
}
