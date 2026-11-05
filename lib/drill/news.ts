// 訓練の新着（docs/tasks/T128.md の 3）。進める・手のあとに新しく起きた事（経過の発生・把握の行）を、目に入る所に短く出し、
// 経過の行に新着の印を付ける。見たら消える。
//
// - 見た行は端末の sessionStorage に訓練ごとの鍵の集合だけを持つ（文は入れない）。この決めはここ（ブラウザの部品 components/drill/NewsBar）
// - 初めて開いた訓練（見た記録が無い）は全部を見たことにして印を出さない（開いた時に全部が目の前にある）
// - 進める・手で画面を読み直すと行が増える。前に見た集合に無い行が新着。出したら見たことにする（次に読み直すと消える）
// - 多いときは NEWS_SHOW 件と「他 N 件」。並びは新しい順
// - 再生（終わった訓練）では出さない（呼ぶ側が渡さない）
//
// D1 を読まない。Claude を呼ばない。ブラウザの束に入る（ほかの lib/drill を値で読まない）。

/** 新着の 1 件（経過の行の鍵・開くタブ・時刻〔発災からの分〕・時刻の言い方・短い文） */
export type NewsItem = { key: string; tab: "occur" | "know"; minute: number; at: string; text: string };

/** 経過のタブ（lib/drill/timeline.ts の LogTab と同じ。値で読まない） */
type Tab = "occur" | "know" | "act";

/** 経過の行への錨の id（経過の発生・把握・対応のタブの中。帯の印・新着の href と経過の行の前の錨で同じ） */
export function logAnchorId(tab: Tab, key: string): string {
  return `log-${tab}-${key}`;
}

/** 錨の id（hash）→ タブ（経過の切替が hash を見て替える）。経過の錨でなければ null */
export function tabOfAnchor(hash: string): Tab | null {
  const m = /^#?log-(occur|know|act)-/.exec(hash);
  return m ? (m[1] as Tab) : null;
}

export const NEWS_LABELS = {
  title: "新着",
  /** 「他 3 件」 */
  more: "他",
  count: "件",
} as const;

/** 一度に並べる数 */
export const NEWS_SHOW = 3;

/** sessionStorage の鍵（訓練ごと） */
export function newsStoreKey(drillId: string): string {
  return `care72.drill.seen.${drillId}`;
}

/** 読んだ値（JSON の文字の配列）を集合に。読めなければ null（初めて開いた扱い） */
export function parseSeen(raw: string | null): Set<string> | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? new Set(v.filter((x): x is string => typeof x === "string")) : null;
  } catch {
    return null;
  }
}

/**
 * 新着（見た集合に無い行、新しい順）と、次に残す見た集合。seen が null（初めて開いた）なら新着なしで全部を見たことに
 */
export function splitNews(items: ReadonlyArray<NewsItem>, seen: ReadonlySet<string> | null): { fresh: NewsItem[]; seen: string[] } {
  const all = items.map((x) => x.key);
  if (seen === null) return { fresh: [], seen: all };
  const fresh = items.filter((x) => !seen.has(x.key)).sort((a, b) => b.minute - a.minute);
  return { fresh, seen: [...new Set([...seen, ...all])] };
}

/** 帯に並べる物（NEWS_SHOW 件）と残りの数 */
export function newsShown(fresh: ReadonlyArray<NewsItem>): { shown: NewsItem[]; rest: number } {
  return { shown: fresh.slice(0, NEWS_SHOW), rest: Math.max(0, fresh.length - NEWS_SHOW) };
}
