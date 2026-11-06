// 偽の client（docs/tasks/T156.md）。Claude を呼ばない。
// - 偽の使う人: 目標ごとの最短の手（personas.ts の route）を順になぞる。画面に無い手は、出ていれば押す物（optional）なら飛ばし、
//   ほかはあきらめる。並びを終えたら「済んだ」。stray に入れた目標では、初めに関係の無い物を 1 つ押して戻る（迷いの数え方を試す）
// - 偽の審査役: 決まった形（通しやすさ 3、迷いのあった最初の物を分かりにくい言葉に、候補の頭を疑うファイルに）
// 返事は本物と同じ JSON の文（lib/claude/call.ts の readJson が読む）で、token は文の長さから推し量る（drill の fake.ts と同じ）

import type Anthropic from "@anthropic-ai/sdk";
import type { ClaudeClient } from "../../../lib/claude/client.ts";
import { sentText, tokensOf } from "../drill/fake.ts";
import { ACTOR_SYSTEM } from "./actor.ts";
import { JUDGE_SYSTEM, type JudgeOut } from "./judge.ts";
import type { Persona, RouteMove } from "./personas.ts";
import type { Move } from "./types.ts";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

function message(params: Params, text: string): Message {
  return {
    id: `msg_fake_${Math.random().toString(36).slice(2, 10)}`,
    type: "message",
    role: "assistant",
    model: params.model,
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: tokensOf(sentText(params)), output_tokens: tokensOf(text) + 150, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Message;
}

function systemHead(params: Params): string {
  const s = params.system;
  if (typeof s === "string") return s;
  return (s ?? []).map((b) => b.text).join("\n");
}

/** 押せる物の 1 行（actor.ts の pageForActor の形）から番号と名前 */
export function parseItemLine(line: string): { ref: number; role: string; name: string; zone?: string } | null {
  const m = /^\[(\d+)\] (\S+) (.*)$/.exec(line);
  if (!m) return null;
  let name = m[3];
  const at = name.lastIndexOf(" @");
  const zone = at >= 0 ? name.slice(at + 2) : undefined;
  for (const cut of [" @", " {", " （押せない）", " ✓", " ="]) {
    const i = name.indexOf(cut);
    if (i >= 0) name = name.slice(0, i);
  }
  return { ref: Number(m[1]), role: m[2], name: name === "（名前なし）" ? "" : name, ...(zone ? { zone } : {}) };
}

/** 窓を閉じる物の名前 */
const DISMISS = ["出ない", "閉じる", "取消"];

export type FakeActorOptions = {
  /** 初めに寄り道する目標の id */
  stray?: readonly string[];
};

/** 偽の使う人。persona の目標の文から route を引く */
export function fakeActor(list: readonly Persona[], opts: FakeActorOptions = {}): ClaudeClient {
  const routes = new Map<string, { id: string; route: readonly RouteMove[] }>();
  for (const p of list) for (const g of p.goals) routes.set(g.text, { id: g.id, route: g.route });
  const pos = new Map<string, number>();
  const strayed = new Set<string>();
  const answer = (params: Params): Move => {
    const body = JSON.parse(String(params.messages[0].content)) as { goal: string; page: { items: string[] } };
    const items = body.page.items.map(parseItemLine).filter((x): x is NonNullable<typeof x> => x !== null);
    const r = routes.get(body.goal);
    const move = (m: Partial<Move> & Pick<Move, "action">): Move => ({ ref: null, text: null, thought: "", expect: "", surprised: false, ...m });
    if (!r) return move({ action: "give_up", thought: "目標が分からない" });
    const key = body.goal;
    if (opts.stray?.includes(r.id) && !strayed.has(key)) {
      // 寄り道: 道の最初の物でない物を押し、次の手で戻る
      strayed.add(key);
      const first = r.route[0];
      const firstName = first && "click" in first ? first.click : null;
      const other = items.find((i) => i.role === "link" && i.name && i.name !== firstName);
      if (other) {
        pos.set(`${key}#back`, 1);
        return move({ action: "click", ref: other.ref, thought: `「${other.name}」かと思った`, expect: "目標の画面が開く" });
      }
    }
    if (pos.get(`${key}#back`) === 1) {
      pos.set(`${key}#back`, 0);
      return move({ action: "back", thought: "違った。戻る", expect: "前の画面", surprised: true });
    }
    let i = pos.get(key) ?? 0;
    while (i < r.route.length) {
      const m = r.route[i];
      if ("back" in m) {
        pos.set(key, i + 1);
        return move({ action: "back", thought: "戻る", expect: "前の画面" });
      }
      const name = "click" in m ? m.click : "type" in m ? m.type : m.select;
      const nth = "click" in m || "type" in m ? (m.nth ?? 0) : 0;
      const exact = items.filter((x) => x.name === name);
      const starts = items.filter((x) => x.name.startsWith(name));
      // 名前の引き方は check.ts の itemByName と同じ（同じ名前の nth → で始まる名前の nth → 頭の物）
      const hit = exact[nth] ?? starts[nth] ?? exact[0] ?? starts[0] ?? null;
      if (!hit) {
        if ("click" in m && m.optional) {
          i += 1;
          continue;
        }
        // 窓が開いていて先へ進めない（訓練の着信など）: 閉じる物を押す（位置は進めない）
        const close = items.find((x) => DISMISS.includes(x.name));
        if (close && items.every((x) => x.zone?.startsWith("窓"))) {
          return move({ action: "click", ref: close.ref, thought: "窓を閉じる", expect: "窓が閉じる" });
        }
        pos.set(key, i);
        return move({ action: "give_up", thought: `「${name}」が見つからない` });
      }
      pos.set(key, i + 1);
      if ("click" in m) return move({ action: "click", ref: hit.ref, thought: `「${name}」を押す`, expect: "次の画面" });
      if ("type" in m) return move({ action: "type", ref: hit.ref, text: m.text, thought: `「${name}」に書く`, expect: "字が入る" });
      return move({ action: "select", ref: hit.ref, text: m.option, thought: `「${name}」で選ぶ`, expect: "選ばれる" });
    }
    return move({ action: "done", thought: "済んだと思う" });
  };
  const judge = (params: Params): JudgeOut => {
    const body = JSON.parse(String(params.messages[0].content)) as { lost: Array<{ path: string; target: string | null }>; candidates: string[] };
    const first = body.lost.find((l) => l.target) ?? null;
    return {
      ease: 3,
      summary: "偽の審査役の講評",
      unclear: first ? [{ word: first.target ?? "", path: first.path, why: "偽の審査役", idea: "確認" }] : [],
      findings: first
        ? [{ path: first.path, target: first.target, weight: "中", title: "偽の審査役の指摘", repro: ["開く"], suspects: body.candidates.slice(0, 1), accept: "迷い 0 回" }]
        : [],
    };
  };
  return {
    beta: {
      messages: {
        create: async (params: Params) => {
          const head = systemHead(params);
          if (head.startsWith(ACTOR_SYSTEM)) return message(params, JSON.stringify(answer(params)));
          if (head.startsWith(JUDGE_SYSTEM)) return message(params, JSON.stringify(judge(params)));
          throw new Error("偽の client が知らない呼び出し");
        },
      },
    },
  };
}
