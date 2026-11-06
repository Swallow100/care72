// 時計の欄（docs/tasks/T132.md）。担当一覧の行の詳細・訓練の左の表の行の詳細・本人のページの時計の欄が同じこれで描く。
// 言葉は lib/ledger-words.ts の clockText（1 か所）。区分（機器・物品・薬・状態）は行に混ぜず小さな見出しで束ね、
// 1 行目は「物の名前 きっかけから長さ 残り」（「酸素 内蔵電池 停電から 2 時間 残り 30 分」）、
// 2 行目に小さく「出典 説明書」「確認日 未確認」と頼り先・メモ。長さの未確認は「手元の量 未確認」と何の値かを前に置き、残りの所に置かない。
// 色は残り（走っている時計の今の残り）か、平時の長さの色だけ（tone）。状態を持たない（Server Component のまま使える）。
// quiet（本人のページの見る方の画面、T143）は 2 行目を出さず、出典・確認日・メモは名前に触れた時に出す（components/person/Hint）。

import type { ClockText } from "@/lib/ledger-words";
import { groupByKind } from "@/lib/ledger-words";
import type { StateTone } from "@/lib/person";
import { TONE_TEXT } from "@/components/ui/Tag";
import { Hint } from "@/components/person/Hint";
import { TARGET_EDGE } from "@/components/person/Target";

export type ClockLineItem = {
  id: string;
  text: ClockText;
  /** 残り（災害モード）か長さ（平時）の色。null は色なし */
  tone: StateTone | null;
  /** 平時に長さそのものに色を付ける（本人のページ。災害モードは残りに付ける） */
  toneOnSpan?: boolean;
  /** 長さの右に足す物 */
  after?: React.ReactNode;
  /** 長さが未確認のときに「未確認」の代わりに出す印（本人のページの台帳の未確認と理由。「手元の量 [未確認 不明]」） */
  missingMark?: React.ReactNode;
  /** 2 行目の終わりに足す物（本人のページのメモ） */
  note?: string | null;
  /** 今入れる欄（T169。本人のページの飛んだ先）。紫の枠 */
  target?: boolean;
};

export function ClockLines({ items, boxed = false, quiet = false }: { items: ReadonlyArray<ClockLineItem>; boxed?: boolean; quiet?: boolean }) {
  return (
    <div className="space-y-1.5" data-clock-lines>
      {groupByKind(items.map((i) => ({ ...i, kind: i.text.kind }))).map((g) => (
        <div key={g.kind} data-clock-group={g.kind}>
          <h4 className="text-xs font-bold text-muted">{g.label}</h4>
          <ul className="mt-0.5 space-y-1">
            {g.items.map((k) => (
              <li
                key={k.id}
                className={[boxed ? "rounded bg-panel2 px-2 py-1" : "", k.target ? TARGET_EDGE : ""].filter(Boolean).join(" ") || undefined}
                data-clock={k.id}
                data-target={k.target ? "" : undefined}
              >
                <ClockLine item={k} quiet={quiet} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ClockLine({ item, quiet }: { item: ClockLineItem; quiet: boolean }) {
  const t = item.text;
  const hint = [t.source, t.confirmed, item.note?.trim() || null].filter((x): x is string => !!x).join("　");
  const spanTone = item.toneOnSpan && item.tone && !t.missing ? `font-bold ${TONE_TEXT[item.tone]}` : "";
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {quiet ? (
          <Hint hint={hint} className="font-bold">
            {t.name}
          </Hint>
        ) : (
          <span className="font-bold">{t.name}</span>
        )}
        {t.missing && t.what && item.missingMark ? (
          <>
            <span className="text-muted" data-clock-span="missing">
              {t.what}
            </span>
            {item.missingMark}
          </>
        ) : (
          t.span &&
          (t.missing ? (
            <span className="text-muted" data-clock-span="missing">
              {t.span}
            </span>
          ) : (
            // きっかけ（「停電から」）は本文色、長さ（「2 時間」）にだけ色（本人のページの平時の長さの色）
            <span className="tabular-nums" data-clock-span="set">
              {t.from && <>{t.from} </>}
              <span className={spanTone || undefined}>{t.length}</span>
            </span>
          ))
        )}
        {t.counts && <span className="text-xs text-muted">（{t.counts}）</span>}
        {t.left && (
          <span className={`font-bold tabular-nums ${item.tone ? TONE_TEXT[item.tone] : ""}`} data-clock-left={t.left.over ? "over" : "left"}>
            {t.left.text}
          </span>
        )}
        {t.waiting && <span className="text-xs text-muted">{t.waiting}</span>}
        {item.after}
        {t.depends && (
          <span className={`text-xs ${t.depends.unchecked ? "font-bold tone-check" : "text-muted"}`} data-clock-depends>
            {t.depends.text}
          </span>
        )}
      </div>
      {!quiet && (
        <div className="flex flex-wrap gap-x-3 text-xs text-muted tabular-nums">
          <span data-clock-source={t.sourceMissing ? "missing" : "set"}>{t.source}</span>
          <span data-clock-confirmed={t.confirmedMissing ? "missing" : "set"}>{t.confirmed}</span>
          {item.note && <span>{item.note}</span>}
        </div>
      )}
    </>
  );
}
