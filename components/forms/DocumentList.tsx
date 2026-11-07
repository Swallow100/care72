// 書類の一覧（/forms、T87）の部品。左に書類と様式を選ぶ欄、右に担当の利用者の行（未確認の数・表示・印刷）と一括印刷。
// 状態を持たない（Server Component のまま、テストで renderToStaticMarkup できる）。言葉は lib/forms/document-list.ts の FORMS_LIST_LABELS。
// 選んだ物は Tabs と同じく文字の色と太字と下線で示し、下地は敷かない。

import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { AddIcon, PaperIcon, PrintIcon } from "@/components/ui/Icon";
import { LinkPending } from "@/components/ui/LinkPending";
import { Panel, PanelHead } from "@/components/ui/Panel";
import { Mark, StateTag } from "@/components/ui/Tag";
import { TABLE, TABLE_BOX, TD, TH } from "@/components/ui/table";
import { aboutLine, type CatalogEntry } from "@/lib/forms/catalog";
import { FORMS_LIST_LABELS as L, type MenuItem, type PersonDocRow } from "@/lib/forms/document-list";
import { UNCONFIRMED_LABELS as U } from "@/lib/forms/unconfirmed";
import { BLANK_LABELS } from "@/lib/labels";
import { OFFICE_FORM_PATH } from "@/lib/forms/plan-form";
import { SubmitButton } from "@/components/ui/SubmitButton";

/** 医療要約の同意の言葉（components/forms/MedicalWithheld.tsx と同じ） */
const BLOCKED_LABELS = { refused: "同意なし", unconfirmed: "未確認" } as const;

function MenuGroup({ title, items, action }: { title: string; items: ReadonlyArray<MenuItem>; action?: React.ReactNode }) {
  return (
    <div className="mt-3 first:mt-0" data-menu-group={title}>
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-bold text-muted">{title}</h3>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {/* 1024px 未満は表の上に置くので、行を横に詰めて版の注を省く（版は右の面の題の下にも出る） */}
      <ul className="mt-1 flex flex-wrap gap-x-4 lg:block">
        {items.map((m) => (
          <li key={m.key}>
            <Link
              href={m.href}
              aria-current={m.current ? "page" : undefined}
              className="relative -mx-1.5 flex flex-wrap items-baseline gap-x-2 rounded px-1.5 py-1"
              data-press
              data-menu-item={m.key}
            >
              <span className={m.current ? "font-bold text-ink underline decoration-2 underline-offset-[6px]" : "text-ink"}>{m.label}</span>
              {m.isDefault && <Mark>{L.isDefault}</Mark>}
              {/* 事業所が足した様式（T147）。確認済は「追加済」、確認保存の前は「下書き」（押すと確かめの画面へ） */}
              {m.mark === "added" && <Mark>{L.added}</Mark>}
              {m.mark === "draft" && <StateTag tone="check">{L.draft}</StateTag>}
              {/* 版の注は語（空白で区切った所）の中で折らない（T188。「対応表 未照合」が「未照 / 合」で折れた）。1 語が列より長いときだけ語の中で折る */}
              <span className="hidden basis-full text-xs break-keep wrap-anywhere text-muted lg:block" data-menu-note>
                {m.note}
              </span>
              <LinkPending />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 書類と様式を選ぶ欄。計画書の段に様式追加（様式対応の画面へ）、事業所の書類は様式 9（CSV 出力も。T147 で事業所の画面から移した） */
export function DocumentMenu({ plan, person, office, officeAction }: { plan: MenuItem[]; person: MenuItem[]; office: MenuItem[]; officeAction?: React.ReactNode }) {
  return (
    <Panel as="aside" aria-label={L.title} className="lg:sticky lg:top-2" data-document-menu>
      <MenuGroup
        title={L.plan}
        items={plan}
        action={
          <ButtonLink href="/forms/mapping" kind="add" size="sm" icon={AddIcon} data-add-form>
            {L.add}
          </ButtonLink>
        }
      />
      <MenuGroup title={L.person} items={person} />
      <MenuGroup title={L.office} items={office} action={officeAction} />
    </Panel>
  );
}

function Unconfirmed({ row }: { row: PersonDocRow }) {
  if (row.blocked) {
    return (
      <span className="flex flex-wrap items-baseline gap-x-1.5" data-blocked={row.blocked.kind}>
        <StateTag tone="check">{BLOCKED_LABELS[row.blocked.kind]}</StateTag>
        <span className="text-xs text-muted">{row.blocked.reason}</span>
      </span>
    );
  }
  if (!row.unconfirmed) return null;
  if (row.unconfirmed.count === 0) return <span className="text-muted">{BLANK_LABELS.none}</span>;
  return (
    <StateTag tone="check">
      {U.unconfirmed} <span className="tabular-nums">{row.unconfirmed.count}</span>
    </StateTag>
  );
}

/** 未確認欄の内訳（問いと未入力の欄の名前と、要記入の数。T117・T188）。要記入の欄は様式で決まりほぼ全員同じなので数だけ */
function Breakdown({ row }: { row: PersonDocRow }) {
  const u = row.unconfirmed;
  if (!u || u.count === 0) return null;
  const ask = u.ask ?? [];
  return (
    <span className="text-xs" data-breakdown>
      {/* 問いで埋められる欄（T117。本人のページの問いの列から） */}
      {ask.length > 0 && (
        <span className="mr-2">
          <span className="text-muted">{U.ask}</span> <span className="font-bold tabular-nums">{ask.length}</span> {ask.join("・")}
        </span>
      )}
      {u.blank.length > 0 && (
        <>
          <span className="text-muted">{U.blank}</span> <span className="font-bold tabular-nums">{u.blank.length}</span> {u.blank.join("・")}
        </>
      )}
      {u.noSource.length > 0 && (
        <span className="ml-2 whitespace-nowrap">
          <span className="text-muted">{U.noSource}</span> <span className="font-bold tabular-nums">{u.noSource.length}</span>
        </span>
      )}
    </span>
  );
}

/** 選んだ書類の担当の利用者の行。1 人ずつ表示・印刷、全員は一括印刷 */
export function DocumentPeople({
  entry,
  isDefault,
  rows,
  batch,
  counted,
  setDefault = null,
}: {
  entry: CatalogEntry;
  isDefault: boolean;
  /** 選んだ計画書の様式を使用様式にする（既定でない様式のとき。値は様式の id。T147 で事業所の画面から移した） */
  setDefault?: string | null;
  rows: ReadonlyArray<PersonDocRow>;
  /** 一括印刷の道（無い書類は 1 人ずつ） */
  batch: string | null;
  /** 未確認を数える書類か（QR・スマホ入口は数えない） */
  counted: boolean;
}) {
  return (
    <Panel aria-labelledby="doc-title" data-document={entry.id}>
      <PanelHead
        id="doc-title"
        title={entry.short}
        count={`${rows.length} 人`}
        sub={isDefault ? <Mark>{L.isDefault}</Mark> : undefined}
        actions={
          <span className="flex flex-wrap items-center gap-1.5">
            {setDefault && (
              <form method="post" action={OFFICE_FORM_PATH} data-set-default={setDefault}>
                <input type="hidden" name="plan_form" value={setDefault} />
                <SubmitButton kind="plain" size="sm" icon="SaveIcon">
                  {L.setDefault}
                </SubmitButton>
              </form>
            )}
            {batch && rows.length > 0 && (
              // 何の書類の一括印刷かを名前に（T162。様式 9 のつもりで押すと松山市の計画書が開いた）。様式 9 は事業所の段から
              <ButtonLink href={batch} kind="main" size="sm" icon={PrintIcon} data-batch-link>
                {entry.short} {L.batch}
              </ButtonLink>
            )}
          </span>
        }
      />
      <p className="mt-0.5 text-xs text-muted" data-document-about={entry.id}>
        {aboutLine(entry)}
        {entry.url && (
          <>
            {" "}
            <a href={entry.url} target="_blank" rel="noreferrer" className="-mx-0.5 rounded px-0.5 text-accent underline underline-offset-2" data-press>
              元様式
            </a>
          </>
        )}
      </p>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{BLANK_LABELS.none}</p>
      ) : (
        <div className={`mt-2 ${TABLE_BOX}`}>
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>氏名</th>
                {counted && <th className={TH}>状態</th>}
                {counted && <th className={`${TH} hidden md:table-cell`}>内訳</th>}
                <th className={TH}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-person-row={r.id}>
                  <td className={`${TD} whitespace-nowrap`}>
                    <Link href={`/people/${encodeURIComponent(r.id)}`} className="relative -mx-0.5 rounded px-0.5 font-bold" data-press>
                      {r.name}
                      <LinkPending />
                    </Link>
                  </td>
                  {counted && (
                    <td className={TD} data-unconfirmed-count={r.unconfirmed?.count ?? ""}>
                      <Unconfirmed row={r} />
                    </td>
                  )}
                  {counted && (
                    <td className={`${TD} hidden md:table-cell`}>
                      <Breakdown row={r} />
                    </td>
                  )}
                  <td className={TD}>
                    <span className="flex gap-1">
                      <ButtonLink href={r.href} kind="plain" size="sm" icon={PaperIcon} aria-label={`${r.name} ${entry.short} ${L.open}`}>
                        {L.open}
                      </ButtonLink>
                      {r.printHref && (
                        <ButtonLink href={r.printHref} kind="plain" size="sm" icon={PrintIcon} aria-label={`${r.name} ${entry.short} ${L.print}`} data-print-link={r.id}>
                          {L.print}
                        </ButtonLink>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
