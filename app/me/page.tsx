import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { personInScope } from "@/lib/auth/scope";
import { requirePage } from "@/lib/auth/server";

export const metadata: Metadata = { title: "本人 | ケア72" };

// 本人のスマホ（T10 で作る）の入口。審査員の「本人スマホ」は山田 ハナ
export default async function MePage() {
  const principal = await requirePage("me");
  if (!principal.personId) notFound();
  const { env } = await getCloudflareContext({ async: true });
  const person = await personInScope(env.DB, principal, principal.personId);
  if (!person) notFound();
  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <section className="rounded-lg bg-panel p-6">
        <h1 className="text-3xl font-bold">{person.name} さん</h1>
        <p className="mt-4 text-xl text-muted">準備中</p>
      </section>
    </main>
  );
}
