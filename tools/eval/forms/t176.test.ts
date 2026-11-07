// T176: 守りの線を本物の回の数で見る形。数え直しは前の答えを返すので、読み取りの揺れが入らない（T175 の数え直しは通り、本物の回で 3 つ外れた）
import { describe, expect, it } from "vitest";
import { GUARDS, guardFindings, unjudgedGuards } from "../guards.ts";
import { ITEMS, valuesOf, type Item } from "../scorecard-items.ts";
import { marksOf, scorecardMarkdown, type Column } from "../scorecard.ts";
import { driftOf, parentItemFields, type DriftField } from "./drift.ts";

const READ_GUARDS = ["forms-review-check", "forms-unplaced-limit", "forms-review-drift"];
const over = { "forms.reviewCheck": 1463, "forms.unplaced": 381, "forms.reviewDrift": 956 };
const args = { bench: "forms" as const, run: "r", values: over, counts: {}, repro: [] };
const rules = (client?: "real" | "replay" | "fake") => guardFindings({ ...args, ...(client ? { client } : {}) }).map((f) => f.rule);

describe("T176 読み取りの揺れの守りは本物の回で見る", () => {
  it("線の数は緩めていない", () => {
    expect(GUARDS.filter((g) => READ_GUARDS.includes(g.id)).map((g) => g.value)).toEqual([591, 157, 245]);
  });

  it("本物の回は外れになる。数え直しと偽の回は外れにも通るにもしない（未確認）", () => {
    for (const id of READ_GUARDS) expect(rules("real")).toContain(`guard:${id}`);
    for (const id of READ_GUARDS) {
      expect(rules("replay")).not.toContain(`guard:${id}`);
      expect(rules("fake")).not.toContain(`guard:${id}`);
    }
    expect(unjudgedGuards("forms", "replay").map((g) => g.id)).toEqual(READ_GUARDS);
    expect(unjudgedGuards("forms", "real")).toEqual([]);
  });

  it("ほかの守りは今までどおり全部の回で見る", () => {
    const out = guardFindings({ ...args, client: "replay", values: { "forms.unplacedContact": 3 } }).map((f) => f.rule);
    expect(out).toContain("guard:forms-contact-placed");
  });

  it("点数の表も、数え直しの列には読み取りの揺れの守りの（外）を付けない", () => {
    const item = ITEMS.find((x) => x.id === "forms.reviewCheck") as Item;
    expect(marksOf(item, undefined, { value: 1463 }, GUARDS, "real").outside).toBe(true);
    expect(marksOf(item, undefined, { value: 1463 }, GUARDS, "replay").outside).toBe(false);
    const column = (client: "real" | "replay"): Column => ({ label: client, from: "run", sources: [{ bench: "forms", run: "r", client }], cells: { "forms.reviewCheck": { value: 1463 } } });
    const md = scorecardMarkdown([column("replay"), column("real")]);
    const row = md.split("\n").find((l) => l.startsWith("| 見直しの要確認 |"));
    expect(row).toContain("| 1,463 | 1,463（外） |");
  });
});

describe("T176 差は同じコードの数え直しとだけ比べる", () => {
  const paper = (check: number) => ({ form: "x", look: { unplaced: 0 }, review: { rule: { check, kinds: {} } } });
  it("比べる元が数え直しなら差を入れる。本物の回なら（コードの差が混ざるので）数に入れない", () => {
    expect(driftOf("元", { mode: "replay", papers: [paper(3)] }, [paper(10)])).toMatchObject({ from: "元", sameCode: true, check: 7 });
    expect(driftOf("元", { mode: "real", papers: [paper(3)] }, [paper(10)])).toMatchObject({ sameCode: false, check: 7 });
    const values = (drift: unknown) => valuesOf({ bench: "forms", run: "r", client: "real", data: { run: "r", mode: "real", forms: [], inputs: [], papers: [], calls: {}, leaks: {}, drift } as never });
    expect(values({ from: "元", sameCode: true, check: 7 })["forms.reviewDrift"]).toBe(7);
    expect(values({ from: "元", sameCode: false, check: 7 })["forms.reviewDrift"] ?? null).toBeNull();
    // 前の記録（sameCode の無い物）は今までどおり
    expect(values({ from: "元", check: 7 })["forms.reviewDrift"]).toBe(7);
  });
});

describe("T176 親と同じ項目の字の欄の数（読み取りの答えの形）", () => {
  const f = (o: Partial<DriftField>): DriftField => ({ page: 1, section: "", label: "欄", shape: "text", item: null, options: [], box: null, ...o });
  it("同じ頁の □・選ぶ欄と同じ項目の字の欄を数え、空きの名前の物を分ける", () => {
    const fields = [
      f({ label: "手帳", shape: "choice", item: "a", options: ["なし", "あり"] }),
      f({ label: "身体（　）級", item: "a" }),
      f({ label: "その他【　】", item: "a" }),
      f({ label: "障害名", item: "a" }),
      f({ label: "別の項目", item: "b" }),
      f({ label: "別の頁（　）", item: "a", page: 2 }),
      f({ label: "項目なし（　）" }),
    ];
    expect(parentItemFields(fields)).toEqual({ all: 3, slot: 2 });
  });
});
