"use client";

// 入れる欄（T03・T04・T45）。本人のページの右に常に開いている、AI の入力専用の欄。手で直すのは左の面の「編集」（SectionEdit）。
// - 上に文字の欄（書く・貼る）。その下に「写真・PDF 読取」と小さなマイク（「話す」）、主のボタン「分ける」
// - 分ける: Claude（Sonnet）が文を台帳の欄に分け（/api/intake/extract）、今の値と並べた変更点を出す
// - 写真・PDF 読取: ケアプラン・お薬手帳などを選ぶと、必ず黒塗りの画面（RedactSheet、T52）を通る。写った氏名・住所・電話・町名を
//   人が塗り、塗った後の画像（JPEG、EXIF なし）を 1 頁ずつ Opus が読み（/api/intake/read）、同じ変更点を出す。元の写真・PDF は送らない。
//   保存すると経過に「写真を読んだ（隠した所 N か所）」（T45 の読む前の確認の窓「読取確認」はこの画面に置き換えた）
// - 話す（T04）: ブラウザの Web Speech で文字の欄に流す。もう一度押して止めると欄に残り、直してから「分ける」。
//   対応していないブラウザ（Firefox など）はボタンを出さない
// - 下に会話の流れ（やりとり）: 入れた物 → AI の言った事（「7 項目に分けました（医療 3・避難 2）」と変更点）→ 保存 → 次の問い → 答え …
//   問いは空欄が無くなるまで続き、「次回」で飛ばせる。流れは下へ伸びる（内側で送らない。送るのはページの縦 1 本）
// 保存は全部 /api/intake/save（版を確かめ、埋まった欄は上書きしない）。保存のあとはページを読み直す（流れはこの画面の間だけ残る）。

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { AiStatusMark } from "@/components/ui/AiStatus";
import { Button, buttonClass } from "@/components/ui/Button";
import { Mark } from "@/components/ui/Tag";
import { aiStatusText, type AiStatus } from "@/lib/claude/status";
import { AI_FAIL_REASON_LABELS, INTAKE_LABELS, INTAKE_SAYS, PENDING_STATUS_LABELS, PLACE_LABELS, SECTION_LABELS } from "@/lib/labels";
import { AI_CONSENT_REFUSED_LABEL } from "@/lib/consent/labels";
import { shrinkImage } from "@/lib/forms/shrink-image";
import { buildReadForm, READ_FILES_MAX, type ReadMeta } from "@/lib/intake/read-form";
import type { AiFailReason } from "@/lib/intake/http";
import type { DictationError } from "@/lib/speech/dictation";
import { useDictation } from "@/lib/speech/use-dictation";
import type { Question } from "@/lib/intake/ask";
import { changeText, type IntakeChange } from "@/lib/intake/changes";
import type { DiffItem } from "@/lib/intake/diff";
import { INTAKE_SECTIONS } from "@/lib/intake/fields";
import type { IntakeProps } from "@/lib/intake/props";
import { Loader72 } from "@/components/ui/Loader72";
import { WAIT_LABELS } from "@/lib/ui/labels";
import { MicIcon, ReadFileIcon, RetryIcon, SplitIcon, StopIcon } from "./icons";
import { isError, postForm, postJson } from "./intake-api";
import { IntakeChanges, rowsOf, type ChangeRow } from "./IntakeChanges";
import { IntakeQuestion, QuestionText } from "./IntakeQuestion";
import { INPUT } from "./intake-ui";
import { AiMark, StateTag, type Level } from "./parts";
import type { RedactedPage } from "./RedactSheet";

// 黒塗りの画面は写真・PDF を選んだときだけ読み込む（ブラウザだけ。PDF を画像にする pdf.js をサーバーの束に入れない）
const RedactSheet = dynamic(() => import("./RedactSheet").then((m) => m.RedactSheet), { ssr: false });

/** 入力の文の長さの上限（lib/intake/extract.ts の INTAKE_TEXT_MAX と同じ） */
const TEXT_MAX = 4000;
/** 流れに出す入力の文の長さ（貼ったケアプランは頭だけ） */
const ECHO_MAX = 140;

/** masked: 送った文のうち伏せた所の数（T74。「伏せ字 N」。何を伏せたかは持たない） */
type Proposal = { model: string; dropped: number; rows: ChangeRow[]; masked?: number };
/** 再試行できる失敗（AI の返事の失敗）。文は同じ文・同じ問いで、写真・PDF は塗った後の同じ画像で送り直す */
type Retry = { kind: "text"; source: string; focus: string | null } | { kind: "file"; page: RedactedPage };

/** 会話の流れの 1 つ */
export type LogEntry =
  | { id: string; who: "you"; text: string }
  | {
      id: string;
      who: "ai";
      kind: "split";
      say: string;
      proposal: Proposal;
      state: "open" | "saved" | "discarded";
      fromText?: boolean;
      /** 黒塗りして読んだ写真・PDF の頁（保存すると経過に「写真を読んだ（隠した所 N か所）」） */
      read?: ReadMeta;
    }
  | { id: string; who: "ai"; kind: "failed"; label: string; reason: AiFailReason | null; retry: Retry | null }
  | { id: string; who: "app"; text: string; tone?: "ok" | "danger" }
  | { id: string; who: "ask"; q: Pick<Question, "key" | "label" | "text" | "why" | "example"> };

const SPEECH_ERROR_LABELS: Record<DictationError, string> = {
  mic: INTAKE_LABELS.micDenied,
  no_speech: INTAKE_LABELS.noSpeech,
  failed: INTAKE_LABELS.speechFailed,
};

/** 「7 項目に分けました（医療 3・避難 2）」の数え方。保存できる物（一致を除く）を本人のページの区分ごとに */
export function splitSay(items: readonly DiffItem[]): string {
  const live = items.filter((i) => i.change !== null);
  if (live.length === 0) return INTAKE_SAYS.none;
  const parts = INTAKE_SECTIONS.flatMap((s) => {
    const n = live.filter((i) => i.section === s).length;
    return n > 0 ? [`${SECTION_LABELS[s]} ${n}`] : [];
  });
  return INTAKE_SAYS.split(live.length, parts.join("・"));
}

const UNSET: AiStatus = { kind: "unset" };

/** API が断った AI の状態を、開いたときと同じ言葉に（「AI 未設定」「AI 上限到達」。lib/claude/status.ts） */
function blockLabel(error: string, label: string): string {
  if (error === "ai_not_configured") return aiStatusText(UNSET);
  if (error === "ai_limit") return aiStatusText({ kind: "limit", limit: 0 });
  return label;
}

const echo = (s: string) => (s.length > ECHO_MAX ? `${s.slice(0, ECHO_MAX)}…` : s);

let seq = 0;
const nextId = () => `log-${++seq}`;

export function Intake(props: IntakeProps & { level: Level }) {
  const router = useRouter();
  // AI 提供が不同意の人（T74 の続き）は開いた時点で AI の操作を止める（手で書く欄は使える）。AI が使えなければ「AI 未設定」「AI 上限到達」
  // （AI の状態の言葉は lib/claude/status.ts の 1 か所。訓練の画面と同じ。T76）
  const [aiBlock, setAiBlock] = useState<string | null>(
    props.aiConsentRefused ? AI_CONSENT_REFUSED_LABEL : props.aiReady ? null : aiStatusText(props.aiStatus ?? UNSET),
  );
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<null | "split" | "read" | "save">(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [skip, setSkip] = useState<string[]>([]);
  /** 黒塗りの画面に渡している写真・PDF（開いている間だけ） */
  const [redacting, setRedacting] = useState<File[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const aiReady = aiBlock === null;
  const H = props.level === 1 ? "h2" : "h3";
  const titleId = `intake-${props.personId}`;
  const fileId = `intake-file-${props.personId}`;

  // 次の 1 問（lib/intake/ask.ts の nextQuestion と同じ。ブラウザに台帳の読み方を持ち込まないため、ここで引く）
  const question = props.queue.find((q) => !skip.includes(q.key)) ?? null;
  const left = props.queue.filter((q) => !skip.includes(q.key)).length;

  const push = (...entries: Array<LogEntry>) => setLog((l) => [...l, ...entries]);
  const patch = (id: string, p: Partial<Extract<LogEntry, { kind: "split" }>>) =>
    setLog((l) => l.map((e) => (e.id === id && e.who === "ai" && e.kind === "split" ? { ...e, ...p } : e)));

  // 話す: 認識の結果は欄に流れ、もう一度押して止めると欄に残る（直してから「分ける」）
  const speech = useDictation({ maxLength: TEXT_MAX, onText: setText, onDone: (spoken) => setText(spoken) });
  const listening = speech.state !== "idle";

  function failed(r: { error: string; label: string; reason?: AiFailReason }, retry: Retry | null) {
    // AI 提供が不同意の人（T74）は、この人の間は AI の操作を止める（上に「同意 拒否」）
    if (r.error === "ai_not_configured" || r.error === "ai_limit" || r.error === "consent_refused") setAiBlock(blockLabel(r.error, r.label));
    // AI の返事の失敗（形が違う・断られた・時間切れ・API）は理由と「再試行」を流れに。ほかは上の状態の欄に
    if (r.error === "ai_failed" || r.error === "ai_refused") push({ id: nextId(), who: "ai", kind: "failed", label: r.label, reason: r.reason ?? null, retry });
    else push({ id: nextId(), who: "app", text: r.label, tone: "danger" });
  }

  type Proposed = { ok: true; ai: { model: string }; items: DiffItem[]; dropped: number; masked?: number };
  const proposalOf = (r: Proposed): LogEntry => ({
    id: nextId(),
    who: "ai",
    kind: "split",
    say: splitSay(r.items),
    proposal: { model: r.ai.model, dropped: r.dropped, rows: rowsOf(r.items), masked: r.masked },
    state: "open",
  });

  async function split(source: string, focus: string | null, echoed = true) {
    setBusy("split");
    setError(null);
    if (echoed) push({ id: nextId(), who: "you", text: echo(source) });
    const r = await postJson<Proposed>("/api/intake/extract", { personId: props.personId, text: source, focus });
    setBusy(null);
    if (isError(r)) return failed(r, { kind: "text", source, focus });
    // 文の欄は保存できたら空にする（取り消したら直して送り直せるよう残す）
    push({ ...proposalOf(r), fromText: focus === null } as LogEntry);
  }

  /** 塗った後の 1 頁を読ませる。送るのは塗った後の画像と黒塗りの画面の印だけ（元の写真・PDF は送らない） */
  async function readPage(page: RedactedPage, echoed = true) {
    if (echoed) push({ id: nextId(), who: "you", text: INTAKE_SAYS.sent(page.name, page.meta.redacted) });
    setBusy("read");
    setError(null);
    const r = await postForm<Proposed>("/api/intake/read", buildReadForm(props.personId, page.blob, page.meta, { bare: page.bare }));
    setBusy(null);
    if (isError(r)) return failed(r, { kind: "file", page });
    push({ ...proposalOf(r), say: `${INTAKE_SAYS.read(page.name)}。${splitSay(r.items)}`, read: page.meta } as LogEntry);
  }

  /**
   * 写真・PDF を選んだら、必ず黒塗りの画面へ（読む前の確認の窓の代わり。T52）。
   * 写真は先に端末で縮めて JPEG に（T68。塗るのは縮めた絵の上。順は 縮小 → 塗り → 送る）。JPEG・PNG・PDF のほかは 1 行で断る
   */
  async function readFiles(files: FileList | null) {
    const picked = files ? [...files].slice(0, READ_FILES_MAX) : [];
    if (fileInput.current) fileInput.current.value = "";
    if (picked.length === 0) return;
    setError(null);
    const shrunk = await Promise.all(picked.map((f) => shrinkImage(f, Number.POSITIVE_INFINITY)));
    const ok = shrunk.flatMap((r) => (r.ok ? [r.file] : []));
    if (shrunk.some((r) => !r.ok)) setError(PLACE_LABELS.fileKinds);
    if (ok.length > 0) setRedacting(ok);
  }

  async function save(changes: IntakeChange[], ai: { model: string } | null, read?: ReadMeta): Promise<number | null> {
    setBusy("save");
    setError(null);
    const r = await postJson<{ ok: true; changed: number }>("/api/intake/save", {
      personId: props.personId,
      version: props.version,
      ai,
      changes,
      ...(read && ai ? { read } : {}),
    });
    setBusy(null);
    if (isError(r)) {
      setError(r.label);
      push({ id: nextId(), who: "app", text: r.label, tone: "danger" });
      // 競合はほかの人の保存。読み直して、今の台帳で選び直す
      if (r.error === "conflict") router.refresh();
      return null;
    }
    router.refresh();
    return r.changed;
  }

  const working = busy !== null;
  // Claude が分けている・読んでいる間は AI の待ちの印（T44 の Loader72）、保存の待ちは文字だけ
  const status: ReactNode =
    busy === "split" || busy === "read" ? (
      <Loader72 label={busy === "split" ? WAIT_LABELS.split : INTAKE_LABELS.reading} size={16} live={false} className="text-muted" />
    ) : working ? (
    <span className="text-muted">{INTAKE_LABELS.busy}</span>
  ) : listening ? (
    <span className="font-bold" data-intake="listening">
      {INTAKE_LABELS.listening}
    </span>
  ) : error ? (
    <span className="font-bold text-danger">{error}</span>
  ) : speech.error ? (
    <span className="font-bold text-danger">{SPEECH_ERROR_LABELS[speech.error]}</span>
  ) : null;

  return (
    <section aria-labelledby={titleId} className="space-y-3 rounded-lg bg-panel px-3 py-2.5 text-sm" data-intake="panel">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <H id={titleId} className="text-[1rem] leading-6 font-bold">
          {INTAKE_LABELS.title}
        </H>
        {/* AI の状態は中立の地の印（状態の 4 色を使わない。T76）。同意 拒否は同意の状態なので今までの印のまま。使えるときは本日残り */}
        {aiBlock === AI_CONSENT_REFUSED_LABEL ? (
          <StateTag tone="check">{aiBlock}</StateTag>
        ) : aiBlock ? (
          <span className="font-bold" data-ai-status="blocked">
            <Mark>{aiBlock}</Mark>
          </span>
        ) : (
          props.aiStatus && <AiStatusMark status={props.aiStatus} />
        )}
        <span role="status" className="ml-auto text-xs">
          {status}
        </span>
      </div>

      <form
        className="space-y-1.5"
        data-intake="text"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) void split(text, null);
        }}
      >
        <textarea
          className={`${INPUT} min-h-32 resize-y`}
          rows={6}
          maxLength={TEXT_MAX}
          placeholder={INTAKE_LABELS.placeholder}
          aria-label={INTAKE_LABELS.title}
          value={text}
          // 聞いている間は認識の結果だけが入る（止めたら直せる）
          readOnly={listening}
          aria-busy={listening}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            ref={fileInput}
            id={fileId}
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            multiple
            className="sr-only"
            disabled={working || !aiReady}
            onChange={(e) => void readFiles(e.target.files)}
          />
          <label
            htmlFor={fileId}
            className={`${buttonClass("plain", "sm")} ${working || !aiReady ? "pointer-events-none text-muted" : "cursor-pointer"}`}
            data-press
            data-intake="read"
            aria-disabled={working || !aiReady || undefined}
          >
            <ReadFileIcon aria-hidden className="size-3.5 shrink-0" />
            {INTAKE_LABELS.readFile}
          </label>
          {speech.supported && (
            <Button
              size="sm"
              kind={listening ? "main" : "plain"}
              icon={listening ? StopIcon : MicIcon}
              data-intake="speak"
              aria-pressed={listening}
              disabled={speech.state === "stopping" || (!listening && working)}
              onClick={() => {
                if (listening) return speech.stop();
                setError(null);
                speech.start(text);
              }}
            >
              {listening ? INTAKE_LABELS.speakStop : INTAKE_LABELS.speak}
            </Button>
          )}
          <span className="text-xs text-muted tabular-nums">
            {text.length}/{TEXT_MAX}
          </span>
          <Button type="submit" kind="main" size="sm" icon={SplitIcon} className="ml-auto" disabled={working || listening || !aiReady || text.trim() === ""} data-intake="split">
            {INTAKE_LABELS.split}
          </Button>
        </div>
      </form>

      {/* 会話の流れ。下へ伸びる（内側で送らない） */}
      <ol aria-label={INTAKE_LABELS.log} className="space-y-2" data-intake="log">
        {log.map((e) => (
          <li key={e.id}>
            <LogBubble
              entry={e}
              props={props}
              busy={working}
              aiReady={aiReady}
              onRows={(rows) => e.who === "ai" && e.kind === "split" && patch(e.id, { proposal: { ...e.proposal, rows } })}
              onDiscard={() => {
                patch(e.id, { state: "discarded" });
                push({ id: nextId(), who: "app", text: INTAKE_SAYS.discarded });
              }}
              onSave={async (changes) => {
                if (e.who !== "ai" || e.kind !== "split") return;
                const n = await save(changes, { model: e.proposal.model }, e.read);
                if (n === null) return;
                patch(e.id, { state: "saved" });
                if (e.fromText) setText("");
                push({ id: nextId(), who: "app", text: n > 0 ? INTAKE_SAYS.saved(changes.length) : INTAKE_SAYS.unchanged, tone: "ok" });
              }}
              onRetry={(retry) => (retry.kind === "text" ? void split(retry.source, retry.focus, false) : void readPage(retry.page, false))}
            />
          </li>
        ))}
        <li>
          {question ? (
            <Bubble who="ask">
              <IntakeQuestion
                question={question}
                left={left}
                busy={working}
                aiReady={aiReady}
                onAnswer={async (changes) => {
                  const asked: LogEntry = { id: nextId(), who: "ask", q: question };
                  const answer: LogEntry = { id: nextId(), who: "you", text: changes.map(changeText).join("・") };
                  const n = await save(changes, null);
                  if (n === null) return;
                  const pending = changes.find((c) => c.t === "pending");
                  push(asked, answer, {
                    id: nextId(),
                    who: "app",
                    text: pending && pending.t === "pending" ? INTAKE_SAYS.pending(PENDING_STATUS_LABELS[pending.status]) : INTAKE_SAYS.saved(changes.length),
                    tone: "ok",
                  });
                }}
                onSkip={async (q: Question) => {
                  // 次回: この回は飛ばし、未聴取として残す（計画に「未確認」）
                  setSkip((s) => [...s, q.key]);
                  push({ id: nextId(), who: "ask", q }, { id: nextId(), who: "app", text: INTAKE_SAYS.skipped });
                  await save([{ t: "pending", field: q.key, status: "not_asked" }], null);
                }}
                onFree={(q, answer) => {
                  push({ id: nextId(), who: "ask", q });
                  void split(answer, q.key);
                }}
              />
            </Bubble>
          ) : (
            <p className="text-xs text-muted" data-intake="done">
              {INTAKE_SAYS.done}
            </p>
          )}
        </li>
      </ol>

      {redacting && (
        <RedactSheet
          files={redacting}
          onCancel={() => setRedacting(null)}
          onSend={(pages) => {
            setRedacting(null);
            void (async () => {
              for (const p of pages) await readPage(p);
            })();
          }}
        />
      )}
    </section>
  );
}

/** 吹き出し。AI（Claude の出力）は AI の印、問いは定型の文（Claude は作らない）、入力は右へ寄せる */
function Bubble({ who, children }: { who: LogEntry["who"]; children: ReactNode }) {
  if (who === "app") return <div className="px-1 text-xs">{children}</div>;
  return (
    <div className={`rounded bg-panel2 px-2 py-1.5 ${who === "you" ? "ml-8" : ""}`} data-who={who}>
      {who === "ai" && (
        <div className="mb-1">
          <AiMark />
        </div>
      )}
      {who === "you" && <div className="mb-0.5 text-xs text-muted">{INTAKE_LABELS.you}</div>}
      {children}
    </div>
  );
}

type BubbleProps = {
  entry: LogEntry;
  props: IntakeProps;
  busy: boolean;
  aiReady: boolean;
  onRows: (rows: ChangeRow[]) => void;
  onSave: (changes: IntakeChange[]) => Promise<void>;
  onDiscard: () => void;
  onRetry: (retry: Retry) => void;
};

export function LogBubble({ entry: e, props, busy, aiReady, onRows, onSave, onDiscard, onRetry }: BubbleProps) {
  switch (e.who) {
    case "you":
      return (
        <Bubble who="you">
          <p className="break-words whitespace-pre-wrap">{e.text}</p>
        </Bubble>
      );
    case "app":
      return (
        <Bubble who="app">
          <span className={e.tone === "danger" ? "font-bold text-danger" : e.tone === "ok" ? "font-bold" : "text-muted"}>{e.text}</span>
        </Bubble>
      );
    case "ask":
      return (
        <Bubble who="ask">
          <div className="mb-0.5 text-xs font-bold">{INTAKE_LABELS.ask}</div>
          <QuestionText q={e.q} />
        </Bubble>
      );
    case "ai":
      if (e.kind === "failed") {
        return (
          <Bubble who="ai">
            <div role="alert" className="flex flex-wrap items-center gap-x-2 gap-y-1" data-intake="failed" data-reason={e.reason ?? ""}>
              <span className="font-bold text-danger">{e.label}</span>
              {e.reason && <span className="text-xs font-bold">{AI_FAIL_REASON_LABELS[e.reason]}</span>}
              {e.retry && (
                <Button kind="plainIn" size="sm" icon={RetryIcon} className="ml-auto" disabled={busy || !aiReady} onClick={() => onRetry(e.retry!)}>
                  {INTAKE_LABELS.retry}
                </Button>
              )}
            </div>
          </Bubble>
        );
      }
      // AI の言った事（数）の吹き出しと、その下に変更点（面の上。外す・直す・保存はそのまま）
      return (
        <div className="space-y-1.5" data-intake="split" data-state={e.state}>
          <Bubble who="ai">
            <p className="font-bold" data-intake="say">
              {e.say}
            </p>
            {(e.proposal.masked ?? 0) > 0 && (
              <p className="mt-0.5 text-xs text-muted tabular-nums" data-intake="masked">
                {INTAKE_LABELS.masked} {e.proposal.masked}
              </p>
            )}
            {e.state !== "open" && <p className="mt-0.5 text-xs text-muted">{e.state === "saved" ? INTAKE_LABELS.saved : INTAKE_LABELS.discard}</p>}
          </Bubble>
          {e.state === "open" && e.proposal.rows.length > 0 && (
            <IntakeChanges
              rows={e.proposal.rows}
              dropped={e.proposal.dropped}
              ledger={props.ledger}
              clocks={props.clocks}
              busy={busy}
              onChange={onRows}
              onDiscard={onDiscard}
              onSave={(changes) => void onSave(changes)}
            />
          )}
        </div>
      );
  }
}
