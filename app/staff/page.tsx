import type { Metadata } from "next";
import { requirePage } from "@/lib/auth/server";

export const metadata: Metadata = { title: "受け持ち | ケア72" };

// 行政・医療班の入口。受け持ちの一覧は T23 で作る（受け取った人が増えていく）。それまでは空
export default async function StaffPage() {
  await requirePage("staff");
  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex items-baseline gap-4">
        <h1 className="text-2xl font-bold">受け持ち</h1>
        <span className="text-muted">0 人</span>
      </div>
      <p className="mt-4 rounded-lg bg-panel p-6 text-muted">なし</p>
    </main>
  );
}
