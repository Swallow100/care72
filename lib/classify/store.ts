// 分類（T12）を信号の行に書く所。D1 は引数で受け取る（テストで node:sqlite を渡す）。サーバーだけで使う。
//
// - Claude の分類（classifySignal）: 録音・文字起こしが信号に添えられたあと、サーバーが 1 回。答えは ai_* に、classes と classified_by
//   （claude）にも写す。人がもう直していれば classes は上書きしない（ai_* だけ残す）。経過に「録音の分類（AI）: …」の 1 行（書き手は自動）
// - 分けられなかったとき: classes は空のまま、ai_error に理由（文字なし・AI 未設定・上限・断られた・形の違い・失敗・伏せきれない）。
//   ただし録音があって文字起こしが空（無音のまま。T37）は、Claude を呼ばずに classes を「不明」にする（classified_by は空、AI の印なし）
// - 人の直し（saveClassEdit）: ケアマネが分類を選び直す。classes と classified_by（care_manager）を書き、経過に「分類修正 …」の 1 行。
//   以後は人の分類が効く（lib/triage は classes を読む）。直す前の Claude の答えは ai_* に残る
// - 訓練の信号（drill_id のある物）はここで扱わない（T18 は classify を直接使う）

import type { D1Database } from "@cloudflare/workers-types";
import type { AskJsonContext } from "../claude/call.ts";
import type { PersonBrief } from "../auth/scope.ts";
import type { AuthorRole, Classifier, RecordingClass, SignalRow } from "../db/types.ts";
import { RECORDING_CLASSES } from "../db/types.ts";
import { pseudonymInputOf } from "../intake/extract.ts";
import { loadPersonRows } from "../person.ts";
import { pseudonymize } from "../pseudonym/index.ts";
import { classify, classifyErrorOf, sealClassifyInput, type AudioFeatures, type ClassifyResult } from "./classify.ts";
import { aiClassLogBody, classEditLogBody } from "./labels.ts";
import { CLASSIFY_COLUMNS, classViewOf, parseClassList, type ClassView, type SignalClassFields } from "./view.ts";

/** 経過の payload の出どころ。kind は note（入れる欄の intake・QR の qr_view と同じ作り） */
export const CLASSIFY_LOG_SOURCE = "classify";
export const CLASS_EDIT_LOG_SOURCE = "class_edit";

/** 録音はあるが文字起こしが空の信号の分類（Claude を呼ばずに決める。T37、docs/DECISIONS.md 11/3 04:0x の 9） */
export const SILENT_CLASSES: readonly RecordingClass[] = ["unknown"];

/** どの信号を分けるか（本人のスマホの録音のあと。事業所と本人はログインから決めた物） */
export type ClassifyTarget = {
  officeId: string;
  personId: string;
  signalId: string;
  /** 音の特徴（録音の長さ。無音の割合は取れれば） */
  audio?: AudioFeatures | null;
};

export type ClassifyDeps = {
  /** AI の呼び出しの文脈。呼ぶときだけ作る（文字なし・人が直した・済んだときは作らない） */
  ai: () => Promise<AskJsonContext>;
  /** 今（ISO 8601） */
  now: () => string;
};

export type ClassifySignalOutcome =
  | { status: "not_found" }
  /** もう分けた・人が直した（何もしない） */
  | { status: "skipped" }
  | { status: "classified"; result: ClassifyResult; view: ClassView };

type SignalForClassify = Pick<
  SignalRow,
  "id" | "person_id" | "transcript" | "injured" | "at_home" | "can_move" | "has_medicine" | "classified_by" | "ai_at"
>;

const bool = (v: 0 | 1 | null): boolean | null => (v === null ? null : v === 1);

async function personBrief(db: D1Database, officeId: string, personId: string): Promise<PersonBrief | null> {
  return db
    .prepare(
      `SELECT id, office_id, care_manager_id, name, kana, birth_date, plan_status, ledger
         FROM people WHERE id = ?1 AND office_id = ?2`,
    )
    .bind(personId, officeId)
    .first<PersonBrief>();
}

/** 分けるための元を読み、本人の鍵で伏せて Claude に渡す。失敗は理由で返す */
async function runClassify(db: D1Database, t: ClassifyTarget, sig: SignalForClassify, deps: ClassifyDeps): Promise<ClassifyResult> {
  if (!sig.transcript?.trim()) return { ok: false, error: "no_text" };
  try {
    const brief = await personBrief(db, t.officeId, t.personId);
    const rows = brief ? await loadPersonRows(db, brief) : null;
    if (!rows) return { ok: false, error: "failed" };
    // 鍵を作るためだけに台帳を読む。台帳（payload）は Claude に渡さない
    const { key } = pseudonymize([pseudonymInputOf(rows)]);
    const input = sealClassifyInput(
      {
        transcript: sig.transcript,
        answers: {
          injured: bool(sig.injured),
          atHome: bool(sig.at_home),
          canMove: bool(sig.can_move),
          hasMedicine: bool(sig.has_medicine),
        },
        audio: t.audio ?? null,
      },
      key,
    );
    return await classify(input, await deps.ai());
  } catch (e) {
    const error = classifyErrorOf(e);
    if (error) return { ok: false, error };
    // 文字起こし・引用をログに出さない（名前だけ）
    console.error("分類に失敗", e instanceof Error ? e.name : typeof e);
    return { ok: false, error: "failed" };
  }
}

async function readClassFields(db: D1Database, signalId: string): Promise<SignalClassFields | null> {
  return db.prepare(`SELECT ${CLASSIFY_COLUMNS} FROM signals WHERE id = ?1`).bind(signalId).first<SignalClassFields>();
}

/**
 * 信号を Claude で 1 回分けて書く。もう分けた（ai_at がある）・人が直した信号は何もしない。
 * 投げない（失敗は ai_error に残す）。呼ぶ側は応答を待たずに走らせてよい（app/api/recordings は waitUntil）
 */
export async function classifySignal(db: D1Database, t: ClassifyTarget, deps: ClassifyDeps): Promise<ClassifySignalOutcome> {
  const sig = await db
    .prepare(
      `SELECT s.id, s.person_id, s.transcript, s.injured, s.at_home, s.can_move, s.has_medicine, s.classified_by, s.ai_at
         FROM signals s JOIN people p ON p.id = s.person_id
        WHERE s.id = ?1 AND s.person_id = ?2 AND p.office_id = ?3 AND s.drill_id IS NULL`,
    )
    .bind(t.signalId, t.personId, t.officeId)
    .first<SignalForClassify>();
  if (!sig) return { status: "not_found" };
  if (sig.ai_at !== null || sig.classified_by === "care_manager") return { status: "skipped" };

  const result = await runClassify(db, t, sig, deps);
  const at = deps.now();
  if (result.ok) {
    const { categories, confidence, quote, memo } = result.value;
    const json = JSON.stringify(categories);
    // 聞き取りメモ（T49）は ai_memo に。押した答え（answers）は上書きしない（画面で人の答えが先。色と順には使わない）
    const memoJson = Object.values(memo).some((v) => v !== null) ? JSON.stringify(memo) : null;
    await db.batch([
      db
        .prepare(
          `UPDATE signals SET ai_classes = ?2, ai_confidence = ?3, ai_quote = ?4, ai_model = ?5, ai_error = NULL, ai_at = ?6, ai_memo = ?7
            WHERE id = ?1 AND ai_at IS NULL`,
        )
        .bind(sig.id, json, confidence, quote, result.model, at, memoJson),
      // 人が先に直していれば、効く分類は人の物のまま
      db
        .prepare(`UPDATE signals SET classes = ?2, classified_by = 'claude' WHERE id = ?1 AND classified_by IS NULL`)
        .bind(sig.id, json),
      db
        .prepare(
          `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, body, payload, signal_id, occurred_at)
           SELECT ?1, s.person_id, NULL, 'system', 'note', ?3, ?4, s.id, ?5 FROM signals s
            WHERE s.id = ?2 AND NOT EXISTS (
              SELECT 1 FROM timeline_entries t
               WHERE t.signal_id = s.id AND t.payload IS NOT NULL AND json_extract(t.payload, '$.source') = ?6)`,
        )
        .bind(
          crypto.randomUUID(),
          sig.id,
          aiClassLogBody({ classes: categories, confidence, quote }),
          JSON.stringify({ source: CLASSIFY_LOG_SOURCE, ai: true, model: result.model, classes: categories }),
          at,
          CLASSIFY_LOG_SOURCE,
        ),
    ]);
  } else if (result.error === "no_text") {
    // 録音はあるが文字が 1 字も無い（無音のまま聞き直しても話せなかった。T37）: Claude は呼ばずに分類は「不明」。
    // AI の答えではないので classified_by・ai_classes は空のまま（AI の印を付けない）、ai_error は文字なし。
    // 人が先に直していれば上書きしない
    await db.batch([
      db.prepare(`UPDATE signals SET ai_error = 'no_text', ai_at = ?2 WHERE id = ?1 AND ai_at IS NULL`).bind(sig.id, at),
      db
        .prepare(
          `UPDATE signals SET classes = ?2
            WHERE id = ?1 AND classified_by IS NULL AND classes IS NULL AND recording_key IS NOT NULL`,
        )
        .bind(sig.id, JSON.stringify(SILENT_CLASSES)),
    ]);
  } else {
    await db
      .prepare(`UPDATE signals SET ai_error = ?2, ai_at = ?3 WHERE id = ?1 AND ai_at IS NULL`)
      .bind(sig.id, result.error, at)
      .run();
  }
  const row = await readClassFields(db, sig.id);
  return { status: "classified", result, view: row ? classViewOf(row) : { kind: "pending" } };
}

// ---------- 人の直し ----------

/** 選んだ分類を決まりに合わせる（5 つの順、重ねない、不明はほかと一緒にしない）。空なら null */
export function normalizeEdit(classes: readonly RecordingClass[]): RecordingClass[] | null {
  const picked = new Set(classes);
  const known = RECORDING_CLASSES.filter((c) => c !== "unknown" && picked.has(c));
  if (known.length > 0) return known;
  return picked.has("unknown") ? ["unknown"] : null;
}

/** 直す人。事業所の壁を通したあと（ケアマネの役だけ） */
export type ClassEditor = { officeId: string; accountId: string | null; role: Extract<AuthorRole, "care_manager"> };

export type ClassEditResult =
  | { ok: true; changed: boolean; view: ClassView }
  | { ok: false; error: "not_found" | "invalid" };

/**
 * ケアマネが信号の分類を直す。classes と classified_by を書き、経過に「分類修正 動けない（AI） → けが」（1 つの batch）。
 * 同じ分類を人がもう付けていれば何もしない
 */
export async function saveClassEdit(
  db: D1Database,
  editor: ClassEditor,
  signalId: string,
  classes: readonly RecordingClass[],
  now: string,
): Promise<ClassEditResult> {
  const to = normalizeEdit(classes);
  if (!to) return { ok: false, error: "invalid" };
  const sig = await db
    .prepare(
      `SELECT s.id, s.person_id, s.classes, s.classified_by FROM signals s JOIN people p ON p.id = s.person_id
        WHERE s.id = ?1 AND p.office_id = ?2 AND s.drill_id IS NULL`,
    )
    .bind(signalId, editor.officeId)
    .first<{ id: string; person_id: string; classes: string | null; classified_by: Classifier | null }>();
  if (!sig) return { ok: false, error: "not_found" };

  const from = parseClassList(sig.classes);
  const json = JSON.stringify(to);
  const same = sig.classified_by === "care_manager" && from !== null && JSON.stringify(from) === json;
  if (!same) {
    await db.batch([
      db.prepare(`UPDATE signals SET classes = ?2, classified_by = 'care_manager' WHERE id = ?1`).bind(sig.id, json),
      db
        .prepare(
          `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, body, payload, signal_id, occurred_at)
           VALUES (?1, ?2, ?3, ?4, 'note', ?5, ?6, ?7, ?8)`,
        )
        .bind(
          crypto.randomUUID(),
          sig.person_id,
          editor.accountId,
          editor.role,
          classEditLogBody({ from, fromBy: sig.classified_by, to }),
          JSON.stringify({ source: CLASS_EDIT_LOG_SOURCE, from, fromBy: sig.classified_by, to }),
          sig.id,
          now,
        ),
    ]);
  }
  const row = await readClassFields(db, sig.id);
  return { ok: true, changed: !same, view: row ? classViewOf(row) : { kind: "pending" } };
}

/** 信号の分類の形（画面の部品に渡す）。事業所の壁の外・訓練の信号は null */
export async function loadClassView(db: D1Database, officeId: string, signalId: string): Promise<ClassView | null> {
  const row = await db
    .prepare(
      `SELECT ${CLASSIFY_COLUMNS.split(", ")
        .map((c) => `s.${c}`)
        .join(", ")} FROM signals s JOIN people p ON p.id = s.person_id
        WHERE s.id = ?1 AND p.office_id = ?2 AND s.drill_id IS NULL`,
    )
    .bind(signalId, officeId)
    .first<SignalClassFields>();
  return row ? classViewOf(row) : null;
}
