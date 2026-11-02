import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { personInScope } from "@/lib/auth/scope";
import { requirePage } from "@/lib/auth/server";

export const metadata: Metadata = { title: "家族 | ケア72" };

// 家族のスマホ（T11 で作る）の入口。審査員の「家族スマホ」は山田 ハナの娘
export default async function FamilyPage() {
  const principal = await requirePage("family");
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
