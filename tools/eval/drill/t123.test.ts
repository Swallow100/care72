// T123: 評価の台の直し（審査役に渡す流れに電話の相手、偽の client の待ちの縮尺）。本物の API は呼ばない。

import { describe, expect, it } from "vitest";
import { rngOf } from "./rng.ts";
import { fakeClaude, LATENCY_MS } from "./fake.ts";
import { storyText } from "./judge.ts";
import { parseArgs } from "./run.ts";

describe("審査役の流れに電話の相手（T123）", () => {
  it("連絡先の id から役割名を書く。無い手はそのまま", () => {
    const o = {
      plan: { scenario: "earthquake", participants: ["p-07"], scale: null },
      replay: {
        ticks: [],
        actions: [
          { kind: "call_contact", person: "p-07", target: "c-07-2", atMinute: 2600, result: { status: "connected", speech: "大丈夫です" } },
          { kind: "advise_119", person: "p-07", target: "c-07-1", atMinute: 3100, result: { status: "connected", speech: "家にいます" } },
          { kind: "note", person: "p-07", target: null, atMinute: 3200, result: { status: "noted" } },
        ],
      },
    };
    const text = storyText(o as never, new Map([["p-07", "A さん"]]), new Map([["c-07-1", "弟"], ["c-07-2", "民生委員"]]));
    expect(text).toContain("call_contact → A さん（相手 民生委員）: connected");
    expect(text).toContain("advise_119 → A さん（相手 弟）: connected");
    expect(text).toContain("note → A さん: noted");
  });
});

describe("偽の client の待ちの縮尺（T123）", () => {
  it("--latency は 0〜1。既定 0 は待たない", () => {
    expect(parseArgs(["--latency", "0.01"])).toMatchObject({ latency: 0.01 });
    expect(parseArgs([])).toMatchObject({ latency: 0 });
    expect(parseArgs(["--latency", "2"])).toMatchObject({ error: expect.any(String) });
    expect(LATENCY_MS.director).toBeGreaterThan(LATENCY_MS.persona!);
  });

  it("縮尺を付けると役の目安の分だけ待つ", async () => {
    const c = fakeClaude({ rng: rngOf("t123"), latency: 0.002 });
    const t0 = Date.now();
    await c.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 100,
      system: [{ type: "text", text: "監督" }],
      messages: [{ role: "user", content: "{}" }],
    } as never);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(5);
  });
});
