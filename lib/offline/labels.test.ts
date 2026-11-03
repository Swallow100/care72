// T71 の画面の言葉と、Service Worker と合わせる名前
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as core from "./sw-core.js";
import { CACHE_PREFIX, CACHED_AT_META, copyTime, isPhonePath, KEEP_MESSAGE, OFFLINE_LABELS } from "./labels.ts";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("SW と画面で同じ名前", () => {
  it("meta の名前・知らせ・鍵の頭", () => {
    expect(CACHED_AT_META).toBe(core.CACHED_AT_META);
    expect(KEEP_MESSAGE).toBe(core.KEEP_MESSAGE);
    expect(CACHE_PREFIX).toBe(core.CACHE_PREFIX);
  });
});

describe("帯の言葉", () => {
  it("写した時刻は日本の時刻の「月/日 時:分」", () => {
    expect(copyTime("2026-11-04T00:12:00.000Z")).toBe("11/4 09:12");
    expect(copyTime("2026-11-03T15:05:00.000Z")).toBe("11/4 00:05");
    expect(copyTime("x")).toBe("");
  });

  it("2〜4 字の漢語。使わない語を含まない", () => {
    for (const w of Object.values(OFFLINE_LABELS)) {
      expect(w.length, w).toBeGreaterThanOrEqual(2);
      expect(w.length, w).toBeLessThanOrEqual(4);
      expect(w).not.toMatch(/診断|判定|重症|緊急度|札|[をがの]/);
    }
  });

  it("本人・家族のスマホの頁だけ大きな字", () => {
    expect(isPhonePath("/me")).toBe(true);
    expect(isPhonePath("/family")).toBe(true);
    expect(isPhonePath("/")).toBe(false);
    expect(isPhonePath("/people/p-01")).toBe(false);
  });
});

describe("つなぎ方", () => {
  it("layout が SW を入れ、帯をヘッダーの下に置き、通話の記録の係で頁を包む", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toContain("<SwRegister />");
    expect(layout).toMatch(/<AppHeader \/>[\s\S]*<OfflineBand stamp=/);
    expect(layout).toMatch(/<CallQueueProvider owner=\{callOwner\}>[\s\S]*\{children\}[\s\S]*<\/CallQueueProvider>/);
  });

  it("SW の登録は scope / で、HTTP の写しを使わずに更新を見る", () => {
    const reg = read("components/SwRegister.tsx");
    expect(reg).toMatch(/register\(SW_URL, \{ scope: "\/", updateViaCache: "none" \}\)/);
    expect(reg).toContain("export const SW_ENABLED = true;");
  });

  it("電話のボタンは貯める係を通し、保留の数を出す", () => {
    const buttons = read("components/list/CallButtons.tsx");
    expect(buttons).toContain("useCallQueue()");
    expect(buttons).toContain("data-pending=");
  });

  it("災害モードの読み直しは通信が無い間は止める（落ちると頁を開き直して行が閉じる）", () => {
    expect(read("components/disaster/AutoRefresh.tsx").match(/navigator\.onLine/g)).toHaveLength(2);
  });
});
