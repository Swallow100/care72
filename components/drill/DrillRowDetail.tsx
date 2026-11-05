// 訓練の左の表の行の下に開く詳細（担当一覧の行の詳細と同じ中身の並べ方）。中身は lib/list/detail.ts の buildRowDetail が作った物。
// 訓練では本番の電話の記録・優先の上書き（本人の経過に書く部品）を出さない。電話・出向くなどの手は T20 の「対応」。
// 連絡先は名前と続柄だけ（訓練の画面から本物の番号にかけない）。安否の時刻は訓練の経過で出す。
// 本人役（T18、Claude）が作った安否には AI の印（aiSignals は lib/drill/view.ts の DrillScreen から）。
// ケアマネが通話・訪問で聞いた安否（T21）は「通話」「訪問」と添える（人が聞いた結果なので AI の印なし。「確認済」は緑の理由だけ）。
// 本人役の赤（本人の言う事つき）は、言う事を声にした物を「録音」として置く（発災時の録音と同じ場所。T21、声は AI の音声）。
// 仮想モードの結末の人（T53）は、上に結末の 1 文と、世界が決めた理由（街と物の事実）を AI の印つきで出す。
// 本人・家族の頼み事のうち未対応の物（T93、通話の往復と訪問で聞いた）は、理由の行の下に灰の文字の印で（色の印にしない。済ませるのは手）。
// 時計は担当一覧と同じ部品（components/person/ClockLines。区分の見出し・きっかけから長さ・残り・出典・確認日。T132）。
// 進行中は連絡先の行（今の詳細と「全部」）を押すと、対応の欄でその本人・連絡の手・その連絡先を選んだ形に（T132、ContactPick と act-pick の口）。
// 手は連絡の区分の手を手の表の順に見て、手の可否の決まり（terms）で押せる最初の物（lib/drill/contact-act.ts）。押せなければ理由を出して押せない。
// 「全部」（T132）は台帳の平時の情報の全部。番号は出さない（「電話あり」）。

import { ClockLines } from "@/components/person/ClockLines";
import { AiMark, REASON_TEXT, StateTag } from "@/components/person/parts";
import { FullDetail } from "@/components/list/FullDetail";
import { FullToggle } from "@/components/list/FullToggle";
import type { ContactKind, DrillAction } from "@/lib/db/types";
import type { ActionTerm } from "@/lib/drill/action-terms";
import { contactAct } from "@/lib/drill/contact-act";
import { CALL_UI, VIRTUAL_LABELS } from "@/lib/drill/labels";
import { minuteText } from "@/lib/drill/time-text";
import { COLOR_LABELS } from "@/lib/labels";
import type { RowDetail } from "@/lib/list/detail";
import { DETAIL_LABELS } from "@/lib/list/labels";
import { TALK_UI } from "@/lib/drill/dialogue";
import type { Ask } from "@/lib/drill/scenarios";
import { AskMarks } from "./TalkBox";
import { ContactPick } from "./ContactPick";

const MINUTE_MS = 60_000;

export function DrillRowDetail({
  detail: d,
  startedAt,
  aiSignals = [],
  heard = {},
  recordings = {},
  ended = null,
  asks = [],
  pick = false,
  terms = null,
}: {
  detail: RowDetail;
  startedAt: string;
  aiSignals?: ReadonlyArray<string>;
  /** ケアマネが通話・訪問で聞いた安否の id → 通話か訪問か */
  heard?: Readonly<Record<string, "call" | "visit">>;
  /** 本人の赤の言う事の声（安否の id → 声の行き先）。声を作れなければ空で文字だけ */
  recordings?: Readonly<Record<string, string>>;
  /** 仮想モードの結末（世界が決めた。T53）。結末でなければ null */
  ended?: { text: string; reason: string | null; ai: boolean } | null;
  /** 本人・家族の頼み事（T93、world.asks のこの人の物）。未対応だけ出す */
  asks?: ReadonlyArray<Ask>;
  /** 連絡先の行から対応の欄の手を選べる（進行中の今の区切りで、対応の欄があるときだけ。T132） */
  pick?: boolean;
  /** この本人の手の可否と所要（T110 の決まりの表の結果。lib/drill/view.ts の terms[本人]）。決まりを選ばなかった訓練は null */
  terms?: Readonly<Partial<Record<DrillAction, ActionTerm>>> | null;
}) {
  /** 連絡先の行を手を選ぶ行に包む（押せる手が無い区分はそのまま） */
  const pickRow = (c: { id: string; kind: ContactKind }, line: React.ReactNode) => {
    const act = pick ? contactAct(c, terms) : null;
    if (!act) return line;
    return (
      <ContactPick person={d.personId} kind={act.kind} target={act.target} label={act.label} block={act.block}>
        {line}
      </ContactPick>
    );
  };
  const open = [...new Set(asks.filter((a) => a.done === null).map((a) => a.kind))];
  const ai = new Set(aiSignals);
  // 安否の時刻は発災からの経過（「6 時間 10 分」。lib/drill/time-text.ts）
  const elapsedOf = (iso: string) => minuteText((Date.parse(iso) - Date.parse(startedAt)) / MINUTE_MS);
  return (
    <div className="@container space-y-2 text-sm" data-detail-of={d.personId}>
      {ended && (
        <div className="space-y-0.5 pt-1" data-ended-detail>
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="text-xs text-muted">{VIRTUAL_LABELS.ended}</span>
            {ended.ai && <AiMark small />}
            <span className="font-bold">{ended.text}</span>
          </div>
          {ended.reason && (
            <div className="flex flex-wrap items-baseline gap-x-1.5" data-ended-reason>
              <span className="text-xs text-muted">{VIRTUAL_LABELS.endedReason}</span>
              <AiMark small />
              <span>{ended.reason}</span>
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-baseline gap-x-3 pt-1">
        <span className="text-xs text-muted">{DETAIL_LABELS.reason}</span>
        <span className={`text-[15px] font-bold ${REASON_TEXT[d.tone]}`} data-reason>
          {d.reason}
        </span>
      </div>
      {open.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-1.5" data-open-asks>
          <span className="text-xs text-muted">{TALK_UI.open}</span>
          <AskMarks asks={open} />
        </div>
      )}
      {/* 表の幅で並べる（圧縮した表は 2 列、広げた表は 3 列） */}
      <div className="grid gap-2 @sm:grid-cols-2 @3xl:grid-cols-3">
        <div className="space-y-2">
          <Part title={DETAIL_LABELS.contacts}>
            {d.contacts.length === 0 ? (
              <p className="text-muted">{DETAIL_LABELS.none}</p>
            ) : (
              <ul className="space-y-0.5">
                {d.contacts.map((c) => (
                  <li key={c.id} data-contact={c.kind}>
                    {pickRow(
                      c,
                      <span className="flex flex-wrap items-baseline gap-x-1.5">
                        <span className="text-xs text-muted">{c.kindLabel}</span>
                        {c.name && <span className="font-bold">{c.name}</span>}
                        {c.relation && <span className="text-xs text-muted">{c.relation}</span>}
                      </span>,
                    )}
                  </li>
                ))}
              </ul>
            )}
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
          <Part title={DETAIL_LABELS.clocks}>
            {d.clocks.length === 0 ? (
              <p className="text-muted">{DETAIL_LABELS.none}</p>
            ) : (
              <ClockLines items={d.clocks.map((k) => ({ id: k.id, text: k.text, tone: k.tone }))} />
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
        </div>
        <Part title={DETAIL_LABELS.signals}>
          {d.signals.length === 0 ? (
            <p className="text-muted">{DETAIL_LABELS.noContact}</p>
          ) : (
            <ul className="space-y-1.5">
              {d.signals.map((s) => (
                <li key={s.id} data-signal={s.id}>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-xs text-muted tabular-nums">
                      {elapsedOf(s.at)}
                    </span>
                    <span className="text-xs text-muted">{s.source}</span>
                    {heard[s.id] && (
                      <span className="text-xs font-bold" data-heard={heard[s.id]}>
                        {heard[s.id] === "visit" ? CALL_UI.heardVisit : CALL_UI.heardCall}
                      </span>
                    )}
                    {ai.has(s.id) && <AiMark small />}
                    <StateTag tone={s.tone}>
                      {s.color === "red" ? COLOR_LABELS.red : s.color === "green" ? COLOR_LABELS.green : COLOR_LABELS.gray}
                    </StateTag>
                    <span>{s.body}</span>
                  </div>
                  {recordings[s.id] && (
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-xs text-muted">{CALL_UI.recording}</span>
                      <AiMark small title="AI の音声（Gemini TTS）" />
                      <audio controls preload="none" src={recordings[s.id]} className="h-8 min-w-0 flex-1" data-recording={s.id} />
                    </div>
                  )}
                  {s.transcript && <p className="mt-0.5">「{s.transcript}」</p>}
                </li>
              ))}
            </ul>
          )}
        </Part>
      </div>
      {d.full && (
        <FullToggle id={d.personId}>
          <FullDetail full={d.full} drill contactSlot={pickRow} />
        </FullToggle>
      )}
    </div>
  );
}

function Part({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md bg-panel2 p-2">
      <h3 className="mb-1 text-[0.8125rem] font-bold">{title}</h3>
      {children}
    </section>
  );
}
