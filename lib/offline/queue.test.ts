// T71 の通話の記録の貯め置き（lib/offline/queue.ts）。lib/signals/phone.test.ts の outbox の見方に合わせる。
import { describe, expect, it, vi } from "vitest";
import { CALL_PATH } from "../list/paths.ts";
import {
  CALL_QUEUE_KEY,
  callOutcomeOf,
  callQueueOwner,
  chainLock,
  createCallQueue,
  fetchCallTransport,
  readCallQueue,
  type CallBody,
  type SendResult,
  type StorageLike,
} from "./queue.ts";

class MemoryStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const OWNER = callQueueOwner("acct-judge");
const T0 = new Date("2026-11-04T01:00:00.000Z");

const dialed = (contact = "c-01-1"): CallBody => ({ person: "p-01", contact, result: "dialed" });
const heardRed: CallBody = {
  person: "p-01",
  contact: "c-01-1",
  result: "connected",
  heard: { color: "red", injured: true },
  memo: " 足を痛めた ",
};

/** 送る道の偽物。next が結果を決める（"throw" は通信の失敗） */
function transport(next: (b: CallBody) => SendResult["outcome"] | "throw" | SendResult) {
  const sent: CallBody[] = [];
  const t = vi.fn(async (b: CallBody): Promise<SendResult> => {
    const r = next(b);
    if (r === "throw") throw new TypeError("Failed to fetch");
    if (typeof r === "string") {
      if (r === "ok") sent.push(b);
      return { outcome: r };
    }
    return r;
  });
  return { t, sent };
}

let seq = 0;
const ids = () => `id-${++seq}`;

describe("通話の記録を貯める", () => {
  it("つながっている: すぐ送り、端末に残さない", async () => {
    const storage = new MemoryStorage();
    const { t, sent } = transport(() => "ok");
    const q = createCallQueue({ storage, owner: OWNER, transport: t, now: () => T0, newId: ids });
    expect(await q.send(dialed())).toEqual({ kind: "sent" });
    expect(sent).toEqual([dialed()]);
    expect(storage.getItem(CALL_QUEUE_KEY)).toBeNull();
    expect(q.items()).toEqual([]);
  });

  it("通信なし: 端末に残し（押した時刻つき）、戻ったら 1 回だけ送る", async () => {
    const storage = new MemoryStorage();
    let online = false;
    const { t, sent } = transport(() => (online ? "ok" : "throw"));
    const q = createCallQueue({ storage, owner: OWNER, transport: t, now: () => T0, newId: () => "a" });
    expect(await q.send(heardRed)).toEqual({ kind: "queued" });
    const body: CallBody = { ...heardRed, memo: "足を痛めた" };
    expect(readCallQueue(storage)).toEqual([{ id: "a", owner: OWNER, at: T0.toISOString(), body }]);
    expect(q.items()).toHaveLength(1);

    online = true;
    await Promise.all([q.flush(), q.flush()]);
    expect(sent).toEqual([body]);
    expect(q.items()).toEqual([]);
    expect(storage.getItem(CALL_QUEUE_KEY)).toBeNull();
    await q.flush();
    expect(sent).toHaveLength(1);
  });

  it("5xx・429・401 は残す。順は守り、前が送れないうちは後ろを送らない", async () => {
    const storage = new MemoryStorage();
    let status: SendResult["outcome"] | "throw" = "throw";
    const { t, sent } = transport(() => status);
    const q = createCallQueue({ storage, owner: OWNER, transport: t, newId: ids });
    await q.send(dialed("c-01-1"));
    status = "retry";
    expect(await q.send({ person: "p-01", contact: "c-01-1", result: "no_answer" })).toEqual({ kind: "queued" });
    // 前の物が retry のうちは、後ろの物は送りに出さない
    expect(t.mock.calls.every(([b]) => b.result === "dialed")).toBe(true);
    status = "ok";
    await q.flush();
    expect(sent.map((b) => b.result)).toEqual(["dialed", "no_answer"]);
  });

  it("送り直しても通らない応答は捨て、画面に応答の言葉を返す。後ろの物は続けて送る", async () => {
    const storage = new MemoryStorage();
    let online = false;
    const { t, sent } = transport((b) =>
      !online ? "throw" : b.result === "connected" ? { outcome: "drop", label: "至急維持" } : "ok",
    );
    const q = createCallQueue({ storage, owner: OWNER, transport: t, newId: ids });
    await q.send(heardRed);
    await q.send(dialed("c-01-2"));
    online = true;
    const r = await q.flush();
    expect(r.dropped.map((d) => d.label)).toEqual(["至急維持"]);
    expect(sent.map((b) => b.contact)).toEqual(["c-01-2"]);
    expect(q.items()).toEqual([]);

    expect(await q.send(heardRed)).toEqual({ kind: "dropped", label: "至急維持" });
  });

  it("ほかの人（持ち主の違う物）は送らない・数えない・消さない", async () => {
    const storage = new MemoryStorage();
    const off = transport(() => "throw");
    const other = createCallQueue({ storage, owner: callQueueOwner("acct-b"), transport: off.t, newId: ids });
    await other.send(dialed());
    const { t, sent } = transport(() => "ok");
    const q = createCallQueue({ storage, owner: OWNER, transport: t, newId: ids });
    expect(q.items()).toEqual([]);
    await q.flush();
    expect(sent).toEqual([]);
    expect(readCallQueue(storage).map((x) => x.owner)).toEqual([callQueueOwner("acct-b")]);
    await q.send(dialed("c-01-9"));
    expect(readCallQueue(storage).map((x) => x.owner)).toEqual([callQueueOwner("acct-b")]);
  });

  it("頁を開き直しても、端末に残った物を送る", async () => {
    const storage = new MemoryStorage();
    await createCallQueue({ storage, owner: OWNER, transport: transport(() => "throw").t, newId: ids }).send(dialed());
    const { t, sent } = transport(() => "ok");
    const again = createCallQueue({ storage, owner: OWNER, transport: t, newId: ids });
    expect(again.items()).toHaveLength(1);
    await again.flush();
    expect(sent).toEqual([dialed()]);
  });

  it("2 つのタブ（同じ錠）が同時に送っても 1 回だけ", async () => {
    const storage = new MemoryStorage();
    await createCallQueue({ storage, owner: OWNER, transport: transport(() => "throw").t, newId: ids }).send(dialed());
    const lock = chainLock();
    const { t, sent } = transport(() => "ok");
    const a = createCallQueue({ storage, owner: OWNER, transport: t, lock, newId: ids });
    const b = createCallQueue({ storage, owner: OWNER, transport: t, lock, newId: ids });
    await Promise.all([a.flush(), b.flush(), a.flush()]);
    expect(sent).toHaveLength(1);
  });

  it("端末に書けない（保存の場所なし・書くと落ちる）: 開いている間は記憶の中で持つ", async () => {
    let online = false;
    const { t, sent } = transport(() => (online ? "ok" : "throw"));
    const none = createCallQueue({ storage: null, owner: OWNER, transport: t, newId: ids });
    expect(await none.send(dialed())).toEqual({ kind: "queued" });
    expect(none.items()).toHaveLength(1);

    const broken: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    const q = createCallQueue({ storage: broken, owner: OWNER, transport: t, newId: ids });
    expect(await q.send(dialed("c-01-2"))).toEqual({ kind: "queued" });
    expect(q.items()).toHaveLength(1);
    online = true;
    await q.flush();
    await none.flush();
    expect(sent).toHaveLength(2);
  });

  it("変わったら知らせる", async () => {
    const q = createCallQueue({ storage: new MemoryStorage(), owner: OWNER, transport: transport(() => "throw").t, newId: ids });
    const seen = vi.fn();
    const off = q.onChange(seen);
    await q.send(dialed());
    expect(seen).toHaveBeenCalled();
    off();
    seen.mockClear();
    await q.send(dialed());
    expect(seen).not.toHaveBeenCalled();
  });

  it("壊れた中身は読まない", () => {
    const storage = new MemoryStorage();
    storage.setItem(CALL_QUEUE_KEY, "{");
    expect(readCallQueue(storage)).toEqual([]);
    storage.setItem(CALL_QUEUE_KEY, JSON.stringify([{ id: "x" }, { id: "y", owner: OWNER, at: "t", body: { person: "p", contact: "c", result: "boom" } }]));
    expect(readCallQueue(storage)).toEqual([]);
  });
});

describe("応答と送る道", () => {
  it("2xx 届いた、400・403・404・409・413 は捨てる、401・429・5xx は残す", () => {
    expect(callOutcomeOf(200)).toBe("ok");
    for (const s of [400, 403, 404, 409, 413]) expect(callOutcomeOf(s)).toBe("drop");
    for (const s of [401, 408, 429, 500, 502, 503]) expect(callOutcomeOf(s)).toBe("retry");
  });

  it("fetch で送る: 電話の記録の場所へ JSON、keepalive。捨てる応答は言葉を読む。通信の失敗は投げる", async () => {
    const calls: Array<[string, RequestInit]> = [];
    let next: () => Promise<Response> = async () => new Response('{"ok":true}', { status: 200 });
    const send = fetchCallTransport(async (input, init) => {
      calls.push([String(input), init!]);
      return next();
    });
    expect(await send(dialed())).toEqual({ outcome: "ok" });
    expect(calls[0][0]).toBe(CALL_PATH);
    expect(calls[0][1]).toMatchObject({ method: "POST", keepalive: true, credentials: "same-origin" });
    expect(JSON.parse(String(calls[0][1].body))).toEqual(dialed());

    next = async () => Response.json({ ok: false, error: "injury", label: "至急維持" }, { status: 409 });
    expect(await send(heardRed)).toEqual({ outcome: "drop", label: "至急維持" });
    next = async () => new Response("x", { status: 503 });
    expect(await send(dialed())).toEqual({ outcome: "retry" });
    next = async () => {
      throw new TypeError("Failed to fetch");
    };
    await expect(send(dialed())).rejects.toThrow();
  });

  it("止まった通信は時間で切る（残して送り直す）", async () => {
    vi.useFakeTimers();
    try {
      const send = fetchCallTransport(
        (_i, init) =>
          new Promise<Response>((_res, rej) => init!.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))),
        1_000,
      );
      const q = createCallQueue({ storage: new MemoryStorage(), owner: OWNER, transport: send, newId: ids });
      const p = q.send(dialed());
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await p).toEqual({ kind: "queued" });
    } finally {
      vi.useRealTimers();
    }
  });
});
