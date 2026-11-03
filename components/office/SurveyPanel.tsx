// 事業所の画面の「アンケート」（docs/tasks/T42.md・T65.md）。共有のリンクを作る・リンクの受付の状態と件数・QR・答えの一覧・写し。
// 写しは docs/survey/answers.md の表の 1 行（docs/survey/README.md の形。tools/survey/summarize.ts がそのまま読む）。
// 引用が「よい」でない人の文（記入欄もその他の記入も）は写しに入れない（一覧では読める）。名前・電話らしい物には「要確認」の印。
// 審査員の試しの答え（T 番号）は「全員写し」に入れない。審査員が見ると、審査員が作った物だけが出る（lib/survey/store.ts）。
// T42 の 1 人 1 本のリンクと答え（survey_links・survey_answers）は出さない（作らなくなった。行は残してある）。

import { CopyButton } from "@/components/forms/CopyButton";
import { Mark, Panel, StateText, type Tone } from "@/components/ui";
import { shortJst } from "@/lib/disaster/state";
import { answerLine, answerRisks, choiceText, quoteAllowed } from "@/lib/survey/answer";
import { surveyUrl } from "@/lib/survey/paths";
import { lastMoment, type ShareState } from "@/lib/survey/share";
import type { SurveyAnswerItem, SurveyOverview, SurveyShareItem } from "@/lib/survey/store";
import { SURVEY_OFFICE_LABELS as L, SURVEY_SHARE_STATE_LABELS } from "@/lib/survey/text";
import { CHOICE_QUESTIONS, COLUMNS, TEXT_FIELDS } from "@/tools/survey/questions";
import { MoreFold } from "./MoreFold";
import { SurveyCreate } from "./SurveyCreate";
import { SurveyQrImage, SurveyQrSave } from "./SurveyQr";

const STATE_TONE: Record<ShareState, Tone> = {
  open: "ok",
  full: "check",
  closed: "unknown",
};

/** 一覧の行に出す列（番号・引用は上の印。その他の記入は選んだ言葉に添える） */
const ROW_COLUMNS = COLUMNS.filter((c) => c !== "番号" && c !== "引用" && !c.endsWith("その他"));

export function SurveyPanel({ overview, origin }: { overview: SurveyOverview; origin: string }) {
  const { shares, answers } = overview;
  const real = answers.filter((a) => !a.judge);
  const allLines = real.map((a) => answerLine(a.id, a.answers)).join("\n");
  return (
    <Panel id="survey" aria-labelledby="survey-title" className="scroll-mt-4">
      <SurveyCreate count={`${L.answers} ${answers.length}・${L.links} ${shares.length}`} />

      <h3 className="mt-3 text-sm font-bold text-muted">{L.links}</h3>
      {shares.length === 0 ? (
        <p className="mt-1 text-sm text-muted">{L.noLinks}</p>
      ) : (
        <MoreFold first={3} className="mt-1 grid gap-2 text-sm" items={shares.map((s) => <ShareRow key={s.token} share={s} origin={origin} />)} />
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="text-sm font-bold text-muted">{L.answers}</h3>
        {real.length > 1 && (
          <span className="ml-auto">
            <span className="mr-2 text-xs text-muted">{L.copyAll}</span>
            <CopyButton text={allLines} />
          </span>
        )}
      </div>
      {answers.length === 0 ? (
        <p className="mt-1 text-sm text-muted">{L.none}</p>
      ) : (
        <MoreFold first={5} className="mt-1 grid gap-2 text-sm" items={answers.map((a) => <AnswerRow key={a.id} item={a} />)} />
      )}
    </Panel>
  );
}

function ShareRow({ share, origin }: { share: SurveyShareItem; origin: string }) {
  const url = surveyUrl(origin, share.token);
  const urlId = `survey-share-${share.token.slice(0, 8)}`;
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded bg-panel2 px-2.5 py-2" data-survey-share={share.state}>
      <SurveyQrImage url={url} px={88} />
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-bold">{share.memo || "—"}</span>
          <StateText tone={STATE_TONE[share.state]}>{SURVEY_SHARE_STATE_LABELS[share.state]}</StateText>
          {share.judge && <Mark inPanel2>{L.judge}</Mark>}
          <span className="text-xs text-muted tabular-nums">
            {L.answers} {share.answers}/{share.maxAnswers}・{L.expires} {shortJst(lastMoment(share.expiresAt))}
          </span>
        </div>
        <p id={urlId} className="mt-1 text-xs break-all text-muted select-all">
          {url}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <CopyButton text={url} targetId={urlId} inPanel2 />
          <SurveyQrSave url={url} inPanel2 />
        </div>
      </div>
    </li>
  );
}

function AnswerRow({ item }: { item: SurveyAnswerItem }) {
  const a = item.answers;
  const risks = answerRisks(a);
  const line = answerLine(item.id, a);
  const lineId = `survey-line-${item.id}`;
  return (
    <li className="rounded bg-panel2 px-2.5 py-2" data-survey-answer={item.id}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-bold">{item.id}</span>
        {item.memo && <span>{item.memo}</span>}
        {item.judge && <Mark inPanel2>{L.judge}</Mark>}
        <StateText tone={quoteAllowed(a) ? "ok" : "check"}>{quoteAllowed(a) ? L.quoteOk : L.quoteNo}</StateText>
        {risks.length > 0 && (
          <Mark inPanel2 tone="check">
            {L.risk}
          </Mark>
        )}
        <span className="ml-auto text-xs text-muted">
          {L.submitted} {shortJst(item.submittedAt)}
        </span>
      </div>
      <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
        {/* 表の並び（役・経験・問 1〜9・問 9 の理由・ご意見）。引用は上の印 */}
        {ROW_COLUMNS.map((column) => {
          const choice = CHOICE_QUESTIONS.find((q) => q.column === column);
          const field = TEXT_FIELDS.find((f) => f.column === column);
          const text = choice
            ? choiceText(choice.key, a.choices[choice.key], choice.other ? a.free[choice.other.key] : null)
            : field
              ? a.free[field.key]
              : null;
          return (
            <div key={column} className="contents">
              <dt className="text-xs leading-5 text-muted">{column}</dt>
              <dd className={`leading-5 ${field ? "break-words whitespace-pre-wrap" : ""}`}>{text ?? <span className="text-muted">—</span>}</dd>
            </div>
          );
        })}
      </dl>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs text-muted">{L.copyRow}</span>
        <p id={lineId} className="min-w-0 flex-1 rounded bg-panel px-2 py-1 text-xs break-all">
          {line}
        </p>
        <CopyButton text={line} targetId={lineId} inPanel2 />
      </div>
    </li>
  );
}
