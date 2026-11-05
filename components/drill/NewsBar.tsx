"use client";

// 訓練の新着（docs/tasks/T128.md の 3）。進める・手のあとに新しく起きた事（経過の発生・把握の行）を上の帯の下に短く並べ、
// 経過の行に新着の印を付ける（lib/drill/news.ts の決め）。見た行の鍵は端末の sessionStorage（訓練ごと。文は入れない）。
// - 初めて開いた訓練は全部を見たことにして出さない。画面の読み直し（進める・手の router.refresh）で行が増えたら、増えた物が新着
// - 並べるのは新しい物から 3 件と「他 N 件」。押すと経過のその行へ（#log-<タブ>-<鍵>。components/drill/LogTabs がタブを替えて送る）
// - 経過の行の印は CSS で付ける（経過はサーバーで描くので、行の前の錨 [data-anchor] とまとまりの見出しの [data-new-for] を選ぶ）
// - 何も無ければ何も描かない（空の帯を作らない）。色は使わない（太字の「新着」と左の細い線）
// 進行中の画面だけで使う（再生では渡さない）。

import { useEffect, useRef, useState } from "react";
import { logAnchorId, NEWS_LABELS, newsShown, newsStoreKey, parseSeen, splitNews, type NewsItem } from "@/lib/drill/news";

/** CSS の属性の値に入れる文字（鍵は英数字と - だけだが、念のため引用符と \ を外す） */
const attr = (v: string) => v.replace(/["\\]/g, "");

export function NewsBar({ drillId, items, className = "" }: { drillId: string; items: ReadonlyArray<NewsItem>; className?: string }) {
  const [fresh, setFresh] = useState<NewsItem[]>([]);
  const sig = items.map((x) => x.key).join(" ");
  const done = useRef<string | null>(null);

  useEffect(() => {
    // 同じ行の並び（開発の 2 回の effect・行の増えない読み直し）では決め直さない
    if (done.current === sig) return;
    done.current = sig;
    const key = newsStoreKey(drillId);
    let seen: Set<string> | null = null;
    try {
      seen = parseSeen(window.sessionStorage.getItem(key));
    } catch {
      seen = null;
    }
    const r = splitNews(items, seen);
    setFresh(r.fresh);
    try {
      window.sessionStorage.setItem(key, JSON.stringify(r.seen));
    } catch {
      // 保存できなくても今回の新着は出す（次に開くと全部を見たことになる）
    }
    // items は sig が同じなら同じ中身（サーバーで描いた行）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drillId, sig]);

  if (fresh.length === 0) return null;
  const { shown, rest } = newsShown(fresh);
  const css = [
    `${fresh.map((x) => `[data-new-for~="${attr(x.key)}"]`).join(",")}{display:inline-block}`,
    `${fresh.map((x) => `[data-anchor="${attr(x.key)}"]+li`).join(",")}{box-shadow:inset 2px 0 0 var(--color-ink);padding-left:0.5rem}`,
  ].join("\n");
  return (
    <div className={`flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm ${className}`} data-news={fresh.length}>
      <span className="font-bold">
        {NEWS_LABELS.title} <span className="tabular-nums">{fresh.length}</span>
      </span>
      {shown.map((x) => (
        <a
          key={x.key}
          href={`#${logAnchorId(x.tab, x.key)}`}
          className="-mx-1 min-w-0 truncate rounded px-1 sm:max-w-[28rem]"
          title={`${x.at} ${x.text}`}
          data-press
          data-news-item={x.key}
        >
          <span className="text-xs text-muted tabular-nums">{x.at}</span> {x.text}
        </a>
      ))}
      {rest > 0 && (
        <span className="text-xs text-muted tabular-nums" data-news-rest={rest}>
          {NEWS_LABELS.more} {rest} {NEWS_LABELS.count}
        </span>
      )}
      <style>{css}</style>
    </div>
  );
}
