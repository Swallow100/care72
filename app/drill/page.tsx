import type { Metadata } from "next";
import { requirePage } from "@/lib/auth/server";

export const metadata: Metadata = { title: "訓練記録 | ケア72" };

// 訓練記録の一覧と再生の枠。訓練は T17、デモ事業所の終わった訓練の種は T26。ゲストも見られる（再生だけ）
export default async function DrillPage() {
  await requirePage("drill");
  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-2xl font-bold">訓練記録</h1>
      <p className="mt-4 rounded-lg bg-panel p-6 text-muted">なし</p>
    </main>
  );
}
