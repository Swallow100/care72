// T88: 録音のまとめの本人の仮名（A さん）は、保存と画面では「本人」に。Claude には仮名で渡したまま（名前を渡さない）。
// 本物の API は呼ばない（偽の client）。

import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Summary } from "../../components/list/Summary.tsx";
import { SEED_PEOPLE, seedConsents } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { AskJsonContext } from "../claude/call.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { HAIKU } from "../claude/models.ts";
import { d1UsageStore } from "../claude/usage.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { pseudonymize, pseudonymizeText } from "../pseudonym/index.ts";
import { summarize } from "./summary.ts";
import { ownCall, summaryOf } from "./view.ts";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;
beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

function fake(summary: string) {
  const calls: Params[] = [];
  const client: ClaudeClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return {
            id: "msg_test",
            type: "message",
            role: "assistant",
            model: HAIKU,
            content: [{ type: "text", text: JSON.stringify({ summary }), citations: null }],
            stop_reason: "end_turn",
            stop_details: null,
            stop_sequence: null,
            usage: { input_tokens: 200, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          } as unknown as Message;
        },
      },
    },
  };
  return { client, calls };
}

const aiCtx = (claude: ClaudeClient): AskJsonContext => ({
  env: { ANTHROPIC_API_KEY: "dummy" },
  usage: d1UsageStore(db),
  office: { id: "office-demo", kind: "demo" },
  now: () => new Date("2026-11-04T01:30:00.000Z"),
  claude,
});

const p01 = SEED_PEOPLE.find((p) => p.person.id === "p-01")!;
const { key } = pseudonymize([{ person: p01.person, ledger: p01.ledger, contacts: p01.contacts, clocks: p01.clocks, consents: seedConsents(p01) }]);

describe("録音のまとめの仮名は「本人」に（T88）", () => {
  it("Claude には仮名で渡し、返ったまとめの「A さん」は保存の文で「本人」に", async () => {
    const { client, calls } = fake("A さんは家にいて、水が床まで来たと言っている");
    const text = pseudonymizeText("山田です。水が床まで来た。娘の森 恵子さんに電話した", key);
    const r = await summarize({ text, key }, aiCtx(client));
    expect(r).toEqual({ ok: true, model: HAIKU, summary: "本人は家にいて、水が床まで来たと言っている" });
    const sent = JSON.stringify(calls[0].messages);
    expect(sent).toContain("A さんです");
    for (const s of ["山田", "ハナ", "森 恵子", "恵子"]) expect(sent, s).not.toContain(s);
  });

  it("画面（担当一覧の行）は、前に保存した「A さん」のまとめも「本人」で出す。直した人の文は変えない", () => {
    expect(summaryOf({ ai_summary: "A さんは無事で、娘が来ている" })).toEqual({ text: "本人は無事で、娘が来ている", by: "ai", error: null });
    expect(summaryOf({ ai_summary: "Aさんは家にいる", summary: "A さんと書いた人の文" })).toEqual({ text: "A さんと書いた人の文", by: "human", error: null });
    const html = renderToStaticMarkup(
      createElement(Summary, { signalId: "s-1", transcript: "水が来た", summary: summaryOf({ ai_summary: "A さんの家に水が来た" }) }),
    );
    expect(html).toContain("本人の家に水が来た");
    expect(html).not.toContain("A さん");
  });

  it("本人の仮名だけを戻す（AA さん・役割名・伏せ字はそのまま）", () => {
    expect(ownCall("A さんと AA さんと支援者 1、（氏名）")).toBe("本人と AA さんと支援者 1、（氏名）");
  });
});
