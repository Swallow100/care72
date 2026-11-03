"use client";

// ログアウトのボタン（T71 の続き、11/4 設計の答え 1）。端末に送れていない通話の記録（保留）があれば、
// アプリ内の確認の窓（lib/ui/dialog.ts の appChoice）で「保留 N」と「送信待ち」か「破棄」を選ぶ。
// - 送信待ち: ログアウトせず、その場で送り直す（届けば保留が消える。つながらなければ保留のまま残る）
// - 破棄: 自分の残りを送らずに消してからログアウト（ほかの人の物は消さない）
// - 取消: 何もしない
// 保留が無ければ今までどおりそのまま送る。窓が出せない（JS が動く前）ときもそのまま送る（貯めた物は端末に残り、
// 同じ人が入り直せば送る。ほかの人には送らない・数えない）。

import { useCallQueue } from "@/components/CallQueue";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { OFFLINE_LABELS } from "@/lib/offline/labels";
import { appChoice } from "@/lib/ui/dialog";

const LOGOUT = "ログアウト";

export function LogoutButton() {
  const queue = useCallQueue();
  return (
    <SubmitButton
      kind="danger"
      icon="LogoutIcon"
      data-logout
      onClick={(e) => {
        const n = queue?.items.length ?? 0;
        if (!queue || n === 0) return;
        e.preventDefault();
        const button = e.currentTarget;
        const form = button.form;
        void appChoice(`${OFFLINE_LABELS.pending} ${n}`, {
          title: LOGOUT,
          options: [
            { value: "wait", label: OFFLINE_LABELS.wait, icon: "LaterIcon" },
            { value: "discard", label: OFFLINE_LABELS.discard, icon: "RemoveIcon", danger: true },
          ],
        }).then((a) => {
          if (a === "wait") {
            void queue.flush();
            return;
          }
          if (a !== "discard" || !form?.isConnected) return;
          queue.discard();
          form.requestSubmit(button);
        });
      }}
    >
      {LOGOUT}
    </SubmitButton>
  );
}
