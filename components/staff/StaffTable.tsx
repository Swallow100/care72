"use client";

// 受け持ちの表（/staff、docs/tasks/T23.md）。数百人でも探せるように、避難所・状態・氏名（カナ）で絞り、列の見出しで並べ替える。
// 絞込と並びは URL に載せる（T62。CSV〔/staff/csv〕が画面と同じ行を書くため。前は画面の中だけ）。
// 絞り方と並べ方は lib/custody/staff-view.ts（CSV も同じ関数）。URL は history.replaceState で書き換える（読み直しの要求を出さない）。
// 既定の並びはルールの表の並び（番号）。
// 状態の色と理由は lib/triage の結果をそのまま出す（ここで決め直さない）。氏名を押すと本人のページ。
// 行の「解除」で搬送（行き先）・退所を選んで受け持ちから外す（本人の経過に残る）。
// 医療の列と理由は同意の範囲の物だけが来る（lib/custody/board.ts）。医療要約を開ける人は氏名の横に「医療要約」（T24）。
// 768px 未満で医療の列を省くときは、氏名の下に医療の印を時計の残りつきで 1 行（担当一覧と同じ部品。T54）。
// 768px 以上の医療の列も同じ印（時計の残りつき。T55）。
// 640px 未満は「解除」の列を省き、解除のボタンを氏名の下に出す（375 で列が切れて押せなかった。T55）。解除はどの幅も赤の文字。

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { MedicalMarkList, NarrowMarks } from "@/components/list/NarrowMarks";
import { StateFilter } from "@/components/list/StateFilter";
import { StateTag, TONE_TEXT } from "@/components/person/parts";
import { Button } from "@/components/ui/Button";
import { AddPersonIcon, CloseIcon, OpenIcon, SortIcon, UnlistIcon } from "@/components/ui/Icon";
import { INTAKE_SEARCH_ID } from "./StaffIntake";
import { LinkPending } from "@/components/ui/LinkPending";
import { SORT_ICON, TABLE, TABLE_BOX, TH } from "@/components/ui/table";
import type { StaffRow } from "@/lib/custody/board";
import { NOTE_MAX } from "@/lib/custody/forms";
import { CUSTODY_LABELS, CUSTODY_VIA_LABELS, RELEASE_LABELS } from "@/lib/custody/labels";
import { CUSTODY_RELEASE_API } from "@/lib/custody/paths";
import { RELEASE_KINDS, type ReleaseKind } from "@/lib/db/types";
import { DOCUMENT_LABELS, stateLabel } from "@/lib/labels";
import { COLOR_TONES } from "@/lib/person";
import type { Color } from "@/lib/triage/index";
import { Select } from "@/components/ui/Select";
import { ReasonText } from "@/components/list/ReasonText";
import {
  NO_STAFF_VIEW,
  STAFF_COLORS,
  STAFF_DESCENDING,
  STAFF_SORT_LABELS,
  MAX_STAFF_TEXT,
  staffViewQuery,
  staffViewRows,
  type StaffSort,
  type StaffView,
} from "@/lib/custody/staff-view";

type Sort = StaffSort;

/** セルは詰める（1280px で横に送らない） */
const CELL = "bg-panel px-1.5 py-1.5 align-top";
const INPUT =
  "min-w-0 rounded-md bg-panel2 px-2 py-1 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";
/** 行の詳細（地が panel2）の中の欄は白にする（地と同じ灰色だと箱が見えない。T55 の問い 2） */
const INPUT_IN = INPUT.replace("bg-panel2", "bg-panel");
const COLS = 10;
/** 狭い画面で省く列（担当一覧の表と同じ。PC の画面と同じく横に送らない。T40） */
const SM = "hidden sm:table-cell";
const MD = "hidden md:table-cell";
const LG = "hidden lg:table-cell";

/** URL の query のうち、絞込と並びだけを書き換える（error など、ほかの物は残す） */
function replaceQuery(query: string) {
  const url = new URL(window.location.href);
  for (const k of ["shelter", "color", "q", "sort"]) url.searchParams.delete(k);
  for (const [k, v] of new URLSearchParams(query)) url.searchParams.set(k, v);
  const next = url.pathname + url.search + url.hash;
  // data は null（Next の状態の物を渡すと Next は自分の移りとみなし、useSearchParams に知らせない）
  if (next !== window.location.pathname + window.location.search + window.location.hash) window.history.replaceState(null, "", next);
}

export function StaffTable({
  rows,
  shelters,
  view = NO_STAFF_VIEW,
}: {
  rows: StaffRow[];
  shelters: string[];
  /** URL の絞込と並び（開いたときの値。lib/custody/staff-view.ts の parseStaffView） */
  view?: StaffView;
}) {
  const [picked, setShelter] = useState(view.shelter);
  const [color, setColor] = useState<Color | "">(view.color);
  const [text, setText] = useState(view.q);
  const [sort, setSort] = useState<Sort>(view.sort);
  const [open, setOpen] = useState<string | null>(null);
  // 選んだ避難所の人が搬送・退所で全員いなくなったら（読み直しで一覧から消えたら）全部に戻す
  const shelter = shelters.includes(picked) ? picked : "";

  const current: StaffView = { shelter, color, q: text.trim().slice(0, MAX_STAFF_TEXT), sort };
  const shown = useMemo(
    () => staffViewRows(rows, shelters, { shelter, color, q: text.trim().slice(0, MAX_STAFF_TEXT), sort }),
    [rows, shelters, shelter, color, text, sort],
  );
  // 絞込と並びを URL に（CSV出力のリンク〔StaffCsvLink〕がこれを読む。読み直しても残る）
  // 状態の切替の人数は、避難所と氏名の絞込のあとの人（状態の絞込の前）
  const stateCounts = useMemo(() => {
    const out: Record<Color, number> = { red: 0, yellow: 0, gray: 0, green: 0 };
    for (const r of staffViewRows(rows, shelters, { shelter, color: "", q: text.trim().slice(0, MAX_STAFF_TEXT), sort })) out[r.color] += 1;
    return out;
  }, [rows, shelters, shelter, text, sort]);
  const query = staffViewQuery(current);
  useEffect(() => {
    replaceQuery(query);
  }, [query]);

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
        {/* 見出し「状態」は押せない言葉、切替は押せるボタン（担当一覧の絞込と同じ部品。T66） */}
        <StateFilter label={CUSTODY_LABELS.state} allLabel={CUSTODY_LABELS.filterAll} current={color || null} counts={stateCounts} onPick={(c) => setColor(c ?? "")} />
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
              {/* 640px 未満は状態の印を小さく・連絡順の見出しを 2 字で折り、氏名と理由の列に幅を回す（担当一覧と同じ。T78） */}
              <th className={`${TH} text-center sm:w-[4.5rem]`}>{CUSTODY_LABELS.state}</th>
              <Header k="rank" sort={sort} onSort={setSort} className="w-8 text-center sm:w-10" narrowWrap />
              <Header k="kana" sort={sort} onSort={setSort} />
              <Header k="age" sort={sort} onSort={setSort} className={SM} />
              <th className={`${TH} ${MD}`}>{CUSTODY_LABELS.medical}</th>
              <Header k="remain" sort={sort} onSort={setSort} />
              <Header k="shelter" sort={sort} onSort={setSort} className={SM} />
              <Header k="received" sort={sort} onSort={setSort} className={MD} />
              <Header k="office" sort={sort} onSort={setSort} className={LG} />
              <th className={`${TH} ${SM} w-px`}>
                <span className="sr-only">{CUSTODY_LABELS.release}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={COLS} className={`${CELL} text-muted`}>
                  {rows.length === 0 ? (
                    // 受け持ちが 0 人: 受入の面（1280px 未満は表の下）の検索の欄へ送る入口（T78。前は「なし」だけで手がかりが無かった）
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      {CUSTODY_LABELS.none}
                      <Button size="sm" icon={AddPersonIcon} onClick={toIntake} data-intake-entry>
                        {CUSTODY_LABELS.receive}
                      </Button>
                    </span>
                  ) : (
                    CUSTODY_LABELS.noHits
                  )}
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

/** 受入の面の検索の欄へ送って焦点を置く（受入一覧が空のときの入口、T78） */
function toIntake() {
  const field = document.getElementById(INTAKE_SEARCH_ID);
  // 検索のほかの切替（避難所・新規登録）を開いていれば、面の見出しへ送るだけ
  if (!field) return document.getElementById("intake-title")?.scrollIntoView({ block: "start" });
  field.scrollIntoView({ block: "center" });
  field.focus({ preventScroll: true });
}

/** 並べ替えの見出し。押せる見出しには並べ替えの印（押していない列は上下の印、押している列は下線と向きの印）。押せない見出し（状態・医療）は印なし（T66） */
function Header({
  k,
  sort,
  onSort,
  className = "",
  narrowWrap = false,
}: {
  k: Sort;
  sort: Sort;
  onSort: (s: Sort) => void;
  className?: string;
  /** 640px 未満は見出しを 2 字ずつ折る（「連絡/順」、T78） */
  narrowWrap?: boolean;
}) {
  const active = k === sort;
  const desc = STAFF_DESCENDING.has(k);
  return (
    <th className={`${TH} px-1 ${className}`} aria-sort={active ? (desc ? "descending" : "ascending") : undefined}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`rounded px-1 py-0.5 whitespace-nowrap ${narrowWrap ? "max-sm:w-[calc(2em+0.5rem)] max-sm:whitespace-normal " : ""}outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent ${active ? "text-ink underline decoration-2 underline-offset-4" : "font-normal"}`}
        data-press
      >
        {STAFF_SORT_LABELS[k]}
        {active ? (
          <OpenIcon aria-hidden className={`${SORT_ICON} ${desc ? "" : "rotate-180"}`} />
        ) : (
          <SortIcon aria-hidden className={SORT_ICON} data-sortable />
        )}
      </button>
    </th>
  );
}

function Row({ row: r, open, onToggle }: { row: StaffRow; open: boolean; onToggle: () => void }) {
  // 医療の印は時計から（担当一覧と同じ）。時計の無い人（その場で登録した人）は台帳の機器
  const hasMarks = r.markItems.length > 0 || r.devices.length > 0;
  // 解除（開くと取消）。640px 以上は行の末尾の列、未満は氏名の下に同じ物
  const release = (
    <Button size="sm" kind={open ? "quiet" : "danger"} icon={open ? CloseIcon : UnlistIcon} onClick={onToggle} aria-expanded={open}>
      {open ? CUSTODY_LABELS.cancel : CUSTODY_LABELS.release}
    </Button>
  );
  return (
    <>
      <tr data-person={r.personId} data-color={r.color}>
        <td className={`${CELL} text-center`}>
          <StateTag tone={r.tone} size="fit">
            {stateLabel(r)}
          </StateTag>
        </td>
        <td className={`${CELL} text-center`}>
          <span className="font-bold tabular-nums">{r.rank}</span>
        </td>
        <td className={`${CELL} min-w-[7rem] sm:min-w-[9rem] md:min-w-[7rem] lg:min-w-[9rem]`}>
          <Link href={`/people/${encodeURIComponent(r.personId)}`} className="relative -mx-1 rounded px-1 font-bold" data-press>
            {r.name}
            <LinkPending />
          </Link>
          <span className="ml-1 text-xs text-muted">{r.kana}</span>
          {/* 医療要約（T07）を開いて印刷。医療班への提供に同意がある人だけ（T24）。375 で「医療要/約」と割れないよう 1 塊に（T79） */}
          {r.summary && (
            <Link
              href={`/people/${encodeURIComponent(r.personId)}/forms/medical`}
              className="ml-1 inline-block rounded px-1 text-xs whitespace-nowrap text-accent underline underline-offset-2"
              data-press
              data-summary
            >
              {DOCUMENT_LABELS.medical}
            </Link>
          )}
          {/* 768px 未満は医療の列を省くので、医療の印（「酸素 4h」）を氏名の下に。時計の無い人は医療の列と同じく台帳の機器 */}
          <NarrowMarks items={r.markItems} fallback={r.devices} />
          {/* 理由は医療が範囲の外の人には来ない（時計・薬の名前が入るので） */}
          {r.reason && (
            <div className={`mt-0.5 text-xs font-bold ${TONE_TEXT[r.tone]}`} data-reason>
              <ReasonText text={r.reason} />
            </div>
          )}
          {/* 受入の前の最後の知らせが赤なら、その答え（T78。受入で緑になっても、けが・動けないのまま来たことが分かるように） */}
          {r.before && (
            <div className="mt-0.5 text-xs" data-before>
              <span className="text-muted">{CUSTODY_LABELS.before}</span> <span className={`font-bold ${TONE_TEXT.urgent}`}>{r.before}</span>
            </div>
          )}
          {/* 640px 未満は解除の列を省くので、解除のボタンをここに */}
          <div className="mt-1 sm:hidden" data-release-inline>
            {release}
          </div>
        </td>
        <td className={`${CELL} ${SM} whitespace-nowrap`}>
          <span className="tabular-nums">{r.age ?? "—"}</span>
          <span className="text-muted"> 歳</span>
          {r.ageReported && <div className="text-xs text-muted">{CUSTODY_LABELS.reportedAge}</div>}
        </td>
        <td className={`${CELL} ${MD} min-w-[5rem]`}>
          {!hasMarks && r.medications.length === 0 ? (
            <span className="text-muted">—</span>
          ) : (
            <div className="space-y-0.5">
              {/* 担当一覧の氏名の下・本人のページの上と同じ印（時計のいちばん短い残りつき、残りの色は印の文字。T55） */}
              {hasMarks && (
                <div className="flex flex-wrap gap-1" data-medical-marks>
                  <MedicalMarkList items={r.markItems} fallback={r.devices} />
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
        {/* 残りの数は折り返さず、時計の名前（「人工呼吸器 内蔵電池」）は折り返す（375 で表が幅を超え「解除」が切れていた。担当一覧と同じ。T54） */}
        <td className={`${CELL} sm:min-w-[5.5rem]`}>
          {r.remain ? (
            <>
              {/* 状態の色が付くときは塗りの印（担当一覧の残りと同じ。黄は文字に使わない。T66） */}
              <div className="whitespace-nowrap font-bold tabular-nums" data-remain={r.remain.tone ?? "none"}>
                {r.remain.tone ? (
                  <StateTag tone={r.remain.tone} size="fit">
                    {r.remain.text}
                  </StateTag>
                ) : (
                  r.remain.text
                )}
              </div>
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
        <td className={`${CELL} ${SM} w-px whitespace-nowrap text-right`}>{release}</td>
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
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={NOTE_MAX} className={`${INPUT_IN} w-48`} />
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
