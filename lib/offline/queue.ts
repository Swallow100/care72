// 通話の記録（担当一覧の行の詳細の電話・不通・通話と、通話で聞いた安否）を端末に貯め、つながったら送る（docs/tasks/T71.md）。
// lib/signals/outbox.ts と同じ作り（outbox は本人・家族の信号で、ここはケアマネの通話の記録。outbox には触らない）:
//
// - 送る前に端末（localStorage）に書き、届いたら消す。送る途中で頁を閉じても（電話の画面へ移っても）次に開いたときに送る
// - 順は守る: 前の物が送れないうちは後ろを送らない（同じ人の「不通」のあとの「通話 無事」が逆に届かないように）
// - 送り直しても通らない応答（400 形の違い・403 権限なし・404 対象なし・409 平時・至急維持）は捨てる。
//   通信の失敗・5xx・429・401 は残す（401 は同じアカウントでログインし直せば送れる）
// - 持ち主は「cm:<アカウントの id>」。同じ端末で別の人がログインしても、ほかの人の物は送らない・数えない（審査員は acct-judge）
// - 聞いた安否は、届くまで色と連絡順に入らない（端末の中で表を動かさない。届いてからサーバーの表が決める）
// - 同じ端末の 2 つのタブが同時に送らないよう、送る間は錠（ブラウザは navigator.locks）を持つ。毎回端末から読み直す
// - 画面（DOM）に触らない。保存の場所・送る道・錠は渡す（テストは偽物）
//
// 送り直しで届いたときの経過の時刻は、サーバーが受けた時刻（app/api/caseload/call は触らない）。押した時刻は at に持つ。

import { CALL_PATH } from "../list/paths.ts";

export const CALL_QUEUE_KEY = "care72.calls.queue.v1";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type CallResult = "dialed" | "no_answer" | "connected";
/** 通話で聞いた安否（lib/list/calls.ts の Heard と同じ形） */
export type CallHeard = { color: "green" | "red"; injured?: true; canMove?: false };
/** app/api/caseload/call に送る形（lib/list/http.ts の callPost が読む） */
export type CallBody = { person: string; contact: string; result: CallResult; heard?: CallHeard | null; memo?: string };

export type QueuedCall = {
  id: string;
  /** cm:<アカウントの id> */
  owner: string;
  /** 押した時刻（端末の時計） */
  at: string;
  body: CallBody;
};

/** 送った結果。ok 届いた・retry 残して送り直す・drop 送り直しても通らないので捨てる */
export type SendOutcome = "ok" | "retry" | "drop";
export type SendResult = { outcome: SendOutcome; label?: string | null };
/** 送る道。通信の失敗は投げてよい（retry として受ける） */
export type CallTransport = (body: CallBody) => Promise<SendResult>;
/** 送る間だけ持つ錠。同じ名前の錠を持つ物は順に動く */
export type Lock = <T>(fn: () => Promise<T>) => Promise<T>;

/** 画面に出す結果。sent 届いた・queued 端末に残した・dropped 届かず捨てた（label は応答の短い漢語） */
export type CallDelivery = { kind: "sent" } | { kind: "queued" } | { kind: "dropped"; label: string | null };
export type FlushReport = { sent: string[]; dropped: Array<{ id: string; label: string | null }> };

export type CallQueue = {
  /** 貯めて、前から順に送り、足した物の結果を返す */
  send(body: CallBody): Promise<CallDelivery>;
  /** 残っている自分の物を順に送る。前の物が送れなければそこで止める */
  flush(): Promise<FlushReport>;
  /** 残っている自分の物（古い順） */
  items(): QueuedCall[];
  /** 端末の中身が変わったら呼ぶ（ほかのタブの変化は storage の知らせで画面が読み直す） */
  onChange(fn: () => void): () => void;
};

export const callQueueOwner = (accountId: string) => `cm:${accountId}`;

/** 応答の状態から。2xx 届いた、送り直しても通らない物（400・403・404・409・413）は捨てる、ほか（401・429・5xx）は残す */
export function callOutcomeOf(status: number): SendOutcome {
  if (status >= 200 && status < 300) return "ok";
  if ([400, 403, 404, 409, 413].includes(status)) return "drop";
  return "retry";
}

const RESULTS: readonly string[] = ["dialed", "no_answer", "connected"];

function isCall(v: unknown): v is QueuedCall {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  const b = o.body as Record<string, unknown> | undefined;
  return (
    typeof o.id === "string" &&
    typeof o.owner === "string" &&
    typeof o.at === "string" &&
    !!b &&
    typeof b.person === "string" &&
    typeof b.contact === "string" &&
    typeof b.result === "string" &&
    RESULTS.includes(b.result)
  );
}

export function readCallQueue(storage: StorageLike | null): QueuedCall[] {
  if (!storage) return [];
  try {
    const v = JSON.parse(storage.getItem(CALL_QUEUE_KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter(isCall) : [];
  } catch {
    return [];
  }
}

/** 送る形だけを残す（通話でない物に聞いた安否・メモを付けない。空のメモは送らない） */
function cleanBody(b: CallBody): CallBody {
  const memo = b.memo?.trim();
  return {
    person: b.person,
    contact: b.contact,
    result: b.result,
    ...(b.result === "connected" && b.heard ? { heard: b.heard } : {}),
    ...(b.result === "connected" && memo ? { memo } : {}),
  };
}

/** 錠の既定: 同じタブの中で順に動かす */
export function chainLock(): Lock {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>) => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
}

/** 1 回の flush で送る数の上限（端末に壊れた物が残っても回り続けない） */
const MAX_PER_FLUSH = 200;

export function createCallQueue(opts: {
  storage: StorageLike | null;
  owner: string;
  transport: CallTransport;
  now?: () => Date;
  newId?: () => string;
  lock?: Lock;
}): CallQueue {
  const { storage, owner, transport } = opts;
  const now = () => (opts.now?.() ?? new Date()).toISOString();
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const lock = opts.lock ?? chainLock();
  const listeners = new Set<() => void>();
  /** 端末に書けない（容量・プライベートの窓）と分かったら、開いている間は記憶の中だけで持つ */
  let memory: QueuedCall[] | null = storage ? null : [];

  const load = (): QueuedCall[] => (memory ? [...memory] : readCallQueue(storage));
  const save = (next: QueuedCall[]) => {
    if (!memory && storage) {
      try {
        if (next.length === 0) storage.removeItem(CALL_QUEUE_KEY);
        else storage.setItem(CALL_QUEUE_KEY, JSON.stringify(next));
      } catch {
        memory = next;
      }
    } else memory = next;
    for (const fn of listeners) fn();
  };
  const own = () => load().filter((x) => x.owner === owner);

  async function flushOnce(): Promise<FlushReport> {
    const report: FlushReport = { sent: [], dropped: [] };
    for (let i = 0; i < MAX_PER_FLUSH; i++) {
      const item = own()[0];
      if (!item) break;
      let r: SendResult;
      try {
        r = await transport(item.body);
      } catch {
        r = { outcome: "retry" };
      }
      if (r.outcome === "retry") break;
      save(load().filter((x) => x.id !== item.id));
      if (r.outcome === "ok") report.sent.push(item.id);
      else report.dropped.push({ id: item.id, label: r.label ?? null });
    }
    return report;
  }

  const flush = () => lock(flushOnce);

  return {
    async send(body) {
      const item: QueuedCall = { id: newId(), owner, at: now(), body: cleanBody(body) };
      save([...load(), item]);
      const report = await flush();
      if (report.sent.includes(item.id)) return { kind: "sent" };
      const d = report.dropped.find((x) => x.id === item.id);
      if (d) return { kind: "dropped", label: d.label };
      // 残っていれば次に送る。無ければ、ほかのタブが先に送った
      return load().some((x) => x.id === item.id) ? { kind: "queued" } : { kind: "sent" };
    },
    flush,
    items: own,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** fetch で送る道。電話の画面へ移っても送り切る（keepalive）。止まった通信は timeoutMs で切って残す */
export function fetchCallTransport(fetchImpl: typeof fetch = (...a) => fetch(...a), timeoutMs = 15_000): CallTransport {
  return async (body) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(CALL_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "same-origin",
        keepalive: true,
        signal: ctrl.signal,
      });
      const outcome = callOutcomeOf(res.status);
      if (outcome !== "drop") return { outcome };
      const j = (await res.json().catch(() => null)) as { label?: unknown } | null;
      return { outcome, label: typeof j?.label === "string" ? j.label : null };
    } finally {
      clearTimeout(timer);
    }
  };
}
