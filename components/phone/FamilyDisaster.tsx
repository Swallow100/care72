"use client";

// 家族・支援者のスマホの災害モード。流れ（lib/signals/family-phone.ts）に送る道（fetch・localStorage）を渡し、
// 状態を FamilyView で描く。ブラウザの物は描いたあと（useEffect）に作る（サーバーの描画では触らない）。
//
// - 送れなかった答えは端末に残し、開いたとき・つながったとき・20 秒ごとに送り直す（lib/signals/outbox.ts）。
//   持ち主は「役:連絡先」（family:c-01-1）。本人のスマホの残り（self:）や、ほかの家族の残りは送らない
// - 答えたら 1 回読み直す（これまでの こと に自分の答えが載るように）。上と答えたあとの画面にいる間は 30 秒ごとに読み直す

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FamilyScreen } from "@/lib/signals/family";
import { createFamilyPhone, type FamilyPhone, type FamilyState } from "@/lib/signals/family-phone";
import { createOutbox, fetchTransport, type StorageLike } from "@/lib/signals/outbox";
import { FamilyView, type FamilyActions } from "./FamilyView";

const REFRESH_MS = 30_000;
const FLUSH_MS = 20_000;

function storageOf(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function FamilyDisaster({ screen }: { screen: FamilyScreen }) {
  const router = useRouter();
  const [state, setState] = useState<FamilyState>({ step: "top" });
  const phone = useRef<FamilyPhone | null>(null);
  const { contactId, hasDevice } = screen;
  const shelters = screen.shelters.length;

  useEffect(() => {
    const outbox = createOutbox({ storage: storageOf(), owner: `family:${contactId}`, transport: fetchTransport() });
    const p = createFamilyPhone({
      sendSignal: (b) => outbox.sendSignal(b),
      sendAnswers: (item) => outbox.sendAnswers(item),
      hasDevice,
      shelters,
      onChange: setState,
    });
    phone.current = p;

    void outbox.flush();
    const onOnline = () => void outbox.flush();
    window.addEventListener("online", onOnline);
    const timer = window.setInterval(() => void outbox.flush(), FLUSH_MS);
    return () => {
      p.dispose();
      phone.current = null;
      window.removeEventListener("online", onOnline);
      window.clearInterval(timer);
    };
  }, [contactId, hasDevice, shelters]);

  // 答えたら 1 回読み直す
  const done = state.step === "done";
  useEffect(() => {
    if (done) router.refresh();
  }, [done, router]);

  // 上と答えたあとの画面にいる間だけ読み直す
  const idle = state.step === "top" || state.step === "done";
  useEffect(() => {
    if (!idle) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [idle, router]);

  const on = useMemo<FamilyActions>(
    () => ({
      answer: (c) => phone.current?.answer(c),
      choose: (c) => phone.current?.choose(c),
      skip: () => phone.current?.skip(),
      again: () => phone.current?.again(),
    }),
    [],
  );

  return <FamilyView state={state} screen={screen} on={on} />;
}
