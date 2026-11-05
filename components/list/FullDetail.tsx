// 行の詳細の「全部」（docs/tasks/T132.md）。台帳の平時の情報の全部: 連絡先の全員（1 人 1 行）と、本人のページと同じ面（関係者の役割の空き・
// 医療・避難・基本）。中身は lib/list/full.ts の buildFullDetail で作り、面は本人のページの部品（components/person/PersonView の Blocks）で描く。
// 担当一覧は電話のリンク（tel:）。訓練（drill）は番号を出さず「電話あり」、連絡先の行は contactSlot で手を選ぶ行（ContactPick）に包む。
// PC の幅は面を 2〜3 段に流す（container query）。面は面の中の色（bg-panel2）で区切り、枠線を引かない。状態を持たない。

import { Blocks } from "@/components/person/PersonView";
import { Mark } from "@/components/ui/Tag";
import { CONTACT_ROLE_LABELS, FULL_LABELS, SECTION_LABELS } from "@/lib/labels";
import { withoutPhones, type FullContact, type FullDetail as Full } from "@/lib/list/full";

/** 連絡先の 1 行を包む口（訓練の手を選ぶ行）。無ければ 1 行のまま */
export type ContactSlot = (c: FullContact, line: React.ReactNode) => React.ReactNode;

export function FullDetail({ full, drill = false, contactSlot }: { full: Full; drill?: boolean; contactSlot?: ContactSlot }) {
  const sections = drill ? withoutPhones(full.sections) : full.sections;
  const people = sections.find((s) => s.id === "people");
  const others = sections.filter((s) => s.id !== "people");
  return (
    <div className="@container" data-full-detail={drill ? "drill" : "list"}>
      <div className="gap-x-2 @3xl:columns-2 @6xl:columns-3">
        <Part title={people?.label ?? SECTION_LABELS.people} id="people">
          <h4 className="text-xs text-muted">{CONTACT_ROLE_LABELS.list}</h4>
          <ul className="mt-0.5 space-y-1">
            {full.contacts.map((c) => {
              const line = <ContactLine contact={c} drill={drill} />;
              return (
                <li key={c.id} data-full-contact={c.kind}>
                  {contactSlot ? contactSlot(c, line) : line}
                </li>
              );
            })}
          </ul>
          {people && people.blocks.length > 0 && (
            <div className="mt-1.5">
              <Blocks blocks={people.blocks} />
            </div>
          )}
        </Part>
        {others.map((s) => (
          <Part key={s.id} title={s.label} id={s.id}>
            <Blocks blocks={s.blocks} />
          </Part>
        ))}
      </div>
    </div>
  );
}

/** 連絡先 1 人の 1 行（本人のページの関係者と同じ並び）。button の中にも置けるように span だけで組む */
function ContactLine({ contact: c, drill }: { contact: FullContact; drill: boolean }) {
  const hasPhone = c.phone !== null || c.mobile !== null;
  return (
    <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
      <span className="font-bold">{c.name}</span>
      {c.relation && <span className="text-xs text-muted">{c.relation}</span>}
      {c.kindMark && <Mark inPanel2>{c.kindMark}</Mark>}
      {c.roles.map((r) => (
        <Mark key={r} inPanel2>
          {r}
        </Mark>
      ))}
      {c.night && (c.night.ok ? <Mark inPanel2>{c.night.text}</Mark> : <span className="text-xs text-muted">{c.night.text}</span>)}
      {c.facts.length > 0 && <span className="text-xs text-muted">{c.facts.join("・")}</span>}
      {drill || !hasPhone ? (
        <span className="text-xs text-muted" data-full-phone={hasPhone ? "yes" : "no"}>
          {hasPhone ? FULL_LABELS.phoneYes : FULL_LABELS.phoneNo}
        </span>
      ) : (
        [c.phone, c.mobile].map(
          (p) =>
            p && (
              <a key={p.tel} href={`tel:${p.tel}`} className="-mx-0.5 rounded px-0.5 text-accent tabular-nums underline underline-offset-2" data-press>
                {p.text}
              </a>
            ),
        )
      )}
      {c.note && <span className="text-xs text-muted">{c.note}</span>}
    </span>
  );
}

function Part({ title, id, children }: { title: string; id: string; children: React.ReactNode }) {
  return (
    <section className="mb-2 break-inside-avoid rounded-md bg-panel2 p-2" data-full-section={id}>
      <h3 className="mb-1 text-sm font-bold">{title}</h3>
      {children}
    </section>
  );
}
