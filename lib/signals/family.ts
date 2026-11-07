// 家族・支援者のスマホ（docs/tasks/T11.md）に出す物を、本人のページの行（lib/person.ts）から組む。Claude は呼ばない。
// 画面（components/phone/FamilyView.tsx）はここの形を描くだけ。名前・電話はブラウザとサーバーだけで扱う。
//
// - 問い: 続柄から本人の呼び方（娘 → お母さん）。決まらない続柄・隣人・民生委員は名前で「山田 ハナさんは 無事ですか」
// - 経過: 支援者への提供に同意している本人だけ（不同意・未確認は出さない。7 加藤の弟には出さない）。
//   出すのは決まった言葉だけで、経過の本文（自由文・文字起こし）は出さない。出す種類は許可の一覧で絞る
//   （電話・迎え・安否確認・診た・薬・搬送・到着・受入と、本人・家族の答え）。入力・優先の上書き・同意・時計の確認・
//   本人の報告を当てにしない印・記録（自由文）は出さない。色・至急などの言葉も出さない
// - 平時: 本人の 1 枚（T06）のうち 逃げるところ・来てくれる人・持っていく物・電話。住所は 1 枚にもともと無い
// - 診断・助言の言葉は無い（決まった言葉は lib/signals/phrases.ts）

import { scopeOfRows } from "../consent/scope.ts";
import { parseLedger } from "../db/ledger.ts";
import type { AuthorRole, TimelineKind } from "../db/types.ts";
import { easy, nameWithKana, yomi, type Word } from "../forms/easy-words.ts";
import type { OwnBlock, OwnBlockId, OwnSheet } from "../forms/own-sheet.ts";
import type { PersonPageRows } from "../person.ts";
import { isSignalWriterKind, type SignalWriterKind } from "./labels.ts";
import type { ShelterOption } from "./questions.ts";
import {
  FAMILY_ACTOR_PHRASES,
  FAMILY_ANSWER_PHRASES,
  FAMILY_HISTORY_PHRASES,
  FAMILY_PHRASES,
  relationCall,
} from "./phrases.ts";
import { RECORDING_LOG_SOURCE } from "./save.ts";

/** 家族の平時の画面に出す本人の 1 枚の段 */
export const FAMILY_SHEET_BLOCKS: readonly OwnBlockId[] = ["where", "who", "carry", "call"];

/** 答える人（ログインの連絡先の行）。名前は持たない（画面のヘッダーは別に出す） */
export type FamilyWriter = { contactId: string; kind: SignalWriterKind; relation: string | null };

/** ログインの連絡先の行が本人の連絡先で、答えられる種類（家族・支援者・民生委員）なら */
export function familyWriterOf(rows: PersonPageRows, contactId: string | null): FamilyWriter | null {
  if (!contactId) return null;
  const c = rows.contacts.find((x) => x.id === contactId && x.person_id === rows.person.id);
  if (!c || !isSignalWriterKind(c.kind)) return null;
  return { contactId: c.id, kind: c.kind, relation: c.relation };
}

function sexOf(rows: PersonPageRows) {
  try {
    return parseLedger(rows.person.ledger).basic.sex;
  } catch {
    return undefined;
  }
}

/** 本人の名前（カナのふりがな） */
const nameWords = (rows: PersonPageRows) => nameWithKana(rows.person.name, rows.person.kana);

/** 「お母さん（山田 ハナ）は 無事ですか」。呼び方が決まらなければ「山田 ハナさんは 無事ですか」 */
export function familyQuestion(rows: PersonPageRows, w: FamilyWriter): Word[] {
  const call = relationCall(w.relation, sexOf(rows));
  if (call) return [...easy(call), { text: "（" }, ...nameWords(rows), { text: "）" }, ...easy(FAMILY_PHRASES.isSafe)];
  return [...nameWords(rows), ...easy(FAMILY_PHRASES.san), ...easy(FAMILY_PHRASES.isSafe)];
}

/** 経過の中の本人の呼び方: お母さん / 山田 ハナさん */
export function familyCallName(rows: PersonPageRows, w: FamilyWriter): Word[] {
  const call = relationCall(w.relation, sexOf(rows));
  return call ? easy(call) : [...nameWords(rows), ...easy(FAMILY_PHRASES.san)];
}

/** 同意の範囲: 支援者への提供に同意している本人だけ、家族・支援者に経過を見せる（決め方は lib/consent/scope.ts の 1 か所） */
export function familyMayReadHistory(rows: PersonPageRows): boolean {
  return scopeOfRows("family", rows).timeline !== "none";
}

export type FamilyHistoryItem = { id: string; at: string; when: string; words: Word[] };

/** 家族に見せる経過の種類。ほか（入力・優先修正・同意・時計確認・印変更・記録・受持解除）は出さない */
export const FAMILY_HISTORY_KINDS: readonly TimelineKind[] = [
  "signal",
  "called",
  "pickup",
  "safety_check",
  "examined",
  "medication_given",
  "transported",
  "arrived_shelter",
  "received",
];

const HOUR_MS = 3_600_000;

/** 「11/4 10:30」（JST） */
export function familyWhen(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t + 9 * HOUR_MS);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hh}:${mm}`;
}

function actorOf(role: AuthorRole): string | null {
  return role in FAMILY_ACTOR_PHRASES ? FAMILY_ACTOR_PHRASES[role as keyof typeof FAMILY_ACTOR_PHRASES] : null;
}

type Entry = PersonPageRows["timeline"][number];

function payloadOf(t: Entry): { source?: unknown; contactId?: unknown } {
  if (!t.payload) return {};
  try {
    const v = JSON.parse(t.payload) as unknown;
    return v && typeof v === "object" ? (v as { source?: unknown; contactId?: unknown }) : {};
  } catch {
    return {};
  }
}

/** 答えた人の呼び方: 自分なら「あなた」、ほかの家族・支援者は続柄（無ければ種類） */
function answererWords(rows: PersonPageRows, w: FamilyWriter, t: Entry, contactId: unknown): Word[] | null {
  if (t.author_role === "self") return familyCallName(rows, w);
  if (t.author_role !== "family" && t.author_role !== "supporter") return null;
  if (contactId === w.contactId) return easy(FAMILY_PHRASES.you);
  const c = typeof contactId === "string" ? rows.contacts.find((x) => x.id === contactId) : undefined;
  if (c?.relation?.trim()) return yomi(c.relation.trim()).words;
  if (c && isSignalWriterKind(c.kind)) return easy(FAMILY_ACTOR_PHRASES[c.kind]);
  return easy(FAMILY_ACTOR_PHRASES[t.author_role]);
}

/** 経過の 1 行を決まった言葉に。出さない行は null */
function historyWords(rows: PersonPageRows, w: FamilyWriter, t: Entry): Word[] | null {
  const actor = actorOf(t.author_role);
  const by = (phrase: string, fallback = phrase) => easy(actor ? `${actor}が ${phrase}` : fallback);
  const H = FAMILY_HISTORY_PHRASES;
  switch (t.kind) {
    case "signal": {
      const p = payloadOf(t);
      if (p.source === RECORDING_LOG_SOURCE) return t.author_role === "self" ? easy(H.recording) : null;
      if (!t.signal_color) return null;
      const who = answererWords(rows, w, t, p.contactId);
      if (!who) return null;
      return [
        ...who,
        { text: "が「" },
        ...easy(FAMILY_ANSWER_PHRASES[t.signal_color]),
        { text: "」" },
        ...easy(FAMILY_PHRASES.answered),
      ];
    }
    case "called":
      return by(H.called, H.calledNoActor);
    case "pickup":
      return easy(H.pickup);
    case "safety_check":
      return by(H.safetyCheck);
    case "examined":
      return easy(`${actor ?? FAMILY_ACTOR_PHRASES.medical}が ${H.examined}`);
    case "medication_given":
      return easy(H.medicationGiven);
    case "transported":
      return easy(H.transported);
    case "arrived_shelter":
      return easy(H.arrivedShelter);
    case "received":
      return easy(H.received);
    default:
      return null;
  }
}

/**
 * 家族に見せる経過（新しい順、最大 limit 件）。支援者への提供に同意していない本人は null（出さない）。
 * 本文は使わず、種類と書いた人の役から決まった言葉を作る
 */
export function familyHistory(rows: PersonPageRows, w: FamilyWriter, limit = 8): FamilyHistoryItem[] | null {
  if (!familyMayReadHistory(rows)) return null;
  const items: FamilyHistoryItem[] = [];
  const kindOf = new Map<string, string>();
  for (const t of rows.timeline) {
    // 撤回した行（T63）は家族に出さない（やさしい画面に取り消し線の形は無い）
    if (!FAMILY_HISTORY_KINDS.includes(t.kind) || t.retracted_at) continue;
    const words = historyWords(rows, w, t);
    if (words) {
      items.push({ id: t.id, at: t.occurred_at, when: familyWhen(t.occurred_at), words });
      kindOf.set(t.id, t.kind);
    }
  }
  const sorted = items.map((item, i) => ({ item, i, t: Date.parse(item.at) })).sort((a, b) => b.t - a.t || b.i - a.i);
  const top = sorted.slice(0, limit);
  // 受入・到着・搬送のいちばん新しい知らせは、件数の外に押し出されても残す（T184。「無事です」を何度も送ると
  // 「避難所で受け付けました」が消え、どこにいるかが分からなくなった）。残すときは古い方の 1 件と入れ替え、新しい順は保つ
  const place = sorted.find((x) => KEEP_KINDS.has(kindOf.get(x.item.id) ?? ""));
  if (place && limit > 0 && !top.includes(place)) top.splice(top.length - 1, 1, place);
  return top.map((x) => x.item);
}

/** 家族の経過で件数を超えても残す種類（居場所の知らせ。T184） */
const KEEP_KINDS: ReadonlySet<string> = new Set(["received", "arrived_shelter", "transported"]);

/** 家族の災害モードの画面に渡す物（サーバーで組んでブラウザへ。描くだけ） */
export type FamilyScreen = {
  personId: string;
  contactId: string;
  question: Word[];
  /** 経過。null は同意がなく出さない */
  history: FamilyHistoryItem[] | null;
  /** 持っていく物（本人の 1 枚の段のまま） */
  carry: OwnBlock | null;
  /** ケアマネジャー（名前と事業所）と電話。番号が台帳に無ければ null */
  careManager: { words: Word[]; number: string | null };
  /** 問いの頭の呼び方（「お母さん」「山田 ハナさん」。T49 の問いの主語） */
  callName: Word[];
  /** 台帳に機器がある（聞き取りの機器の問いを出す。T49） */
  hasDevice: boolean;
  /** 台帳の避難先 1・2（T69b。「どこの 避難所ですか」の選択肢） */
  shelters: ShelterOption[];
};

/** 台帳に機器がある（本人・家族のスマホの聞き取りで、機器の問いを出すか。T49） */
export function personHasDevice(rows: Pick<PersonPageRows, "person">): boolean {
  return parseLedger(rows.person.ledger).medical.devices.length > 0;
}

/**
 * 台帳の避難先 1・2（T69b）。本人・家族のスマホの「どこの 避難所ですか」の選択肢に、台帳の名前のまま渡す（やさしい日本語の変換を通さない）。
 * 空の欄は出さない。名前はブラウザとサーバーだけで扱い、Claude には渡さない（答えは d1・d2 の id だけ）
 */
export function shelterOptionsOf(rows: Pick<PersonPageRows, "person">): ShelterOption[] {
  let e: { destination1?: string | null; destination2?: string | null };
  try {
    e = parseLedger(rows.person.ledger).evacuation;
  } catch {
    return [];
  }
  const out: ShelterOption[] = [];
  if (e.destination1?.trim()) out.push({ id: "d1", easy: e.destination1.trim() });
  if (e.destination2?.trim()) out.push({ id: "d2", easy: e.destination2.trim() });
  return out;
}

export function buildFamilyScreen(rows: PersonPageRows, w: FamilyWriter, sheet: OwnSheet): FamilyScreen {
  const cm = sheet.blocks.find((b) => b.id === "call")?.lines.find((l) => l.key === "call.cm");
  return {
    personId: rows.person.id,
    contactId: w.contactId,
    question: familyQuestion(rows, w),
    history: familyHistory(rows, w),
    carry: sheet.blocks.find((b) => b.id === "carry") ?? null,
    careManager: { words: cm?.words ?? easy("ケアマネジャー"), number: cm?.phone?.number ?? null },
    callName: familyCallName(rows, w),
    hasDevice: personHasDevice(rows),
    shelters: shelterOptionsOf(rows),
  };
}
