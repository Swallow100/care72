// 手元の MCP（care72-local）の道具の表。名前・説明・入力の形と、data.ts のどれを呼ぶか。どれも読むだけ。
// .claude/agents の persona-tester が道具の名前（mcp__care72-local__check_leaks など）を書くので、名前を変えたらそちらも直す
// （tools/claude-code.test.ts が食い違いを見る）。

import type { DatabaseSync } from "node:sqlite";
import * as z from "zod";
import { DRILL_EVENT_KINDS } from "../../../lib/db/types.ts";
import {
  aiUsage,
  checkLeaks,
  drillDetail,
  drillEvents,
  EVENT_LIMIT,
  getPerson,
  listDrills,
  listPeople,
  loadRoster,
} from "./data.ts";

export type ToolContext = {
  /** 手元の D1 を読むだけで開く。無ければ LocalD1Missing を投げる */
  open: () => DatabaseSync;
};

/** 道具の答え。found が false なら誤りとして返す */
export type ToolAnswer = { found: true; value: unknown } | { found: false; message: string };

export type ToolSpec = {
  name: string;
  title: string;
  description: string;
  input: z.ZodRawShape;
  run: (args: Record<string, unknown>, ctx: ToolContext) => ToolAnswer;
};

function tool<S extends z.ZodRawShape>(spec: {
  name: string;
  title: string;
  description: string;
  input: S;
  run: (args: z.output<z.ZodObject<S>>, ctx: ToolContext) => ToolAnswer;
}): ToolSpec {
  return spec as unknown as ToolSpec;
}

const found = (value: unknown): ToolAnswer => ({ found: true, value });

function withDb<T>(ctx: ToolContext, f: (db: DatabaseSync) => T): T {
  const db = ctx.open();
  try {
    return f(db);
  } finally {
    db.close();
  }
}

const personRef = z.string().min(1).describe("仮名（A さん・A）か people の id（p-01）");

export const TOOLS: readonly ToolSpec[] = [
  tool({
    name: "people",
    title: "担当の本人（仮名）",
    description:
      "手元の D1 の本人を仮名（A さん〜、people の id の順）で一覧にする。年齢・世帯・要介護度・スマホ・機器・時計・連絡先の役割名。氏名・住所・電話は返さない",
    input: {},
    run: (_, ctx) => withDb(ctx, (db) => found(listPeople(loadRoster(db)))),
  }),
  tool({
    name: "person",
    title: "本人 1 人の仮名の台帳",
    description:
      "1 人の台帳を、Claude（ペルソナ・監督）に渡るのと同じ仮名の形（lib/pseudonym の ClaudePerson）で返す。ペルソナの出力が台帳と食い違わないかを見るのに使う",
    input: { ref: personRef },
    run: ({ ref }, ctx) =>
      withDb(ctx, (db) => {
        const p = getPerson(loadRoster(db), ref);
        return p ? found(p) : { found: false, message: `本人が見つからない: ${ref}。people で仮名を見る` };
      }),
  }),
  tool({
    name: "drills",
    title: "訓練記録の一覧",
    description: "訓練記録（drills）を新しい順に。筋書き・状態・今の刻み・時刻・採点の有無・出来事の数",
    input: { limit: z.number().int().min(1).max(200).optional().describe("何件まで（既定 20）") },
    run: ({ limit }, ctx) => withDb(ctx, (db) => found(listDrills(db, limit ?? 20))),
  }),
  tool({
    name: "drill",
    title: "訓練記録 1 つの中身",
    description:
      "訓練 1 つの世界の状態と採点（仮名に置き換え済み）、出来事の種類ごとの数、仮名ごと・種類ごとの数と最初の時刻。採点（連絡の順と抜け）の確かめに使う",
    input: { drill_id: z.string().min(1) },
    run: ({ drill_id }, ctx) =>
      withDb(ctx, (db) => {
        const d = drillDetail(db, loadRoster(db), drill_id);
        return d ? found(d) : { found: false, message: `訓練が見つからない: ${drill_id}。drills で id を見る` };
      }),
  }),
  tool({
    name: "drill_events",
    title: "訓練の出来事",
    description:
      "訓練の出来事を seq の順に。本人は仮名、payload は仮名に置き換えて返し、置き換える前にあった元の氏名・電話・町名は leaks に「何が」だけを書く（値は返さない）。kind・本人・刻みで絞れる",
    input: {
      drill_id: z.string().min(1),
      kind: z.enum(DRILL_EVENT_KINDS).optional().describe("persona_turn・action など"),
      person: personRef.optional(),
      from_step: z.number().int().min(0).optional(),
      to_step: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(EVENT_LIMIT.max).optional().describe(`何件まで（既定 ${EVENT_LIMIT.default}）`),
    },
    run: (a, ctx) =>
      withDb(ctx, (db) =>
        found(
          drillEvents(db, loadRoster(db), {
            drillId: a.drill_id,
            kind: a.kind,
            person: a.person,
            fromStep: a.from_step,
            toStep: a.to_step,
            limit: a.limit,
          }),
        ),
      ),
  }),
  tool({
    name: "check_leaks",
    title: "漏れの確かめ",
    description:
      "文（ペルソナの出力の JSON など）に、手元の D1 の本人と連絡先の元の氏名・電話・町名、電話番号らしい並びが入っていないかを確かめる。返すのは「A さんの電話」のような何が漏れたかだけで、値は返さない。空なら漏れなし",
    input: { text: z.string().describe("確かめる文") },
    run: ({ text }, ctx) => withDb(ctx, (db) => found(checkLeaks(loadRoster(db), text))),
  }),
  tool({
    name: "ai_usage",
    title: "AI の呼び出しの数",
    description: "ai_calls を日・事業所・用途・モデル・状態ごとに数え、token を足す（表に本文は無い）。訓練を回したあとの回数を見る",
    input: { day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD（JST）。無ければ全部") },
    run: ({ day }, ctx) => withDb(ctx, (db) => found(aiUsage(db, day))),
  }),
];

export const TOOL_NAMES: readonly string[] = TOOLS.map((t) => t.name);
