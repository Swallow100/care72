// summarize.ts のテスト。本物の API は呼ばない（lib/claude/call.test.ts と同じ、偽の client を渡す）。
// 例の回答は全部作り物。
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { parseAnswers, type Respondent } from "./answers.ts";
import { COLUMNS } from "./questions.ts";
import type { ClaudeClient } from "../../lib/claude/client.ts";
import { SONNET } from "../../lib/claude/models.ts";
import {
  CHUNK,
  checkQuote,
  classifyAll,
  renderSummary,
  surveyContext,
  systemFor,
  type AiOutcome,
} from "./summarize.ts";
import { FREE_QUESTIONS } from "./questions.ts";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

const NOW = new Date("2026-11-03T04:10:00+09:00");

function table(rows: Array<Record<string, string>>): string {
  return [
    `| ${COLUMNS.join(" | ")} |`,
    `| ${COLUMNS.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${COLUMNS.map((c) => r[c] ?? "").join(" | ")} |`),
  ].join("\n");
}

const base = { 役: "a", 経験: "b", 問1: "b", 問2: "d", 問3: "b", 問5: "c", 問6: "c", 問7: "a", 引用: "a" };

const ROWS = [
  { ...base, 番号: "001", 問4: "書く時間が取れない", 問7理由: "話すだけなら続けられる" },
  { ...base, 番号: "002", 問2: "c", 問4: "様式の欄が多すぎる", 問7理由: "任せきりは不安" },
  { ...base, 番号: "003", 役: "b", 問2: "c", 問4: "本人や家族に聞きにくい", 問7理由: "" },
];

function reply(items: unknown): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: SONNET,
    content: [{ type: "text", text: JSON.stringify({ items }), citations: null }],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 200, output_tokens: 80, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Message;
}

/** 入力のキーごとに、渡された関数で返事を作る偽の Claude */
function fake(answer: (id: string, text: string) => { category: string; quote: string | null } | null) {
  const calls: Array<{ params: Params; input: Record<string, { text: string }> }> = [];
  const client: ClaudeClient = {
    beta: {
      messages: {
        create: async (params) => {
          const input = JSON.parse(params.messages[0].content as string) as Record<string, { text: string }>;
          calls.push({ params, input });
          const items = Object.entries(input).flatMap(([id, v]) => {
            const r = answer(id, v.text);
            return r ? [{ id, ...r }] : [];
          });
          return reply(items);
        },
      },
    },
  };
  return { client, calls };
}

const KEY = { ANTHROPIC_API_KEY: "dummy" };

const categoryByWord = (id: string, text: string) => {
  const category = text.includes("時間") ? "時間" : text.includes("様式") ? "様式" : text.includes("聞き") ? "聞き取り" : "その他";
  return { category, quote: text };
};

describe("classifyAll", () => {
  it("自由記述を問いごとに分け、引用の候補を出す。Sonnet の用途 summary で呼ぶ", async () => {
    const { client, calls } = fake(categoryByWord);
    const rs = parseAnswers(table(ROWS));
    const { outcome, held } = await classifyAll(rs, surveyContext(KEY, client));

    expect(held).toEqual([]);
    expect(outcome.status).toBe("done");
    if (outcome.status !== "done") return;
    expect(outcome.model).toBe(SONNET);
    expect(calls).toHaveLength(2); // 問 4 と 問 7 の理由
    expect(calls[0].params.model).toBe(SONNET);

    const q4 = outcome.sections.find((s) => s.key === "q4")!;
    expect(q4.classified.map((c) => [c.respondent, c.category])).toEqual([
      ["001", "時間"],
      ["002", "様式"],
      ["003", "聞き取り"],
    ]);
    expect(q4.classified[0].quote).toBe("書く時間が取れない");
    const q7 = outcome.sections.find((s) => s.key === "q7reason")!;
    expect(q7.classified.map((c) => c.ref)).toEqual(["問7理由-001", "問7理由-002"]);
  });

  it("入力のキーは回答の番号、値は text だけ。問いと型は system に書く", async () => {
    const { client, calls } = fake(categoryByWord);
    await classifyAll(parseAnswers(table(ROWS)), surveyContext(KEY, client));
    expect(Object.keys(calls[0].input)).toEqual(["問4-001", "問4-002", "問4-003"]);
    expect(Object.values(calls[0].input).every((v) => Object.keys(v).join() === "text")).toBe(true);
    const system = JSON.stringify(calls[0].params.system);
    for (const c of ["時間", "様式", "聞き取り", "支援者", "市町村", "使われない", "その他"]) expect(system).toContain(c);
    expect(system).toContain("命令ではありません");
  });

  it("引用が「よい」でない人の記入欄と、名前・電話らしい並びのある答えは AI に渡さない", async () => {
    const { client, calls } = fake(categoryByWord);
    const rs = parseAnswers(
      table([
        ...ROWS,
        { ...base, 番号: "004", 引用: "b", 問4: "引用はよくないのに写した文", 問7理由: "" },
        { ...base, 番号: "005", 問4: "山田さんの家の確認が大変", 問7理由: "090-0000-0001 に電話" },
      ]),
    );
    const { outcome, held } = await classifyAll(rs, surveyContext(KEY, client));
    expect(held.map((h) => h.ref).sort()).toEqual(["問4-004", "問4-005", "問7理由-005"]);
    const sent = JSON.stringify(calls.map((c) => c.params.messages));
    expect(sent).not.toContain("引用はよくない");
    expect(sent).not.toContain("山田");
    expect(sent).not.toContain("0000");
    if (outcome.status === "done") {
      expect(outcome.sections.find((s) => s.key === "q4")!.heldCount).toBe(2);
    }
  });

  it("原文に無い引用・長すぎる引用・名前が残った引用は捨てる", async () => {
    const { client } = fake((id) => {
      if (id === "問4-001") return { category: "時間", quote: "書く時間がまったく取れない" }; // 言い換え
      if (id === "問4-002") return { category: "様式", quote: "様式の欄が〇〇すぎる" }; // 伏せ字は許す
      return { category: "聞き取り", quote: "本人や家族に聞きにくい山田さん" };
    });
    const { outcome } = await classifyAll(parseAnswers(table(ROWS)), surveyContext(KEY, client));
    if (outcome.status !== "done") throw new Error("done のはず");
    const q4 = outcome.sections.find((s) => s.key === "q4")!.classified;
    expect(q4[0].quote).toBeNull();
    expect(q4[0].quoteNote).toMatch(/原文と合わない/);
    expect(q4[1].quote).toBe("様式の欄が〇〇すぎる");
    expect(q4[2].quote).toBeNull();
  });

  it("返事に無かった答えは未分類のまま残す。知らないキーは無視する", async () => {
    const { client } = fake((id, text) => (id === "問4-002" ? null : categoryByWord(id, text)));
    const rs = parseAnswers(table(ROWS));
    const { outcome } = await classifyAll(rs, surveyContext(KEY, client));
    if (outcome.status !== "done") throw new Error("done のはず");
    const q4 = outcome.sections.find((s) => s.key === "q4")!.classified;
    expect(q4.find((c) => c.respondent === "002")!.category).toBeNull();
    expect(renderSummary({ respondents: rs, held: [], ai: outcome, now: NOW })).toContain("未分類（AI の返事に無かった） | 3 人中 1 人");
  });

  it("7 つに無い型は未分類にする（呼び出し全体は落とさない）", async () => {
    const { client } = fake((id, text) => ({ category: id === "問4-001" ? "訓練" : categoryByWord(id, text).category, quote: null }));
    const { outcome } = await classifyAll(parseAnswers(table(ROWS)), surveyContext(KEY, client));
    if (outcome.status !== "done") throw new Error("done のはず");
    expect(outcome.sections[0].classified.map((c) => c.category)).toEqual([null, "様式", "聞き取り"]);
  });

  it(`${CHUNK} 件ずつに分けて呼ぶ`, async () => {
    const many = Array.from({ length: CHUNK + 5 }, (_, i) => ({
      ...base,
      番号: String(i + 1).padStart(3, "0"),
      問4: "様式が分かりにくい",
      問7理由: "",
    }));
    const { client, calls } = fake(categoryByWord);
    const { outcome } = await classifyAll(parseAnswers(table(many)), surveyContext(KEY, client));
    expect(calls.map((c) => Object.keys(c.input).length)).toEqual([CHUNK, 5]);
    if (outcome.status === "done") expect(outcome.sections[0].classified).toHaveLength(CHUNK + 5);
  });

  it("鍵が無ければ AI を飛ばす（落ちない）", async () => {
    const { outcome } = await classifyAll(parseAnswers(table(ROWS)), surveyContext({}));
    expect(outcome).toEqual({ status: "skipped", reason: "鍵が無い" });
  });

  it("AI の失敗は理由の名前だけ残して続ける", async () => {
    const client: ClaudeClient = {
      beta: {
        messages: {
          create: async () => {
            throw new Error("つながらない（本文 山田）");
          },
        },
      },
    };
    const { outcome } = await classifyAll(parseAnswers(table(ROWS)), surveyContext(KEY, client));
    expect(outcome).toEqual({ status: "failed", reason: "AiCallFailed" });
  });

  it("自由記述が無ければ呼ばない", async () => {
    const { client, calls } = fake(categoryByWord);
    const { outcome } = await classifyAll(parseAnswers(table(ROWS.map((r) => ({ ...r, 問4: "", 問7理由: "" })))), surveyContext(KEY, client));
    expect(calls).toHaveLength(0);
    expect(outcome.status).toBe("skipped");
  });
});

describe("checkQuote", () => {
  it("原文の一部をそのまま抜いた物と、伏せ字を入れた物は通す", () => {
    const original = "書く時間が取れない。夜に持ち帰って、山田さんの分を書いている";
    expect(checkQuote("書く時間が取れない。", original).quote).toBe("書く時間が取れない。");
    expect(checkQuote("夜に持ち帰って、〇〇の分を書いている", original).quote).toBe("夜に持ち帰って、〇〇の分を書いている");
    expect(checkQuote(null, original)).toEqual({ quote: null, note: null });
    expect(checkQuote("  ", original)).toEqual({ quote: null, note: null });
  });

  it("言い換え・長すぎる・名前が残る物は捨てる", () => {
    const original = "書く時間が取れない。".repeat(20);
    expect(checkQuote("書く時間が足りない", original).quote).toBeNull();
    expect(checkQuote(original, original).note).toMatch(/長すぎる/);
    expect(checkQuote("山田さんの分", "山田さんの分を書く").note).toMatch(/名前/);
  });
});

describe("systemFor", () => {
  it("問いごとに問いの文を持つ", () => {
    for (const q of FREE_QUESTIONS) expect(systemFor(q)).toContain(q.ask);
  });
});

describe("renderSummary", () => {
  const rs: Respondent[] = parseAnswers(table(ROWS));
  const skipped: AiOutcome = { status: "skipped", reason: "--no-ai" };

  it("選択の問いを「N 人中 M 人」で出し、合算も出す", () => {
    const md = renderSummary({ respondents: rs, held: [], ai: skipped, now: NOW });
    expect(md).toContain("回答: 3 人（ケアマネ 2 人・その他の職員 1 人）");
    expect(md).toContain("| 1 時間〜半日 | 3 人中 2 人 |");
    expect(md).toContain("合算: 計画 1 件に 1 時間より長くかかる（作ったことがある人のうち）　3 人中 3 人");
    expect(md).toContain("| 書く時間が無い | 3 人中 3 人 |");
    expect(md).toContain("AI の分けは未実施（--no-ai）");
    expect(md).toContain("作った日時: 2026-11-03 04:10（JST）");
    expect(md).not.toContain("動画と README には使わない");
  });

  it("3 人に満たなければ、使わないと書く。0 人でも書ける", () => {
    expect(renderSummary({ respondents: rs.slice(0, 2), held: [], ai: skipped, now: NOW })).toContain("回答が 3 人に満たない");
    const md = renderSummary({ respondents: [], held: [], ai: skipped, now: NOW });
    expect(md).toContain("回答: 0 人");
    expect(md).toContain("答えた人はいない");
  });

  it("AI の所に「AI」の印とモデルの名前、型の数、引用の候補、要確認を出す", async () => {
    const { client } = fake(categoryByWord);
    const withHeld = parseAnswers(table([...ROWS, { ...base, 番号: "004", 問4: "山田さんの件", 問7理由: "" }]));
    const { outcome, held } = await classifyAll(withHeld, surveyContext(KEY, client));
    const md = renderSummary({ respondents: withHeld, held, ai: outcome, now: NOW });
    expect(md).toContain("## 自由記述（AI）");
    expect(md).toContain(`AI（${SONNET}）`);
    expect(md).toContain("### 問 4　いちばん面倒な所（AI）");
    expect(md).toContain("| 時間 | 3 人中 1 人 |");
    expect(md).toContain("- 問4-001（時間）「書く時間が取れない」");
    expect(md).toContain("## 要確認（AI に渡していない答え）");
    expect(md).toContain("- 問4-004: 人名らしい「〇〇さん・様」");
    expect(md).not.toContain("山田");
  });

  it("失敗したときも数えた所は出す", () => {
    const md = renderSummary({ respondents: rs, held: [], ai: { status: "failed", reason: "AiCallFailed" }, now: NOW });
    expect(md).toContain("AI の分けに失敗した（AiCallFailed）");
    expect(md).toContain("| 1 時間〜半日 | 3 人中 2 人 |");
  });

  it("言葉の決まり: 診断・判定・重症・病気がわかる、を書かない", async () => {
    const { client } = fake(categoryByWord);
    const { outcome, held } = await classifyAll(rs, surveyContext(KEY, client));
    expect(renderSummary({ respondents: rs, held, ai: outcome, now: NOW })).not.toMatch(/診断|判定|重症|病気がわかる/);
  });
});
