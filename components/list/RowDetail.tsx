// 担当一覧の発災時の行の詳細（docs/tasks/T13.md）。中身は lib/list/detail.ts の buildRowDetail で作り、ここは並べるだけ。
// 上に理由の 1 行（表の理由のまま）と上書きの状態。下は 3 列: 連絡先と電話 / 時計・避難先・支援者 / 最終連絡・信号・録音・分類・優先修正。
// 分類と直す口（T12）は classification で受ける。無ければ信号に付いた分類を読むだけで出し、それも無ければ「分類なし」。

import { AiMark, StateTag, TONE_TEXT } from "@/components/person/parts";
import { COLOR_LABELS } from "@/lib/labels";
import type { DetailSignal, RowDetail as Detail } from "@/lib/list/detail";
import { CLASS_LABELS, DETAIL_LABELS } from "@/lib/list/labels";
import { CallButtons } from "./CallButtons";
import { Hearing } from "./Hearing";
import { OverrideForm } from "./OverrideForm";

export type ClassificationSlot = (signal: DetailSignal) => React.ReactNode;
/** 聞き取りの欄（T49）。無ければ読むだけで出す */
export type HearingSlot = (signal: DetailSignal) => React.ReactNode;

export function RowDetail({
  detail,
  classification,
  hearing,
}: {
  detail: Detail;
  classification?: ClassificationSlot;
  hearing?: HearingSlot;
}) {
  const d = detail;
  return (
    <div className="space-y-2 text-sm" data-detail-of={d.personId}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-1">
        <span className="text-xs text-muted">{DETAIL_LABELS.reason}</span>
        <span className={`text-[15px] font-bold ${TONE_TEXT[d.tone]}`} data-reason>
          {d.reason}
        </span>
        {d.override && (
          <span className="flex flex-wrap items-baseline gap-x-1.5" data-override={d.override.expired ? "expired" : "active"}>
            <StateTag tone="check">{DETAIL_LABELS.override}</StateTag>
            <span>
              {DETAIL_LABELS.base} {d.override.baseLabel}→{d.override.toLabel}
            </span>
            <span className="text-muted">{d.override.reason}</span>
            <span className="text-xs text-muted tabular-nums">
              {d.override.byName} {d.override.when}
            </span>
            {d.override.expired && <span className="font-bold tone-check">{DETAIL_LABELS.expired}</span>}
          </span>
        )}
      </div>

      <div className="grid gap-2 lg:grid-cols-3">
        <div className="space-y-2">
          <Part title={DETAIL_LABELS.contacts}>
            <CallButtons personId={d.personId} contacts={d.contacts} />
          </Part>
          <Part title={DETAIL_LABELS.calls}>
            {d.calls.length === 0 ? (
              <p className="text-muted">{DETAIL_LABELS.none}</p>
            ) : (
              <ul className="space-y-0.5">
                {d.calls.map((c, i) => (
                  <li key={`${c.at}-${i}`} data-call={c.result ?? ""}>
                    <div className="flex flex-wrap gap-x-2">
                      <span className="text-xs text-muted tabular-nums">{c.when}</span>
                      <span
                        className={
                          c.result === "no_answer"
                            ? "font-bold tone-check"
                            : c.heard
                              ? `font-bold ${c.heard.color === "green" ? "text-state-ok" : "text-state-urgent"}`
                              : undefined
                        }
                      >
                        {c.body}
                      </span>
                      {c.who && <span className="text-xs text-muted">{c.who}</span>}
                    </div>
                    {/* メモは経過の payload から（本文には入れない）。小さく */}
                    {c.memo && (
                      <p className="text-xs text-muted" data-call-memo-text>
                        {DETAIL_LABELS.memo} {c.memo}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Part>
        </div>

        <div className="space-y-2">
          <Part title={DETAIL_LABELS.clocks}>
            {d.clocks.length === 0 ? (
              <p className="text-muted">{DETAIL_LABELS.none}</p>
            ) : (
              <ul className="space-y-1">
                {d.clocks.map((k) => (
                  <li key={k.id} data-clock={k.id}>
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-bold">{k.label}</span>
                      {k.remaining ? (
                        <span className={`font-bold tabular-nums ${k.tone ? TONE_TEXT[k.tone] : "text-muted"}`}>{k.remaining}</span>
                      ) : (
                        <span className="text-muted">{k.length ? null : DETAIL_LABELS.unconfirmed}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-2 text-xs text-muted">
                      <span>
                        {k.kindLabel} {k.length ?? DETAIL_LABELS.unconfirmed} {k.start}
                      </span>
                      <span>
                        {DETAIL_LABELS.source} {k.source ?? DETAIL_LABELS.unconfirmed}
                        {k.sourceNote ? ` ${k.sourceNote}` : ""}
                      </span>
                      <span>
                        {DETAIL_LABELS.confirmed} {k.confirmed ?? DETAIL_LABELS.unconfirmed}
                      </span>
                      {k.depends && (
                        <span className={k.depends.unchecked ? "font-bold tone-check" : undefined}>
                          {k.depends.on} {k.depends.check}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Part>
          <Part title={DETAIL_LABELS.destinations}>
            <dl className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-2 gap-y-0.5">
              <dt className="text-xs text-muted">1</dt>
              <dd>{d.destinations.first ?? <span className="text-muted">{DETAIL_LABELS.unconfirmed}</span>}</dd>
              <dt className="text-xs text-muted">2</dt>
              <dd>{d.destinations.second ?? <span className="text-muted">{DETAIL_LABELS.unconfirmed}</span>}</dd>
              <dt className="text-xs text-muted">{DETAIL_LABELS.transport}</dt>
              <dd>{d.destinations.transport ?? <span className="text-muted">{DETAIL_LABELS.unconfirmed}</span>}</dd>
            </dl>
          </Part>
          <Part title={DETAIL_LABELS.supporters}>
            {d.supporters.length === 0 ? (
              <p className="font-bold tone-check">{DETAIL_LABELS.none}</p>
            ) : (
              <ul className="space-y-0.5">
                {d.supporters.map((s) => (
                  <li key={`${s.order}-${s.name}`} className="flex flex-wrap gap-x-1.5">
                    <span className="text-xs text-muted tabular-nums">{s.order}</span>
                    <span className="font-bold">{s.name}</span>
                    <span className="text-xs text-muted">{s.parts.join("・")}</span>
                  </li>
                ))}
              </ul>
            )}
          </Part>
        </div>

        <div className="space-y-2">
          <Part
            title={DETAIL_LABELS.signals}
            aside={
              d.lastContact ? (
                <span className="text-xs font-normal text-muted tabular-nums" data-last-contact>
                  {DETAIL_LABELS.lastContact} {d.lastContact.when} {d.lastContact.source}
                  {d.lastContact.ago ? `（${d.lastContact.ago}${DETAIL_LABELS.ago}）` : ""}
                </span>
              ) : (
                <span className="text-xs font-normal text-muted">{DETAIL_LABELS.noContact}</span>
              )
            }
          >
            {d.signals.length === 0 ? (
              <p className="text-muted">{DETAIL_LABELS.none}</p>
            ) : (
              <ul className="space-y-2">
                {d.signals.map((s) => (
                  <SignalItem key={s.id} signal={s} classification={classification} hearing={hearing} />
                ))}
              </ul>
            )}
          </Part>
          <Part title={DETAIL_LABELS.override}>
            <OverrideForm personId={d.personId} color={d.color} overridden={d.override !== null && !d.override.expired} />
          </Part>
        </div>
      </div>
    </div>
  );
}

function SignalItem({
  signal: s,
  classification,
  hearing,
}: {
  signal: DetailSignal;
  classification?: ClassificationSlot;
  hearing?: HearingSlot;
}) {
  const hasVoice = s.recording !== null || s.transcript !== null;
  return (
    <li data-signal={s.id}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-xs text-muted tabular-nums">{s.when}</span>
        <span className="text-xs text-muted">{s.source}</span>
        <StateTag tone={s.tone}>{s.color === "red" ? COLOR_LABELS.red : s.color === "green" ? COLOR_LABELS.green : COLOR_LABELS.gray}</StateTag>
        <span>{s.body}</span>
      </div>
      <div className="mt-1 empty:hidden">{hearing ? hearing(s) : <Hearing signalId={s.id} source={{ answers: s.row.answers, ai_memo: s.row.ai_memo, memo: s.row.memo }} inset />}</div>
      {s.recording && (
        <div className="mt-1 flex items-center gap-2">
          <span className="text-xs text-muted">{DETAIL_LABELS.recording}</span>
          <audio controls preload="none" src={s.recording} className="h-8 min-w-0 flex-1" data-recording={s.id} />
        </div>
      )}
      {s.transcript && (
        <p className="mt-1">
          <span className="text-xs text-muted">{DETAIL_LABELS.transcript}</span> 「{s.transcript}」
        </p>
      )}
      {hasVoice && <div className="mt-1">{classification ? classification(s) : <ClassesReadOnly signal={s} />}</div>}
    </li>
  );
}

/** 分類（T12 の部品が来るまで）。信号に付いた分類を読むだけで出す。Claude の分類には AI の印 */
function ClassesReadOnly({ signal: s }: { signal: DetailSignal }) {
  if (s.classes.length === 0) {
    return (
      <p className="text-xs text-muted" data-classes="none">
        {DETAIL_LABELS.noClasses}
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5" data-classes={s.classes.join(",")}>
      <span className="text-xs text-muted">{DETAIL_LABELS.classes}</span>
      {s.classifiedBy === "claude" && <AiMark />}
      <span>{s.classes.map((c) => CLASS_LABELS[c]).join("・")}</span>
    </p>
  );
}

function Part({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-md bg-panel2 p-2">
      <h3 className="mb-1 flex flex-wrap items-baseline gap-x-2 text-sm font-bold">
        {title}
        {aside}
      </h3>
      {children}
    </section>
  );
}
