// 状態（至急・要確認・不明・無事）で絞る切替。担当一覧の絞込の帯（components/list/FilterBar）と受入一覧（components/staff/StaffTable）で同じ物。
// 見出し「状態」は押せない言葉（地なし、薄い本文色）。切替は押せる形（面の中の灰の地のボタン、28px）で、見出しと見た目を分ける（T66）。
// 状態のボタンは人数の帯と同じ印と数（1 人以上は塗りの印に本文色の数、0 は印も数も灰。components/ui/Tag の CountLabel）。
// 選んだ印は操作の色の枠（地図の層の切替と同じ形。テーマ色の下地は敷かない）。押したときは灰色だけ（data-press）。
// name を渡すと form の送信のボタン（name=値）になり、スクリプトが動かなくても GET の form で絞れる（担当一覧）。

import { CountLabel, countClass } from "@/components/ui/Tag";
import { COLOR_LABELS } from "@/lib/labels";
import { COLOR_TONES } from "@/lib/person";
import type { Color } from "@/lib/triage/index";

const ORDER: ReadonlyArray<Color> = ["red", "yellow", "gray", "green"];

/** 押せる物の焦点の枠（キーで移ったときだけ） */
const FOCUS = "outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";

export function StateFilter({
  label,
  allLabel,
  current,
  counts,
  onPick,
  name,
  labelClass = "",
}: {
  /** 見出し（状態） */
  label: string;
  /** 絞らない切替の言葉（全部） */
  allLabel: string;
  /** 今の絞り（null は全部） */
  current: Color | null;
  counts: Record<Color, number>;
  onPick: (c: Color | null) => void;
  /** form の送信のボタンにするときの欄の名前（color） */
  name?: string;
  /** 見出しの字の大きさ（担当一覧の帯はほかの見出しと同じ text-xs） */
  labelClass?: string;
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-1" data-filter={name ?? "state"}>
      <legend className="sr-only">{label}</legend>
      <span className={`mr-0.5 text-muted ${labelClass}`.trim()} aria-hidden>
        {label}
      </span>
      <Toggle active={current === null} onClick={() => onPick(null)} name={name} value="">
        {allLabel}
      </Toggle>
      {ORDER.map((c) => (
        <Toggle key={c} active={current === c} onClick={() => onPick(c)} name={name} value={c} label={`${COLOR_LABELS[c]} ${counts[c]}`} color={c}>
          <CountLabel tone={COLOR_TONES[c]} count={counts[c]}>
            {COLOR_LABELS[c]}
          </CountLabel>
          <span className={`font-bold tabular-nums ${countClass(counts[c])}`}>{counts[c]}</span>
        </Toggle>
      ))}
    </fieldset>
  );
}

function Toggle({
  active,
  onClick,
  name,
  value,
  label,
  color,
  children,
}: {
  active: boolean;
  onClick: () => void;
  name?: string;
  value: string;
  /** 読み上げの名前（中が印と数のとき） */
  label?: string;
  color?: Color;
  children: React.ReactNode;
}) {
  return (
    <button
      type={name ? "submit" : "button"}
      name={name}
      value={name ? value : undefined}
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      aria-pressed={active}
      aria-label={label}
      className={`inline-flex h-7 items-center gap-1 rounded bg-panel2 px-2 text-sm text-ink ${FOCUS} ${active ? "font-bold ring-2 ring-accent ring-inset" : ""}`}
      data-press
      data-state-filter={color ?? "all"}
    >
      {children}
    </button>
  );
}
