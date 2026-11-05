// 声の聞き取りの会話（docs/tasks/T137.md）の決まりと Claude の 1 回。本物の API は呼ばない（偽の client が決まった JSON を返す）。
// うめき声・黙る・違う答え・方言・認知症で噛み合わない・危ない言葉・医療の助言を言わせようとする答え、で
// 次の 1 文・ボタンへの切り替え・応答不明瞭の印・締めが正しいか。答えを表の入力にするのは決まった問いのままのときだけ。

import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { SEED_PEOPLE, seedConsents } from "../../seed/people.ts";
import type { AskJsonContext } from "../claude/call.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { HAIKU, TALK_SPEC } from "../claude/models.ts";
import type { UsageStore } from "../claude/usage.ts";
import { EMERGENCY_TEXT } from "../forms/own-sheet.ts";
import { pseudonymize, type PseudonymInput } from "../pseudonym/index.ts";
import { VOICE_PROMPT_TEXT } from "./phrases.ts";
import {
  answerOf,
  buttonQuestions,
  closingOf,
  dangerOf,
  fixedLine,
  gateLine,
  heardOf,
  heardTurn,
  newTalkLog,
  parseTalkLog,
  planTalk,
  TALK_MAX_AI,
  TALK_MAX_MS,
  TALK_MAX_TURNS,
  TALK_OPENING,
  TALK_TOPIC_SPECS,
  talkAnswers,
  talkDialogText,
  talkReplies,
  wantsEnd,
  yesNoChoice,
  type TalkContext,
  type TalkLine,
  type TalkLog,
} from "./talk.ts";
import { nextTalk, TALK_SYSTEM, type TalkAnswer } from "./talk-ai.ts";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

const T0 = Date.parse("2026-11-04T01:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

// ---------- 偽の Claude と上限 ----------

function reply(value: unknown): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: HAIKU,
    content: [{ type: "text", text: JSON.stringify(value), citations: null }],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 300, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Message;
}

function fake(answer: (p: Params) => TalkAnswer | Error) {
  const calls: Params[] = [];
  const client: ClaudeClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          const a = answer(params);
          if (a instanceof Error) throw a;
          return reply(a);
        },
      },
    },
  };
  return { client, calls };
}

const memoryUsage = (): UsageStore & { rows: string[] } => {
  const rows: string[] = [];
  return {
    rows,
    async reserve(c) {
      rows.push(c.purpose);
      return true;
    },
    async finish() {},
    async countDay() {
      return rows.length;
    },
  };
};

const yamada = SEED_PEOPLE[0];
const yamadaInput: PseudonymInput = {
  person: yamada.person,
  ledger: yamada.ledger,
  contacts: yamada.contacts,
  clocks: yamada.clocks,
  consents: seedConsents(yamada),
};
const { key } = pseudonymize([yamadaInput], { on: "2026-11-04" });

function aiOf(client: ClaudeClient) {
  const usage = memoryUsage();
  const ctx: AskJsonContext = {
    env: { ANTHROPIC_API_KEY: "dummy" },
    usage,
    office: { id: "office-demo", kind: "demo" },
    now: () => new Date(T0),
    claude: client,
  };
  return { ai: { ctx: async () => ctx, key }, usage };
}

const CTX: TalkContext = { hasDevice: true, answers: {}, now: T0 + 30_000 };

/** 会話の記録を、読んだ文と本人の言葉の組から作る（最初は定型文） */
function logOf(pairs: Array<[TalkLine, string | null]>, over: Partial<TalkLog> = {}): TalkLog {
  const log = newTalkLog(iso(T0));
  pairs.forEach(([line, r], i) => log.turns.push(heardTurn(line, r, iso(T0 + i * 15_000))));
  return { ...log, ...over };
}

const ai = (ask: TalkAnswer["ask"], question: string, preface = "", done = false): TalkAnswer => ({ ask, preface, question, done });

// ---------- 答えを見る ----------

describe("答えの聞こえ方（コード。Claude は使わない）", () => {
  it("無音・うめき声・言いよどみ・1 字は聞き取れない。短くても はい・うん・いいえ は言葉", () => {
    expect(heardOf(null)).toBe("silent");
    expect(heardOf("  ")).toBe("silent");
    for (const s of ["うー", "あー、うー", "ううー…", "えっと", "あのー", "んー", "え"]) expect(heardOf(s)).toBe("unclear");
    for (const s of ["はい", "うん", "いいえ", "ううん", "いや", "ない", "あしが いたい", "いたい"]) expect(heardOf(s)).toBe("text");
  });

  it("命に関わる言葉はコードの一覧で。打ち消しが続く所は数えない。決まった水・火の問いの はい も", () => {
    expect(dangerOf("けむりが でてる")).toBe("fire");
    expect(dangerOf("火事だ")).toBe("fire");
    expect(dangerOf("火事じゃない")).toBeNull();
    expect(dangerOf("いきが くるしい")).toBe("breath");
    expect(dangerOf("息が苦しくない")).toBeNull();
    expect(dangerOf("水が入ってきた")).toBe("water");
    expect(dangerOf("たんすに はさまれて")).toBe("trapped");
    expect(dangerOf("血が止まらない")).toBe("bleeding");
    expect(dangerOf("あしが いたい")).toBeNull();
    expect(dangerOf("ひざ", { id: "water", choice: "knee" })).toBe("water");
    expect(dangerOf("はい", undefined, { topic: "water", by: "fixed" })).toBe("water");
    // AI が言い換えた水の問いの「はい」は数えない（問いの向きが分からない）
    expect(dangerOf("はい", undefined, { topic: "water", by: "ai" })).toBeNull();
    expect(dangerOf("する", { id: "fireGas", choice: "yes" })).toBe("fire");
  });

  it("終えたい言葉", () => {
    expect(wantsEnd("もういい")).toBe(true);
    expect(wantsEnd("もう ええ わ")).toBe(true);
    expect(wantsEnd("おわり")).toBe(true);
    expect(wantsEnd("いたい")).toBe(false);
  });

  it("答えを表の入力にするのは決まった問いのままのときだけ（言葉の一致）。言い換えた問い・最初の問いは取らない", () => {
    expect(answerOf(fixedLine("injured"), "はい")).toEqual({ id: "injured", choice: "yes" });
    expect(answerOf(fixedLine("canMove"), "うごけん")).toBeUndefined();
    expect(answerOf(fixedLine("canMove"), "うごけない")).toEqual({ id: "canMove", choice: "no" });
    // AI が決まった問いの文をそのまま使った（前置きつき）: 取る
    const same: TalkLine = { text: "わかりました。けがは ありますか", question: "けがは ありますか", easy: null, by: "ai", topic: "injured" };
    expect(answerOf(same, "はい")).toEqual({ id: "injured", choice: "yes" });
    // 言い換えた（向きが逆の問いもありうる）: 取らない
    const neg: TalkLine = { text: "けがは ないですか", question: "けがは ないですか", easy: null, by: "ai", topic: "injured" };
    expect(answerOf(neg, "はい")).toBeUndefined();
    expect(answerOf(TALK_OPENING, "はい")).toBeUndefined();
    expect(answerOf(fixedLine("callee"), "はい")).toBeUndefined();
  });
});

// ---------- 次の手（コードの決まり） ----------

describe("次の手（planTalk）", () => {
  it("うめき声 → 黙る: 2 回続いたらボタンの答え方へ", () => {
    expect(planTalk(logOf([[TALK_OPENING, "うー…"]]), CTX).kind).toBe("ask");
    expect(planTalk(logOf([[TALK_OPENING, "うー…"], [fixedLine("injured"), null]]), CTX)).toEqual({ kind: "buttons" });
  });

  it("黙る → 言葉 → 黙る: 続いていないのでボタンにしない", () => {
    const log = logOf([[TALK_OPENING, null], [fixedLine("injured"), "はい"], [fixedLine("canMove"), null]]);
    expect(planTalk(log, CTX).kind).toBe("ask");
  });

  it("危ない言葉は AI より先（Claude を呼ばない）。終えたい言葉も", () => {
    expect(planTalk(logOf([[TALK_OPENING, "けむりが でてる"]]), CTX)).toEqual({ kind: "danger", danger: "fire" });
    expect(planTalk(logOf([[TALK_OPENING, "もういい"]]), CTX)).toEqual({ kind: "close", end: "wants_end" });
  });

  it("上限: 10 回聞いたら締める。5 分の残りが 1 往復を切っても締める", () => {
    const turns: Array<[TalkLine, string | null]> = [[TALK_OPENING, "きょうは ね"]];
    for (let i = 1; i < TALK_MAX_TURNS; i++) turns.push([{ ...fixedLine("callee"), topic: "callee" }, "そうねえ"]);
    expect(planTalk(logOf(turns), CTX)).toEqual({ kind: "close", end: "cap" });
    expect(planTalk(logOf([[TALK_OPENING, "あしが いたい"]]), { ...CTX, now: T0 + TALK_MAX_MS - 20_000 })).toEqual({
      kind: "close",
      end: "cap",
    });
  });

  it("表の 2 問を先に聞く（決まった問いの順）。押した答えのある話題は聞かない。機器は台帳に機器がある人だけ", () => {
    const plan = planTalk(logOf([[TALK_OPENING, "あしが いたい"]]), CTX);
    expect(plan).toMatchObject({ kind: "ask", fallback: "injured" });
    const pressed = planTalk(logOf([[TALK_OPENING, "あしが いたい"]]), { ...CTX, answers: { injured: { choice: "no", via: "press" } } });
    expect(pressed).toMatchObject({ kind: "ask", fallback: "canMove" });
    if (pressed.kind === "ask") expect(pressed.items).not.toContain("injured");
    const noDevice = planTalk(logOf([[TALK_OPENING, "あしが いたい"]]), { ...CTX, hasDevice: false });
    if (noDevice.kind === "ask") expect(noDevice.items).not.toContain("device");
  });

  it("聞く問いが全部済んだら締める（つかめた）。深く聞く問いは取れた答えに合う物だけ（決まった問いで続けるとき）", () => {
    // 押した答えで話題の最初の問いが全部済み、深く聞く問いの元の答えも「深く聞かない」側
    const answers = {
      injured: { choice: "no", via: "press" },
      canMove: { choice: "yes", via: "press" },
      exit: { choice: "yes", via: "press" },
      atHome: { choice: "unknown", via: "press" },
      water: { choice: "none", via: "press" },
      fireGas: { choice: "no", via: "press" },
      hasMedicine: { choice: "no", via: "press" },
      nearby: { choice: "family", via: "press" },
    } as const;
    const log = logOf([[TALK_OPENING, "だいじょうぶ"], [fixedLine("callee"), "いない"]]);
    expect(planTalk(log, { ...CTX, hasDevice: false, answers })).toEqual({ kind: "close", end: "grasped" });
    // 水「いいえ」は危なくない（打ち消し）
    expect(planTalk(logOf([[fixedLine("water"), "きて いない"]]), CTX).kind).toBe("ask");
  });

  it("答えに合わせて 1 段深く聞く: けが ある → どこか・血・動かせるか、動けない → 挟まれ・呼べるか、機器 → 電池・予備（決まった問いの表）", () => {
    const hurt = logOf([[TALK_OPENING, "あしが いたい"], [fixedLine("injured"), "はい"], [fixedLine("canMove"), "うごけない"]]);
    const p1 = planTalk(hurt, CTX);
    expect(p1.kind).toBe("ask");
    if (p1.kind === "ask") {
      expect(p1.items).toEqual(expect.arrayContaining(["injuryPart", "bleeding", "injuryMove", "pinned", "callHelp"]));
      // 決まった問いで続けるときは、取れた答えの深い問いを話題の最初の問いより先に
      expect(["injuryPart", "bleeding", "injuryMove", "pinned", "callHelp"]).toContain(p1.fallback);
      expect(p1.items).not.toContain("exit");
    }
    // けが ない・動ける: けがの深い問いは決まった問いでは聞かない（AI は元を聞いたあとなら選べる）
    const fine = logOf([[TALK_OPENING, "だいじょうぶ"], [fixedLine("injured"), "ない"], [fixedLine("canMove"), "うごける"]]);
    const p2 = planTalk(fine, CTX);
    if (p2.kind === "ask") expect(["injuryPart", "bleeding", "injuryMove", "pinned"]).not.toContain(p2.fallback);
    // 元をまだ聞いていない深い問いは選べない
    const p3 = planTalk(logOf([[TALK_OPENING, "あしが いたい"]]), CTX);
    if (p3.kind === "ask") expect(p3.items).not.toContain("bleeding");
    // 機器: 電池・予備は台帳に機器がある人だけ、機器を聞いたあと
    const dev = logOf([[TALK_OPENING, "でんきが こない"], [fixedLine("device"), "とまった"]]);
    const p4 = planTalk(dev, CTX);
    if (p4.kind === "ask") expect(p4.items).toEqual(expect.arrayContaining(["battery", "spare"]));
    const p5 = planTalk(dev, { ...CTX, hasDevice: false });
    if (p5.kind === "ask") expect(p5.items).not.toContain("battery");
    // 深い問いの答えも決まった問いのままなら言葉の一致で取る（出血 → 問いの表の bleeding）
    expect(heardTurn(fixedLine("bleeding"), "でてる", iso(T0)).answer).toEqual({ id: "bleeding", choice: "yes" });
    expect(heardTurn(fixedLine("injuryPart"), "あし", iso(T0))).toMatchObject({ topic: "injured", item: "injuryPart", answer: { id: "injuryPart", choice: "leg" } });
    // 表に無い深い問い（動かせるか）は答えを取らない（会話の記録と文字起こしに残る）
    expect(heardTurn(fixedLine("injuryMove"), "うごかせない", iso(T0)).answer).toBeUndefined();
  });

  it("ボタンの答え方の問い: 表の 4 列の問いのうち、押した・取れた答えの無い物。はい・いいえを問いの表の選択肢に引く", () => {
    const log = logOf([[TALK_OPENING, null], [fixedLine("injured"), "はい"]]);
    expect(buttonQuestions(log, { atHome: { choice: "yes", via: "press" } })).toEqual(["canMove", "hasMedicine"]);
    expect(yesNoChoice("injured", true)).toBe("yes");
    expect(yesNoChoice("canMove", false)).toBe("no");
    expect(talkAnswers(log)).toEqual({ injured: { choice: "yes", via: "voice" } });
  });

  it("締めの文はどれも 119 の文で終わる（出し分けない）。危ない言葉のときは 119 の文を先に。上限は「また あとで ききます」", () => {
    for (const end of ["grasped", "wants_end", "send", "unclear", "cap"] as const) {
      expect(closingOf(end).text.endsWith(EMERGENCY_TEXT)).toBe(true);
    }
    expect(closingOf("danger").text.startsWith(EMERGENCY_TEXT)).toBe(true);
    expect(closingOf("cap").text).toContain("またあとでききます");
    expect(closingOf("grasped").text).not.toContain("またあとで");
  });
});

// ---------- AI の 1 文の門 ----------

describe("AI の 1 文の門（gateLine）", () => {
  it("易しい問いは通る。「大丈夫ですか」は問いなので通る", () => {
    expect(gateLine({ preface: "あしが いたいのですね", question: "じぶんで うごけますか" })).toMatchObject({
      ok: true,
      text: "あしが いたいのですね。じぶんで うごけますか",
    });
    expect(gateLine({ preface: "", question: "だいじょうぶですか" }).ok).toBe(true);
  });

  it("問いの欄に受け止めの一言が入っていたら分ける", () => {
    expect(gateLine({ preface: "", question: "わかりました。けがは ありますか" })).toMatchObject({
      ok: true,
      preface: "わかりました",
      question: "けがは ありますか",
    });
  });

  it("診断・薬の量・助言・言い切り・119・名前・英字・長い・問いでない は外す", () => {
    const bad: Array<[string, string, string]> = [
      ["", "こっせつ かも しれません。骨折ですか", "diagnosis"],
      ["", "くすりは 2じょう のみましたか", "dose"],
      ["", "あしを ひやして くださいね？", "advice"],
      ["だいじょうぶですよ", "そばに だれか いますか", "reassure"],
      ["", "119に でんわ できますか", "dose"],
      ["", "きゅうきゅうしゃを よびましたか", "emergency"],
      ["", "おなまえを おしえて もらえますか", "personal"],
      ["Aさん", "けがは ありますか", "latin"],
      ["", "けがは ありますか。うごけますか。くすりは ありますか", "many"],
      ["", "あし", "not_question"],
      ["", "あ".repeat(41) + "か", "long"],
    ];
    for (const [preface, question, reason] of bad) expect(gateLine({ preface, question })).toEqual({ ok: false, reason });
  });
});

// ---------- Claude の 1 回 ----------

describe("次の 1 文（nextTalk。偽の client）", () => {
  it("違う答え（認知症で噛み合わない）: AI が同じ話題を易しく言い換える。AI の印。言い換えた問いの答えは表に渡さない", async () => {
    const f = fake(() => ai("injured", "どこか いたい ところは ありますか", "そうでしたか"));
    const { ai: a, usage } = aiOf(f.client);
    const log = logOf([
      [TALK_OPENING, "きょうは おまつりで ね、むすめが くるの"],
      [fixedLine("injured"), "おまつりは たのしいよ"],
    ]);
    const r = await nextTalk(log, CTX, a);
    expect(r).toMatchObject({ kind: "ask", called: true, line: { by: "ai", topic: "injured", text: "そうでしたか。どこか いたい ところは ありますか" } });
    expect(usage.rows).toEqual(["classify"]);
    expect(f.calls[0].model).toBe(HAIKU);
    expect(f.calls[0].max_tokens).toBe(TALK_SPEC.maxTokens);
    if (r.kind === "ask") expect(answerOf(r.line, "はい")).toBeUndefined();
  });

  it("方言・言いよどみ: 本人の言葉はそのまま（伏せたうえで）Claude に渡る。答えから次の話題を選べる", async () => {
    const f = fake(() => ai("canMove", "じぶんで たてますか", "あしが いたいのですね"));
    const { ai: a } = aiOf(f.client);
    const log = logOf([[TALK_OPENING, "えっと、あしが いとうて、うごけんのよ"]]);
    const r = await nextTalk(log, CTX, a);
    expect(r).toMatchObject({ kind: "ask", line: { by: "ai", topic: "canMove" } });
    const sent = JSON.stringify(f.calls[0].messages);
    expect(sent).toContain("あしが いとうて、うごけんのよ");
    expect(f.calls[0].system).toEqual(expect.arrayContaining([expect.objectContaining({ text: TALK_SYSTEM })]));
  });

  it("名前・電話は伏せてから渡す（仮名化の門）", async () => {
    const f = fake(() => ai("nearby", "そばに だれか いますか"));
    const { ai: a } = aiOf(f.client);
    const name = yamada.person.name;
    const phone = yamada.contacts.find((c) => c.phone)?.phone ?? "090-0000-0001";
    const log = logOf([[TALK_OPENING, `${name}です。むすめの でんわは ${phone}`]]);
    await nextTalk(log, CTX, a);
    const sent = JSON.stringify(f.calls[0]);
    expect(sent).not.toContain(name);
    expect(sent).not.toContain(phone);
  });

  it("医療の助言を言わせようとする答え: AI が助言を書いたら門で外し、話題の決まった問いに戻す", async () => {
    const f = fake(() => ai("hasMedicine", "くすりを 2じょう のんで くださいね？", "だいじょうぶですよ"));
    const { ai: a } = aiOf(f.client);
    const log = logOf([[TALK_OPENING, "くすりは なんじょう のめば いいの"]]);
    const r = await nextTalk(log, CTX, a);
    expect(r).toMatchObject({ kind: "ask", called: true, error: "gate", line: { by: "fixed", topic: "hasMedicine", text: TALK_TOPIC_SPECS.hasMedicine.text } });
  });

  it("危ない言葉・終えたい・聞き取れないの続きは Claude を呼ばない", async () => {
    const f = fake(() => ai("injured", "けがは ありますか"));
    const { ai: a, usage } = aiOf(f.client);
    expect(await nextTalk(logOf([[TALK_OPENING, "いきが くるしい"]]), CTX, a)).toEqual({ kind: "danger", danger: "breath", called: false });
    expect(await nextTalk(logOf([[TALK_OPENING, "もういい"]]), CTX, a)).toEqual({ kind: "close", end: "wants_end", called: false });
    expect(await nextTalk(logOf([[TALK_OPENING, null], [fixedLine("injured"), "うー"]]), CTX, a)).toEqual({ kind: "buttons", called: false });
    expect(f.calls).toHaveLength(0);
    expect(usage.rows).toEqual([]);
  });

  it("「つかめた」でも表の 2 問を聞くまでは終えない（決まった問い）。聞いたあとなら締める", async () => {
    const f = fake(() => ai("place", "いえに いますか", "", true));
    const { ai: a } = aiOf(f.client);
    const r1 = await nextTalk(logOf([[TALK_OPENING, "あしが いたい"]]), CTX, a);
    expect(r1).toMatchObject({ kind: "ask", line: { by: "fixed", topic: "injured" } });
    const done = logOf([
      [TALK_OPENING, "あしが いたい"],
      [fixedLine("injured"), "はい"],
      [fixedLine("canMove"), "うごけない"],
    ]);
    expect(await nextTalk(done, CTX, a)).toEqual({ kind: "close", end: "grasped", called: true });
  });

  it("鍵なし・失敗・形の違い・知らない話題・呼んだ回数の上限: 決まった問いで続ける", async () => {
    const log = logOf([[TALK_OPENING, "あしが いたい"]]);
    expect(await nextTalk(log, CTX, null)).toMatchObject({ kind: "ask", called: false, error: "not_configured", line: fixedLine("injured") });
    const broken = fake(() => new Anthropic.APIConnectionTimeoutError());
    expect(await nextTalk(log, CTX, aiOf(broken.client).ai)).toMatchObject({ kind: "ask", error: "failed", line: fixedLine("injured") });
    const shape = fake(() => ({ topic: "weather", preface: "", question: "はれ ですか", done: false }) as unknown as TalkAnswer);
    expect(await nextTalk(log, CTX, aiOf(shape.client).ai)).toMatchObject({ kind: "ask", error: "bad_output" });
    const capped = fake(() => ai("injured", "けがは ありますか"));
    const r = await nextTalk({ ...log, aiCalls: TALK_MAX_AI }, CTX, aiOf(capped.client).ai);
    expect(r).toMatchObject({ kind: "ask", called: false, error: "cap" });
    expect(capped.calls).toHaveLength(0);
  });

  it("聞ける話題の外（押して答えた話題・台帳に無い機器）を選んだら決まった問い", async () => {
    const f = fake(() => ai("device", "きかいは うごいて いますか"));
    const r = await nextTalk(logOf([[TALK_OPENING, "あしが いたい"]]), { ...CTX, hasDevice: false }, aiOf(f.client).ai);
    expect(r).toMatchObject({ kind: "ask", error: "topic", line: { by: "fixed", topic: "injured" } });
  });
});

describe("1 段深く聞く問い（T137b。AI は問いの表から選び、言い換えるだけ）", () => {
  const hurt = () => logOf([[TALK_OPENING, "あしが いたい"], [fixedLine("injured"), "はい"]]);

  it("けが ある のあと: AI が「出血」を選び易しく言い換える（AI の印、深い問いの id）。言い換えた答えは表に渡さない", async () => {
    const f = fake(() => ai("bleeding", "ちは でて いますか", "けがを したのですね"));
    const r = await nextTalk(hurt(), CTX, aiOf(f.client).ai);
    expect(r).toMatchObject({ kind: "ask", called: true, line: { by: "ai", topic: "injured", item: "bleeding", text: "けがを したのですね。ちは でて いますか" } });
    // AI に渡す状況には深い問いの表（何のあとか・決まった問い）
    expect(JSON.stringify(f.calls[0].messages)).toContain("bleeding（出血。けがのあと。決まった問い「血は出ていますか」）");
    if (r.kind === "ask") expect(answerOf(r.line, "はい")).toBeUndefined();
  });

  it("決まった問いの文のまま選んだら決まった問いとして読む（作り置きの声、答えは言葉の一致で取る）", async () => {
    const f = fake(() => ai("bleeding", "血は出ていますか"));
    const r = await nextTalk(hurt(), CTX, aiOf(f.client).ai);
    expect(r).toMatchObject({ kind: "ask", called: true, line: { by: "fixed", item: "bleeding", voice: "/api/signals/voice?fixed=topic-bleeding" } });
    if (r.kind === "ask") expect(answerOf(r.line, "でてる")).toEqual({ id: "bleeding", choice: "yes" });
  });

  it("元をまだ聞いていない深い問い・表に無い問いを選んだら決まった問い", async () => {
    const f = fake(() => ai("spare", "よびの でんちは ありますか"));
    const r = await nextTalk(logOf([[TALK_OPENING, "あしが いたい"]]), CTX, aiOf(f.client).ai);
    expect(r).toMatchObject({ kind: "ask", error: "topic", line: { by: "fixed", topic: "injured" } });
    const g = fake(() => ({ ask: "bloodType", preface: "", question: "けつえきがたは なにですか", done: false }) as unknown as TalkAnswer);
    expect(await nextTalk(logOf([[TALK_OPENING, "あしが いたい"]]), CTX, aiOf(g.client).ai)).toMatchObject({ kind: "ask", error: "bad_output" });
  });

  it("深い問いの言い換えでも助言・診断は門で外す（動けない → 挟まれ の問いに「うごかないで ください」）", async () => {
    const f = fake(() => ai("pinned", "うごかないで くださいね？"));
    const log = logOf([[TALK_OPENING, "うごけん"], [fixedLine("canMove"), "うごけない"]]);
    expect(await nextTalk(log, CTX, aiOf(f.client).ai)).toMatchObject({ kind: "ask", error: "gate", gate: "advice", line: { by: "fixed", item: "pinned" } });
  });
});

// ---------- 記録の形 ----------

describe("会話の記録の形", () => {
  it("送った記録を確かめる（知らない値・長すぎる物は断る）。本人の言葉だけの文と、問いと答えの文", () => {
    const log = logOf([[TALK_OPENING, "あしが いたい"], [fixedLine("injured"), "はい"], [fixedLine("canMove"), null]]);
    expect(parseTalkLog(JSON.parse(JSON.stringify(log)))).toEqual(log);
    expect(parseTalkLog({ ...log, end: "never" })).toBeNull();
    expect(parseTalkLog({ ...log, turns: [{ ...log.turns[0], topic: "weather" }] })).toBeNull();
    expect(parseTalkLog({ ...log, turns: [{ ...log.turns[0], reply: "あ".repeat(401) }] })).toBeNull();
    expect(parseTalkLog({ ...log, turns: [{ ...log.turns[1], answer: { id: "injured", choice: "maybe" } }] })).toBeNull();
    expect(talkReplies(log)).toBe("あしが いたい\nはい");
    expect(talkDialogText(log)).toContain(`問: ${VOICE_PROMPT_TEXT}\n答: あしが いたい`);
    expect(talkDialogText(log)).toContain("答: （無音）");
  });
});
