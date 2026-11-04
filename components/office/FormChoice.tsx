// 事業所の「使う様式」（docs/tasks/T47.md の 4）。自治体で様式が違うので、計画書に使う様式を事業所ごとに 1 つ選ぶ。
// 候補は 松山市の様式・内閣府の様式例・事業所が確かめた対応表（様式対応の確認済）。下書きの対応表は出さない。
// 選んだ様式は本人のページの書類の行の「計画書」になる（lib/forms/plan-form.ts）。保存はフォームの POST（app/office/form）。
// 自分で D1 を読む（事業所の画面 app/office/page.tsx には 1 行で置く。T42 などと衝突しにくくするため）。

import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { CHOICE_INPUT } from "@/components/ui/choice";
import { Panel, PanelHead } from "@/components/ui/Panel";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { ABOUT_SEPARATOR } from "@/lib/forms/catalog";
import { listPlanForms, loadPlanForm, OFFICE_FORM_PATH, type PlanFormOption } from "@/lib/forms/plan-form";

// 選んだ印は枠だけ（押した行に付く。下地は敷かない）
const ROW = "flex cursor-pointer items-start gap-2 rounded bg-panel2 px-2 py-2 text-sm has-[:checked]:outline-2 has-[:checked]:-outline-offset-2 has-[:checked]:outline-accent";

export async function FormChoice({ officeId, error }: { officeId: string; error?: boolean }) {
  let options: PlanFormOption[];
  let current: string;
  try {
    const { env } = await getCloudflareContext({ async: true });
    [options, current] = await Promise.all([listPlanForms(env.DB, officeId), loadPlanForm(env.DB, officeId).then((c) => c.id)]);
  } catch (e) {
    console.error("使う様式を読めない", e);
    return null;
  }
  return (
    <Panel aria-labelledby="plan-form-title">
      <form method="post" action={OFFICE_FORM_PATH} id="plan-form">
        <PanelHead id="plan-form-title" title="使用様式" />
        {error && (
          <p role="alert" className="mt-1 text-sm font-bold text-danger">
            保存不可
          </p>
        )}
        <fieldset className="mt-2 grid gap-1">
          <legend className="sr-only">計画書の様式</legend>
          {options.map((o) => (
            <label key={o.id} className={ROW} data-plan-form={o.id} data-current={o.id === current ? "1" : undefined}>
              <input type="radio" name="plan_form" value={o.id} defaultChecked={o.id === current} className={`mt-0.5 ${CHOICE_INPUT}`} />
              <span className="min-w-0">
                <span className="block">{o.entry.short}</span>
                <span className="block text-xs text-muted">
                  {o.entry.official}{ABOUT_SEPARATOR}{o.entry.version}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <SubmitButton kind="main" icon="SaveIcon">
            保存
          </SubmitButton>
          <Link href="/forms/mapping" className="-mx-0.5 rounded px-0.5 text-sm text-accent underline underline-offset-2" data-press>
            様式追加
          </Link>
        </div>
      </form>
    </Panel>
  );
}
