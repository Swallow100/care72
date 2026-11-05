// T132: 時計と連絡先の言葉（lib/ledger-words.ts）。担当一覧の行の詳細・訓練の詳細・本人のページが同じ言葉を出す元
import { describe, expect, it } from "vitest";
import type { ClockRow } from "./db/types.ts";
import { clockText, groupByKind, nightText } from "./ledger-words.ts";
import type { Situation } from "./triage/index.ts";

const base: Omit<ClockRow, "id" | "person_id" | "label" | "kind" | "category"> = {
  value: null,
  unit: null,
  starts_on: "outage",
  source: null,
  source_note: null,
  confirmed_at: null,
  depends_on: null,
  depends_check: null,
  note: null,
  sort: 0,
};
const battery = { ...base, kind: "device" as const, category: "oxygen" as const, label: "酸素 内蔵電池", value: 2, unit: "hour" as const, source: "device_manual" as const };
const cylinder = { ...base, kind: "supply" as const, category: "oxygen" as const, label: "酸素 予備ボンベ", value: 8, unit: "hour" as const };
const warfarin = { ...base, kind: "medication" as const, category: "anticoagulant" as const, label: "ワーファリン", starts_on: "disaster" as const };
const insulin = {
  ...base,
  kind: "medication" as const,
  category: "insulin" as const,
  label: "インスリン",
  value: 4,
  unit: "day" as const,
  starts_on: "disaster" as const,
  source: "family" as const,
  source_note: "娘から",
  confirmed_at: "2026-11-01T03:00:00.000Z",
  depends_on: "refrigeration" as const,
  depends_check: "unconfirmed" as const,
};
const condition = { ...base, kind: "condition" as const, category: "dementia" as const, label: "本人の申告は参考", starts_on: "none" as const };

const before: Situation = { now: "2026-11-05T01:00:00.000Z", disasterAt: "2026-11-05T00:00:00.000Z", outageAt: null };
const during: Situation = { ...before, now: "2026-11-05T01:30:00.000Z", outageAt: "2026-11-05T00:00:00.000Z" };
const after: Situation = { ...during, now: "2026-11-05T03:00:00.000Z" };

describe("時計の 1 行", () => {
  it("平時は物の名前ときっかけから長さ。区分の語を行に混ぜない", () => {
    const t = clockText(battery);
    expect(t.line).toBe("酸素 内蔵電池 停電から 2 時間");
    expect(t.span).toBe("停電から 2 時間");
    expect(t.group).toBe("機器");
    expect(t.line).not.toContain("機器");
    expect(clockText(cylinder).line).toBe("酸素 予備ボンベ 停電から 8 時間");
    expect(clockText(cylinder).group).toBe("物品");
  });

  it("長さが未確認なら何の値かを前に置き、数え始めを添える（残りの欄に未確認を置かない）", () => {
    const t = clockText(warfarin, during);
    expect(t.line).toBe("ワーファリン 手元の量 未確認（発災から数える）");
    expect(t.missing).toBe(true);
    expect(t.left).toBeNull();
    expect(t.waiting).toBeNull();
    expect(clockText({ ...battery, value: null, unit: null }).span).toBe("持つ時間 未確認");
  });

  it("発災時は走っている時計に今の残り、超えたら超過、停電の前は未開始", () => {
    expect(clockText(battery, during).line).toBe("酸素 内蔵電池 停電から 2 時間（残り 30 分）");
    expect(clockText(battery, during).left).toMatchObject({ text: "残り 30 分", over: false });
    expect(clockText(battery, after).left).toMatchObject({ text: "超過 1 時間", over: true });
    expect(clockText(battery, before).waiting).toBe("未開始");
    expect(clockText(battery, before).line).toBe("酸素 内蔵電池 停電から 2 時間（未開始）");
    expect(clockText(insulin, during).line).toBe("インスリン 発災から 4 日（残り 3.9 日）");
  });

  it("出典と確認日は何の値か分かる形。無ければ未確認", () => {
    expect(clockText(battery).source).toBe("出典 説明書");
    expect(clockText(warfarin).source).toBe("出典 未確認");
    expect(clockText(warfarin).sourceMissing).toBe(true);
    expect(clockText(insulin).source).toBe("出典 家族 娘から");
    expect(clockText(insulin).confirmed).toBe("確認日 2026-11-01");
    expect(clockText(warfarin).confirmed).toBe("確認日 未確認");
    expect(clockText(insulin).depends).toMatchObject({ text: "冷蔵 未確認", unchecked: true });
  });

  it("走らない時計（本人の状態）は名前だけ", () => {
    const t = clockText(condition, during);
    expect(t.line).toBe("本人の申告は参考");
    expect(t.span).toBeNull();
    expect(t.left).toBeNull();
    expect(t.group).toBe("状態");
  });

  it("区分ごとの見出しで束ねる（機器 → 物品 → 薬 → 状態、空の区分は出さない）", () => {
    const groups = groupByKind([warfarin, battery, cylinder, insulin].map((k) => clockText(k)));
    expect(groups.map((g) => g.label)).toEqual(["機器", "物品", "薬"]);
    expect(groups[2].items.map((x) => x.name)).toEqual(["ワーファリン", "インスリン"]);
  });
});

describe("連絡先の夜間", () => {
  it("何の印か分かる形", () => {
    expect(nightText(1)).toBe("夜間 来訪可");
    expect(nightText(0)).toBe("夜間 来訪不可");
    expect(nightText(null)).toBe("夜間 来訪 未確認");
  });
});
