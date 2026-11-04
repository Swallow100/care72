// 仮名化の層。Claude に渡す物は必ずここを通す。
//
// - 本人は「A さん」「B さん」、連絡先は役割名（娘・支援者 1・訪問看護）にする。
// - 氏名・カナ・生年月日・住所・電話は渡さない。自由文の中の名前・町名・電話も置き換える。
// - 渡す項目は下の toClaudePerson に書いた物だけ（台帳に項目を足しても、ここに書くまでは渡らない）。
// - 人が付ける欄（本人の報告を当てにしない印、時計の頼り先の確認）は入れる形にも渡す形にも持たない。
//   Claude が推し量って付ける道を作らないため（docs/DECISIONS.md「仮名化・同意・個人情報」。型の検査は pseudonym.test.ts）。
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
import { CONTACT_PASSES, formLeaks, maskContactForms, maskPlaceAndNameForms, NAME_MARK, PLACE_NAME_PASSES, type Span } from "./forms.ts";
import { transportText } from "../map/transport.ts";

export { ADDRESS_MARK, MAIL_MARK, NAME_MARK, NOT_NAME_WORDS, POSTAL_MARK } from "./forms.ts";

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
  /**
   * 町名 → 地区の別名（訓練の入力。T88）。置き換えの表は町名を別名にし、restoreText は別名を町名に戻す。
   * 無ければ台帳の町名は（町名）
   */
  readonly places?: ReadonlyArray<Place>;
};

/** 町名と、Claude に見せる地区の別名（甲地区） */
export type Place = { town: string; alias: string };

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

export const KIND_ROLE: Readonly<Record<Exclude<ContactKind, "self" | "family" | "supporter">, string>> = {
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

/** 連絡先の役割名の元の語（番号の前。娘・支援者・民生委員）。名前のすぐ前に書かれた同じ語を名前と一緒に置き換える（T88） */
function roleWord(c: Pick<ContactRow, "kind" | "relation">): string {
  if (c.kind === "family" || c.kind === "self") return c.relation?.trim() || "家族";
  if (c.kind === "supporter") return "支援者";
  return KIND_ROLE[c.kind];
}

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
/** みまもり員の名前の置き換え先 */
export const WATCHER_ROLE = "みまもり員";

/**
 * 置き換え先。prefix は名前のすぐ前に書かれがちな同じ意味の語（続柄・役割の語）で、名前と一緒に置き換え先 1 つにする
 * （「娘の森 恵子さん」→「娘」。「娘の娘」にしない。T88）
 */
type Target = { kind: "person" | "contact"; replacement: string; prefix: string | null };

/** 名前のすぐ後ろが施設・店の語なら、名前でなく施設の名前の一部（「森田医院」）。役割名・仮名にせず（氏名）にする（T88） */
const FACILITY_AFTER =
  "(?=病院|医院|クリニック|診療所|薬局|歯科|眼科|内科|外科|皮膚科|整形|小学校|中学校|高校|学校|保育園|幼稚園|公民館|集会所|会館|センター|ステーション|ホーム|商店|酒店|工務店|書店|製作所|建設|運送|自動車|団地|ハイツ|荘|苑|ビル|マンション|アパート|駅|橋)";

/** 町名の rule と漏れの見張りの言葉 */
function townRules(town: string, replacement: string, what: string, rules: Array<{ pattern: RegExp; replacement: string; len: number }>, secrets: Array<{ value: string; what: string }>): void {
  for (const t of new Set([town, townStem(town)])) {
    if (t.length >= 2) {
      rules.push({ pattern: new RegExp(esc(t), "g"), replacement, len: t.length });
      secrets.push({ value: t, what });
    }
  }
}

function buildKey(
  inputs: ReadonlyArray<PseudonymInput>,
  places: ReadonlyArray<Place> = [],
  towns: ReadonlyArray<string> = [],
): {
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

  // 訓練の町名（T88）: 事業所の町名は全部、地区の別名に（本人自身の町名も）
  const placeTowns = new Set<string>();
  for (const p of places) {
    const town = p.town.trim();
    if (!town || placeTowns.has(town)) continue;
    placeTowns.add(town);
    townRules(town, p.alias, "町名", rules, secrets);
  }
  // ほかの町名は（町名）に。本人自身の町名は下の本人ごとの rule が持つ
  const ownTowns = new Set(inputs.map((x) => x.ledger.basic.address?.town?.trim()).filter((t): t is string => !!t));
  for (const raw of towns) {
    const town = raw.trim();
    if (!town || placeTowns.has(town) || ownTowns.has(town)) continue;
    placeTowns.add(town);
    townRules(town, TOWN_MARK, "町名", rules, secrets);
  }

  inputs.forEach((input, i) => {
    const alias = aliasFor(i);
    people.push({ alias, personId: input.person.id, name: input.person.name });
    const personTarget: Target = { kind: "person", replacement: alias, prefix: "本人" };
    for (const full of [input.person.name, input.person.kana]) {
      const parts = nameParts(full);
      add(exact, parts.join("\u0000"), personTarget);
      secrets.push({ value: parts.join(" "), what: `${alias}の氏名` });
      secrets.push({ value: parts.join(""), what: `${alias}の氏名` });
      for (const p of parts) add(partial, p, personTarget);
      for (const p of parts) if (p.length >= 2) secrets.push({ value: p, what: `${alias}の氏名` });
    }
    if (input.person.birth_date) secrets.push({ value: input.person.birth_date, what: `${alias}の生年月日` });

    const town = input.ledger.basic.address?.town?.trim();
    if (town && !placeTowns.has(town)) townRules(town, TOWN_MARK, `${alias}の町名`, rules, secrets);

    // みまもり員（台帳の地域の支援者）は連絡先の表に無い名前。連絡先と同じく役割名に置き換え、漏れの見張りにも足す
    const watcher = input.ledger.local?.watcher?.trim();
    if (watcher) {
      const replacement = batch ? `${alias}の${WATCHER_ROLE}` : WATCHER_ROLE;
      const t: Target = { kind: "contact", replacement, prefix: WATCHER_ROLE };
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
      const t: Target = { kind: "contact", replacement, prefix: roleWord(c) };
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

  // 置き換え先が 1 つに決まり、その前置きの語（続柄・役割）も 1 つなら、名前の前のその語も一緒に置き換える（「娘の森 恵子さん」→「娘」）
  const prefixOf = (targets: Target[], replacement: string): string => {
    if (replacement === NAME_MARK) return "";
    const ws = [...new Set(targets.filter((t) => t.replacement === replacement).map((t) => t.prefix))];
    return ws.length === 1 && ws[0] ? `(?:${esc(ws[0])}[ 　]*(?:の|：|:)?[ 　]*)?` : "";
  };
  for (const [joined, targets] of exact) {
    const parts = joined.split("\u0000");
    const replacement = pick(targets);
    const src = prefixOf(targets, replacement) + parts.map(esc).join(SPACE) + HONORIFIC;
    rules.push({ pattern: new RegExp(src, "g"), replacement, len: joined.length + 100 });
  }
  for (const [part, targets] of partial) {
    const replacement = pick(targets);
    if (part.length >= 2) {
      // 施設・店の名前の中の姓（「森田医院」）は仮名・役割名にしない（「A さん医院」「娘病院」にしない）
      rules.push({ pattern: new RegExp(esc(part) + FACILITY_AFTER, "g"), replacement: NAME_MARK, len: part.length + 0.5 });
      rules.push({ pattern: new RegExp(prefixOf(targets, replacement) + esc(part) + HONORIFIC, "g"), replacement, len: part.length });
    } else {
      // 1 字の姓・名は敬称が付いたときだけ置き換える（「正」「清」は普通の言葉にも出る）
      rules.push({
        pattern: new RegExp(prefixOf(targets, replacement) + esc(part) + "(?:さん|さま|様|氏|ちゃん|くん)", "g"),
        replacement,
        len: part.length,
      });
    }
  }
  rules.sort((a, b) => b.len - a.len);

  const key: PseudonymKey = {
    people,
    contacts,
    rules: Object.freeze(rules.map(({ pattern, replacement }) => ({ pattern, replacement }))),
    secrets: Object.freeze(secrets.filter((s) => s.value.length >= 2)),
    ...(places.length > 0 ? { places: Object.freeze(places.map((p) => ({ town: p.town.trim(), alias: p.alias }))) } : {}),
  };
  return { key, roles };
}

/**
 * 置き換えの記録の 1 単位（T88）。plain は元の 1 字のまま、back は元に戻せる印（仮名・（町名）・（氏名）などの伏せ字と、
 * 地区の別名）、keep は戻さない印（役割名「娘」「支援者 1」。Claude は続柄の言葉として使うので、元の名前に戻すと続柄が名前になる）
 */
type Unit = { out: string; orig: string; kind: "plain" | "back" | "keep" };

/** 印を当てる。spans は今の文（out を並べた物）の位置。重なりは先の物を取り、印の途中にかかる所は印ごと */
function applyUnits(units: Unit[], spans: ReadonlyArray<Span>, mark: string, kind: "back" | "keep"): { units: Unit[]; count: number } {
  if (spans.length === 0) return { units, count: 0 };
  const starts: number[] = [];
  let pos = 0;
  for (const u of units) {
    starts.push(pos);
    pos += u.out.length;
  }
  const out: Unit[] = [];
  let i = 0;
  let last = 0;
  let count = 0;
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    if (s.start < last || s.end <= s.start) continue;
    last = s.end;
    while (i < units.length && starts[i] + units[i].out.length <= s.start) out.push(units[i++]);
    let orig = "";
    let j = i;
    while (j < units.length && starts[j] < s.end) orig += units[j++].orig;
    if (j === i) continue;
    out.push({ out: mark, orig, kind });
    count++;
    i = j;
  }
  while (i < units.length) out.push(units[i++]);
  return { units: out, count };
}

const regexSpans = (re: RegExp, text: string): Span[] => {
  const g = re.global ? re : new RegExp(re.source, `${re.flags}g`);
  return [...text.matchAll(g)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
};

const joinOut = (units: ReadonlyArray<Unit>) => units.map((u) => u.out).join("");

/** 置き換えの表の置き換え先のうち、元に戻せる物（仮名・伏せ字・地区の別名）。ほかは役割名 */
function restorable(replacement: string, key: PseudonymKey): boolean {
  return /^[A-Z]+ さん$/u.test(replacement) || replacement.startsWith("（") || (key.places ?? []).some((p) => p.alias === replacement);
}

/**
 * 自由文の中の名前・町名・電話を置き換え、どの元の語をどの印にしたかを 1 字ずつ記録する（T88。入れる欄の戻しが使う）。
 * 順: 台帳の名前・町名（表）→ メール・郵便番号 → 電話の形 → 住所の形 → 名前の形（T74・T88。./forms.ts）
 */
function scrubUnits(text: string, key: PseudonymKey): { units: Unit[]; count: number } {
  let units: Unit[] = Array.from(text, (c) => ({ out: c, orig: c, kind: "plain" as const }));
  let count = 0;
  const step = (spans: Span[], mark: string, kind: "back" | "keep") => {
    const r = applyUnits(units, spans, mark, kind);
    units = r.units;
    count += r.count;
  };
  for (const { pattern, replacement } of key.rules) {
    const spans = regexSpans(pattern, joinOut(units));
    if (spans.length > 0) step(spans, replacement, restorable(replacement, key) ? "back" : "keep");
  }
  for (const p of CONTACT_PASSES) step(p.find(joinOut(units)), p.mark, "back");
  step(regexSpans(PHONE_LIKE, joinOut(units)), PHONE_MARK, "back");
  for (const p of PLACE_NAME_PASSES) step(p.find(joinOut(units)), p.mark, "back");
  return { units, count };
}

/**
 * 自由文の中の名前・町名・電話を置き換え、置き換えた所の数を返す。
 * 順: 台帳の名前・町名（表）→ メール・郵便番号 → 電話の形 → 住所の形 → 名前の形（T74・T88。./forms.ts）
 */
function scrubCounted(text: string, key: PseudonymKey): { text: string; count: number } {
  const { units, count } = scrubUnits(text, key);
  return { text: joinOut(units), count };
}

function scrub(text: string, key: PseudonymKey): string {
  return scrubCounted(text, key).text;
}

/**
 * 自由文を Claude に渡すときに伏せる所の数（入れる欄の「伏せ字 N」。T74）。何を伏せたかは返さない。
 * pseudonymizeText と同じ置き換えを数えるだけで、Claude に渡せる物は作らない
 */
export function maskedCount(text: string, key: PseudonymKey): number {
  return scrubCounted(text, key).count;
}

/**
 * できた物に元の情報が残っていないか。残っていれば何が残ったかを返す（値は返さない）。
 * 台帳の名前・電話・生年月日と、電話・敬称つきの名前・住所・郵便番号・メールの形（T74）を見る
 */
export function findLeaks(value: unknown, key: PseudonymKey): string[] {
  const json = typeof value === "string" ? value : JSON.stringify(value);
  const found = new Set<string>();
  for (const s of key.secrets) if (json.includes(s.value)) found.add(s.what);
  if (new RegExp(PHONE_LIKE.source).test(json)) found.add("電話番号らしい並び");
  for (const what of formLeaks(json)) found.add(what);
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
      transport: s(transportText(evacuation)),
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
  /**
   * 町名 → 地区の別名（訓練の本人役・監督・講評・世界。T88）。ここにある町名は（町名）でなく別名にし（本人自身の町名も）、
   * 漏れの見張りにも足す（台帳の本人の町でなくても、事業所の町名が残れば止める）
   */
  places?: ReadonlyArray<Place>;
  /**
   * ほかの町名（事業所の本人たちの町名など）も（町名）に伏せ、漏れの見張りに足す（訓練の声。本人役の言葉は画面で町名に戻した文なので。T88）
   */
  towns?: ReadonlyArray<string>;
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
  const { key, roles } = buildKey(inputs, options.places ?? [], options.towns ?? []);
  const people = inputs.map((input, i) => toClaudePerson(input, aliasFor(i), roles[i], key, on));
  assertNoLeak(people, key);
  return { payload: seal(people), key };
}

/**
 * ケアマネが話した・貼った自由文を Claude に渡せる形にする。
 * 置き換えるのは key にある名前・町名と、電話・敬称つきの名前・住所・郵便番号・メールの形（T74）。
 * 敬称の無い台帳に無い名前（「田中が来る」）は残りうる。
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

/**
 * Claude の返事（本人役の言葉・講評・世界の 1 文などの作った文）を画面と記録に使える形に（T74 の続き）。
 * 作った名前（「隣の佐藤さん」）・住所・郵便番号・メールの形は、文を捨てずに（氏名）（住所）（郵便番号）（メール）に置き換える
 * （本人役が近所の人の名前を作っただけで黙らないように）。置き換えたあとに台帳の名前・生年月日・電話（key の secrets）か
 * 電話の形が残れば null（呼ぶ側が捨てる。今までどおり）。仮名（A さん）は戻さない（restoreText は呼ぶ側が後で）。
 * Claude に渡す前の検査（pseudonymize・pseudonymizeText の findLeaks）はこれを通らず、形が残れば今のまま止める
 */
export function maskReply(text: string, key: PseudonymKey): string | null {
  const masked = maskPlaceAndNameForms(maskContactForms(text).text).text;
  return findLeaks(masked, key).length > 0 ? null : masked;
}

/** Claude の返事の中の仮名（A さん）を氏名に、地区の別名（訓練の甲地区。T88）を町名に戻す。画面に出す前に、ブラウザかサーバーで使う */
export function restoreText(text: string, key: PseudonymKey): string {
  const people = [...key.people].sort((a, b) => b.alias.length - a.alias.length);
  let out = text;
  for (const p of people) {
    const letters = esc(p.alias.replace(" さん", ""));
    out = out.replace(new RegExp(`(?<![A-Za-z])${letters}[ 　]?さん`, "g"), `${p.name}さん`);
  }
  return restorePlaces(out, key);
}

/** 地区の別名（甲地区）を町名に戻す。長い別名から（甲2地区 を 甲地区 より先に） */
export function restorePlaces(text: string, key: PseudonymKey): string {
  let out = text;
  for (const p of [...(key.places ?? [])].sort((a, b) => b.alias.length - a.alias.length)) out = out.split(p.alias).join(p.town);
  return out;
}

/**
 * 仮名化の層に入れた本人の文字の値（台帳の文字の欄・連絡先の続柄と備考）。入れる欄で Claude が写した値を元の言葉に戻す元（T88）。
 * 氏名・電話・生年月日は入れない
 */
export function inputTexts(input: PseudonymInput): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      if (v.trim()) out.push(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(input.ledger);
  for (const c of input.contacts) walk([c.relation, c.note]);
  for (const k of input.clocks) walk([k.label, k.note]);
  return out;
}

/**
 * 入れる欄（T88）: Claude が写した値の伏せ字・仮名を、伏せる前の元の言葉に戻す関数を作る。sources はケアマネが入れた文と
 * 台帳の文字の値（inputTexts）。値がどれかの元の伏せたあとの文にそのまま入っていて、元の言葉が 1 つに決まるときだけ、その元の言葉に
 * （「（町名）小学校」→ 台帳の「かわなぎ小学校」）。役割名（娘・支援者 1）は戻さない（Claude は続柄の言葉として使う）。
 * 決まらなければ restoreText（仮名だけ氏名に、伏せ字はそのまま残り、画面が人に直させる）
 */
export function sourceRestorer(sources: ReadonlyArray<string>, key: PseudonymKey): (value: string) => string {
  const traces = [...new Set(sources)].map((s) => {
    const units = scrubUnits(s, key).units;
    const starts: number[] = [];
    let pos = 0;
    for (const u of units) {
      starts.push(pos);
      pos += u.out.length;
    }
    return { units, starts, out: joinOut(units) };
  });
  return (value: string) => {
    if (!value.trim()) return value;
    const found = new Set<string>();
    for (const t of traces) {
      for (let i = t.out.indexOf(value); i >= 0; i = t.out.indexOf(value, i + 1)) {
        const a = t.starts.indexOf(i);
        const end = i + value.length;
        const b = end === t.out.length ? t.units.length : t.starts.indexOf(end);
        // 印の途中で始まる・終わる所は戻さない
        if (a < 0 || b < 0) continue;
        found.add(
          t.units
            .slice(a, b)
            .map((u) => (u.kind === "keep" ? u.out : u.orig))
            .join(""),
        );
      }
    }
    return found.size === 1 ? [...found][0] : restoreText(value, key);
  };
}
