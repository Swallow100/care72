// 訓練の声（docs/tasks/T21.md）。本人役の言う事を Gemini TTS で声にし、R2 に訓練ごとに置く（同じ物は 2 度作らない）。
//
// - 声にする物（clip）は 2 つ。どちらも文は D1 から読む（画面から送られた文は読まない。サーバーに任意の文を読ませない）:
//   signal: 訓練の安否（signals の drill_id がこの訓練）の文字起こし（着信の言う事・本人の赤の「録音」）。
//   act: ケアマネの手（drills.world の actions）の返事の言う事（電話に出た人の言葉）。
// - 役割ごとに声を分ける（娘・夫・本人。voiceOf）。声の名前は Gemini TTS の決まった声の一覧から選んだ。
//   本物の API で通るかは鍵が無く確かめていない（未確認（本番の鍵で））。
// - TTS に氏名・住所・電話を渡さない: その本人の台帳から lib/pseudonym の鍵を作り、文を pseudonymizeText に通してから speak に渡す
//   （speak は鍵で漏れを確かめ、仮名は「あなた」と読む）。本人役の言う事は元から名前を持たない（仮名は「本人」に置き換え済み）。
// - Gemini の鍵が無ければ声を作らない（not_configured。画面は文字だけ）。R2 にあればそれを返す（鍵が無くても）。
// - 呼ぶ前に事業所の 1 日の上限を確かめ、ai_calls に用途 voice で 1 行残す（speak の中）。
// - R2 の鍵は `drill/<訓練の id>/<signal の id>.wav`・`drill/<訓練の id>/act-<手の番号>.wav`。id だけで名前は入らない。
//   signals.recording_key には書かない（本番の録音の道 /api/recordings は drill_id IS NULL だけを返す）。
// - 訓練を消しても R2 の声は残る（最初に戻すで消すなら T26 の道に足す）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { geminiKeyOf, type AiEnv } from "../claude/client.ts";
import { AiBadOutput, AiCallFailed, AiLimitReached, AiNotConfigured } from "../claude/errors.ts";
import { d1UsageStore } from "../claude/usage.ts";
import { parseLedger } from "../db/ledger.ts";
import type { ContactKind, OfficeKind } from "../db/types.ts";
import { DEFAULT_VOICE, speak, type TtsClient } from "../gemini/tts.ts";
import { pseudonymize, pseudonymizeText, PseudonymLeakError } from "../pseudonym/index.ts";
import { drillScope, loadDrillRow, stateOfRow } from "./db.ts";
import { drillError, isDrillId } from "./http.ts";
import { loadPersonaSources, personaPlaces } from "./persona.ts";

// ---------- 声の選び方 ----------

/** 話す人。本人・家族（続柄）・支援者（民生委員も） */
export type Speaker = {
  kind: "self" | "family" | "supporter";
  /** 家族の続柄（娘・夫…）。分からなければ null */
  relation: string | null;
  /** 本人の性別（台帳の basic.sex）。分からなければ null */
  sex: "female" | "male" | null;
};

/**
 * 役割ごとの声（Gemini TTS の決まった声の名前）。本物の API でこの名前が通るかは未確認（本番の鍵で）。
 * 本人は年配の落ち着いた声、家族の女性・男性、支援者で分ける
 */
export const VOICES = {
  selfFemale: "Gacrux",
  selfMale: "Algenib",
  familyFemale: "Aoede",
  familyMale: "Charon",
  supporter: "Achird",
} as const;

/** 続柄の性別（娘・妻・嫁・母・姉・妹・孫娘・長女…は女性、夫・息子・父・兄・弟・孫・長男・甥…は男性）。分からなければ null */
export function relationSex(relation: string | null): "female" | "male" | null {
  const r = relation?.trim() ?? "";
  if (!r) return null;
  if (/婿/.test(r)) return "male";
  if (/[娘妻嫁母姉妹姪女婆]/.test(r)) return "female";
  if (/[夫男父兄弟甥孫爺]|息子/.test(r)) return "male";
  return null;
}

/** 話す人の声の名前。分からなければ既定の声（lib/gemini/tts.ts の DEFAULT_VOICE） */
export function voiceOf(speaker: Speaker): string {
  if (speaker.kind === "supporter") return VOICES.supporter;
  if (speaker.kind === "self") {
    if (speaker.sex === "female") return VOICES.selfFemale;
    if (speaker.sex === "male") return VOICES.selfMale;
    return DEFAULT_VOICE;
  }
  const sex = relationSex(speaker.relation);
  if (sex === "female") return VOICES.familyFemale;
  if (sex === "male") return VOICES.familyMale;
  return DEFAULT_VOICE;
}

/** 声を作れるか（Gemini の鍵がある。配信の Secret の名前 GEMINI_TTS も読む）。無ければ画面は文字だけ */
export function voiceEnabled(env: Pick<AiEnv, "GEMINI_API_KEY" | "GEMINI_TTS">): boolean {
  return geminiKeyOf(env) !== null;
}

// ---------- clip ----------

/** 声にする物。安否（signals の id）か、ケアマネの手の返事（手の番号 a1…） */
export type VoiceClip = { signal: string } | { act: string };

const SIGNAL_TAIL = /^\d{1,4}-s\d{1,4}$/;
const ACT_ID = /^a\d{1,5}$/;

/** 安否の id がこの訓練の物の形か（lib/drill/db.ts の signalId: `<訓練>-<刻み>-s<番号>`） */
export function isDrillSignalId(drillId: string, signal: unknown): signal is string {
  return typeof signal === "string" && signal.startsWith(`${drillId}-`) && SIGNAL_TAIL.test(signal.slice(drillId.length + 1));
}

export function isActId(v: unknown): v is string {
  return typeof v === "string" && ACT_ID.test(v);
}

/** 画面の音声の要素の行き先 */
export function voiceHref(drillId: string, clip: VoiceClip): string {
  const q = "signal" in clip ? `signal=${encodeURIComponent(clip.signal)}` : `act=${encodeURIComponent(clip.act)}`;
  return `/api/drill/voice?drill=${encodeURIComponent(drillId)}&${q}`;
}

/** R2 の鍵（id だけ。名前は入らない） */
export function voiceKey(drillId: string, clip: VoiceClip): string {
  return `drill/${drillId}/${"signal" in clip ? clip.signal : `act-${clip.act}`}.wav`;
}

// ---------- 作る・読む ----------

/** R2 の使う所だけ（配信は env.RECORDINGS、テストは Map の偽物） */
export type VoiceBucket = {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(key: string, value: Uint8Array, options: { httpMetadata: { contentType: string } }): Promise<unknown>;
};

export type VoiceDeps = {
  db: D1Database;
  bucket: VoiceBucket;
  env: AiEnv;
  /** 時刻の差し替え口（テスト。1 日の上限の日付） */
  now?: () => Date;
  /** TTS の差し替え口（テスト。本物の API を呼ばない） */
  tts?: TtsClient;
};

export type VoiceScope = { office: { id: string; kind: OfficeKind } };

export type VoiceFailure = "not_found" | "not_configured" | "limit" | "failed";

export type VoiceResult =
  | { ok: true; audio: Uint8Array; voice: string; cached: boolean }
  | { ok: false; reason: VoiceFailure };

/** 断りの言葉（2〜4 字）。対象なしは lib/drill/labels.ts の DRILL_API_LABELS */
export const VOICE_LABELS = { not_configured: "未設定", limit: "上限到達", failed: "生成失敗" } as const;

type ResolvedClip = { person: string; text: string; speaker: Speaker };

type ContactForVoice = { id: string; kind: ContactKind; relation: string | null; has_smartphone: number | null };

const SUPPORTER_KINDS: ReadonlyArray<ContactKind> = ["supporter", "welfare_commissioner"];

async function personSex(db: D1Database, officeId: string, person: string): Promise<Speaker["sex"] | undefined> {
  const row = await db
    .prepare("SELECT ledger FROM people WHERE id = ?1 AND office_id = ?2")
    .bind(person, officeId)
    .first<{ ledger: string }>();
  if (!row) return undefined;
  const sex = parseLedger(row.ledger).basic.sex;
  return sex === "female" || sex === "male" ? sex : null;
}

async function contactsOf(db: D1Database, person: string): Promise<ContactForVoice[]> {
  const res = await db
    .prepare("SELECT id, kind, relation, has_smartphone FROM contacts WHERE person_id = ?1 ORDER BY sort, id")
    .bind(person)
    .all<ContactForVoice>();
  return res.results;
}

/** 家族の言う事の話す人: 家族が 1 人ならその続柄、何人かならスマホのある最初の人（押せる人）、無ければ最初の人 */
function familyRelation(contacts: ReadonlyArray<ContactForVoice>): string | null {
  const family = contacts.filter((c) => c.kind === "family");
  const one = family.length === 1 ? family[0] : (family.find((c) => c.has_smartphone === 1) ?? family[0]);
  return one?.relation?.trim() || null;
}

/** 安否の言う事。本人役の出どころ（本人・家族・支援者）の物だけ */
async function resolveSignal(db: D1Database, officeId: string, drillId: string, signal: string): Promise<ResolvedClip | null> {
  const row = await db
    .prepare(
      `SELECT s.person_id, s.source, s.transcript FROM signals s JOIN people p ON p.id = s.person_id
        WHERE s.id = ?1 AND s.drill_id = ?2 AND p.office_id = ?3`,
    )
    .bind(signal, drillId, officeId)
    .first<{ person_id: string; source: string; transcript: string | null }>();
  const text = row?.transcript?.trim();
  if (!row || !text) return null;
  if (row.source === "agent") {
    const sex = await personSex(db, officeId, row.person_id);
    if (sex === undefined) return null;
    return { person: row.person_id, text, speaker: { kind: "self", relation: null, sex } };
  }
  if (row.source === "family") {
    return { person: row.person_id, text, speaker: { kind: "family", relation: familyRelation(await contactsOf(db, row.person_id)), sex: null } };
  }
  if (row.source === "supporter") return { person: row.person_id, text, speaker: { kind: "supporter", relation: null, sex: null } };
  return null;
}

/** ケアマネの手の返事の言う事（電話に出た人の言葉）。話す人は手の相手の連絡先 */
async function resolveAct(db: D1Database, officeId: string, drillId: string, act: string): Promise<ResolvedClip | null> {
  const row = await loadDrillRow(db, officeId, drillId);
  if (!row) return null;
  const record = stateOfRow(row).actions.find((a) => a.id === act);
  const text = record?.result?.speech?.trim();
  if (!record || !text || !record.person || !record.target) return null;
  const contact = (await contactsOf(db, record.person)).find((c) => c.id === record.target);
  if (!contact) return null;
  if (contact.kind === "self") {
    const sex = await personSex(db, officeId, record.person);
    if (sex === undefined) return null;
    return { person: record.person, text, speaker: { kind: "self", relation: null, sex } };
  }
  if (contact.kind === "family") {
    return { person: record.person, text, speaker: { kind: "family", relation: contact.relation?.trim() || null, sex: null } };
  }
  if (SUPPORTER_KINDS.includes(contact.kind)) return { person: record.person, text, speaker: { kind: "supporter", relation: null, sex: null } };
  return null;
}

/**
 * 声を 1 つ返す。R2 にあればそれ（TTS を呼ばない）、無ければ Gemini TTS で作って R2 に置く。
 * 事業所の外の訓練・無い clip・本人役の出どころでない安否は not_found。Gemini の鍵が無ければ not_configured（画面は文字だけ）
 */
export async function drillVoice(deps: VoiceDeps, scope: VoiceScope, drillId: string, clip: VoiceClip): Promise<VoiceResult> {
  const officeId = scope.office.id;
  if (!isDrillId(drillId)) return { ok: false, reason: "not_found" };
  if ("signal" in clip ? !isDrillSignalId(drillId, clip.signal) : !isActId(clip.act)) return { ok: false, reason: "not_found" };
  if (!(await loadDrillRow(deps.db, officeId, drillId))) return { ok: false, reason: "not_found" };
  const resolved =
    "signal" in clip
      ? await resolveSignal(deps.db, officeId, drillId, clip.signal)
      : await resolveAct(deps.db, officeId, drillId, clip.act);
  if (!resolved) return { ok: false, reason: "not_found" };
  const voice = voiceOf(resolved.speaker);

  const key = voiceKey(drillId, clip);
  const hit = await deps.bucket.get(key);
  if (hit) return { ok: true, audio: new Uint8Array(await hit.arrayBuffer()), voice, cached: true };
  if (!voiceEnabled(deps.env)) return { ok: false, reason: "not_configured" };

  try {
    const sources = await loadPersonaSources(deps.db, officeId);
    const source = sources.get(resolved.person);
    if (!source) return { ok: false, reason: "not_found" };
    // 本人役の言葉は画面の文（地区の別名を町名に戻した文。T88）なので、事業所の町名と地理の町名も全部（町名）に伏せて読む（近く）
    const towns = [...new Set([...sources.values()].map((x) => x.ledger.basic.address?.town ?? ""))];
    const { key: pseudonymKey } = pseudonymize([source], { towns: [...towns, ...personaPlaces(scope, sources).map((p) => p.town)] });
    const text = pseudonymizeText(resolved.text, pseudonymKey);
    const r = await speak(
      { text, voice, key: pseudonymKey },
      {
        env: deps.env,
        usage: d1UsageStore(deps.db),
        office: scope.office,
        ...(deps.now ? { now: deps.now } : {}),
        ...(deps.tts ? { tts: deps.tts } : {}),
      },
    );
    await deps.bucket.put(key, r.audio, { httpMetadata: { contentType: r.mimeType } });
    return { ok: true, audio: r.audio, voice, cached: false };
  } catch (e) {
    if (e instanceof AiNotConfigured) return { ok: false, reason: "not_configured" };
    if (e instanceof AiLimitReached) return { ok: false, reason: "limit" };
    // 中身（文・鍵）はログに書かない。名前だけ
    if (!(e instanceof PseudonymLeakError || e instanceof AiCallFailed || e instanceof AiBadOutput)) {
      console.error("訓練の声を作れない", e instanceof Error ? e.name : typeof e);
    }
    return { ok: false, reason: "failed" };
  }
}

// ---------- GET /api/drill/voice ----------

const AUDIO_HEADERS = {
  "Content-Type": "audio/wav",
  "Cache-Control": "private, max-age=86400",
  "X-Content-Type-Options": "nosniff",
} as const;

const REFUSE: Record<Exclude<VoiceFailure, "not_found">, number> = { not_configured: 503, limit: 429, failed: 502 };

function refuse(reason: Exclude<VoiceFailure, "not_found">): Response {
  return Response.json({ ok: false, error: reason, label: VOICE_LABELS[reason] }, { status: REFUSE[reason], headers: { "Cache-Control": "no-store" } });
}

/** 問いの形（drill と、signal か act のどちらか 1 つ）。違えば null */
export function parseVoiceQuery(q: URLSearchParams): { drillId: string; clip: VoiceClip } | null {
  const drillId = q.get("drill");
  const signal = q.get("signal");
  const act = q.get("act");
  if (!isDrillId(drillId)) return null;
  if (signal !== null && act === null) return isDrillSignalId(drillId, signal) ? { drillId, clip: { signal } } : null;
  if (act !== null && signal === null) return isActId(act) ? { drillId, clip: { act } } : null;
  return null;
}

/**
 * 声の GET の中身（app/api/drill/voice/route.ts はこれを返すだけ）。ケアマネの役だけ（審査員のケアマネの役も）。
 * ログインなし 401・ほかの役 403・形が違う 400・対象なし 404・未設定 503・上限 429・失敗 502
 */
export async function voiceGet(deps: VoiceDeps, p: Principal | null, query: URLSearchParams): Promise<Response> {
  if (!p) return drillError("login_required");
  if (!drillScope(p) || !p.office) return drillError("forbidden");
  const parsed = parseVoiceQuery(query);
  if (!parsed) return drillError("invalid");
  const r = await drillVoice(deps, { office: { id: p.office.id, kind: p.office.kind } }, parsed.drillId, parsed.clip);
  if (!r.ok) return r.reason === "not_found" ? drillError("not_found") : refuse(r.reason);
  return new Response(r.audio as unknown as BodyInit, {
    status: 200,
    headers: { ...AUDIO_HEADERS, "Content-Length": String(r.audio.byteLength) },
  });
}
