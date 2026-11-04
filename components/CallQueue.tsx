"use client";

// 通話の記録を端末に貯めて送る係（T71。lib/offline/queue.ts を頁に 1 つ）。layout が全部の頁を包む。
// ケアマネの役のときだけ持ち主（cm:<アカウントの id>）を受け、ほかの役では何もしない（本人・家族の信号の outbox には触らない）。
// 送り直すのは 開いたとき・つながったとき（online）・頁が見えたとき・20 秒ごと（残っている間）。1 件でも届いたら読み直す
// （聞いた安否は届いてからサーバーの表が色と順を決める。端末の中では動かさない）。
// 行の詳細の電話のボタン（components/list/CallButtons.tsx）は useCallQueue で貯めて、保留の数を読む。

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  CALL_QUEUE_KEY,
  createCallQueue,
  fetchCallTransport,
  type CallBody,
  type CallDelivery,
  type CallQueue,
  type Lock,
  type QueuedCall,
  type StorageLike,
} from "@/lib/offline/queue";

export type CallQueueApi = {
  /** 残っている自分の物（古い順） */
  items: QueuedCall[];
  send(body: CallBody): Promise<CallDelivery>;
  /** 今すぐ送り直す（ログアウトの「送信待ち」） */
  flush(): Promise<void>;
  /** 自分の残りを送らずに消す（ログアウトの「破棄」） */
  discard(): void;
};

const Ctx = createContext<CallQueueApi | null>(null);

/** 行の詳細から使う。ケアマネの役でなければ null（そのときは今までどおり 1 回だけ送る） */
export const useCallQueue = () => useContext(Ctx);

const RETRY_MS = 20_000;

/** 頁の中で持ち主ごとに 1 つ（行を開くたびに作らない） */
const queues = new Map<string, CallQueue>();

function localStore(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 同じ端末の別のタブと同時に送らない錠。無い端末は同じタブの中だけで順に */
function browserLock(): Lock | undefined {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) return undefined;
  return <T,>(fn: () => Promise<T>) => locks.request("care72.calls", () => fn()) as Promise<T>;
}

function queueFor(owner: string): CallQueue {
  let q = queues.get(owner);
  if (!q) {
    q = createCallQueue({ storage: localStore(), owner, transport: fetchCallTransport(), lock: browserLock() });
    queues.set(owner, q);
  }
  return q;
}

export function CallQueueProvider({ owner, children }: { owner: string | null; children: React.ReactNode }) {
  const router = useRouter();
  const queue = useMemo(() => (owner && typeof window !== "undefined" ? queueFor(owner) : null), [owner]);
  const [items, setItems] = useState<QueuedCall[]>([]);

  useEffect(() => {
    if (!queue) {
      setItems([]);
      return;
    }
    const read = () => setItems(queue.items());
    read();
    const off = queue.onChange(read);
    const flush = async () => {
      const r = await queue.flush().catch(() => null);
      if (r && r.sent.length > 0) router.refresh();
    };
    void flush();
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === CALL_QUEUE_KEY) read();
    };
    const onOnline = () => void flush();
    const onVisible = () => {
      if (document.visibilityState === "visible") void flush();
    };
    const timer = window.setInterval(() => {
      if (queue.items().length > 0) void flush();
    }, RETRY_MS);
    window.addEventListener("storage", onStorage);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      off();
      window.clearInterval(timer);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [queue, router]);

  const api = useMemo<CallQueueApi | null>(
    () =>
      queue
        ? {
            items,
            async send(body) {
              const d = await queue.send(body);
              if (d.kind === "sent") router.refresh();
              return d;
            },
            async flush() {
              const r = await queue.flush().catch(() => null);
              if (r && r.sent.length > 0) router.refresh();
            },
            discard: () => queue.discard(),
          }
        : null,
    [queue, items, router],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
