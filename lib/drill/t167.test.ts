// T167（docs/tasks/T167.md）の訓練のテスト。偽の答えだけ（本物の Claude を呼ばない）。
// 評価の 8 回目で見えた形を、架空の入力で作り直して確かめる（記録の台詞は写さない）。

import { describe, expect, it } from "vitest";
import { TALK_FIXED_SPEECH, speechRuleOf, type TalkLine, type TalkReply } from "./dialogue.ts";
import { closesCall, QUICK_KINDS, QUICK_REPLIES, quickKindOf, quickReply } from "./talk-quick.ts";
import { talkRound } from "./talk-turn.ts";
import { EMPTY_WORLD } from "./scenarios.ts";

const cm = (text: string, ask?: TalkLine["ask"]): TalkLine => ({ who: "cm", text, ai: false, minute: 10, ...(ask ? { ask } : {}) });
const them = (text: string, ai = true): TalkLine => ({ who: "them", text, ai, minute: 11 });

describe("通話の短い返事（呼び出しを減らす）", () => {
  it("相づち・待って・聞こえますか・何でしたっけ・曜日・後で電話はコードで返す", () => {
    for (const [said, kind] of [
      ["はい", "ack"],
      ["分かりました。", "ack"],
      ["うう……ちょっと待ってください", "wait"],
      ["もしもし、聞こえますか、電波が悪いみたいで", "hear"],
      ["あー、はい、はい、それで、何でしたっけ", "again"],
      ["えっと、今日は何曜日でしたっけ", "offtopic"],
      ["あとでまた電話します", "later"],
    ] as const) {
      expect(quickKindOf({ said }, [])).toBe(kind);
    }
    expect(quickKindOf({ ask: "will_call_back", said: "また後で電話します" }, [])).toBe("later");
    expect(quickKindOf({ ask: "stay", said: "今いる所で待っていてください。また連絡します" }, [])).toBe("stay");
  });

  it("中身のある文と初めて聞く問いは本人役が答える（コードにしない）", () => {
    for (const said of ["酸素の機械の音がしていますか", "さっきは家にいると言っていましたが、避難所にいるんですか", "そちらは寒くないですか、毛布はありますか", "近くに誰かいますか", "停電は続いていますか", "今どこにいますか", "はい、薬が足りないのですね"]) {
      expect(quickKindOf({ said }, [])).toBeNull();
    }
    expect(quickKindOf({ ask: "where", said: "今どこにいますか" }, [])).toBeNull();
    expect(quickKindOf({ ask: "advise_119", said: "具合が悪いなら 119 に電話してください" }, [])).toBeNull();
  });

  it("同じ通話でもう答えた問いはコードで返す（ボタンと文のどちらでも）。答えられなかった問いは本人役に", () => {
    const lines = [cm("けがはありませんか", "injured"), them("けがはありません。")];
    expect(quickKindOf({ said: "けがはありませんか" }, lines)).toBe("repeat");
    expect(quickKindOf({ ask: "injured", said: "けがはありませんか" }, lines)).toBe("repeat");
    expect(quickKindOf({ ask: "where", said: "今どこにいますか" }, lines)).toBeNull();
    const failed = [cm("けがはありませんか", "injured"), them(TALK_FIXED_SPEECH, false)];
    expect(quickKindOf({ ask: "injured", said: "けがはありませんか" }, failed)).toBeNull();
  });

  it("返事は同じ通話で重ねず、決まりの語を書かない", () => {
    const first = quickReply("ack", [], 0);
    const second = quickReply("ack", [them(first, false)], 0);
    expect(second).not.toBe(first);
    expect(quickReply("wait", [], 1)).not.toBe(quickReply("wait", [], 2));
    for (const k of QUICK_KINDS) {
      for (const x of QUICK_REPLIES[k]) {
        expect(speechRuleOf(x)).toBeNull();
        expect(x).not.toMatch(/曜日|[月火水木金土日]曜|無事|けが|さん/);
      }
    }
  });

  it("コードの返事はそのまま行に残り、AI の印も頼み事も呼び出しの数えも付かない", () => {
    const reply: TalkReply = { said: "はい", speech: "はい、どうぞ。", asks: [], ai: false, called: false, coded: true };
    const r = talkRound({ world: EMPTY_WORLD, person: "p-01", at: 100, text: "はい", reply, fit: null });
    expect(r.them).toMatchObject({ who: "them", text: "はい、どうぞ。", ai: false });
    expect(r.them.asks).toBeUndefined();
    expect(r.world.counts?.call ?? 0).toBe(0);
    // 印の無い言葉は今までどおり固定の言葉（鍵なし・失敗）
    const failed: TalkReply = { said: "はい", speech: "何か", asks: [], ai: false, called: true };
    expect(talkRound({ world: EMPTY_WORLD, person: "p-01", at: 100, text: "はい", reply: failed, fit: null }).them.text).toBe(TALK_FIXED_SPEECH);
  });

  it("また後で電話します・待機の指示は通話を切る合図", () => {
    expect(closesCall({ ask: "will_call_back" })).toBe(true);
    expect(closesCall({ ask: "stay" })).toBe(true);
    expect(closesCall({ text: "あとでまた電話します" })).toBe(true);
    expect(closesCall({ ask: "where" })).toBe(false);
    expect(closesCall({ text: "はい" })).toBe(false);
  });
});
