// 事業所の画面の「アンケート」（docs/tasks/T42.md）。リンクを作る・作ったリンクの状態・答えの一覧・写し。
// 写しは docs/survey/answers.md の表の 1 行（docs/survey/README.md の形。tools/survey/summarize.ts がそのまま読む）。
// 引用が「よい」でない人の記入欄の文は写しに入れない（一覧では読める）。名前・電話らしい物には「要確認」の印。
// 審査員の試しの答え（T 番号）は「全員写し」に入れない。審査員が見ると、審査員が作った物だけが出る（lib/survey/store.ts）。

import { CopyButton } from "@/components/forms/CopyButton";
import { Mark, Panel, StateText, type Tone } from "@/components/ui";
import { shortJst } from "@/lib/disaster/state";
import { answerLine, answerRisks, choiceText, quoteAllowed } from "@/lib/survey/answer";
import { surveyUrl } from "@/lib/survey/paths";
import type { SurveyAnswerItem, SurveyLinkItem, SurveyOverview } from "@/lib/survey/store";
import { SURVEY_LINK_STATE_LABELS, SURVEY_OFFICE_LABELS as L, type SurveyLinkState } from "@/lib/survey/text";
import { CHOICE_QUESTIONS, COLUMNS, FREE_QUESTIONS } from "@/tools/survey/questions";
import { MoreFold } from "./MoreFold";
import { SurveyCreate } from "./SurveyCreate";

const STATE_TONE: Record<SurveyLinkState, Tone> = {
  unopened: "unknown",
  opened: "check",
  answered: "ok",
  expired: "unknown",
};

export function SurveyPanel({ overview, origin }: { overview: SurveyOverview; origin: string }) {
  const { links, answers } = overview;
  const real = answers.filter((a) => !a.judge);
  const allLines = real.map((a) => answerLine(a.id, a.answers)).join("\n");
  return (
    <Panel id="survey" aria-labelledby="survey-title" className="scroll-mt-4">
      <SurveyCreate count={`${L.answers} ${answers.length}・${L.links} ${links.length}`} />

      <h3 className="mt-3 text-sm font-bold text-muted">{L.links}</h3>
      {links.length === 0 ? (
        <p className="mt-1 text-sm text-muted">{L.noLinks}</p>
      ) : (
        <MoreFold first={5} className="mt-1 grid gap-px text-sm" items={links.map((l) => <LinkRow key={l.token} link={l} origin={origin} />)} />
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

function LinkRow({ link, origin }: { link: SurveyLinkItem; origin: string }) {
  const live = link.state === "unopened" || link.state === "opened";
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded bg-panel2 px-2 py-1.5" data-survey-link={link.state}>
      <span className="font-bold">{link.memo || "—"}</span>
      <StateText tone={STATE_TONE[link.state]}>{SURVEY_LINK_STATE_LABELS[link.state]}</StateText>
      {link.judge && <Mark inPanel2>{L.judge}</Mark>}
      <span className="text-xs text-muted">
        {L.expires} {shortJst(link.expiresAt)}
      </span>
      {live && (
        <span className="ml-auto">
          <CopyButton text={surveyUrl(origin, link.token)} />
        </span>
      )}
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
        <StateText tone={quoteAllowed(a) ? "ok" : "unknown"}>{quoteAllowed(a) ? L.quoteOk : L.quoteNo}</StateText>
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
        {/* 紙の並び（役・経験・問 1〜7・問 7 の理由）。引用は上の印 */}
        {COLUMNS.filter((c) => c !== "番号" && c !== "引用").map((column) => {
          const choice = CHOICE_QUESTIONS.find((q) => q.column === column);
          const free = FREE_QUESTIONS.find((q) => q.column === column);
          const text = choice ? choiceText(choice.key, a.choices[choice.key]) : free ? a.free[free.key] : null;
          return (
            <div key={column} className="contents">
              <dt className="text-xs leading-5 text-muted">{column}</dt>
              <dd className={`leading-5 ${free ? "break-words whitespace-pre-wrap" : ""}`}>{text ?? <span className="text-muted">—</span>}</dd>
            </div>
          );
        })}
      </dl>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs text-muted">{L.copyRow}</span>
        <p id={lineId} className="min-w-0 flex-1 rounded bg-panel px-2 py-1 text-xs break-all">
          {line}
        </p>
        <CopyButton text={line} targetId={lineId} />
      </div>
    </li>
  );
}
