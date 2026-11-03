// 仮名化の層。Claude に渡す物は必ずここを通す。
//
// - 本人は「A さん」「B さん」、連絡先は役割名（娘・支援者 1・訪問看護）にする。
// - 氏名・カナ・生年月日・住所・電話は渡さない。自由文の中の名前・町名・電話も置き換える。
// - 渡す項目は下の toClaudePerson に書いた物だけ（台帳に項目を足しても、ここに書くまでは渡らない）。
// - 人が付ける欄（本人の報告を当てにしない印、時計の頼り先の確認）は入れる形にも渡す形にも持たない。
//   Claude が推し量って付ける道を作らないため（docs/DECISIONS.md 11/2。型の検査は pseudonym.test.ts）。
// - できた物は凍結し、この層が作った印を付ける。印の無い物は Claude の呼び出しが受け取らない。
// - 作ったあとに元の氏名・電話などが残っていないかを確かめ、残っていれば止める。
//
// 元に戻す鍵（PseudonymKey）はブラウザとサーバーにだけ置き、Claude には渡さない。

import type {
  Ability,
  CareLevel,
  ClockCategory,
  ClockKind,
  ClockRow,
  ClockSource,
  ClockStart,
  ClockUnit,
  ConsentKind,
  ConsentStatus,
  ContactKind,
  ContactReach,
  ContactRow,
  Household,
  Ledger,
  MyTimeline,
  PersonRow,
  Sex,
  SmartphoneUse,
  SupportKind,
} from "../db/types.ts";
import { ageOn, todayJst } from "../age.ts";

// ---------- 入れる形（DB の行でも種のデータでも通る） ----------

export type PseudonymInput = {
  person: Pick<PersonRow, "id" | "name" | "kana" | "birth_date">;
  ledger: Ledger;
  contacts: Array<
    Pick<
      ContactRow,
      | "id"
      | "kind"
      | "relation"
      | "name"
      | "phone"
      | "reach"
      | "emergency_order"
      | "supporter_order"
      | "night_ok"
      | "has_car"
      | "has_smartphone"
      | "note"
    >
  >;
  clocks: Array<Pick<ClockRow, "kind" | "category" | "label" | "value" | "unit" | "starts_on" | "source" | "note">>;
  consents?: Array<{ kind: ConsentKind; status: ConsentStatus }>;
};

// ---------- Claude に渡る形 ----------

export type ClaudeContact = {
  /** 役割名。本人の中で重ならない（娘・支援者 1・訪問看護） */
  role: string;
  kind: ContactKind;
  /** 続柄・間柄（隣人など）。名前ではない */
  relation: string | null;
  reach: ContactReach | null;
  emergencyOrder: number | null;
  supporterOrder: number | null;
  nightOk: boolean | null;
  hasCar: boolean | null;
  hasSmartphone: boolean | null;
  note: string | null;
};

export type ClaudeClock = {
  kind: ClockKind;
  category: ClockCategory;
  label: string;
  value: number | null;
  unit: ClockUnit | null;
  startsOn: ClockStart;
  source: ClockSource | null;
  note: string | null;
};

export type ClaudePerson = {
  /** 仮名（A さん） */
  alias: string;
  age: number | null;
  sex: Sex | null;
  household: Household | null;
  /** 世帯の書き足し（T57。自由文と同じく置き換え済み） */
  householdNote: string | null;
  housing: { floor: number | null; floors: number | null; structure: string | null; bedroom: string | null };
  smartphone: SmartphoneUse | null;
  care: {
    careLevel: CareLevel | null;
    handbook: string | null;
    intractableDisease: string | null;
    walking: Ability | null;
    hearing: Ability | null;
    vision: Ability | null;
    understanding: Ability | null;
    judgment: Ability | null;
    orientation: Ability | null;
    bedridden: boolean | null;
    dementia: boolean | null;
  };
  medical: {
    devices: Array<{ kind: string; detail: string | null; schedule: string | null }>;
    medications: Array<{
      name: string;
      category: string;
      schedule: string | null;
      amount: string | null;
      storage: string | null;
      needsRefrigeration: boolean | null;
      interruptionRisk: boolean | null;
    }>;
    allergies: string[];
    history: string[];
    vaccinations: string[];
  };
  evacuation: {
    hazards: Array<{ kind: string; depthM: number | null; note: string | null }>;
    destination1: string | null;
    destination2: string | null;
    route: string | null;
    barriers: string | null;
    transport: string | null;
    pets: string | null;
    carryItems: string[];
    myTimeline: MyTimeline | null;
    support: SupportKind[];
    supportNote: string | null;
  };
  /** みまもり員がいるか（名前は渡さない） */
  watcher: boolean;
  /** 特記。名前・町名・電話だけを置き換え、言葉は言い換えない */
  notes: string[];
  pending: Array<{ field: string; status: string }>;
  contacts: ClaudeContact[];
  clocks: ClaudeClock[];
  consents: Partial<Record<ConsentKind, ConsentStatus>>;
};

/** 仮名化の層を通った物。この型の値はこの層の関数からしか作れない */
declare const forClaude: unique symbol;
export type ForClaude<T> = T & { readonly [forClaude]: true };

// ---------- 元に戻す鍵（Claude に渡さない） ----------

export type PseudonymKey = {
  people: Array<{ alias: string; personId: string; name: string }>;
  contacts: Array<{ alias: string; role: string; contactId: string; personId: string }>;
  /** 置き換えの表。長い物から順に当てる */
  readonly rules: ReadonlyArray<{ pattern: RegExp; replacement: string }>;
  /** 残っていたら漏れとみなす文字列（2 字以上） */
  readonly secrets: ReadonlyArray<{ value: string; what: string }>;
};

export class PseudonymLeakError extends Error {
  readonly findings: string[];
  constructor(findings: string[]) {
    // 値そのものは書かない（ログに残るので）
    super(`仮名化のあとに元の情報が残っている: ${findings.join("、")}`);
    this.name = "PseudonymLeakError";
    this.findings = findings;
  }
}

// ---------- 印と凍結 ----------

const issued = new WeakSet<object>();

function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const child of Object.values(v as Record<string, unknown>)) deepFreeze(child);
  }
  return v;
}

function seal<T extends object>(v: T): ForClaude<T> {
  deepFreeze(v);
  issued.add(v);
  return v as ForClaude<T>;
}

/** この層が作った物か。Claude の呼び出しの入口で確かめる */
export function isForClaude(v: unknown): v is ForClaude<object> {
  return typeof v === "object" && v !== null && issued.has(v);
}

export function assertForClaude(v: unknown): asserts v is ForClaude<object> {
  if (!isForClaude(v)) throw new Error("仮名化の層（lib/pseudonym）を通っていない物は Claude に渡さない");
}

// ---------- 仮名と役割名 ----------

/** 0 → A、25 → Z、26 → AA（事業所 100〜150 人でも尽きない） */
export function aliasLetters(index: number): string {
  let n = index;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function aliasFor(index: number): string {
  return `${aliasLetters(index)} さん`;
}

const KIND_ROLE: Record<Exclude<ContactKind, "self" | "family" | "supporter">, string> = {
  welfare_commissioner: "民生委員",
  visiting_nurse: "訪問看護",
  care_service: "介護の事業所",
  home_doctor: "かかりつけ",
  pharmacy: "薬局",
  dialysis_center: "透析施設",
  city_office: "市役所",
  // T57。役割名は種類の言葉だけ（名前・間柄を使わない。その他の間柄は自由記入で名前が入りうる）
  oxygen_supplier: "酸素業者",
  power_company: "電力会社",
  hospital: "病院",
  other: "その他の連絡先",
};

/** 本人の連絡先（self を除く）に役割名を付ける。本人の中で重ならない */
export function contactRoles(contacts: ReadonlyArray<Pick<ContactRow, "kind" | "relation">>): string[] {
  const base = contacts.map((c) => {
    if (c.kind === "self") return "本人";
    if (c.kind === "family") return c.relation?.trim() || "家族";
    if (c.kind === "supporter") return "支援者";
    return KIND_ROLE[c.kind];
  });
  const total = new Map<string, number>();
  for (const b of base) total.set(b, (total.get(b) ?? 0) + 1);
  const seen = new Map<string, number>();
  return base.map((b, i) => {
    const n = (seen.get(b) ?? 0) + 1;
    seen.set(b, n);
    // 支援者はいつも番号付き（支援者 1・2）。ほかは重なったときだけ
    if (contacts[i].kind === "supporter" || (total.get(b) ?? 0) > 1) return `${b} ${n}`;
    return b;
  });
}

// ---------- 置き換えの表 ----------

const SPACE = "[ 　]*";
const HONORIFIC = "(?:さん|さま|様|氏|ちゃん|くん)?";

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nameParts(name: string): string[] {
  return name.split(/[ 　]+/).filter(Boolean);
}

function digitsOf(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}

function townStem(town: string): string {
  return town.replace(/(町|台|村)$/, "");
}

/** 電話番号らしい並び（0 で始まる 10〜11 桁、区切りあり・なし） */
const PHONE_LIKE = /(?<![0-9０-９])[0０][0-9０-９]{1,4}[-‐－ー ]?[0-9０-９]{1,4}[-‐－ー ]?[0-9０-９]{3,4}(?![0-9０-９])/g;
export const PHONE_MARK = "（電話）";
export const TOWN_MARK = "（町名）";
export const NAME_MARK = "（氏名）";
/** みまもり員の名前の置き換え先 */
export const WATCHER_ROLE = "みまもり員";

type Target = { kind: "person" | "contact"; replacement: string };

function buildKey(inputs: ReadonlyArray<PseudonymInput>): {
  key: PseudonymKey;
  roles: string[][];
} {
  const people: PseudonymKey["people"] = [];
  const contacts: PseudonymKey["contacts"] = [];
  const roles: string[][] = [];
  const secrets: Array<{ value: string; what: string }> = [];
  const batch = inputs.length > 1;

  // 全文（姓と名の間の空きを問わない）→ 置き換え先。重なれば（氏名）
  const exact = new Map<string, Target[]>();
  // 姓だけ・名だけ（2 字以上）。1 字のときは敬称付きのときだけ
  const partial = new Map<string, Target[]>();
  const add = (m: Map<string, Target[]>, k: string, t: Target) => {
    const list = m.get(k) ?? [];
    list.push(t);
    m.set(k, list);
  };
  const rules: Array<{ pattern: RegExp; replacement: string; len: number }> = [];

  inputs.forEach((input, i) => {
    const alias = aliasFor(i);
    people.push({ alias, personId: input.person.id, name: input.person.name });
    const personTarget: Target = { kind: "person", replacement: alias };
    for (const full of [input.person.name, input.person.kana]) {
      const parts = nameParts(full);
      add(exact, parts.join("\u0000"), personTarget);
      secrets.push({ value: parts.join(" "), what: `${alias}の氏名` });
      secrets.push({ value: parts.join(""), what: `${alias}の氏名` });
      for (const p of parts) add(partial, p, personTarget);
      for (const p of parts) if (p.length >= 2) secrets.push({ value: p, what: `${alias}の氏名` });
    }
    if (input.person.birth_date) secrets.push({ value: input.person.birth_date, what: `${alias}の生年月日` });

    const town = input.ledger.basic.address?.town;
    if (town) {
      for (const t of new Set([town, townStem(town)])) {
        if (t.length >= 2) {
          rules.push({ pattern: new RegExp(esc(t), "g"), replacement: TOWN_MARK, len: t.length });
          secrets.push({ value: t, what: `${alias}の町名` });
        }
      }
    }

    // みまもり員（台帳の地域の支援者）は連絡先の表に無い名前。連絡先と同じく役割名に置き換え、漏れの見張りにも足す
    const watcher = input.ledger.local?.watcher?.trim();
    if (watcher) {
      const replacement = batch ? `${alias}の${WATCHER_ROLE}` : WATCHER_ROLE;
      const t: Target = { kind: "contact", replacement };
      const parts = nameParts(watcher);
      add(exact, parts.join("\u0000"), t);
      secrets.push({ value: parts.join(" "), what: `${alias}の${WATCHER_ROLE}の名前` });
      secrets.push({ value: parts.join(""), what: `${alias}の${WATCHER_ROLE}の名前` });
      if (parts.length > 1) {
        for (const p of parts) add(partial, p, t);
        for (const p of parts) if (p.length >= 2) secrets.push({ value: p, what: `${alias}の${WATCHER_ROLE}の名前` });
      }
    }

    const r = contactRoles(input.contacts);
    roles.push(r);
    input.contacts.forEach((c, j) => {
      if (c.kind !== "self") {
        contacts.push({ alias, role: r[j], contactId: c.id, personId: input.person.id });
      }
      if (c.phone) {
        secrets.push({ value: c.phone, what: `${alias}の電話` });
        secrets.push({ value: digitsOf(c.phone), what: `${alias}の電話` });
      }
      if (!c.name || c.kind === "self") return;
      const replacement = batch ? `${alias}の${r[j]}` : r[j];
      const t: Target = { kind: "contact", replacement };
      const parts = nameParts(c.name);
      add(exact, parts.join("\u0000"), t);
      secrets.push({ value: parts.join(" "), what: `${alias}の${r[j]}の名前` });
      secrets.push({ value: parts.join(""), what: `${alias}の${r[j]}の名前` });
      if (parts.length > 1) {
        for (const p of parts) add(partial, p, t);
        for (const p of parts) if (p.length >= 2) secrets.push({ value: p, what: `${alias}の${r[j]}の名前` });
      }
    });
  });

  const pick = (targets: Target[]): string => {
    const uniq = [...new Set(targets.map((t) => t.replacement))];
    if (uniq.length === 1) return uniq[0];
    // 本人が 1 人だけ当たるなら本人を優先（「小林さん」は台帳の本人のことが多い）
    const persons = [...new Set(targets.filter((t) => t.kind === "person").map((t) => t.replacement))];
    if (persons.length === 1) return persons[0];
    return NAME_MARK;
  };

  for (const [joined, targets] of exact) {
    const parts = joined.split("\u0000");
    const src = parts.map(esc).join(SPACE) + HONORIFIC;
    rules.push({ pattern: new RegExp(src, "g"), replacement: pick(targets), len: joined.length + 100 });
  }
  for (const [part, targets] of partial) {
    // 1 字の姓・名は敬称が付いたときだけ置き換える（「正」「清」は普通の言葉にも出る）
    const src = part.length >= 2 ? esc(part) + HONORIFIC : esc(part) + "(?:さん|さま|様|氏|ちゃん|くん)";
    rules.push({ pattern: new RegExp(src, "g"), replacement: pick(targets), len: part.length });
  }
  rules.sort((a, b) => b.len - a.len);

  const key: PseudonymKey = {
    people,
    contacts,
    rules: Object.freeze(rules.map(({ pattern, replacement }) => ({ pattern, replacement }))),
    secrets: Object.freeze(secrets.filter((s) => s.value.length >= 2)),
  };
  return { key, roles };
}

/** 自由文の中の名前・町名・電話を置き換える */
function scrub(text: string, key: PseudonymKey): string {
  let out = text;
  for (const { pattern, replacement } of key.rules) out = out.replace(pattern, replacement);
  return out.replace(PHONE_LIKE, PHONE_MARK);
}

/** できた物に元の情報が残っていないか。残っていれば何が残ったかを返す（値は返さない） */
export function findLeaks(value: unknown, key: PseudonymKey): string[] {
  const json = typeof value === "string" ? value : JSON.stringify(value);
  const found = new Set<string>();
  for (const s of key.secrets) if (json.includes(s.value)) found.add(s.what);
  if (new RegExp(PHONE_LIKE.source).test(json)) found.add("電話番号らしい並び");
  return [...found];
}

function assertNoLeak(value: unknown, key: PseudonymKey): void {
  const leaks = findLeaks(value, key);
  if (leaks.length > 0) throw new PseudonymLeakError(leaks);
}

// ---------- 組み立て ----------

function toClaudePerson(input: PseudonymInput, alias: string, roles: string[], key: PseudonymKey, on: string): ClaudePerson {
  const s = (v: string | null | undefined): string | null => (v == null ? null : scrub(v, key));
  const ss = (v: string[] | undefined): string[] => (v ?? []).map((x) => scrub(x, key));
  const b = (v: 0 | 1 | null): boolean | null => (v == null ? null : v === 1);
  const { basic, care, medical, evacuation } = input.ledger;

  const consents: Partial<Record<ConsentKind, ConsentStatus>> = {};
  for (const c of input.consents ?? []) consents[c.kind] = c.status;

  return {
    alias,
    age: input.person.birth_date ? ageOn(input.person.birth_date, on) : null,
    sex: basic.sex ?? null,
    household: basic.household ?? null,
    householdNote: s(basic.householdNote),
    housing: {
      floor: basic.housing?.floor ?? null,
      floors: basic.housing?.floors ?? null,
      structure: basic.housing?.structure ?? null,
      bedroom: s(basic.housing?.bedroom),
    },
    smartphone: basic.contactMeans?.smartphone ?? null,
    care: {
      careLevel: care.careLevel ?? null,
      handbook: s(care.handbook),
      intractableDisease: s(care.intractableDisease),
      walking: care.walking ?? null,
      hearing: care.hearing ?? null,
      vision: care.vision ?? null,
      understanding: care.understanding ?? null,
      judgment: care.judgment ?? null,
      orientation: care.orientation ?? null,
      bedridden: care.bedridden ?? null,
      dementia: care.dementia ?? null,
    },
    medical: {
      devices: medical.devices.map((d) => ({ kind: d.kind, detail: s(d.detail), schedule: s(d.schedule) })),
      medications: medical.medications.map((m) => ({
        name: scrub(m.name, key),
        category: m.category,
        schedule: s(m.schedule),
        amount: s(m.amount),
        storage: s(m.storage),
        needsRefrigeration: m.needsRefrigeration ?? null,
        interruptionRisk: m.interruptionRisk ?? null,
      })),
      allergies: ss(medical.allergies),
      history: ss(medical.history),
      vaccinations: ss(medical.vaccinations),
    },
    evacuation: {
      // 書き足し（T57）は自由文と同じく名前・町名・電話を置き換えて渡す
      hazards: evacuation.hazards.map((h) => ({ kind: h.kind, depthM: h.depthM ?? null, note: s(h.note) })),
      destination1: s(evacuation.destination1),
      destination2: s(evacuation.destination2),
      route: s(evacuation.route),
      barriers: s(evacuation.barriers),
      transport: s(evacuation.transport),
      pets: s(evacuation.pets),
      carryItems: ss(evacuation.carryItems),
      myTimeline: evacuation.myTimeline ?? null,
      support: [...(evacuation.support ?? [])],
      supportNote: s(evacuation.supportNote),
    },
    watcher: (input.ledger.local?.watcher ?? "").trim() !== "",
    notes: ss(input.ledger.notes),
    pending: input.ledger.pending.map((p) => ({ field: p.field, status: p.status })),
    contacts: input.contacts.flatMap((c, j): ClaudeContact[] =>
      c.kind === "self"
        ? []
        : [
            {
              role: roles[j],
              kind: c.kind,
              relation: c.kind === "family" ? null : s(c.relation),
              reach: c.reach,
              emergencyOrder: c.emergency_order,
              supporterOrder: c.supporter_order,
              nightOk: b(c.night_ok),
              hasCar: b(c.has_car),
              hasSmartphone: b(c.has_smartphone),
              note: s(c.note),
            },
          ],
    ),
    clocks: input.clocks.map((k) => ({
      kind: k.kind,
      category: k.category,
      label: scrub(k.label, key),
      value: k.value,
      unit: k.unit,
      startsOn: k.starts_on,
      source: k.source,
      note: s(k.note),
    })),
    consents,
  };
}

export type PseudonymizeOptions = {
  /** 年齢を数える日（YYYY-MM-DD、JST）。既定は今日 */
  on?: string;
};

/**
 * 本人（1 人でも何人でも）を Claude に渡せる形にする。並びの順に A さん・B さん…
 * 返る key は元に戻すための物で、Claude には渡さない。
 */
export function pseudonymize(
  inputs: ReadonlyArray<PseudonymInput>,
  options: PseudonymizeOptions = {},
): { payload: ForClaude<ClaudePerson[]>; key: PseudonymKey } {
  const on = options.on ?? todayJst();
  const { key, roles } = buildKey(inputs);
  const people = inputs.map((input, i) => toClaudePerson(input, aliasFor(i), roles[i], key, on));
  assertNoLeak(people, key);
  return { payload: seal(people), key };
}

/**
 * ケアマネが話した・貼った自由文を Claude に渡せる形にする。
 * 置き換えられるのは key にある名前・町名と、電話番号らしい並びだけ。台帳に無い名前は残りうる。
 */
export function pseudonymizeText(text: string, key: PseudonymKey): ForClaude<{ text: string }> {
  const out = { text: scrub(text, key) };
  assertNoLeak(out, key);
  return seal(out);
}

/**
 * 人の値を含まない項目表（様式の読み取り T08 の台帳の項目の key と名前の一覧）を Claude に渡せる形にする。
 * 渡してよいのはコードに書いた項目名と説明だけ。台帳の値・氏名・住所・電話は入れない（ここでは電話番号らしい並びがあれば止める）
 */
export function sealItemCatalog<T extends object>(catalog: T): ForClaude<T> {
  const copy = structuredClone(catalog);
  if (new RegExp(PHONE_LIKE.source).test(JSON.stringify(copy))) throw new PseudonymLeakError(["電話番号らしい並び"]);
  return seal(copy);
}

/** Claude の返事の中の仮名（A さん）を氏名に戻す。画面に出す前に、ブラウザかサーバーで使う */
export function restoreText(text: string, key: PseudonymKey): string {
  const people = [...key.people].sort((a, b) => b.alias.length - a.alias.length);
  let out = text;
  for (const p of people) {
    const letters = esc(p.alias.replace(" さん", ""));
    out = out.replace(new RegExp(`(?<![A-Za-z])${letters}[ 　]?さん`, "g"), `${p.name}さん`);
  }
  return out;
}
