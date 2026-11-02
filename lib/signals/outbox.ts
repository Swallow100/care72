// 送れなかった信号を端末に残し、つながったら送る（docs/tasks/T10.md「通信が無いとき」。最小の形）。
//
// - 信号は送る前に端末（localStorage）に書き、届いたら消す。送る途中で画面を閉じても次に開いたときに送る
// - 録音の音声は大きいので端末に書かず、画面を開いている間だけ覚える（閉じると音声は消え、文字起こしだけ送る）
// - 順は守る: 前の物が送れないうちは後ろを送らない（録音は信号のあと）
// - 送り直しても通らない応答（平時・形の違い・権限なし）は捨てる。通信の失敗・5xx・429・401 は残す
// - 持ち主は「役:本人」（self:p-01）、家族のスマホは「役:連絡先」（family:c-01-1。T11）。
//   同じ端末で審査員が役を替えても、ほかの人・ほかの役の物は送らない
//   （出どころはサーバーがログインの役から決めるので、本人の残りを家族のログインで送ると家族の信号になる）。その役の画面を開いたときに送る
// - 画面（DOM）に触らない。保存の場所と送る道は渡す（テストは偽物）

import type { AnySignalBody } from "./body.ts";

export const OUTBOX_KEY = "care72.phone.outbox.v1";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** 送った結果。ok 届いた・retry 残して送り直す・drop 送り直しても通らないので捨てる */
export type SendOutcome = "ok" | "retry" | "drop";

/** 画面に出す結果。sent 届いた・queued 端末に残した・dropped 届かず捨てた */
export type Delivery = "sent" | "queued" | "dropped";

export type AttachItem = {
  signalId: string;
  transcript: string | null;
  durationSec: number | null;
  /** 録り終えた時刻（端末の時計） */
  recordedAt: string;
};

export type OutboxItem =
  | { kind: "signal"; owner: string; body: AnySignalBody }
  | ({ kind: "attach"; owner: string } & AttachItem);

/** 送る道。sentAt は送るたびに今 */
export type Transport = {
  signal(body: AnySignalBody): Promise<SendOutcome>;
  attach(item: AttachItem & { sentAt: string }, audio: Blob | null): Promise<SendOutcome>;
};

export type Outbox = {
  sendSignal(body: AnySignalBody): Promise<Delivery>;
  sendRecording(item: AttachItem, audio: Blob | null): Promise<Delivery>;
  /** 残っている自分の物を順に送る。前の物が送れなければそこで止める */
  flush(): Promise<void>;
  /** 残っている自分の物の数 */
  pending(): number;
};

function isItem(v: unknown): v is OutboxItem {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.owner !== "string") return false;
  if (o.kind === "signal") return !!o.body && typeof (o.body as { id?: unknown }).id === "string";
  return o.kind === "attach" && typeof o.signalId === "string" && typeof o.recordedAt === "string";
}

export function readOutbox(storage: StorageLike | null): OutboxItem[] {
  if (!storage) return [];
  try {
    const v = JSON.parse(storage.getItem(OUTBOX_KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter(isItem) : [];
  } catch {
    return [];
  }
}

function writeOutbox(storage: StorageLike | null, items: OutboxItem[]): void {
  if (!storage) return;
  try {
    if (items.length === 0) storage.removeItem(OUTBOX_KEY);
    else storage.setItem(OUTBOX_KEY, JSON.stringify(items));
  } catch {
    // 保存できない（容量・プライベートの窓）。開いている間は記憶の中にある
  }
}

const keyOf = (x: OutboxItem) => (x.kind === "signal" ? `signal:${x.body.id}` : `attach:${x.signalId}`);

export function createOutbox(opts: {
  storage: StorageLike | null;
  owner: string;
  transport: Transport;
  now?: () => Date;
}): Outbox {
  const { storage, owner, transport } = opts;
  const now = () => (opts.now?.() ?? new Date()).toISOString();
  /** 開いている間はこれが正。書くたびに端末にも写す（保存できない端末でも、開いている間は送り直せる） */
  let items: OutboxItem[] = readOutbox(storage);
  const audios = new Map<string, Blob>();
  /** 送った結果（キーごと）。順に送る途中で、後ろに足した物の結果を返すため */
  const outcomes = new Map<string, SendOutcome>();
  let flushing: Promise<void> | null = null;

  const save = (next: OutboxItem[]) => {
    items = next;
    writeOutbox(storage, items);
  };
  const add = (item: OutboxItem) => save([...items.filter((x) => keyOf(x) !== keyOf(item)), item]);
  const remove = (item: OutboxItem) => {
    save(items.filter((x) => keyOf(x) !== keyOf(item)));
    if (item.kind === "attach") audios.delete(item.signalId);
  };
  const own = () => items.filter((x) => x.owner === owner);

  async function send(item: OutboxItem): Promise<SendOutcome> {
    try {
      if (item.kind === "signal") return await transport.signal({ ...item.body, sentAt: now() });
      const audio = audios.get(item.signalId) ?? null;
      if (!audio && !item.transcript?.trim()) return "drop";
      const { signalId, transcript, durationSec, recordedAt } = item;
      return await transport.attach({ signalId, transcript, durationSec, recordedAt, sentAt: now() }, audio);
    } catch {
      return "retry";
    }
  }

  async function flushOnce(): Promise<void> {
    for (const item of own()) {
      const r = await send(item);
      outcomes.set(keyOf(item), r);
      if (r === "retry") return;
      remove(item);
    }
  }

  function flush(): Promise<void> {
    if (!flushing) flushing = flushOnce().finally(() => (flushing = null));
    return flushing;
  }

  /** 足して、前から順に送り、足した物の結果を返す */
  async function enqueueAndSend(item: OutboxItem): Promise<Delivery> {
    add(item);
    outcomes.delete(keyOf(item));
    // 送っている途中なら、それが終わってからもう一度（足した物まで届くように）
    if (flushing) await flushing;
    await flush();
    const r = outcomes.get(keyOf(item));
    outcomes.delete(keyOf(item));
    return r === "ok" ? "sent" : r === "drop" ? "dropped" : "queued";
  }

  return {
    sendSignal: (body) => enqueueAndSend({ kind: "signal", owner, body }),
    sendRecording(attach, audio) {
      if (audio) audios.set(attach.signalId, audio);
      return enqueueAndSend({ kind: "attach", owner, ...attach });
    },
    flush,
    pending: () => own().length,
  };
}

/** 応答の状態から。2xx 届いた、送り直しても通らない物（400・403・404・409・413）は捨てる、ほかは残す */
export function outcomeOf(status: number): SendOutcome {
  if (status >= 200 && status < 300) return "ok";
  if ([400, 403, 404, 409, 413].includes(status)) return "drop";
  return "retry";
}

export const SIGNALS_PATH = "/api/signals";
export const RECORDINGS_PATH = "/api/recordings";
export const VOICE_PATH = "/api/signals/voice";

/** fetch で送る道。通信の失敗は投げる（outbox が retry として受ける） */
export function fetchTransport(fetchImpl: typeof fetch = (...a) => fetch(...a)): Transport {
  return {
    async signal(body) {
      const res = await fetchImpl(SIGNALS_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "same-origin",
      });
      return outcomeOf(res.status);
    },
    async attach(item, audio) {
      const form = new FormData();
      form.set("signal", item.signalId);
      form.set("recordedAt", item.recordedAt);
      form.set("sentAt", item.sentAt);
      if (item.transcript?.trim()) form.set("transcript", item.transcript.trim());
      if (item.durationSec !== null) form.set("durationSec", String(item.durationSec));
      if (audio) form.set("audio", audio, "recording");
      const res = await fetchImpl(RECORDINGS_PATH, { method: "POST", body: form, credentials: "same-origin" });
      return outcomeOf(res.status);
    },
  };
}
