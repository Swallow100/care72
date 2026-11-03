// 様式 9 の表（画面）。列はひな形の列とケア72 の列を全部出す。小さな字（11px）で密に並べ、横に送らない（T38）:
// 1280px 以上は 19 列を全部、文は欄の中で折り返して縦に伸ばす。1024〜1279px は細かい列（環境・地域・住所・医療機関・特記・連絡先2・
// 確認方法・手直し）を省き、768px 未満は順位・優先・氏名・理由・結果だけ（省いた列は CSV と紙に全部ある）。
// 表は 1 つの面にまとめ、行は地の色の 1px のすき間（components/ui/table と同じ見た目）。
// 画面では氏名と色を順位の横に寄せる（CSV はひな形の列の順のまま）。順位を押すとその行の下に手直しの欄が開く。
// 色は意味にだけ: 優先の印と結果は状態の 4 色、「支援者なし」は要確認（本文色＋黄の帯）。手直しは色を付けず「自動 N」と理由。状態を持たない。

import Link from "next/link";
import { StateTag, TONE_TEXT } from "@/components/person/parts";
import { ButtonLink } from "@/components/ui/Button";
import { CloseIcon } from "@/components/ui/Icon";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { TABLE_BOX } from "@/components/ui/table";
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

/** 本文のセル（詰めた余白。文は折り返す） */
const CELL = "bg-panel px-1 py-1 align-top break-words";
/** 見出しのセル（面の中の灰色。2 行まで折り返す） */
const HEAD = "bg-panel2 px-1 py-1 align-bottom text-[0.65rem] leading-tight font-bold text-muted";
const Dash = () => <span className="text-muted">—</span>;

/**
 * 幅の狭い画面で省く列（横に送らないため）。1024〜1279px は細かい列（地域・住所・医療機関・特記・連絡先2・手直し）を、
 * 768〜1023px はさらに環境・確認方法を、768px 未満は医療・避難・避難所・担当・連絡先1・確認日時も省く。省いた列は CSV と紙（Form9Paper）に全部ある
 */
const HIDE: Partial<Record<Form9ColumnId, string>> = {
  area: "hidden xl:table-cell",
  address: "hidden xl:table-cell",
  facility: "hidden xl:table-cell",
  notes: "hidden xl:table-cell",
  emergency2: "hidden xl:table-cell",
  manual: "hidden xl:table-cell",
  environment: "hidden lg:table-cell",
  means: "hidden lg:table-cell",
  medicalCare: "hidden md:table-cell",
  evacuation: "hidden md:table-cell",
  shelter: "hidden md:table-cell",
  careManager: "hidden md:table-cell",
  emergency1: "hidden md:table-cell",
  checkedAt: "hidden md:table-cell",
};

/**
 * 列の幅（表は table-fixed。理由の列だけ幅を決めず、残りを全部使う）。1280px で 19 列が 1248px に収まる値。
 * 電話の番号（連絡先）は折り返さず、隣の列にはみ出さない幅（96px では 3px はみ出していた）。
 * T79（11/4 の点検の低: 1280 で行が 3〜5 行に折れた）: 氏名は名前と年齢が 1 行に、避難・地域・確認方法は 1 項目が 1 行に収まる幅へ広げ、
 * 理由（1280 で 141px あった）から分けた。医療・介護は段の名前でなく医療の印を並べる（下の cellOf）
 */
const WIDTH: Record<Form9ColumnId, string> = {
  no: "w-[32px]",
  color: "w-[46px]",
  nameAge: "w-[90px]",
  medicalCare: "w-[76px]",
  environment: "w-[66px]",
  evacuation: "w-[80px]",
  area: "w-[62px]",
  address: "w-[52px]",
  shelter: "w-[60px]",
  facility: "w-[52px]",
  notes: "w-[52px]",
  careManager: "w-[32px]",
  reason: "",
  emergency1: "w-[100px]",
  emergency2: "w-[100px]",
  means: "w-[68px]",
  result: "w-[60px]",
  checkedAt: "w-[50px]",
  manual: "w-[42px]",
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
    <div className={TABLE_BOX}>
    <table className="w-full table-fixed border-separate border-spacing-x-0 border-spacing-y-px text-left text-[0.6875rem] leading-snug">
      <thead>
        <tr>
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
    </div>
  );
}

function HeaderCell({ id, sort }: { id: Form9ColumnId; sort: Form9Sort }) {
  const c = COLUMN.get(id)!;
  const key = SORT_OF[id];
  const active = key === sort;
  return (
    <th
      className={`${HEAD} ${id === "no" ? "text-center" : ""} ${WIDTH[id]} ${HIDE[id] ?? ""}`}
      title={c.csv}
      aria-sort={active ? "ascending" : undefined}
    >
      {c.group && <span className="block font-normal">{c.group}</span>}
      {key ? (
        <Link
          href={form9Href({ sort: key })}
          className={`-mx-0.5 rounded px-0.5 py-0.5 whitespace-nowrap ${active ? "text-ink underline underline-offset-4" : ""}`}
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
          <td key={id} className={`${CELL} ${HIDE[id] ?? ""} ${editing ? "first:shadow-[inset_3px_0_0_var(--accent)]" : ""}`}>
            <Cell id={id} row={r} sort={sort} editing={editing} disaster={disaster} />
          </td>
        ))}
      </tr>
      {editing && (
        <tr>
          <td colSpan={SCREEN_ORDER.length} className="bg-panel2 px-3 py-2">
            <RankForm row={r} sort={sort} error={error} size={size} />
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
          <span className="block text-lg font-bold leading-tight whitespace-nowrap tabular-nums">{r.rank}</span>
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
          <StateTag tone={COLOR_TONES[r.color]}>
            {COLOR_LABELS[r.color]}
          </StateTag>
        </span>
      ) : (
        <Dash />
      );
    case "nameAge":
      return (
        <div>
          <Link href={`/people/${r.id}`} className="-mx-0.5 rounded px-0.5 text-[0.8125rem] font-bold whitespace-nowrap" data-press>
            {r.name}
          </Link>
          {r.age !== null && <span className="whitespace-nowrap text-muted"> {r.age}歳</span>}
          <div className="text-muted">{r.kana}</div>
        </div>
      );
    case "medicalCare":
      // 画面は段の数字と医療の印（「5 ステロイド」）。印の無い段（認知症で独居・寝たきり・それ以外）は段の名前。
      // 段の名前（「抗血小板薬・抗凝固薬・ステロイド・抗てんかん薬」）は長く 5 行に折れたので、画面では title に（紙・CSV は名前のまま。T79）
      return (
        <div className="flex flex-wrap items-baseline gap-0.5" title={`${r.tier} ${TIER_LABELS[r.tier]}`}>
          <span className="mr-0.5 font-bold tabular-nums">{r.tier}</span>
          {r.marks.length > 0
            ? r.marks.map((m) => (
                <span key={m} className="rounded bg-panel2 px-1">
                  {m}
                </span>
              ))
            : <span>{TIER_LABELS[r.tier]}</span>}
        </div>
      );
    case "evacuation":
      return <Words text={text} warn="支援者なし" />;
    case "means":
      return <Words text={text} />;
    case "reason":
      return <div className={`${disaster && r.color ? `font-bold ${TONE_TEXT[COLOR_TONES[r.color]]}` : ""}`}>{text}</div>;
    case "emergency1":
    case "emergency2":
      return <ContactCell c={r.emergency[id === "emergency1" ? 0 : 1]} />;
    case "result":
      if (!r.result) return <Dash />;
      return (
        <div>
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
      // 画面は月日だけ（「11/3」。列を細くして横に送らないため）。年まで要るときは CSV と紙
      const [, month, day] = (date ?? "").split("-");
      const short = month && day ? `${Number(month)}/${Number(day)}` : date;
      return (
        <div className="whitespace-nowrap tabular-nums" title={text}>
          <div className="font-bold">{time}</div>
          <div className="text-muted">{short}</div>
        </div>
      );
    }
    case "manual":
      return r.manual ? (
        <div>
          <div>{r.manual.reason}</div>
          <div className="text-muted">
            {[r.manual.by, formatJst(r.manual.at)].filter((x) => x).join(" ")}
          </div>
        </div>
      ) : (
        <Dash />
      );
    default:
      return text ? <div>{text}</div> : <Dash />;
  }
}

/** 「・」で区切った言葉を 1 行ずつ。注意の言葉（支援者なし）だけ要確認（本文色＋黄の帯） */
function Words({ text, warn }: { text: string; warn?: string }) {
  if (!text) return <Dash />;
  return (
    <ul>
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
    <div>
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
  const input = "rounded-md bg-panel px-2 py-1.5 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";
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
      <SubmitButton kind="main" icon="SaveIcon">
        保存
      </SubmitButton>
      {r.manual && (
        <SubmitButton kind="plainIn" name="clear" value="1" formNoValidate>
          手直し解除
        </SubmitButton>
      )}
      <ButtonLink href={form9Href({ sort })} kind="quiet" icon={CloseIcon}>
        閉じる
      </ButtonLink>
      {error && (
        <span role="alert" className="self-center text-sm font-bold text-danger">
          {RANK_FORM_ERROR_LABELS[error]}
        </span>
      )}
    </form>
  );
}
