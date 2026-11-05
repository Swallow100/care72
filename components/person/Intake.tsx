"use client";

// 入れる欄（T03・T04・T45・T138）。本人のページの右に常に開いている、AI の入力専用の欄。手で直すのは左の面の「編集」（SectionEdit）。
// - 上に文字の欄（書く・貼る）。その下に「写真・PDF 読取」と小さなマイク（「話す」）、主のボタン「入力」（前は「分ける」。11/4）
// - 入力: Claude（Sonnet）が文を台帳の欄に振り分け（/api/intake/extract）、今の値と並べた変更点を出す
// - 写真・PDF 読取: ケアプラン・お薬手帳などを選ぶと、必ず黒塗りの画面（RedactSheet、T52）を通る。写った氏名・住所・電話・町名を
//   人が塗り、塗った後の画像（JPEG、EXIF なし）を 1 頁ずつ Opus が読み（/api/intake/read）、同じ変更点を出す。元の写真・PDF は送らない。
//   保存すると経過に「写真を読んだ（隠した所 N か所）」（T45 の読む前の確認の窓「読取確認」はこの画面に置き換えた）
// - 話す（T04）: ブラウザの Web Speech で文字の欄に流す。もう一度押して止めると欄に残り、直してから「入力」。
//   対応していないブラウザ（Firefox など）はボタンを出さない
// - 今の問い（T138）: 入力の欄のすぐ下の決まった所に 1 問だけ置き、そこから動かさない。答える・「次回」にすると、保存の返事を待って
//   ページを読み直す前に、同じ所が次の問いに替わる。問いは空欄が無くなるまで続く
// - その下にやり取り（T138）: 会話の形で、AI と問いは左、ケアマネは右の吹き出し（地の色を分ける）。ひと続きのやり取りを 1 組にし、
//   新しい組を上に並べる（組の中は起きた順。components/person/intake-log.ts）。古い組は「以前 N 件」に畳む。
//   保存は毎回の行にせず、吹き出しの中の小さな状態（保存済）だけ。流れは下へ伸びる（内側で送らない。送るのはページの縦 1 本）
// 保存は全部 /api/intake/save（版を確かめ、埋まった欄は上書きしない）。保存のあとはページを読み直す（流れはこの画面の間だけ残る）。

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { AiStatusMark } from "@/components/ui/AiStatus";
import { Button, buttonClass } from "@/components/ui/Button";
import { Mark } from "@/components/ui/Tag";
import { aiStatusText, type AiStatus } from "@/lib/claude/status";
import { AI_FAIL_REASON_LABELS, INTAKE_LABELS, INTAKE_SAYS, PLACE_LABELS, SECTION_LABELS } from "@/lib/labels";
import { AI_CONSENT_REFUSED_LABEL } from "@/lib/consent/labels";
import { shrinkImage } from "@/lib/forms/shrink-image";
import { buildReadForm, READ_FILES_MAX, type ReadMeta } from "@/lib/intake/read-form";
import type { AiFailReason } from "@/lib/intake/http";
import type { DictationError } from "@/lib/speech/dictation";
import { useDictation } from "@/lib/speech/use-dictation";
import type { Question } from "@/lib/intake/ask";
import { changeText, type IntakeChange } from "@/lib/intake/changes";
import { savedLines } from "@/lib/intake/saved-say";
import type { DiffItem } from "@/lib/intake/diff";
import { INTAKE_SECTIONS } from "@/lib/intake/fields";
import type { IntakeProps } from "@/lib/intake/props";
import { Loader72 } from "@/components/ui/Loader72";
import { WAIT_LABELS } from "@/lib/ui/labels";
import { FoldIcon, MicIcon, MoreIcon, ReadFileIcon, RetryIcon, SplitIcon, StopIcon } from "./icons";
import { isError, postForm, postJson } from "./intake-api";
import { currentAsk, logTurns, saveVersion, TURNS_SHOWN, visibleTurns } from "./intake-log";
import { IntakeChanges, rowsOf, type ChangeRow } from "./IntakeChanges";
import { IntakeQuestion } from "./IntakeQuestion";
import { INPUT } from "./intake-ui";
import { AiMark, StateTag, type Level } from "./parts";
import type { RedactedPage } from "./RedactSheet";

// 黒塗りの画面は写真・PDF を選んだときだけ読み込む（ブラウザだけ。PDF を画像にする pdf.js をサーバーの束に入れない）
const RedactSheet = dynamic(() => import("./RedactSheet").then((m) => m.RedactSheet), { ssr: false });

/** 入力の文の長さの上限（lib/intake/extract.ts の INTAKE_TEXT_MAX と同じ。4,000 字を超える文はサーバーが分けて読む。T120） */
const TEXT_MAX = 12000;
/** 流れに出す入力の文の長さ（貼ったケアプランは頭だけ） */
const ECHO_MAX = 140;

/** masked: 送った文のうち伏せた所の数（T74。「伏せ字 N」。何を伏せたかは持たない） */
type Proposal = { model: string; dropped: number; rows: ChangeRow[]; masked?: number };
/** 再試行できる失敗（AI の返事の失敗）。文は同じ文・同じ問いで、写真・PDF は塗った後の同じ画像で送り直す */
type Retry = { kind: "text"; source: string; focus: string | null } | { kind: "file"; page: RedactedPage };

/**
 * 会話の流れの 1 つ。you はケアマネ（右）、ai は Claude の出力（左、AI の印）、ask は定型の問い（左、印なし）、app は失敗の 1 行。
 * 保存できたかは吹き出しの中の小さな状態（state・changed）で持ち、「N 件を保存しました」の行は作らない（T138）
 */
export type LogEntry =
  | {
      id: string;
      who: "you";
      text: string;
      /** 問いの答えを保存した（「保存済」。同じ値で変わらなければ「変更なし」） */
      state?: "saved" | "unchanged";
      /** 保存の失敗（「競合」「保存失敗」など） */
      error?: string;
    }
  | {
      id: string;
      who: "ai";
      kind: "split";
      say: string;
      proposal: Proposal;
      state: "open" | "saved" | "discarded";
      fromText?: boolean;
      /** 文で答えた問いの欄（保存したら今の問いを次に替える） */
      focus?: string | null;
      /** 保存で変わった数（0 なら「変更なし」） */
      changed?: number;
      /**
       * 保存した中身（T143、lib/intake/saved-say.ts）。保存のあとは数（say）でなく 1 件 1 行の「区分 欄 値」を 5 件まで、残りは「他 N 件」。
       * head は写真・PDF の「〇〇 を読みました」（say の頭）
       */
      saved?: { lines: string[]; more: number; head: string | null };
      /** 保存の失敗（変更点は開いたまま、もう一度保存できる） */
      error?: string;
      /** 黒塗りして読んだ写真・PDF の頁（保存すると経過に「写真を読んだ（隠した所 N か所）」） */
      read?: ReadMeta;
    }
  | { id: string; who: "ai"; kind: "failed"; label: string; reason: AiFailReason | null; retry: Retry | null }
  | { id: string; who: "app"; text: string; tone?: "danger" }
  | { id: string; who: "ask"; q: Pick<Question, "key" | "section" | "label" | "text" | "why" | "example"> };

type SplitEntry = Extract<LogEntry, { kind: "split" }>;
type YouEntry = Extract<LogEntry, { who: "you" }>;

const SPEECH_ERROR_LABELS: Record<DictationError, string> = {
  mic: INTAKE_LABELS.micDenied,
  no_speech: INTAKE_LABELS.noSpeech,
  failed: INTAKE_LABELS.speechFailed,
};

/** 「7 項目を見つけました（医療 3・避難 2）」の数え方。保存できる物（一致を除く）を本人のページの区分ごとに */
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

/** まだ保存していない変更点のある組（古くても畳まない） */
const hasOpen = (turn: readonly LogEntry[]) => turn.some((e) => e.who === "ai" && e.kind === "split" && e.state === "open");

let seq = 0;
const nextId = () => `log-${++seq}`;

type Saved = { ok: true; changed: number } | { ok: false; label: string };

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
  /** この回で「次回」にした欄 */
  const [skip, setSkip] = useState<string[]>([]);
  /** この回で答えて保存できた欄（ページを読み直す前から、今の問いを次に替える） */
  const [done, setDone] = useState<string[]>([]);
  /** 今の問いの答えの保存の失敗（今の問いの所に出す） */
  const [askError, setAskError] = useState<string | null>(null);
  /** 畳んだ古い組を開いている */
  const [all, setAll] = useState(false);
  /** 自分の保存の返事の版（ページの読み直しが届く前に次の問いへ答えても、自分の保存で競合にしない） */
  const [savedVersion, setSavedVersion] = useState(0);
  /** 黒塗りの画面に渡している写真・PDF（開いている間だけ） */
  const [redacting, setRedacting] = useState<File[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const aiReady = aiBlock === null;
  const H = props.level === 1 ? "h2" : "h3";
  const H2 = props.level === 1 ? "h3" : "h4";
  const titleId = `intake-${props.personId}`;
  const fileId = `intake-file-${props.personId}`;

  // 今の 1 問（lib/intake/ask.ts の nextQuestion と同じ選び方。ブラウザに台帳の読み方を持ち込まないため、ここで引く）
  const { question, left } = currentAsk(props.queue, [...skip, ...done]);
  const turns = logTurns(log);
  const { shown, folded } = visibleTurns(turns, all, hasOpen);

  const push = (...entries: Array<LogEntry>) => setLog((l) => [...l, ...entries]);
  const patch = (id: string, p: Partial<SplitEntry>) =>
    setLog((l) => l.map((e) => (e.id === id && e.who === "ai" && e.kind === "split" ? { ...e, ...p } : e)));
  const patchYou = (id: string, p: Partial<YouEntry>) => setLog((l) => l.map((e) => (e.id === id && e.who === "you" ? { ...e, ...p } : e)));

  // 話す: 認識の結果は欄に流れ、もう一度押して止めると欄に残る（直してから「入力」）。
  // 聞いている間も欄を直せ、直した所は次の音声の文字で上書きしない（T143、lib/speech/dictation.ts の edit）
  const speech = useDictation({ maxLength: TEXT_MAX, onText: setText, onDone: (spoken) => setText(spoken) });
  const listening = speech.state !== "idle";

  function failed(r: { error: string; label: string; reason?: AiFailReason }, retry: Retry | null) {
    // AI 提供が不同意の人（T74）は、この人の間は AI の操作を止める（上に「同意 拒否」）
    if (r.error === "ai_not_configured" || r.error === "ai_limit" || r.error === "consent_refused") setAiBlock(blockLabel(r.error, r.label));
    // AI の返事の失敗（形が違う・断られた・時間切れ・API）は理由と「再試行」を流れに。ほかは失敗の 1 行を同じ組に
    if (r.error === "ai_failed" || r.error === "ai_refused") push({ id: nextId(), who: "ai", kind: "failed", label: r.label, reason: r.reason ?? null, retry });
    else push({ id: nextId(), who: "app", text: r.label, tone: "danger" });
  }

  type Proposed = { ok: true; ai: { model: string }; items: DiffItem[]; dropped: number; masked?: number };
  const proposalOf = (r: Proposed): SplitEntry => ({
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
    push({ ...proposalOf(r), fromText: focus === null, focus });
  }

  /** 塗った後の 1 頁を読ませる。送るのは塗った後の画像と黒塗りの画面の印だけ（元の写真・PDF は送らない） */
  async function readPage(page: RedactedPage, echoed = true) {
    if (echoed) push({ id: nextId(), who: "you", text: INTAKE_SAYS.sent(page.name, page.meta.redacted) });
    setBusy("read");
    setError(null);
    const r = await postForm<Proposed>("/api/intake/read", buildReadForm(props.personId, page.blob, page.meta, { bare: page.bare }));
    setBusy(null);
    if (isError(r)) return failed(r, { kind: "file", page });
    push({ ...proposalOf(r), say: `${INTAKE_SAYS.read(page.name)}。${splitSay(r.items)}`, read: page.meta });
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
    if (shrunk.some((r) => !r.ok)) setError(shrunk.some((r) => !r.ok && r.error === "heic") ? PLACE_LABELS.heic : PLACE_LABELS.fileKinds);
    if (ok.length > 0) setRedacting(ok);
  }

  /** 保存。失敗の言葉は呼んだ所（吹き出し・今の問い）に出す。競合はほかの人の保存なので、読み直して今の台帳で選び直す */
  async function save(changes: IntakeChange[], ai: { model: string } | null, read?: ReadMeta): Promise<Saved> {
    setBusy("save");
    setError(null);
    const r = await postJson<{ ok: true; changed: number; version: number }>("/api/intake/save", {
      personId: props.personId,
      version: saveVersion(props.version, savedVersion),
      ai,
      changes,
      ...(read && ai ? { read } : {}),
    });
    setBusy(null);
    if (isError(r)) {
      if (r.error === "conflict") router.refresh();
      return { ok: false, label: r.label };
    }
    setSavedVersion((v) => Math.max(v, r.version));
    router.refresh();
    return { ok: true, changed: r.changed };
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
          // 聞いている間に「入力」を押したら、聞くのをやめて今の欄の文を送る（T143。直してから入力できる）
          if (listening) speech.abort();
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
          // 聞いている間も直せる（T143）。直した文のあとに次の確定した区切りがつながる
          aria-busy={listening}
          onChange={(e) => {
            setText(e.target.value);
            if (listening) speech.edit(e.target.value);
          }}
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
          <Button type="submit" kind="main" size="sm" icon={SplitIcon} className="ml-auto" disabled={working || !aiReady || text.trim() === ""} data-intake="split">
            {INTAKE_LABELS.split}
          </Button>
        </div>
      </form>

      {/* 今の問い。入力の欄のすぐ下の決まった所（やり取りが増えても動かない）。答えると同じ所が次の問いに替わる */}
      <div className="rounded bg-panel2 px-2 py-1.5" data-intake="current" data-key={question?.key ?? ""}>
        {question ? (
          <IntakeQuestion
            question={question}
            left={left}
            busy={working}
            aiReady={aiReady}
            onAnswer={async (changes) => {
              const q = question;
              setAskError(null);
              const r = await save(changes, null);
              if (!r.ok) return setAskError(r.label);
              setDone((d) => [...d, q.key]);
              push({ id: nextId(), who: "ask", q }, { id: nextId(), who: "you", text: changes.map(changeText).join("・"), state: r.changed > 0 ? "saved" : "unchanged" });
            }}
            onSkip={async (q: Question) => {
              // 次回: この回は飛ばし、未聴取として残す（計画に「未確認」）。答えの吹き出しは「次回」
              setAskError(null);
              setSkip((s) => [...s, q.key]);
              const you: LogEntry = { id: nextId(), who: "you", text: INTAKE_LABELS.next };
              push({ id: nextId(), who: "ask", q }, you);
              const r = await save([{ t: "pending", field: q.key, status: "not_asked" }], null);
              if (!r.ok) patchYou(you.id, { error: r.label });
            }}
            onFree={(q, answer) => {
              // 文で答える問い: AI が分けた変更点を保存したら、今の問いを次に替える（取り消したら同じ問いが残る）
              setAskError(null);
              push({ id: nextId(), who: "ask", q });
              void split(answer, q.key);
            }}
          />
        ) : (
          <p className="text-xs text-muted" data-intake="done">
            {INTAKE_SAYS.done}
          </p>
        )}
        {askError && (
          <p role="alert" className="mt-1 text-xs font-bold text-danger" data-intake="ask-error">
            {askError}
          </p>
        )}
      </div>

      {/* やり取り。新しい組が上、組の中は起きた順。古い組は畳む */}
      <div className="space-y-2">
        {log.length > 0 && <H2 className="text-xs font-bold text-muted">{INTAKE_LABELS.log}</H2>}
        <ol aria-label={INTAKE_LABELS.log} className="space-y-3" data-intake="log">
          {shown.map((turn) => (
            <li key={turn[0].id} className="space-y-1.5" data-intake="turn">
              {turn.map((e) => (
                <LogBubble
                  key={e.id}
                  entry={e}
                  props={props}
                  busy={working}
                  aiReady={aiReady}
                  onRows={(rows) => e.who === "ai" && e.kind === "split" && patch(e.id, { proposal: { ...e.proposal, rows } })}
                  onDiscard={() => patch(e.id, { state: "discarded", error: undefined })}
                  onSave={async (changes) => {
                    if (e.who !== "ai" || e.kind !== "split") return;
                    const r = await save(changes, { model: e.proposal.model }, e.read);
                    if (!r.ok) return patch(e.id, { error: r.label });
                    // 吹き出しは保存した中身に（T143）。写真・PDF は「〇〇 を読みました」を頭に残す
                    const head = e.read ? (e.say.split("。")[0] ?? null) : null;
                    patch(e.id, { state: "saved", changed: r.changed, error: undefined, saved: { ...savedLines(changes), head } });
                    if (e.fromText) setText("");
                    const focus = e.focus;
                    if (focus) setDone((d) => [...d, focus]);
                  }}
                  onRetry={(retry) => (retry.kind === "text" ? void split(retry.source, retry.focus, false) : void readPage(retry.page, false))}
                />
              ))}
            </li>
          ))}
        </ol>
        {(folded > 0 || (all && turns.length > TURNS_SHOWN)) && (
          <Button size="sm" kind="quiet" icon={all ? FoldIcon : MoreIcon} aria-expanded={all} data-intake="fold" onClick={() => setAll((a) => !a)}>
            {all ? (
              INTAKE_LABELS.fold
            ) : (
              <span className="tabular-nums">
                {INTAKE_LABELS.earlier} {folded} {INTAKE_LABELS.earlierUnit}
              </span>
            )}
          </Button>
        )}
      </div>

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

/**
 * 吹き出し。AI（Claude の出力）と問い（定型の文）は左、ケアマネは右。地の色で分ける（AI と問いは面の中の灰色、ケアマネはもう 1 段の灰色）。
 * 枠線・影・塗りの色は使わない。AI の印は Claude の出力の吹き出しにだけ付け、問いには付けない（Claude は問いを作らない）
 */
function Bubble({ who, children }: { who: LogEntry["who"]; children: ReactNode }) {
  if (who === "app") {
    return (
      <div className="mr-auto px-1 text-xs" data-who="app" data-side="left">
        {children}
      </div>
    );
  }
  const right = who === "you";
  return (
    <div
      className={`w-fit min-w-0 rounded-lg px-2 py-1.5 break-words ${right ? "ml-auto max-w-[85%] bg-panel3" : "mr-auto max-w-[94%] bg-panel2"}`}
      data-who={who}
      data-side={right ? "right" : "left"}
    >
      {/* 書き手は向きと地の色で示し、読み上げにだけ名前を渡す */}
      <span className="sr-only">{right ? INTAKE_LABELS.you : who === "ask" ? INTAKE_LABELS.ask : "AI"}</span>
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

/** 吹き出しの中の小さな状態（保存済・変更なし・取消）。行を足さず、言葉の後ろに添える */
function SmallState({ children }: { children: ReactNode }) {
  return (
    <span className="text-xs whitespace-nowrap text-muted" data-intake="state">
      {children}
    </span>
  );
}

function SmallError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-0.5 text-xs font-bold text-danger" data-intake="save-error">
      {children}
    </p>
  );
}

export function LogBubble({ entry: e, props, busy, aiReady, onRows, onSave, onDiscard, onRetry }: BubbleProps) {
  switch (e.who) {
    case "you":
      return (
        <Bubble who="you">
          <p className="whitespace-pre-wrap">
            {e.text}
            {e.state && (
              <>
                {" "}
                <SmallState>{e.state === "saved" ? INTAKE_LABELS.saved : INTAKE_LABELS.unchanged}</SmallState>
              </>
            )}
          </p>
          {e.error && <SmallError>{e.error}</SmallError>}
        </Bubble>
      );
    case "app":
      return (
        <Bubble who="app">
          <span className={e.tone === "danger" ? "font-bold text-danger" : "text-muted"}>{e.text}</span>
        </Bubble>
      );
    case "ask":
      // 答えた問い。何を聞いたかの文だけ（なぜ・例は今の問いの所で読んだ物）
      return (
        <Bubble who="ask">
          <p className="mb-0.5 flex flex-wrap items-baseline gap-x-1.5 text-xs">
            <span className="font-bold">{INTAKE_LABELS.ask}</span>
            {e.q.section && (
              <span className="text-muted">
                {SECTION_LABELS[e.q.section]} {e.q.label}
              </span>
            )}
          </p>
          <p className="leading-snug font-bold">{e.q.text}</p>
        </Bubble>
      );
    case "ai":
      if (e.kind === "failed") {
        return (
          <Bubble who="ai">
            <div role="alert" className="flex flex-wrap items-center gap-x-2 gap-y-1" data-intake="failed" data-reason={e.reason ?? ""}>
              <AiMark />
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
      // AI の言った事（数）の吹き出しと、その下に変更点（面の上。外す・直す・保存・取消はそのまま）。
      // 保存・取消のあとは変更点を畳み、吹き出しの中の小さな状態だけを残す
      // 保存したあとは保存した中身を 1 件 1 行で（T143）。変わらなかった・取消は数の言葉のまま
      if (e.state === "saved" && e.saved && (e.changed ?? 0) > 0 && e.saved.lines.length > 0) {
        return (
          <div className="space-y-1.5" data-intake="split" data-state={e.state}>
            <Bubble who="ai">
              <div className="flex items-baseline gap-x-1.5">
                <AiMark />
                <div className="min-w-0 space-y-0.5" data-intake="saved">
                  {e.saved.head && <p className="text-xs text-muted">{e.saved.head}</p>}
                  <ul className="space-y-0.5 font-bold">
                    {e.saved.lines.map((line, i) => (
                      <li key={i} data-intake="saved-line">
                        {line}
                      </li>
                    ))}
                  </ul>
                  <p className="flex flex-wrap items-baseline gap-x-1.5">
                    {e.saved.more > 0 && (
                      <span className="text-xs text-muted tabular-nums" data-intake="saved-more">
                        {INTAKE_LABELS.savedMore(e.saved.more)}
                      </span>
                    )}
                    <SmallState>{INTAKE_LABELS.saved}</SmallState>
                  </p>
                </div>
              </div>
              {e.error && <SmallError>{e.error}</SmallError>}
            </Bubble>
          </div>
        );
      }
      return (
        <div className="space-y-1.5" data-intake="split" data-state={e.state}>
          <Bubble who="ai">
            <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              <AiMark />
              <span className="font-bold" data-intake="say">
                {e.say}
              </span>
              {e.state !== "open" && (
                <SmallState>{e.state === "discarded" ? INTAKE_LABELS.discard : e.changed === 0 ? INTAKE_LABELS.unchanged : INTAKE_LABELS.saved}</SmallState>
              )}
            </p>
            {(e.proposal.masked ?? 0) > 0 && (
              <p className="mt-0.5 text-xs text-muted tabular-nums" data-intake="masked">
                {INTAKE_LABELS.masked} {e.proposal.masked}
              </p>
            )}
            {/* 写真・PDF の読み取りは、塗って隠したフリガナ・住所・電話を AI で埋めない（T117 の問い 5）。手で入れる欄を 1 行で */}
            {e.read && e.state === "open" && (
              <p className="mt-0.5 text-xs text-muted" data-intake="hand-only">
                {INTAKE_LABELS.handOnly} {INTAKE_LABELS.handOnlyFields}
              </p>
            )}
            {e.error && <SmallError>{e.error}</SmallError>}
          </Bubble>
          {e.state === "open" && e.proposal.rows.length > 0 && (
            <div className="mr-4">
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
            </div>
          )}
        </div>
      );
  }
}
