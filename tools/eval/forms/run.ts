// 評価の台（T107）の 1 回。入力の束と様式を、手元の dev の道にそのまま通す:
//   様式: 原本（架空の様式は白紙の HTML → Chrome の PDF、置き場の原本）→ ブラウザの段（頁の画像）→ formReadPost（app/api/forms/read の中身。
//         Opus に読ませ、対応表を下書きで D1 に、頁の画像を R2 に）→ 対応表を D1 から読む
//   入力: 文（extractIntake）か、写真・PDF（ブラウザの段で塗った頁 → checkRedactedImage → readIntake）→ 差分 → saveIntake で台帳に
//   紙: 台帳 × 対応表 → buildMappedSheet・buildOverlaySheet → 埋めた紙（PDF・PNG）
// 正解の側も同じ道を通す（正解どおりに分けた変更を同じ保存で台帳に、正解の対応表で同じ紙）。比べるのはその 2 つ。
// D1 は migrations を流した node:sqlite（手元だけ、回ごとに新しい）、R2 はメモリの偽物。本番の D1 には触らない。

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Principal } from "../../../lib/auth/principal.ts";
import type { AskJsonContext } from "../../../lib/claude/call.ts";
import type { ClaudeClient } from "../../../lib/claude/client.ts";
import { AiBadOutput, AiCallFailed, AiLimitReached, AiNotConfigured, AiRefused } from "../../../lib/claude/errors.ts";
import { d1UsageStore, type UsageStore } from "../../../lib/claude/usage.ts";
import type { Ledger } from "../../../lib/db/types.ts";
import { d1FromSqlite, migratedSqlite } from "../../../lib/db/test-d1.ts";
import { getMapping } from "../../../lib/forms/mapping-db.ts";
import { FORM_FILE_MAX_BYTES, type FormMapping, type LedgerItemKey } from "../../../lib/forms/mapping.ts";
import { pageImageKey, parsePageImages, type PageImage, type PageImageBucket } from "../../../lib/forms/page-images.ts";
import { formReadPost } from "../../../lib/forms/read-post.ts";
import { buildFormReadForm } from "../../../lib/forms/read-upload.ts";
import type { DiffItem } from "../../../lib/intake/diff.ts";
import { extractIntake, INTAKE_TEXT_MAX, pseudonymInputOf, splitIntakeText, type IntakeProposal } from "../../../lib/intake/extract.ts";
import { aiConsentRefusal } from "../../../lib/intake/http.ts";
import type { ReadSource } from "../../../lib/intake/read-form.ts";
import { checkRedactedImage } from "../../../lib/intake/read-check.ts";
import { readIntake, sealReadOutput } from "../../../lib/intake/read.ts";
import { saveIntake, SaveRequestSchema } from "../../../lib/intake/save.ts";
import type { ExtractOutput } from "../../../lib/intake/schema.ts";
import { loadPersonPage, type PersonPageRows } from "../../../lib/person.ts";
import { pseudonymize, PseudonymLeakError } from "../../../lib/pseudonym/index.ts";
import { seedStatements, personStatements } from "../../../seed/sql.ts";
import { SEED_PEOPLE, type SeedPerson } from "../../../seed/people.ts";
import { browserStage, type BrowserResult } from "./browser.ts";
import { goldOf, readCorpus } from "./corpus.ts";
import { fakeClient, type FakeClient, type FakeStyle } from "./fake.ts";
import { GOLD_FORMS, goldMapping, goldReading, type GoldForm } from "./gold.ts";
import { buildInputs, handwriteHtml, hashSeed, pdfHtml, photoHtml, type InputKind, type InputSpec } from "./inputs.ts";
import { buildSheets, sheetHtml, type Sheets } from "./paper.ts";
import { loadReplay, replayClient } from "./replay.ts";
import { lookOfPaper, type LookScore } from "./look.ts";
import { costUsd, jsonl, realClient, recorder, type CallRecord, type Jsonl } from "./record.ts";
import { heicBytes, launchRenderer, withExif, type Ratio, type Renderer } from "./render.ts";
import { cellOfSheet, scoreIntake, scorePaper, scoreRead, type IntakeScore, type Judgement, type PaperScore, type ReadScore } from "./score.ts";

export const REPO_ROOT = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
/** 入力の作り方の版。変えたら入力を作り直す（置き場の _inputs/<版>）。g2: 頭の行の生年月日を入れ方ごとに略記・漢数字に（T118） */
export const GEN_VERSION = "g2";
/** 紙の日付（決まった日。年齢と作成日がこの日で数わる） */
export const EVAL_TODAY = "2026-11-05";
const OFFICE = "office-demo";
const ACCOUNT = "acct-yamamoto";

export type PaperMode = "none" | "png" | "pdf" | "all";

export type EvalOptions = {
  /** replay は前の本物の回の返事で数え直す（T133。API を呼ばない） */
  mode: "fake" | "real" | "replay";
  /** 数え直す回のフォルダ（mode が replay のとき。読むだけ） */
  replayDir?: string;
  fakeStyle: FakeStyle;
  /** 本物の回の鍵（環境変数から。台はファイルを探さない） */
  apiKey?: string;
  /** 回のフォルダの親（リポジトリの外） */
  outRoot: string;
  /** 様式の置き場（無ければ置き場の様式は飛ばす） */
  corpusRoot: string | null;
  /** 前の回との差の md を置く所（null なら回のフォルダだけ） */
  progressDir: string | null;
  paper: PaperMode;
  /** 正解の表の無い様式（置き場の様式）の紙も、全部の入力で刷る（既定は台帳そのままの 1 人だけ） */
  paperAllForms?: boolean;
  /** 絞り込み（様式の id・入力の id の頭・人の id）。様式は gold（正解の表のある物）・corpus（置き場の正解の無い物）・置き場のフォルダの名前も */
  forms?: string[];
  inputs?: string[];
  people?: string[];
  today?: string;
  /** 回の名前（無ければ日時と mode） */
  runId?: string;
  /** Chrome（"auto" は探す。テストは null で絵・PDF・紙を飛ばす） */
  renderer?: Renderer | null | "auto";
  /** テストの差し替え: 様式の頁の画像（id → JPEG の頁）と、入力の絵（id → 選んだファイルと伏せる所） */
  formPages?: Record<string, Uint8Array[]>;
  inputFiles?: Record<string, { bytes: Uint8Array; secrets: Ratio[][] }>;
  /** 本物の回の費用の見積もりの上限（ドル）。超えたら次の様式・入力を始めない（飛ばした物は「上限」と数える） */
  maxUsd?: number | null;
  log?: (line: string) => void;
};

// ---------- 結果の形 ----------

export type FormResult = {
  id: string;
  title: string;
  gold: boolean;
  status: "ok" | "skipped" | "failed";
  reason?: string;
  pages: number;
  read: ReadScore | null;
  overlay: boolean;
  /** 読めた欄・台帳の項目に当てた欄・場所のある欄 */
  fields?: number;
  mapped?: number;
  placed?: number;
  /** 読めなかった頁・切れた答えから拾った欄だけの頁（T120。読めた頁の欄で対応表にした） */
  unread?: number[];
  partial?: number[];
};

export type InputResult = {
  id: string;
  kind: InputKind;
  personId: string;
  status: "ok" | "partial" | "failed" | "skipped";
  /** 失敗の理由（type・too_large・too_long・redact・ai_*・save_*） */
  failures: string[];
  pieces: number;
  sentPieces: number;
  /** 生のファイルの大きさが上限（5 MB）を超えていたか（ブラウザの段で縮めて送る） */
  rawOverLimit: boolean;
  intake: IntakeScore | null;
  /** 正解どおりに分けた台帳と種の台帳の違い（道で運べない値。AI に関係ない） */
  carryLoss: number;
};

export type PaperResult = {
  form: string;
  input: string;
  kind: InputKind;
  score: PaperScore | null;
  /** 紙の見た目の数（T133。元の様式の上の紙だけ。正解の表の無い様式も） */
  look?: LookScore;
  files: { pdf?: string; fillPdf?: string; png?: string; fillPng?: string };
};

/** aiCalls は手元の D1 の ai_calls の行から数えた物（費用の見積もりの元） */
export type CallSummary = {
  aiCalls: { rows: number; ok: number; failed: number; inputTokens: number; outputTokens: number; costUsd: number; byPurpose: Record<string, number> };
  calls: number; ok: number; failed: number; retried: number; attempts: number; durationMs: number; inputTokens: number; outputTokens: number; costUsd: number; byModel: Record<string, { calls: number; costUsd: number }>;
  /** 出力の上限で切れた呼び出し（T131。失敗に数えるが、様式の読み取りは拾えた欄を残して続きを頼む） */
  truncated: number;
  /** 様式の読み取りの 1 回の出力の最大（考える分を含む） */
  formReadMaxOutput: number;
};

export type LeakSummary = { calls: number; textHits: number; strongHits: number; birthHits: number; weakHits: number; images: number; imagesRedacted: number; imagesNotRedacted: number };

export type RunResult = {
  run: string;
  mode: "fake" | "real" | "replay";
  fakeStyle: FakeStyle | null;
  /** 数え直した前の回（T133） */
  replayOf?: string;
  startedAt: string;
  finishedAt: string;
  today: string;
  genVersion: string;
  corpus: { root: string | null; missing: boolean; files: number; excluded: number; cities: string[] };
  renderer: boolean;
  /** 埋めた紙を刷ったか（all・pdf・png・none） */
  paper?: PaperMode;
  forms: FormResult[];
  inputs: InputResult[];
  papers: PaperResult[];
  calls: CallSummary;
  leaks: LeakSummary;
  dir: string;
};

// ---------- 手元の D1 と R2 ----------

function memoryBucket(): PageImageBucket & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    put: async (key, value) => {
      objects.set(key, value);
    },
    get: async (key) => {
      const o = objects.get(key);
      return o ? { body: o, size: o.length } : null;
    },
  };
}

const PRINCIPAL: Principal = {
  role: "care_manager",
  judge: false,
  admin: false,
  accountId: ACCOUNT,
  displayName: "山本",
  office: { id: OFFICE, name: "デモ事業所", kind: "demo" },
  caseloadOf: ACCOUNT,
  personId: null,
  contactId: null,
};

/** 入れる欄で埋める前の台帳（人が手で入れる物〔住所・位置・経路地図・連絡先の名前と電話と順〕と、分け方に無い空欄の理由だけ） */
export function blankPerson(p: SeedPerson, id: string, removePending: ReadonlySet<string>): SeedPerson {
  const l = p.ledger;
  const ledger: Ledger = {
    basic: { ...(l.basic.address ? { address: l.basic.address } : {}), ...(l.basic.location ? { location: l.basic.location } : {}) },
    care: {},
    medical: { devices: l.medical.devices.filter((d) => d.kind === "other"), medications: [] },
    evacuation: {
      hazards: l.evacuation.hazards.filter((h) => h.kind === "other"),
      ...(l.evacuation.destination1Location ? { destination1Location: l.evacuation.destination1Location } : {}),
      ...(l.evacuation.destination2Location ? { destination2Location: l.evacuation.destination2Location } : {}),
      ...(l.evacuation.routeMap ? { routeMap: l.evacuation.routeMap } : {}),
    },
    notes: [],
    pending: l.pending.filter((x) => !removePending.has(x.field)),
  };
  return {
    person: { ...p.person, id },
    ledger,
    contacts: p.contacts.map((c) => ({ ...c, id: `${id}-${c.id}`, night_ok: null, note: c.kind === "self" ? c.note : null })),
    refusedConsents: p.refusedConsents,
    clocks: p.clocks.map((k) => ({ ...k, id: `${id}-${k.id}` })),
  };
}

// ---------- 出力先の守り ----------

/** 回のフォルダがリポジトリの中なら止める（原本の写る紙・送った画像をリポジトリに入れない） */
export function assertOutside(dir: string): void {
  const rel = relative(REPO_ROOT, resolve(dir));
  if (rel === "" || (!rel.startsWith("..") && !rel.includes(":"))) throw new Error(`出力先がリポジトリの中: ${dir}（リポジトリの外を指す）`);
}

function stamp(d: Date): string {
  const j = new Date(d.getTime() + 9 * 3600_000).toISOString();
  return `${j.slice(0, 10).replace(/-/g, "")}-${j.slice(11, 19).replace(/:/g, "")}`;
}

const failureOf = (e: unknown): string => {
  if (e instanceof AiNotConfigured) return "ai_not_configured";
  if (e instanceof AiLimitReached) return "ai_limit";
  if (e instanceof AiRefused) return "ai_refused";
  if (e instanceof AiBadOutput) return `ai_bad_output_${e.reason}`;
  if (e instanceof AiCallFailed) return `ai_failed_${e.code}`;
  if (e instanceof PseudonymLeakError) return "pseudonym_leak";
  return `error_${e instanceof Error ? e.name : typeof e}`;
};

const matchesAny = (id: string, filters?: string[]) => !filters || filters.length === 0 || filters.some((f) => id === f || id.startsWith(f));

// ---------- 1 回 ----------

export async function runEval(opts: EvalOptions): Promise<RunResult> {
  const today = opts.today ?? EVAL_TODAY;
  const started = new Date();
  const run = opts.runId ?? `${stamp(started)}-${opts.mode}`;
  assertOutside(opts.outRoot);
  const dir = join(opts.outRoot, run);
  mkdirSync(dir, { recursive: true });
  const log: Jsonl = jsonl(dir);
  const t0 = performance.now();
  const say = (line: string) => opts.log?.(`${((performance.now() - t0) / 1000).toFixed(1)}s ${line}`);
  if (opts.mode === "real" && !opts.apiKey) throw new Error("本物の回は鍵（環境変数 ANTHROPIC_API_KEY）が要る");

  // 手元の D1（migrations を流した node:sqlite）と種
  const sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  const db = d1FromSqlite(sqlite);
  const bucket = memoryBucket();

  // AI の client（記録で包む）
  const rec = recorder({ run, dir, log });
  const fake: FakeClient | null = opts.mode === "fake" ? fakeClient(opts.fakeStyle, rec.holder) : null;
  if (opts.mode === "replay" && !opts.replayDir) throw new Error("数え直しは前の回のフォルダが要る（--replay=<回のフォルダ>）");
  const replay = opts.mode === "replay" ? replayClient(loadReplay(opts.replayDir!), rec.current, rec.holder) : null;
  const inner: ClaudeClient = fake ?? replay ?? realClient(opts.apiKey!, rec.holder);
  const evalCtx: AskJsonContext = {
    env: { ANTHROPIC_API_KEY: opts.mode === "real" ? opts.apiKey : opts.mode, AI_DAILY_LIMIT: "1000" },
    usage: rec.usage(d1UsageStore(db)),
    office: { id: OFFICE, kind: "demo" },
    claude: rec.client(inner),
  };
  // 正解の側（偽の gold。ai_calls にも記録にも数えない）
  const noUsage: UsageStore = { reserve: async () => true, finish: async () => {}, countDay: async () => 0 };
  const oracle = fakeClient("gold", { current: null });
  const oracleCtx: AskJsonContext = { env: { ANTHROPIC_API_KEY: "oracle" }, usage: noUsage, office: { id: OFFICE, kind: "demo" }, claude: oracle };

  const renderer = opts.renderer === undefined || opts.renderer === "auto" ? await launchRenderer() : opts.renderer;
  const cacheDir = join(opts.outRoot, "_inputs", GEN_VERSION);
  const step = (row: Record<string, unknown>) => log.write("steps.jsonl", { run, ms: Math.round(performance.now() - t0), ...row });
  const judge = (js: Judgement[]) => {
    for (const x of js) log.write("judgements.jsonl", { run, ...x });
  };
  // 費用の上限（本物の回だけ）。記録した呼び出しの見積もりの合計で見て、超えたら次の様式・入力を始めない
  const spentUsd = () => rec.all().reduce((n, r) => n + (r.costUsd ?? 0), 0);
  const overBudget = () => opts.mode === "real" && opts.maxUsd != null && spentUsd() >= opts.maxUsd;

  try {
    // ---------- 様式 ----------
    const corpus = readCorpus(opts.corpusRoot);
    const forms: FormResult[] = [];
    const ready: Array<{ form: GoldForm | null; id: string; title: string; mapping: FormMapping; images: PageImage[] | null; pages: Uint8Array[]; pairs: Map<number, string> }> = [];
    type FormJob = { id: string; gold: GoldForm | null; title: string; original: () => Promise<{ bytes: Uint8Array } | { pages: Uint8Array[] } | null> };
    const jobs: FormJob[] = [];
    for (const g of GOLD_FORMS) {
      if (!matchesAny(g.id, opts.forms) && !opts.forms?.includes("gold")) continue;
      if (g.source.kind === "generated") {
        const src = g.source;
        jobs.push({
          id: g.id,
          gold: g,
          title: g.title,
          original: async () => {
            if (opts.formPages?.[g.id]) return { pages: opts.formPages[g.id] };
            if (!renderer) return null;
            const path = join(cacheDir, "forms", `${g.id}.pdf`);
            if (!existsSync(path)) {
              mkdirSync(join(cacheDir, "forms"), { recursive: true });
              writeFileSync(path, (await renderer.pdf(src.html())).bytes);
            }
            return { bytes: new Uint8Array(readFileSync(path)) };
          },
        });
      } else {
        const file = corpus.files.find((f) => goldOf(f, [g]) === g);
        if (!file) {
          forms.push({ id: g.id, title: g.title, gold: true, status: "skipped", reason: "原本なし", pages: 0, read: null, overlay: false });
          step({ stage: "form", form: g.id, ok: false, reason: "原本なし（置き場に無い）" });
          continue;
        }
        jobs.push({ id: g.id, gold: g, title: g.title, original: async () => ({ bytes: new Uint8Array(readFileSync(file.path)) }) });
      }
    }
    // 置き場の様式のうち正解の表の無い物（数は読めた欄だけ）
    for (const f of corpus.files) {
      if (goldOf(f, GOLD_FORMS)) continue;
      if (!matchesAny(f.id, opts.forms) && !matchesAny(f.dir, opts.forms) && !opts.forms?.includes("corpus")) continue;
      jobs.push({ id: f.id, gold: null, title: `${f.city} ${f.formName ?? f.fileName}`, original: async () => ({ bytes: new Uint8Array(readFileSync(f.path)) }) });
    }

    for (const job of jobs) {
      say(`様式 ${job.id}`);
      if (overBudget()) {
        forms.push({ id: job.id, title: job.title, gold: !!job.gold, status: "skipped", reason: "上限", pages: 0, read: null, overlay: false });
        step({ stage: "form", form: job.id, ok: false, reason: `費用の上限 $${opts.maxUsd}（見積もり $${spentUsd().toFixed(2)}）` });
        continue;
      }
      const orig = await job.original();
      if (!orig) {
        forms.push({ id: job.id, title: job.title, gold: !!job.gold, status: "skipped", reason: "Chrome なし", pages: 0, read: null, overlay: false });
        step({ stage: "form", form: job.id, ok: false, reason: "Chrome が無く白紙を作れない" });
        continue;
      }
      let pages: Array<{ bytes: Uint8Array; source: ReadSource; page: number; ink?: number[] }>;
      if ("pages" in orig) pages = orig.pages.map((b, i) => ({ bytes: b, source: "pdf" as const, page: i + 1 }));
      else {
        // 様式の頁は印刷の字の位置も作る（T133。アプリの様式の読取と同じ）
        const br: BrowserResult = await browserStage(orig.bytes, [], { ink: true });
        step({ stage: "form.receive", form: job.id, ok: br.ok, rawBytes: br.rawBytes, ...(br.ok ? { totalPages: br.totalPages, pages: br.pages.map((p) => ({ bytes: p.bytes.length, w: p.width, h: p.height, q: p.quality })) } : { error: br.error }) });
        if (!br.ok) {
          forms.push({ id: job.id, title: job.title, gold: !!job.gold, status: "failed", reason: br.error, pages: 0, read: null, overlay: false });
          continue;
        }
        pages = br.pages.map((p) => ({ bytes: p.bytes, source: p.meta.source, page: p.meta.page, ink: p.ink }));
      }
      const answer = job.gold ? goldReading(job.gold, pages.length) : { title: job.title, issuer: "", pages: pages.length, typeface: "gothic" as const, fields: [] };
      // 様式の読み取りは 1 頁 1 回（T120）。頁の数だけ正解を積む（崩し方の種は様式で 1 つ。偽の client が頼まれた頁の分を返す）
      for (let i = 0; i < pages.length; i++) fake?.expect(job.gold ? { kind: "read", answer } : { kind: "read", answer, noise: false }, job.id);
      rec.scope(job.id, "form_read");
      const form = buildFormReadForm(pages.map((p) => ({ blob: new Blob([p.bytes as BlobPart], { type: "image/jpeg" }), meta: { source: pages[0].source, page: p.page, redacted: 0 }, bare: true, ink: p.ink ?? null })));
      // 頁は 1 つずつ読む（呼び出しの記録を順に結ぶため。アプリは並べて読む）
      const res = await formReadPost({ db, bucket, aiContext: async () => evalCtx, newId: () => `fm-${job.id}`, readConcurrency: 1 }, { officeId: OFFICE, accountId: ACCOUNT }, form);
      rec.flush();
      fake?.drain();
      const body = (await res.json()) as { ok: boolean; id?: string; error?: string; rejected?: number; unread?: number[]; partial?: number[] };
      if (!body.ok || !body.id) {
        forms.push({ id: job.id, title: job.title, gold: !!job.gold, status: "failed", reason: body.error ?? `http_${res.status}`, pages: pages.length, read: null, overlay: false });
        step({ stage: "form.read", form: job.id, ok: false, status: res.status, error: body.error });
        continue;
      }
      const stored = (await getMapping(db, OFFICE, body.id))!;
      const images = parsePageImages(stored.page_images);
      let read: ReadScore | null = null;
      let pairs = new Map<number, string>();
      if (job.gold) {
        const s = scoreRead(job.gold, stored.mapping, body.rejected ?? 0);
        read = s.score;
        pairs = s.pairs;
        judge(s.judgements);
      }
      step({
        stage: "form.read",
        form: job.id,
        ok: true,
        mapping: body.id,
        fields: stored.mapping.fields.length,
        mapped: stored.mapping.fields.filter((f) => f.item !== null).length,
        placed: stored.mapping.fields.filter((f) => (f.box ?? null) !== null).length,
        rejected: body.rejected ?? 0,
        pages: stored.mapping.pages,
        unread: body.unread ?? [],
        partial: body.partial ?? [],
        typeface: stored.mapping.typeface ?? null,
        // 一覧の形の様式（T131）の行の数と行の間
        list: stored.mapping.list ?? null,
        fieldsRead: stored.mapping.fields.map((f) => ({ id: f.id, page: f.page, section: f.section, label: f.label, shape: f.shape, item: f.item, confidence: f.ai?.confidence, reason: f.ai?.reason, rejected: f.ai?.rejected ?? null, box: f.box ?? null })),
        score: read,
      });
      forms.push({
        id: job.id,
        title: job.title,
        gold: !!job.gold,
        status: "ok",
        pages: stored.mapping.pages,
        read,
        overlay: !!images && stored.mapping.fields.some((f) => (f.box ?? null) !== null),
        fields: stored.mapping.fields.length,
        mapped: stored.mapping.fields.filter((f) => f.item !== null).length,
        placed: stored.mapping.fields.filter((f) => (f.box ?? null) !== null).length,
        ...(body.unread?.length ? { unread: body.unread } : {}),
        ...(body.partial?.length ? { partial: body.partial } : {}),
      });
      ready.push({ form: job.gold, id: job.id, title: job.title, mapping: stored.mapping, images, pages: pages.map((p) => p.bytes), pairs });
    }

    // ---------- 入力 ----------
    const people = SEED_PEOPLE.filter((p) => !opts.people || opts.people.length === 0 || opts.people.includes(p.person.id));
    const specs = buildInputs(people).filter((s) => matchesAny(s.id, opts.inputs));
    const inputs: InputResult[] = [];
    const rowsOf = new Map<string, { actual: PersonPageRows; expected: PersonPageRows }>();
    let seq = 0;
    for (const spec of specs) {
      say(`入力 ${spec.id}`);
      const seed = SEED_PEOPLE.find((p) => p.person.id === spec.personId)!;
      const result: InputResult = { id: spec.id, kind: spec.kind, personId: spec.personId, status: "ok", failures: [], pieces: 0, sentPieces: 0, rawOverLimit: false, intake: null, carryLoss: 0 };
      inputs.push(result);
      if (spec.kind !== "ledger" && overBudget()) {
        result.status = "skipped";
        result.failures.push("budget");
        step({ stage: "input.receive", input: spec.id, ok: false, error: `費用の上限 $${opts.maxUsd}（見積もり $${spentUsd().toFixed(2)}）` });
        continue;
      }
      if (spec.kind === "ledger") {
        const rows = (await loadPersonPage(db, PRINCIPAL, spec.personId))!;
        rowsOf.set(spec.id, { actual: rows, expected: rows });
        step({ stage: "input", input: spec.id, kind: spec.kind, ok: true, note: "種の台帳のまま（入れる欄を通さない）" });
        continue;
      }
      // 埋める前の台帳を 2 人分（AI の側と正解の側）
      seq += 1;
      const removePending = new Set(spec.oracle.flatMap((o) => o.unknowns.map((u) => u.field)));
      const actId = `ev${seq}a`;
      const expId = `ev${seq}o`;
      for (const id of [actId, expId]) for (const s of personStatements(blankPerson(seed, id, removePending))) sqlite.exec(s);
      const load = async (id: string) => (await loadPersonPage(db, PRINCIPAL, id))!;

      // 送る単位（文 1 つ、または ブラウザの段を通った頁）
      type Piece = { kind: "text"; text: string; oracle: ExtractOutput } | { kind: "image"; bytes: Uint8Array; meta: { source: ReadSource; page: number; redacted: number }; redactOk: boolean | null; oracle: ExtractOutput };
      const pieces: Piece[] = [];
      if (spec.text !== undefined) {
        if (spec.text.trim().length > INTAKE_TEXT_MAX) {
          result.failures.push("too_long");
          step({ stage: "input.receive", input: spec.id, ok: false, error: "too_long", chars: spec.text.length, max: INTAKE_TEXT_MAX });
        } else pieces.push({ kind: "text", text: spec.text, oracle: spec.oracle[0] });
      } else if (spec.doc) {
        const file = await inputFile(spec, opts, renderer, cacheDir);
        if (!file) {
          result.status = "skipped";
          result.failures.push("no_renderer");
          step({ stage: "input.receive", input: spec.id, ok: false, error: "Chrome が無く絵・PDF を作れない" });
          continue;
        }
        result.rawOverLimit = file.bytes.length > FORM_FILE_MAX_BYTES;
        const br = await browserStage(file.bytes, file.secrets);
        step({ stage: "input.receive", input: spec.id, kind: spec.kind, ok: br.ok, rawBytes: br.rawBytes, rawOverLimit: result.rawOverLimit, ...(br.ok ? { totalPages: br.totalPages, pages: br.pages.map((p) => ({ page: p.meta.page, bytes: p.bytes.length, w: p.width, h: p.height, quality: p.quality, redacted: p.meta.redacted, redactOk: p.redactOk })) } : { error: br.error }) });
        if (!br.ok) result.failures.push(br.error);
        else {
          if (br.totalPages > br.pages.length) step({ stage: "input.receive", input: spec.id, note: `PDF の ${br.pages.length + 1} 頁目から読まない（上限 ${br.pages.length} 頁）`, skippedPages: br.totalPages - br.pages.length });
          for (const p of br.pages) pieces.push({ kind: "image", bytes: p.bytes, meta: p.meta, redactOk: p.redactOk, oracle: spec.oracle[p.meta.page - 1] ?? spec.oracle[0] });
        }
      }
      result.pieces = pieces.length;

      const expItems: DiffItem[] = [];
      const actItems: DiffItem[] = [];
      let dropped = 0;
      for (const [i, piece] of pieces.entries()) {
        const seedKey = `${spec.id}#${i + 1}`;
        // 正解の側
        const expRows = await load(expId);
        const expProposal = await runPiece(piece, expRows, oracleCtx, oracle, today, seedKey);
        oracle.drain();
        if (expProposal.ok) {
          expItems.push(...expProposal.proposal.items);
          await save(expId, expRows.person.version ?? 1, expProposal.proposal, piece);
        }
        // AI の側
        const actRows = await load(actId);
        const refused = aiConsentRefusal(actRows.consents);
        if (refused) {
          result.failures.push("consent_refused");
          step({ stage: "input.read", input: spec.id, piece: i + 1, ok: false, error: "consent_refused" });
          continue;
        }
        if (piece.kind === "image" && piece.redactOk === false) {
          result.failures.push("redact");
          step({ stage: "input.read", input: spec.id, piece: i + 1, ok: false, error: "塗った所が黒くない（送らない）" });
          continue;
        }
        rec.scope(spec.id, piece.kind === "text" ? "intake_text" : `intake_read_${piece.meta.page}`);
        const act = await runPiece(piece, actRows, evalCtx, fake, today, seedKey);
        rec.flush();
        fake?.drain();
        if (!act.ok) {
          result.failures.push(act.error);
          step({ stage: "input.read", input: spec.id, piece: i + 1, ok: false, error: act.error });
          continue;
        }
        result.sentPieces += 1;
        actItems.push(...act.proposal.items);
        dropped += act.proposal.dropped;
        step({
          stage: "input.read",
          input: spec.id,
          piece: i + 1,
          ok: true,
          model: act.proposal.ai.model,
          masked: act.proposal.masked ?? null,
          dropped: act.proposal.dropped,
          items: act.proposal.items.map((d) => ({ label: d.label, state: d.state, next: d.next, masked: d.masked, change: d.change })),
        });
        const saved = await save(actId, actRows.person.version ?? 1, act.proposal, piece);
        if (!saved.ok) result.failures.push(`save_${saved.error}`);
      }
      const s = scoreIntake(spec.id, expItems, actItems, dropped);
      result.intake = s.score;
      judge(s.judgements);
      const actual = await load(actId);
      const expected = await load(expId);
      // 道で運べない値は、送る単位があった入力だけ（失敗した入力は失敗に数える）
      result.carryLoss = pieces.length > 0 ? carryLoss(seed.ledger, JSON.parse(expected.person.ledger) as Ledger, spec) : 0;
      rowsOf.set(spec.id, { actual, expected });
      if (result.failures.length > 0) result.status = result.sentPieces > 0 ? "partial" : "failed";
      step({ stage: "input.done", input: spec.id, status: result.status, failures: result.failures, intake: result.intake, carryLoss: result.carryLoss });
    }

    // ---------- 紙 ----------
    const papers: PaperResult[] = [];
    const sampleInput = specs.find((s) => s.kind === "ledger")?.id ?? null;
    for (const f of ready) {
      const imgSrc = pageSources(f.id, f.images, bucket.objects);
      const gm = f.form ? goldMapping(f.form, f.mapping.pages) : null;
      // 正解の表のある様式の、AI の欄 → 正解の項目と別解（紙の見た目の数の台帳あり空欄。T133）
      const goldItems = new Map<string, { item: LedgerItemKey | null; accept: ReadonlyArray<LedgerItemKey | null> }>();
      if (f.form) for (const [gi, aid] of f.pairs) goldItems.set(aid, { item: f.form.fields[gi].item, accept: f.form.fields[gi].accept ?? [] });
      for (const spec of specs) {
        const rows = rowsOf.get(spec.id);
        if (!rows) continue;
        say(`紙 ${f.id} × ${spec.id}`);
        const actual: Sheets = buildSheets(rows.actual, f.mapping, f.images, today);
        let score: PaperScore | null = null;
        if (f.form && gm) {
          const expected = buildSheets(rows.expected, gm, f.images, today);
          const s = scorePaper({
            form: f.form,
            input: spec.id,
            pairs: f.pairs,
            goldMapping: gm,
            aiMapping: f.mapping,
            expectedCell: cellOfSheet(expected.mapped),
            actualCell: cellOfSheet(actual.mapped),
            expected,
            actual,
          });
          score = s.score;
          judge(s.judgements);
          step({ stage: "paper", form: f.id, input: spec.id, overlay: !!actual.overlay, score, rows: s.rows, annex: actual.overlay?.annex.map((a) => ({ field: a.label, reason: a.reason })) ?? [], unconfirmed: actual.mapped.unconfirmed });
        } else step({ stage: "paper", form: f.id, input: spec.id, overlay: !!actual.overlay, annex: actual.overlay?.annex.length ?? 0, unconfirmed: actual.mapped.unconfirmed.length });
        // 紙の見た目の数（T133）: 重なり・はみ出し・隣の欄・ずらした所・置けなかった欄・台帳あり空欄・伏字
        const look = actual.overlay && f.images ? lookOfPaper({ rows: rows.actual, mapping: f.mapping, images: f.images, overlay: actual.overlay, today, ...(f.form ? { goldItems } : {}) }) : null;
        if (look) {
          const label = (id: string) => f.mapping.fields.find((x) => x.id === id)?.label ?? id;
          step({
            stage: "paper.look",
            form: f.id,
            input: spec.id,
            look: look.score,
            issues: look.check.issues.map((x) => ({ page: x.page, field: x.fieldId, label: label(x.fieldId), kind: x.kind })),
            blanks: look.blanks.map((b) => ({ field: b.field, label: b.label, item: b.item })),
            masks: look.masks,
            unplaced: actual.overlay?.unplaced ?? [],
            // 欄の枠の中でずらした字（目で確かめるため。欄と置いた所だけで、字は書かない）
            shifted: (actual.overlay?.pages ?? []).flatMap((pg) =>
              pg.items.flatMap((it) => (it.kind === "text" && it.shifted ? [{ page: pg.page, field: it.fieldId, label: label(it.fieldId), box: it.box }] : [])),
            ),
          });
        }
        // 正解の表の無い様式は、既定で台帳そのままの 1 人だけ刷る（置き場の様式は数が多い）
        const draw = !!f.form || opts.paperAllForms || spec.id === sampleInput;
        const files = draw ? await renderPaper(actual, imgSrc, { renderer, mode: opts.paper, dir, form: f.id, input: spec.id, today }) : {};
        papers.push({ form: f.id, input: spec.id, kind: spec.kind, score, ...(look ? { look: look.score } : {}), files });
      }
    }

    say("記録をまとめる");
    const records = rec.all();
    const result: RunResult = {
      run,
      mode: opts.mode,
      fakeStyle: opts.mode === "fake" ? opts.fakeStyle : null,
      ...(opts.mode === "replay" ? { replayOf: opts.replayDir } : {}),
      startedAt: started.toISOString(),
      finishedAt: new Date().toISOString(),
      today,
      genVersion: GEN_VERSION,
      corpus: { root: opts.corpusRoot, missing: corpus.missing, files: corpus.files.length, excluded: corpus.excluded, cities: corpus.cities },
      renderer: !!renderer,
      paper: opts.paper,
      forms,
      inputs,
      papers,
      calls: { ...callSummary(records), aiCalls: await aiCallsSummary(db) },
      leaks: leakSummary(records, inputs, dir),
      dir,
    };
    say("結果を書く");
    writeFileSync(join(dir, "result.json"), JSON.stringify(result, null, 2), "utf8");
    return result;
  } finally {
    sqlite.close();
    say("Chrome を閉じる");
    if (opts.renderer === undefined || opts.renderer === "auto") await renderer?.close();
    say("閉じた");
  }

  // ---------- 中の道具 ----------

  /** 送る単位 1 つを読む（文は extractIntake、絵は readIntake）。偽の client には正解を積む */
  async function runPiece(
    piece: { kind: "text"; text: string; oracle: ExtractOutput } | { kind: "image"; bytes: Uint8Array; oracle: ExtractOutput },
    rows: PersonPageRows,
    ctx: AskJsonContext,
    client: FakeClient | null,
    today: string,
    seedKey: string,
  ): Promise<{ ok: true; proposal: IntakeProposal } | { ok: false; error: string }> {
    try {
      if (piece.kind === "text") {
        // 正解は送る文と同じ仮名化（同じ人の鍵）で伏せた形（完全に読めた Claude が返す形）
        const { key } = pseudonymize([pseudonymInputOf(rows)], { on: today });
        // 4,000 字を超える文は塊ごとに 1 回（T120）。正解は塊ごとに全体の正解（まとめるときに同じ物は 1 つになる）
        const chunks = splitIntakeText(piece.text).length;
        for (let c = 0; c < chunks; c++) client?.expect({ kind: "extract", answer: sealReadOutput(piece.oracle, key) }, c === 0 ? seedKey : `${seedKey}~${c}`);
        return { ok: true, proposal: await extractIntake(rows, piece.text, ctx, { today, concurrency: 1 }) };
      }
      const checked = checkRedactedImage(piece.bytes);
      if (!checked.ok) return { ok: false, error: checked.error };
      client?.expect({ kind: "extract", answer: piece.oracle }, seedKey);
      return { ok: true, proposal: await readIntake(rows, checked.file, ctx, { today }) };
    } catch (e) {
      return { ok: false, error: failureOf(e) };
    }
  }

  /** 差分の「追加」を保存（画面の既定と同じ。既入力・一致は保存しない） */
  async function save(personId: string, version: number, proposal: IntakeProposal, piece: { kind: string; meta?: { source: ReadSource; page: number; redacted: number } }): Promise<{ ok: true } | { ok: false; error: string }> {
    const changes = proposal.items.filter((d) => d.change && d.state === "add").map((d) => d.change!);
    if (changes.length === 0) return { ok: true };
    const req = SaveRequestSchema.safeParse({ personId, version, ai: { model: proposal.ai.model }, ...(piece.kind === "image" && piece.meta ? { read: piece.meta } : {}), changes });
    if (!req.success) {
      step({ stage: "input.save", person: personId, ok: false, error: "invalid", issues: req.error.issues.map((i) => i.path.join(".")) });
      return { ok: false, error: "invalid" };
    }
    const r = await saveIntake(db, PRINCIPAL, req.data);
    step({ stage: "input.save", person: personId, ok: r.ok, ...(r.ok ? { changed: r.changed, fields: r.fields } : { error: r.error }) });
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }
}

/** 入力の絵・PDF（作った物は置き場の _inputs に残し、次の回も同じ物を使う） */
async function inputFile(spec: InputSpec, opts: EvalOptions, renderer: Renderer | null, cacheDir: string): Promise<{ bytes: Uint8Array; secrets: Ratio[][] } | null> {
  if (opts.inputFiles?.[spec.id]) return opts.inputFiles[spec.id];
  const doc = spec.doc!;
  if (doc.kind === "heic") return { bytes: heicBytes(hashSeed(spec.id)), secrets: [] };
  const ext = doc.kind === "pdf" ? "pdf" : "jpg";
  const path = join(cacheDir, `${spec.id}.${ext}`);
  const meta = join(cacheDir, `${spec.id}.json`);
  if (existsSync(path) && existsSync(meta)) return { bytes: new Uint8Array(readFileSync(path)), secrets: JSON.parse(readFileSync(meta, "utf8")).secrets };
  if (!renderer) return null;
  let out: { bytes: Uint8Array; secrets: Ratio[][] };
  if (doc.kind === "handwrite") {
    const r = await renderer.image(handwriteHtml(doc, spec.id), { width: 1700, height: 2200, quality: 82 });
    out = { bytes: r.bytes, secrets: [r.secrets] };
  } else if (doc.kind === "photo") {
    const r = await renderer.image(photoHtml(doc, spec.id), { width: 3024, height: 4032, quality: 100 });
    out = { bytes: withExif(r.bytes), secrets: [r.secrets] };
  } else {
    const r = await renderer.pdf(pdfHtml(doc));
    out = { bytes: r.bytes, secrets: r.secrets };
  }
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(path, out.bytes);
  writeFileSync(meta, JSON.stringify({ secrets: out.secrets }), "utf8");
  return out;
}

/** 正解どおりに分けた台帳で、種の台帳の値が運べなかった数（入れた事実のうち、台帳に入らなかった物。AI に関係ない道の限り） */
function carryLoss(seedLedger: Ledger, got: Ledger, spec: InputSpec): number {
  let loss = 0;
  const has = (v: unknown) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0) && v !== "";
  const get = (l: Ledger, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), l);
  const oracle = spec.oracle.flat();
  const fields = new Set(oracle.flatMap((o) => o.items.map((x) => x.field)));
  for (const f of fields) if (has(get(seedLedger, f)) && !has(get(got, f))) loss += 1;
  const meds = oracle.reduce((n, o) => n + o.medications.length, 0);
  if (got.medical.medications.length < meds) loss += meds - got.medical.medications.length;
  const devs = oracle.reduce((n, o) => n + o.devices.length, 0);
  const gotDevs = got.medical.devices.filter((d) => d.kind !== "other").length;
  if (gotDevs < devs) loss += devs - gotDevs;
  const notes = oracle.reduce((n, o) => n + o.notes.length, 0);
  if (got.notes.length < notes) loss += notes - got.notes.length;
  return loss;
}

/** 頁の画像（R2 の偽物の中身）を data: の URL に */
function pageSources(mappingFormId: string, images: readonly PageImage[] | null, objects: Map<string, Uint8Array>): (page: number) => string {
  const urls = new Map<number, string>();
  for (const img of images ?? []) {
    const o = objects.get(pageImageKey(OFFICE, `fm-${mappingFormId}`, img.page));
    if (o) urls.set(img.page, `data:image/jpeg;base64,${Buffer.from(o).toString("base64")}`);
  }
  return (page) => urls.get(page) ?? "";
}

async function renderPaper(
  sheets: Sheets,
  imgSrc: (page: number) => string,
  o: { renderer: Renderer | null; mode: PaperMode; dir: string; form: string; input: string; today: string },
): Promise<PaperResult["files"]> {
  if (!o.renderer || o.mode === "none") return {};
  const sub = join(o.dir, "filled", o.form);
  mkdirSync(sub, { recursive: true });
  const files: PaperResult["files"] = {};
  const wantPdf = o.mode === "pdf" || o.mode === "all";
  const wantPng = o.mode === "png" || o.mode === "all";
  const versions: Array<{ fill: boolean; suffix: string }> = [{ fill: false, suffix: "" }, ...(sheets.overlay ? [{ fill: true, suffix: ".fill" }] : [])];
  for (const v of versions) {
    const html = await sheetHtml(sheets, imgSrc, v.fill, o.today);
    const r = await o.renderer.paper(html, { png: wantPng });
    const base = join(sub, `${o.input}${v.suffix}`);
    mkdirSync(sub, { recursive: true });
    if (wantPdf) writeFileSync(`${base}.pdf`, r.pdf);
    if (wantPng && r.png) writeFileSync(`${base}.png`, r.png);
    const rel = (ext: string) => `${o.form}/${o.input}${v.suffix}.${ext}`;
    if (v.fill) {
      if (wantPdf) files.fillPdf = rel("pdf");
      if (wantPng && r.png) files.fillPng = rel("png");
    } else {
      if (wantPdf) files.pdf = rel("pdf");
      if (wantPng && r.png) files.png = rel("png");
    }
  }
  return files;
}

/** ai_calls の行（askJson が呼ぶ前に足し、終わりに状態とトークンを書いた物）から回数と費用 */
async function aiCallsSummary(db: ReturnType<typeof d1FromSqlite>): Promise<CallSummary["aiCalls"]> {
  const { results } = await db
    .prepare("SELECT purpose, model, status, input_tokens, output_tokens FROM ai_calls WHERE office_id = ?1")
    .bind(OFFICE)
    .all<{ purpose: string; model: string; status: string; input_tokens: number | null; output_tokens: number | null }>();
  const out: CallSummary["aiCalls"] = { rows: results.length, ok: 0, failed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, byPurpose: {} };
  for (const r of results) {
    if (r.status === "ok") out.ok += 1;
    else out.failed += 1;
    out.inputTokens += r.input_tokens ?? 0;
    out.outputTokens += r.output_tokens ?? 0;
    out.costUsd += costUsd(r.model, r.input_tokens, r.output_tokens) ?? 0;
    out.byPurpose[r.purpose] = (out.byPurpose[r.purpose] ?? 0) + 1;
  }
  return out;
}

function callSummary(records: readonly CallRecord[]): Omit<CallSummary, "aiCalls"> {
  const s: Omit<CallSummary, "aiCalls"> = { calls: records.length, ok: 0, failed: 0, retried: 0, attempts: 0, durationMs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, byModel: {}, truncated: 0, formReadMaxOutput: 0 };
  for (const r of records) {
    if (r.usage?.status === "ok") s.ok += 1;
    else s.failed += 1;
    if (r.response?.stopReason === "max_tokens") s.truncated += 1;
    if (r.purpose === "form_read") s.formReadMaxOutput = Math.max(s.formReadMaxOutput, r.usage?.outputTokens ?? 0);
    if (r.attempts.length > 1) s.retried += 1;
    s.attempts += r.attempts.length;
    s.durationMs += r.durationMs;
    s.inputTokens += r.usage?.inputTokens ?? 0;
    s.outputTokens += r.usage?.outputTokens ?? 0;
    s.costUsd += r.costUsd ?? 0;
    const m = (s.byModel[r.usage?.model ?? r.model] ??= { calls: 0, costUsd: 0 });
    m.calls += 1;
    m.costUsd += r.costUsd ?? 0;
  }
  return s;
}

function leakSummary(records: readonly CallRecord[], inputs: readonly InputResult[], dir: string): LeakSummary {
  const strong = (k: string) => k === "name" || k === "kana" || k === "phone" || k === "town";
  const out: LeakSummary = { calls: records.length, textHits: 0, strongHits: 0, birthHits: 0, weakHits: 0, images: 0, imagesRedacted: 0, imagesNotRedacted: 0 };
  for (const r of records) {
    out.textHits += r.leaks.length;
    out.strongHits += r.leaks.filter((l) => strong(l.kind)).length;
    out.birthHits += r.leaks.filter((l) => l.kind === "birth").length;
    out.weakHits += r.leaks.filter((l) => l.kind === "weak").length;
  }
  // 送った画像: 入力の絵は塗った所が黒いと測れた物だけを送る（ブラウザの段の redactOk）。様式の白紙は塗る所が無い
  const steps = readFileSafe(join(dir, "steps.jsonl"));
  for (const line of steps) {
    if (line.stage !== "input.receive" || !Array.isArray(line.pages)) continue;
    for (const p of line.pages as Array<{ redactOk: boolean | null }>) {
      out.images += 1;
      if (p.redactOk === true) out.imagesRedacted += 1;
      if (p.redactOk === false) out.imagesNotRedacted += 1;
    }
  }
  void inputs;
  return out;
}

function readFileSafe(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** 置き場の中の前の回（同じ mode と偽の崩し方、result.json のある物のうち、今の回より前で新しい物） */
export function previousRun(outRoot: string, current: RunResult): RunResult | null {
  if (!existsSync(outRoot)) return null;
  const runs = readdirSync(outRoot)
    .filter((d) => d !== current.run && d < current.run && existsSync(join(outRoot, d, "result.json")))
    .sort()
    .reverse();
  for (const d of runs) {
    const r = JSON.parse(readFileSync(join(outRoot, d, "result.json"), "utf8")) as RunResult;
    if (r.mode === current.mode && r.fakeStyle === current.fakeStyle) return r;
  }
  return null;
}

export const SEP = sep;
