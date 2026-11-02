// 様式 9 の表（画面）。列はひな形の列とケア72 の列を全部出す。小さな字で密に並べ、横は区分の中でスクロール。
// 画面では氏名と色を順位の横に寄せる（CSV はひな形の列の順のまま）。順位を押すとその行の下に手直しの欄が開く。
// 色は意味にだけ: 優先の印と結果は状態の 4 色、「支援者なし」は黄。手直しは色を付けず「自動 N」と理由。状態を持たない。

import Link from "next/link";
import { StateTag, TONE_TEXT } from "@/components/person/parts";
import {
  FORM9_COLUMNS,
  RANK_FORM_ERROR_LABELS,
  MAX_REASON_LENGTH,
  type Form9ColumnId,
  type Form9Contact,
  type Form9Row,
  type RankFormError,
} from "@/lib/forms/form9";
import { FORM9_RANK_PATH, FORM9_SORT_LABELS, form9Href, type Form9Sort } from "@/lib/forms/form9-href";
import { COLOR_LABELS, TIER_LABELS } from "@/lib/labels";
import { COLOR_TONES, formatJst, telHref } from "@/lib/person";

/** 画面の列の順。順位・優先・氏名を左に寄せ、ほかはひな形の順、ケア72 の列はそのあと */
export const SCREEN_ORDER: ReadonlyArray<Form9ColumnId> = [
  "no",
  "color",
  "nameAge",
  "medicalCare",
  "environment",
  "evacuation",
  "area",
  "address",
  "shelter",
  "facility",
  "notes",
  "careManager",
  "reason",
  "emergency1",
  "emergency2",
  "means",
  "result",
  "checkedAt",
  "manual",
];

const COLUMN = new Map(FORM9_COLUMNS.map((c) => [c.id, c]));

/** 並び替えのできる列 */
const SORT_OF: Partial<Record<Form9ColumnId, Form9Sort>> = { no: "rank", nameAge: "kana", area: "area", careManager: "manager" };

const CELL = "bg-panel px-1.5 py-1.5 align-top first:rounded-l-md last:rounded-r-md";
const Dash = () => <span className="text-muted">—</span>;

/** 横に送っても残す左の 3 列（順位・優先・氏名）。幅を決めて左からの位置をそろえる */
const STICKY: Partial<Record<Form9ColumnId, string>> = {
  no: "sticky left-0 z-10 w-12 min-w-12",
  color: "sticky left-12 z-10 w-14 min-w-14",
  nameAge: "sticky left-26 z-10",
};

type Props = {
  rows: ReadonlyArray<Form9Row>;
  sort: Form9Sort;
  /** 手直しの欄を開いている本人 */
  edit: string | null;
  error: RankFormError | null;
  /** 並び（平時・発災時） */
  disaster: boolean;
};

export function Form9Table({ rows, sort, edit, error, disaster }: Props) {
  return (
    <table className="w-full min-w-[90rem] border-separate border-spacing-y-0.5 text-left text-xs">
      <thead>
        <tr className="text-muted">
          {SCREEN_ORDER.map((id) => (
            <HeaderCell key={id} id={id} sort={sort} />
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <RowGroup key={r.id} row={r} sort={sort} editing={edit === r.id} error={edit === r.id ? error : null} size={rows.length} disaster={disaster} />
        ))}
      </tbody>
    </table>
  );
}

function HeaderCell({ id, sort }: { id: Form9ColumnId; sort: Form9Sort }) {
  const c = COLUMN.get(id)!;
  const key = SORT_OF[id];
  const active = key === sort;
  return (
    <th
      className={`whitespace-nowrap bg-base px-1.5 py-1.5 align-bottom font-normal ${id === "no" ? "text-center" : ""} ${STICKY[id] ?? ""}`}
      title={c.csv}
      aria-sort={active ? "ascending" : undefined}
    >
      {c.group && <span className="block text-[0.65rem] leading-tight">{c.group}</span>}
      {key ? (
        <Link
          href={form9Href({ sort: key })}
          className={`-mx-1 rounded px-1 py-0.5 ${active ? "text-ink underline underline-offset-4" : ""}`}
          data-press
        >
          {key === "rank" ? c.label : FORM9_SORT_LABELS[key]}
        </Link>
      ) : (
        c.label
      )}
    </th>
  );
}

function RowGroup({
  row: r,
  sort,
  editing,
  error,
  size,
  disaster,
}: {
  row: Form9Row;
  sort: Form9Sort;
  editing: boolean;
  error: RankFormError | null;
  size: number;
  disaster: boolean;
}) {
  return (
    <>
      <tr id={`row-${r.id}`} aria-selected={editing || undefined}>
        {SCREEN_ORDER.map((id) => (
          <td key={id} className={`${CELL} ${STICKY[id] ?? ""} ${editing ? "first:shadow-[inset_3px_0_0_var(--accent)]" : ""}`}>
            <Cell id={id} row={r} sort={sort} editing={editing} disaster={disaster} />
          </td>
        ))}
      </tr>
      {editing && (
        <tr>
          <td colSpan={SCREEN_ORDER.length} className="rounded-md bg-panel2 px-3 py-2">
            <div className="sticky left-3 w-fit max-w-[calc(100vw-4rem)]">
              <RankForm row={r} sort={sort} error={error} size={size} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Cell({ id, row: r, sort, editing, disaster }: { id: Form9ColumnId; row: Form9Row; sort: Form9Sort; editing: boolean; disaster: boolean }) {
  const text = r.cells[id];
  switch (id) {
    case "no":
      return (
        <Link
          href={editing ? form9Href({ sort }) : form9Href({ sort, edit: r.id })}
          className="-mx-1 block rounded px-1 text-center"
          aria-label={`${r.name} 順位変更`}
          data-press
        >
          <span className="block text-lg font-bold leading-tight tabular-nums">{r.rank}</span>
          {r.manual ? (
            <span className="block whitespace-nowrap text-[0.65rem] text-muted tabular-nums">自動 {r.autoRank}</span>
          ) : (
            <span className="block text-[0.65rem] text-accent">変更</span>
          )}
        </Link>
      );
    case "color":
      return r.color ? (
        <span className="whitespace-nowrap">
          <StateTag tone={COLOR_TONES[r.color]} size="md">
            {COLOR_LABELS[r.color]}
          </StateTag>
        </span>
      ) : (
        <Dash />
      );
    case "nameAge":
      return (
        <div className="min-w-[6rem]">
          <Link href={`/people/${r.id}`} className="-mx-1 rounded px-1 text-sm font-bold" data-press>
            {r.name}
          </Link>
          {r.age !== null && <span className="tabular-nums text-muted"> {r.age}歳</span>}
          <div className="text-muted">{r.kana}</div>
        </div>
      );
    case "medicalCare":
      return (
        <div className="min-w-[7rem]">
          <span className="font-bold tabular-nums">{r.tier}</span> <span>{TIER_LABELS[r.tier]}</span>
          {r.marks.length > 0 && (
            <div className="mt-0.5 flex flex-wrap gap-0.5">
              {r.marks.map((m) => (
                <span key={m} className="rounded bg-panel2 px-1">
                  {m}
                </span>
              ))}
            </div>
          )}
        </div>
      );
    case "evacuation":
      return <Words text={text} warn="支援者なし" min="min-w-[6rem]" />;
    case "means":
      return <Words text={text} min="min-w-[5rem]" />;
    case "reason":
      return <div className={`min-w-[8rem] ${disaster && r.color ? `font-bold ${TONE_TEXT[COLOR_TONES[r.color]]}` : ""}`}>{text}</div>;
    case "emergency1":
    case "emergency2":
      return <ContactCell c={r.emergency[id === "emergency1" ? 0 : 1]} />;
    case "result":
      if (!r.result) return <Dash />;
      return (
        <div className="min-w-[5rem]">
          <span className={`font-bold ${r.result.tone ? TONE_TEXT[r.result.tone] : r.result.at ? "" : TONE_TEXT.unknown}`}>
            {r.result.label}
          </span>
          {r.result.detail && <span> {r.result.detail}</span>}
          {r.result.by && <div className="text-muted">{r.result.by}</div>}
        </div>
      );
    case "checkedAt": {
      if (!text) return <Dash />;
      const [date, time] = text.split(" ");
      return (
        <div className="whitespace-nowrap tabular-nums">
          <div className="font-bold">{time}</div>
          <div className="text-muted">{date}</div>
        </div>
      );
    }
    case "manual":
      return r.manual ? (
        <div className="min-w-[7rem]">
          <div>{r.manual.reason}</div>
          <div className="text-muted">
            {[r.manual.by, formatJst(r.manual.at)].filter((x) => x).join(" ")}
          </div>
        </div>
      ) : (
        <Dash />
      );
    default:
      return text ? <div className={MIN_WIDTH[id] ?? ""}>{text}</div> : <Dash />;
  }
}

const MIN_WIDTH: Partial<Record<Form9ColumnId, string>> = {
  environment: "min-w-[6rem]",
  area: "min-w-[4.5rem]",
  address: "min-w-[5rem]",
  shelter: "min-w-[5rem]",
  facility: "min-w-[4.5rem]",
  notes: "min-w-[4.5rem]",
};

/** 「・」で区切った言葉を 1 行ずつ。注意の言葉（支援者なし）だけ黄 */
function Words({ text, warn, min }: { text: string; warn?: string; min: string }) {
  if (!text) return <Dash />;
  return (
    <ul className={min}>
      {text.split("・").map((p, i) => (
        <li key={i} className={p === warn ? `font-bold ${TONE_TEXT.check}` : undefined}>
          {p}
        </li>
      ))}
    </ul>
  );
}

function ContactCell({ c }: { c: Form9Contact | undefined }) {
  if (!c) return <Dash />;
  return (
    <div className="min-w-[6.5rem]">
      <div>
        <span className="text-muted">{c.who}</span> {c.name}
      </div>
      {c.phone ? (
        <a href={`tel:${telHref(c.phone)}`} className="-mx-0.5 whitespace-nowrap rounded px-0.5 text-accent tabular-nums underline underline-offset-2" data-press>
          {c.phone}
        </a>
      ) : (
        <span className="text-muted">電話なし</span>
      )}
    </div>
  );
}

/** 手直しの欄。順位と理由。手直し済みなら「手直し解除」（自動の順位に戻す） */
function RankForm({ row: r, sort, error, size }: { row: Form9Row; sort: Form9Sort; error: RankFormError | null; size: number }) {
  const input = "rounded-md bg-panel px-2 py-1.5 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-accent";
  return (
    <form method="post" action={FORM9_RANK_PATH} className="flex flex-wrap items-end gap-x-3 gap-y-2">
      <input type="hidden" name="person" value={r.id} />
      <input type="hidden" name="sort" value={sort} />
      <span className="self-center text-sm font-bold">{r.name}</span>
      <span className="self-center text-muted">
        自動 <span className="tabular-nums">{r.autoRank}</span>
      </span>
      <label className="flex flex-col gap-0.5">
        <span className="text-muted">順位</span>
        <input
          type="number"
          name="rank"
          min={1}
          max={size}
          required
          defaultValue={r.rank}
          className={`${input} w-20 tabular-nums`}
        />
      </label>
      <label className="flex w-[28rem] max-w-full flex-col gap-0.5">
        <span className="text-muted">理由</span>
        <input
          type="text"
          name="reason"
          required
          maxLength={MAX_REASON_LENGTH}
          defaultValue={r.manual?.reason ?? ""}
          className={input}
          autoFocus
        />
      </label>
      <button type="submit" className="rounded bg-accent px-3 py-1.5 text-sm font-bold text-on-accent" data-press="overlay">
        保存
      </button>
      {r.manual && (
        <button type="submit" name="clear" value="1" formNoValidate className="rounded px-3 py-1.5 text-sm" data-press>
          手直し解除
        </button>
      )}
      <Link href={form9Href({ sort })} className="rounded px-3 py-1.5 text-sm text-muted" data-press>
        閉じる
      </Link>
      {error && (
        <span role="alert" className="self-center text-sm font-bold text-danger">
          {RANK_FORM_ERROR_LABELS[error]}
        </span>
      )}
    </form>
  );
}
