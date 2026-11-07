// T178: 評価の 11 回目の「直す所」の 1〜3。文は作った文で書く（記録の言葉を写さない）

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { factsOf, planOf, sentenceSlip, slipContextOf, startsMove, talkContextOf } from "./person-facts.ts";
import { EMPTY_WORLD } from "./scenarios.ts";

const source = (id: string) => {
  const p = SEED_PEOPLE.find((x) => x.person.id === id)!;
  return { ledger: p.ledger, clocks: p.clocks, contacts: p.contacts };
};
const factsFor = (id: string) => factsOf({ person: id, world: EMPTY_WORLD, state: null, actions: [], now: 600, plan: planOf(source(id)), inOutage: false, startHour: 10 });

describe("移る言葉（門と台が同じ表）", () => {
  // 自力で移れる人（p-10）と、移れない人（寝たきりの p-02）
  const mover = factsFor("p-10");
  const stuck = factsFor("p-02");
  const says = [
    // 行き先の語が無い言い方
    "これから移ります。",
    "今から移ります。",
    "透析の時間が近いので、これから移ります。",
    "道が通れるようになったので移ります。",
    "車で移ります。",
    "娘の車で移動します。",
    "父を車で移します。",
    // 読点を挟む言い方
    "父を車で避難所へ、これから移ります。",
    "高台の集会所へ、今から移ります。",
    "避難所へ車で、これから行きます。",
    "避難所へ、母を連れて移ります。",
    // 前からの形
    "これから避難所へ歩いて移ります。",
    "避難所へ行きます。",
  ];
  const talk = [
    // 頼み事・打ち消し・問い
    "移る手だてを頼みます。",
    "移る車をお願いします。",
    "移る準備の相談をしたいです。",
    "道が通れず移れません。",
    "移りますか。",
    "移るかは相談します。",
    "移ろうか迷っています。",
    // 条件つき
    "手伝う人か車が来たら、移ります。",
    "水が引いてから移ります。",
    "道が通れたら避難所へ移ります。",
    // 本人でない・家の中・機器の話
    "今から母の家へ向かいます。",
    "これから向かいます。",
    "2階へ移ります。",
    "2階へ、これから移ります。",
    "予備に移ります。",
    "場所を移ります。",
    "電話が移ります。",
    "父を2階へ移します。",
    // 計画の説明・済んだ話
    "計画では避難所に行く予定です。",
    "移るのは後です。",
    "2階にいます。",
  ];

  it.each(says)("移ると言った文: %s", (s) => {
    expect(startsMove(mover, [s])).toBe(true);
    expect(sentenceSlip(s, { ...slipContextOf(stuck, "home"), noMove: true })).toBe("move_said");
  });

  it.each(talk)("普通の会話は移ると言った事にしない: %s", (s) => {
    expect(startsMove(mover, [s])).toBe(false);
    expect(sentenceSlip(s, { ...slipContextOf(stuck, "home"), noMove: true })).not.toBe("move_said");
  });

  it("する事の短い形も読む。文ごとに見る", () => {
    expect(startsMove(mover, [null, "車で移る。"])).toBe(true);
    expect(startsMove(mover, [null, "移る手だてを頼む。家にいる"])).toBe(false);
    expect(startsMove(mover, ["さっきは道が通れず移れませんでした。これから移ります。"])).toBe(true);
    expect(startsMove(mover, ["車が来たら移ります。今は家です。"])).toBe(false);
  });

  it("通話でも移れない人は同じ文で落ちる", () => {
    expect(sentenceSlip("これから移ります。", talkContextOf(stuck))).toBe("move_said");
    expect(sentenceSlip("移る手だてを頼みます。", talkContextOf(stuck))).not.toBe("move_said");
  });
});
