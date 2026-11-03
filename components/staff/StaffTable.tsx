"use client";

// 受け持ちの表（/staff、docs/tasks/T23.md）。数百人でも探せるように、避難所・状態・氏名（カナ）で絞り、列の見出しで並べ替える。
// 絞り込みの言葉は URL に載せない（氏名が入るので。画面の中だけで持つ）。既定の並びはルールの表の並び（番号）。
// 状態の色と理由は lib/triage の結果をそのまま出す（ここで決め直さない）。氏名を押すと本人のページ。
// 行の「解除」で搬送（行き先）・退所を選んで受け持ちから外す（本人の経過に残る）。
// 医療の列と理由は同意の範囲の物だけが来る（lib/custody/board.ts）。医療要約を開ける人は氏名の横に「医療要約」（T24）。

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { StateTag, TONE_TEXT } from "@/components/person/parts";
import { Button } from "@/components/ui/Button";
import { CloseIcon, UnlistIcon } from "@/components/ui/Icon";
import { LinkPending } from "@/components/ui/LinkPending";
import { TABLE, TABLE_BOX, TH } from "@/components/ui/table";
import type { StaffRow } from "@/lib/custody/board";
import { NOTE_MAX } from "@/lib/custody/forms";
import { CUSTODY_LABELS, CUSTODY_VIA_LABELS, RELEASE_LABELS } from "@/lib/custody/labels";
import { CUSTODY_RELEASE_API } from "@/lib/custody/paths";
import { RELEASE_KINDS, type ReleaseKind } from "@/lib/db/types";
import { COLOR_LABELS, DOCUMENT_LABELS } from "@/lib/labels";
import { COLOR_TONES } from "@/lib/person";
import type { Color } from "@/lib/triage/index";
import { Select } from "@/components/ui/Select";

const SORTS = ["rank", "kana", "age", "remain", "shelter", "received", "office"] as const;
type Sort = (typeof SORTS)[number];

const SORT_LABELS: Record<Sort, string> = {
  rank: "優先",
  kana: CUSTODY_LABELS.name,
  age: CUSTODY_LABELS.age,
  remain: CUSTODY_LABELS.remain,
  shelter: CUSTODY_LABELS.shelter,
  received: CUSTODY_LABELS.receivedAt,
  office: CUSTODY_LABELS.office,
};

/** 降順で並べる列（年齢は上の人から、受入は新しい順） */
const DESCENDING: ReadonlySet<Sort> = new Set<Sort>(["age", "received"]);
const COLORS: ReadonlyArray<Color> = ["red", "yellow", "gray", "green"];

/** セルは詰める（1280px で横に送らない） */
const CELL = "bg-panel px-1.5 py-1.5 align-top";
const INPUT =
  "min-w-0 rounded-md bg-panel2 px-2 py-1 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";
const COLS = 10;
/** 狭い画面で省く列（担当一覧の表と同じ。PC の画面と同じく横に送らない。T40） */
const SM = "hidden sm:table-cell";
const MD = "hidden md:table-cell";
const LG = "hidden lg:table-cell";

function compare(a: StaffRow, b: StaffRow, sort: Sort): number {
  const num = (x: number | null) => (x === null ? Infinity : x);
  switch (sort) {
    case "rank":
      return a.rank - b.rank;
    case "kana":
      return a.kana.localeCompare(b.kana, "ja") || a.rank - b.rank;
    case "age":
      // 上の人から。年齢の無い人は後ろ
      return (b.age ?? -1) - (a.age ?? -1) || a.rank - b.rank;
    case "remain":
      return num(a.remain?.hours ?? null) - num(b.remain?.hours ?? null) || a.rank - b.rank;
    case "shelter":
      return a.shelter.localeCompare(b.shelter, "ja") || a.rank - b.rank;
    case "received":
      return Date.parse(b.receivedAt) - Date.parse(a.receivedAt) || a.rank - b.rank;
    case "office":
      return a.office.localeCompare(b.office, "ja") || a.rank - b.rank;
  }
}

/** 絞り込みの文字: カタカナ・空白なし（漢字の氏名にも当てる） */
function squash(s: string): string {
  return [...s.normalize("NFKC")]
    .map((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return c >= 0x3041 && c <= 0x3096 ? String.fromCodePoint(c + 0x60) : ch;
    })
    .join("")
    .replace(/\s/g, "");
}

export function StaffTable({ rows, shelters }: { rows: StaffRow[]; shelters: string[] }) {
  const [picked, setShelter] = useState("");
  const [color, setColor] = useState<Color | "">("");
  const [text, setText] = useState("");
  const [sort, setSort] = useState<Sort>("rank");
  const [open, setOpen] = useState<string | null>(null);
  // 選んだ避難所の人が搬送・退所で全員いなくなったら（読み直しで一覧から消えたら）全部に戻す
  const shelter = shelters.includes(picked) ? picked : "";

  const shown = useMemo(() => {
    const q = squash(text);
    return rows
      .filter((r) => (shelter ? r.shelter === shelter : true))
      .filter((r) => (color ? r.color === color : true))
      .filter((r) => (q ? squash(r.kana).includes(q) || squash(r.name).includes(q) : true))
      .sort((a, b) => compare(a, b, sort));
  }, [rows, shelter, color, text, sort]);

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-panel px-2 py-1.5 text-sm">
        <label className="flex items-center gap-1.5">
          <span className="text-muted">{CUSTODY_LABELS.shelter}</span>
          <Select value={shelter} onChange={(e) => setShelter(e.target.value)} className={INPUT} data-filter="shelter">
            <option value="">{CUSTODY_LABELS.filterAll}</option>
            {shelters.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </label>
        <fieldset className="flex items-center gap-1" data-filter="state">
          <legend className="sr-only">{CUSTODY_LABELS.state}</legend>
          <span className="mr-0.5 text-muted" aria-hidden>
            {CUSTODY_LABELS.state}
          </span>
          <FilterButton active={color === ""} onClick={() => setColor("")}>
            {CUSTODY_LABELS.filterAll}
          </FilterButton>
          {COLORS.map((c) => (
            <FilterButton key={c} active={color === c} onClick={() => setColor(c)} tone={COLOR_TONES[c]}>
              {COLOR_LABELS[c]}
            </FilterButton>
          ))}
        </fieldset>
        <label className="flex items-center gap-1.5">
          <span className="text-muted">{CUSTODY_LABELS.nameKana}</span>
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className={`${INPUT} w-36`}
            autoComplete="off"
            data-filter="text"
          />
        </label>
        <span className="ml-auto tabular-nums text-muted">
          <span className="font-bold text-ink">{shown.length}</span> / {rows.length} {CUSTODY_LABELS.people}
        </span>
      </div>

      <div className={`mt-1 ${TABLE_BOX}`}>
        <table className={TABLE} data-table="staff">
          <thead>
            <tr>
              <th className={`${TH} w-[4.5rem] text-center`}>{CUSTODY_LABELS.state}</th>
              <Header k="rank" sort={sort} onSort={setSort} className="w-10 text-center" />
              <Header k="kana" sort={sort} onSort={setSort} />
              <Header k="age" sort={sort} onSort={setSort} className={SM} />
              <th className={`${TH} ${MD}`}>{CUSTODY_LABELS.medical}</th>
              <Header k="remain" sort={sort} onSort={setSort} />
              <Header k="shelter" sort={sort} onSort={setSort} className={SM} />
              <Header k="received" sort={sort} onSort={setSort} className={MD} />
              <Header k="office" sort={sort} onSort={setSort} className={LG} />
              <th className={`${TH} w-px`}>
                <span className="sr-only">{CUSTODY_LABELS.release}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={COLS} className={`${CELL} text-muted`}>
                  {rows.length === 0 ? CUSTODY_LABELS.none : CUSTODY_LABELS.noHits}
                </td>
              </tr>
            )}
            {shown.map((r) => (
              <Row key={r.custodyId} row={r} open={open === r.custodyId} onToggle={() => setOpen(open === r.custodyId ? null : r.custodyId)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  tone,
  children,
}: {
  active: boolean;
  onClick: () => void;
  tone?: keyof typeof TONE_TEXT;
  children: React.ReactNode;
}) {
  // 選んだ印は文字の色と下線（下地は敷かない）。状態の色は文字にだけ
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded px-1.5 py-0.5 ${active ? `font-bold underline underline-offset-4 ${tone ? TONE_TEXT[tone] : "text-ink"}` : tone ? TONE_TEXT[tone] : "text-muted"}`}
      data-press
    >
      {children}
    </button>
  );
}

function Header({ k, sort, onSort, className = "" }: { k: Sort; sort: Sort; onSort: (s: Sort) => void; className?: string }) {
  const active = k === sort;
  return (
    <th className={`${TH} px-1 ${className}`} aria-sort={active ? (DESCENDING.has(k) ? "descending" : "ascending") : undefined}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`rounded px-1 py-0.5 ${active ? "text-ink underline decoration-2 underline-offset-4" : ""}`}
        data-press
      >
        {SORT_LABELS[k]}
      </button>
    </th>
  );
}

function Row({ row: r, open, onToggle }: { row: StaffRow; open: boolean; onToggle: () => void }) {
  // 医療の印は時計から（担当一覧と同じ）。時計の無い人（その場で登録した人）は台帳の機器
  const medical = r.marks.length > 0 ? r.marks : r.devices;
  return (
    <>
      <tr data-person={r.personId} data-color={r.color}>
        <td className={`${CELL} text-center`}>
          <StateTag tone={r.tone} size="md">
            {COLOR_LABELS[r.color]}
          </StateTag>
        </td>
        <td className={`${CELL} text-center`}>
          <span className="font-bold tabular-nums">{r.rank}</span>
        </td>
        <td className={`${CELL} min-w-[7rem] sm:min-w-[9rem]`}>
          <Link href={`/people/${encodeURIComponent(r.personId)}`} className="relative -mx-1 rounded px-1 font-bold" data-press>
            {r.name}
            <LinkPending />
          </Link>
          <span className="ml-1 text-xs text-muted">{r.kana}</span>
          {/* 医療要約（T07）を開いて印刷。医療班への提供に同意がある人だけ（T24） */}
          {r.summary && (
            <Link
              href={`/people/${encodeURIComponent(r.personId)}/forms/medical`}
              className="ml-1 rounded px-1 text-xs text-accent underline underline-offset-2"
              data-press
              data-summary
            >
              {DOCUMENT_LABELS.medical}
            </Link>
          )}
          {/* 理由は医療が範囲の外の人には来ない（時計・薬の名前が入るので） */}
          {r.reason && (
            <div className={`mt-0.5 text-xs font-bold ${TONE_TEXT[r.tone]}`} data-reason>
              {r.reason}
            </div>
          )}
        </td>
        <td className={`${CELL} ${SM} whitespace-nowrap`}>
          <span className="tabular-nums">{r.age ?? "—"}</span>
          <span className="text-muted"> 歳</span>
          {r.ageReported && <div className="text-xs text-muted">{CUSTODY_LABELS.reportedAge}</div>}
        </td>
        <td className={`${CELL} ${MD} min-w-[5rem]`}>
          {medical.length === 0 && r.medications.length === 0 ? (
            <span className="text-muted">—</span>
          ) : (
            <div className="space-y-0.5">
              {medical.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {medical.map((m) => (
                    <span key={m} className="whitespace-nowrap rounded bg-panel2 px-1 py-px text-xs">
                      {m}
                    </span>
                  ))}
                </div>
              )}
              {r.medications.length > 0 && (
                <div className="text-xs text-muted">
                  {CUSTODY_LABELS.medications} {r.medications.join("・")}
                </div>
              )}
            </div>
          )}
        </td>
        <td className={`${CELL} whitespace-nowrap`}>
          {r.remain ? (
            <>
              <div className={`font-bold tabular-nums ${r.remain.tone ? TONE_TEXT[r.remain.tone] : ""}`}>{r.remain.text}</div>
              <div className="text-xs text-muted">{r.remain.label}</div>
            </>
          ) : (
            <span className="text-muted">—</span>
          )}
        </td>
        <td className={`${CELL} ${SM} whitespace-nowrap`}>{r.shelter}</td>
        <td className={`${CELL} ${MD} whitespace-nowrap`}>
          <div className="tabular-nums">{r.receivedWhen}</div>
          <div className="text-xs text-muted">{CUSTODY_VIA_LABELS[r.via]}</div>
        </td>
        <td className={`${CELL} ${LG} whitespace-nowrap`}>
          <span className={r.unaffiliated ? "font-bold" : ""}>{r.office}</span>
        </td>
        <td className={`${CELL} w-px whitespace-nowrap text-right`}>
          <Button size="sm" kind={open ? "quiet" : "plain"} icon={open ? CloseIcon : UnlistIcon} onClick={onToggle} aria-expanded={open}>
            {open ? CUSTODY_LABELS.cancel : CUSTODY_LABELS.release}
          </Button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={COLS} className={`${CELL} bg-panel2`}>
            <ReleaseForm custodyId={r.custodyId} onDone={onToggle} />
          </td>
        </tr>
      )}
    </>
  );
}

/** 搬送（行き先）・退所。確定で受け持ちから外す */
function ReleaseForm({ custodyId, onDone }: { custodyId: string; onDone: () => void }) {
  const router = useRouter();
  const [kind, setKind] = useState<ReleaseKind>("transported");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(CUSTODY_RELEASE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ custodyId, kind, note: kind === "transported" ? note : "" }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; label?: string } | null;
      if (data?.ok) {
        onDone();
        router.refresh();
        return;
      }
      setError(data?.label ?? "送信失敗");
    } catch {
      setError("送信失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-x-3 gap-y-2" data-release>
      <fieldset className="flex items-center gap-1.5">
        <legend className="sr-only">{CUSTODY_LABELS.release}</legend>
        {RELEASE_KINDS.map((k) => (
          <label key={k} className="flex h-8 items-center gap-1.5 rounded-md bg-panel px-2">
            <input type="radio" name={`kind-${custodyId}`} value={k} checked={kind === k} onChange={() => setKind(k)} className="accent-accent" />
            {RELEASE_LABELS[k]}
          </label>
        ))}
      </fieldset>
      {kind === "transported" && (
        <label className="flex items-center gap-1.5">
          <span className="text-muted">{CUSTODY_LABELS.destination}</span>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={NOTE_MAX} className={`${INPUT} w-48`} />
        </label>
      )}
      {/* 受け持ちから外す確定なので赤の塗り */}
      <Button type="submit" kind="dangerFill" icon={UnlistIcon} disabled={busy} data-pending={busy ? "" : undefined}>
        {busy ? CUSTODY_LABELS.sending : CUSTODY_LABELS.confirm}
      </Button>
      {error && (
        <span role="alert" className="text-sm font-bold text-danger">
          {error}
        </span>
      )}
    </form>
  );
}
