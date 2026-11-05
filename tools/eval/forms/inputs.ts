// 評価の台（T107）の架空の入力の束。種の 10 人（seed/people.ts。全員架空）の台帳から、入れ方ごとの入力と、その入力の正解の分け方
// （完全に読めたときに Claude が返す形 ExtractOutput。仮名化の前の言葉）を作る。
//
// - 入れ方: 自由文（文章・箇条書き・メモの 3 つの書き方を人ごとに回す）・声の書き起こし風・長すぎる書き起こし・手書き風の写真・
//   スマホの写真風（大きい JPEG・傾き・端末の付け足し）・HEIC・複数頁の PDF（読む頁の上限 PDF_PAGES_MAX を超える 4 頁）・台帳そのまま
// - 文は「事実」の並びから作る。事実ごとに言い方（書き方ごと）と正解の分け方の切れ端を持つので、入力の正解は入れた事実の切れ端を足した物
// - 氏名・カナ・生年月日・住所・電話は「伏せる所」として持つ。文の入力ではそのまま書き（仮名化の門が伏せるのを確かめる）、
//   絵の入力ではその場所を覚えて、ブラウザの黒塗りと同じ塗り方で塗ってから送る（tools/eval/forms/browser.ts）
// - 絵と PDF の中身は HTML で書き、Chrome で写真・PDF にする（tools/eval/forms/render.ts）。ここは文字と HTML だけで、決まった種で同じ物になる

import type { ContactRow, Ledger } from "../../../lib/db/types.ts";
import { birthWritings } from "../shapes.ts";
import { INTAKE_CHUNK_MAX } from "../../../lib/intake/extract.ts";
import { PENDING_KEYS, type ExtractOutput } from "../../../lib/intake/schema.ts";
import { kindFromText } from "../../../lib/map/transport.ts";
import {
  CARE_LEVEL_LABELS,
  DEVICE_LABELS,
  HAZARD_LABELS,
  HOUSEHOLD_LABELS,
  STRUCTURE_LABELS,
  SUPPORT_KIND_LABELS,
  TRANSPORT_KIND_LABELS,
} from "../../../lib/labels.ts";
import { SEED_PEOPLE, type SeedPerson } from "../../../seed/people.ts";

/** 入力の種類。ledger は入れる欄を通さず種の台帳のまま（様式の読み取りだけを見る比べの基準） */
export const INPUT_KINDS = ["text", "voice", "long", "handwrite", "photo", "heic", "pdf", "ledger"] as const;
export type InputKind = (typeof INPUT_KINDS)[number];
export const INPUT_KIND_LABELS: Record<InputKind, string> = {
  text: "自由文",
  voice: "書き起こし",
  long: "長文",
  handwrite: "手書き",
  photo: "写真",
  heic: "HEIC",
  pdf: "PDF",
  ledger: "台帳",
};

export type Style = "prose" | "list" | "memo" | "voice";
export const STYLE_LABELS: Record<Style, string> = { prose: "文章", list: "箇条書き", memo: "メモ", voice: "書き起こし" };

/** 文の切れ。secret は伏せる所（氏名・電話・住所・生年月日）。絵ではその場所を塗る */
export type Seg = string | { secret: string };
export type Line = Seg[];

/** 正解の分け方（空の形） */
export function emptyExtract(): ExtractOutput {
  return { items: [], medications: [], devices: [], hazards: [], contacts: [], notes: [], unknowns: [] };
}

export function mergeExtract(parts: ReadonlyArray<Partial<ExtractOutput>>): ExtractOutput {
  const out = emptyExtract();
  for (const p of parts) {
    out.items.push(...(p.items ?? []));
    out.medications.push(...(p.medications ?? []));
    out.devices.push(...(p.devices ?? []));
    out.hazards.push(...(p.hazards ?? []));
    out.contacts.push(...(p.contacts ?? []));
    out.notes.push(...(p.notes ?? []));
    out.unknowns.push(...(p.unknowns ?? []));
  }
  return out;
}

// ---------- 決まった種の乱数 ----------

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32。同じ種なら同じ並び */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 事実 ----------

/** 群（PDF の頁の分け方・手書きのメモに載せる物） */
export type FactGroup = "本人" | "介護" | "医療" | "避難" | "連絡先" | "特記";

export type Fact = {
  id: string;
  group: FactGroup;
  /** 書き方ごとの言い方（1 行） */
  say: Record<Style, Line>;
  piece: Partial<ExtractOutput>;
};

const item = (field: string, value: string): Partial<ExtractOutput> => ({ items: [{ field, value }] });
const all = (s: string): Record<Style, Line> => ({ prose: [s], list: [s], memo: [s], voice: [s] });
const says = (prose: string, list: string, memo: string, voice: string): Record<Style, Line> => ({ prose: [prose], list: [list], memo: [memo], voice: [voice] });

const ABILITY_SAYS: Record<string, Record<string, [string, string]>> = {
  walking: { ok: ["歩行は自立している", "歩行 自立"], some: ["歩くときは見守りと一部の介助が要る", "歩行 一部介助"], hard: ["自力では歩けない（全介助）", "歩行 全介助"] },
  hearing: { ok: ["耳の聞こえは問題ない", "聴力 問題なし"], some: ["耳が少し遠い", "やや難聴"], hard: ["耳がほとんど聞こえない", "聴力 困難"] },
  vision: { ok: ["目は問題ない", "視力 問題なし"], some: ["目が少し見えにくい", "視力 やや低下"], hard: ["目がほとんど見えない", "視力 困難"] },
  understanding: { ok: ["言葉の理解は問題ない", "理解 問題なし"], some: ["込み入った話は一部わからない", "理解 一部"], hard: ["言葉の理解が難しい", "理解 困難"] },
  judgment: { ok: ["危ないことの判断はできる", "判断 可"], some: ["危ないことの判断が一部できない", "判断 一部"], hard: ["危ないことの判断ができない", "判断 困難"] },
  orientation: { ok: ["家族や知人の見分けはつく", "見当識 問題なし"], some: ["人の見分けが時々つかない", "見当識 一部"], hard: ["人や場所の見分けがつかない", "見当識 困難"] },
};

const careShort = (v: string) => CARE_LEVEL_LABELS[v as keyof typeof CARE_LEVEL_LABELS].replace("要介護", "要介").replace("要支援", "要支");

function voiceOf(s: string, r: () => number, dialect: boolean): string {
  const fillers = ["えー、", "あの、", "えっと、", "あのー、", "まあ、"];
  const head = r() < 0.6 ? fillers[Math.floor(r() * fillers.length)] : "";
  // 言い淀みの繰り返し（頭の 2 字）
  const stutter = r() < 0.2 && s.length > 4 ? `${s.slice(0, 2)}、` : "";
  // 動詞・形容詞で終わる文と、名詞で終わる文で後ろを変える
  const verb = /[るいたすうくつ]$/.test(s);
  const tails = verb ? ["", "ね", "んです"] : ["", "です", "ですね"];
  const tail = dialect && r() < 0.35 ? (verb ? "けん" : "やけん") : tails[Math.floor(r() * tails.length)];
  return `${head}${stutter}${s}${tail}。`;
}

const nightOf = (c: Pick<ContactRow, "night_ok">): "yes" | "no" | "unknown" => (c.night_ok === 1 ? "yes" : c.night_ok === 0 ? "no" : "unknown");

/** 1 人の台帳から事実の並び。入れる欄の分け方（lib/intake/schema.ts）で表せる物だけ */
export function factsOf(p: SeedPerson): Fact[] {
  const l: Ledger = p.ledger;
  const out: Fact[] = [];
  const b = l.basic;
  if (b.sex) out.push({ id: "basic.sex", group: "本人", say: says(b.sex === "female" ? "女性。" : "男性。", `・性別：${b.sex === "female" ? "女" : "男"}`, b.sex === "female" ? "女" : "男", b.sex === "female" ? "女の方" : "男の方"), piece: item("basic.sex", b.sex) });
  if (b.household) {
    const words: Record<string, string> = { alone: "一人暮らし", with_spouse: "夫婦二人暮らし", with_child: "子どもと同居", with_family: "家族と同居" };
    const w = words[b.household] ?? HOUSEHOLD_LABELS[b.household];
    out.push({ id: "basic.household", group: "本人", say: says(`${w}。`, `・世帯：${w}`, w, w), piece: item("basic.household", b.household) });
  }
  const cm = b.contactMeans;
  if (cm?.landline !== undefined) out.push({ id: "cm.landline", group: "本人", say: all(cm.landline ? "自宅に固定電話がある。" : "固定電話はない。"), piece: item("basic.contactMeans.landline", String(cm.landline)) });
  if (cm?.mobile !== undefined) out.push({ id: "cm.mobile", group: "本人", say: all(cm.mobile ? "携帯電話を持っている。" : "携帯電話は持っていない。"), piece: item("basic.contactMeans.mobile", String(cm.mobile)) });
  if (cm?.smartphone) {
    const w = { uses: "スマホは自分で使える", views: "スマホは見るだけ", none: "スマホは持っていない" }[cm.smartphone];
    out.push({ id: "cm.smartphone", group: "本人", say: says(`${w}。`, `・${w}`, w, w), piece: item("basic.contactMeans.smartphone", cm.smartphone) });
  }
  const c = l.care;
  if (c.careLevel) out.push({ id: "care.careLevel", group: "介護", say: says(`要介護度は${CARE_LEVEL_LABELS[c.careLevel]}。`, `・介護度：${CARE_LEVEL_LABELS[c.careLevel]}`, careShort(c.careLevel), `介護度は${CARE_LEVEL_LABELS[c.careLevel]}`), piece: item("care.careLevel", c.careLevel) });
  for (const k of ["walking", "hearing", "vision", "understanding", "judgment", "orientation"] as const) {
    const v = c[k];
    if (!v) continue;
    const [long, short] = ABILITY_SAYS[k][v];
    out.push({ id: `care.${k}`, group: "介護", say: says(`${long}。`, `・${short}`, short, long), piece: item(`care.${k}`, v) });
  }
  if (c.bedridden !== undefined) out.push({ id: "care.bedridden", group: "介護", say: all(c.bedridden ? "ほぼ寝たきり。" : "寝たきりではない。"), piece: item("care.bedridden", String(c.bedridden)) });
  if (c.dementia !== undefined) out.push({ id: "care.dementia", group: "介護", say: all(c.dementia ? "認知症がある。" : "認知症はない。"), piece: item("care.dementia", String(c.dementia)) });
  if (c.handbook) out.push({ id: "care.handbook", group: "介護", say: all(`障害者手帳は${c.handbook}。`), piece: item("care.handbook", c.handbook) });
  if (c.intractableDisease) out.push({ id: "care.intractableDisease", group: "介護", say: all(`難病は${c.intractableDisease}。`), piece: item("care.intractableDisease", c.intractableDisease) });

  const m = l.medical;
  m.devices.forEach((d, i) => {
    if (d.kind === "other") return; // その他の機器は人が編集の画面で足す（AI の分け方に無い）
    const name = DEVICE_LABELS[d.kind];
    const detail = d.detail ? `（${d.detail}）` : "";
    const sched = d.schedule ? ` ${d.schedule}` : "";
    out.push({
      id: `device.${i}`,
      group: "医療",
      say: says(`${name}${detail}を使っている${sched ? `。${d.schedule}` : ""}。`, `・機器：${name}${detail}${sched}`, `${name}${detail}${sched}`, `${name}を使ってて${detail}${sched}`),
      // 正解の中身は種類の名前を重ねない（T120 の決まり。「胃ろう 経管栄養」の経管栄養は種類の名前）。前の正解は台帳の中身のままで、
      // 決まりどおりの答えを外れと数えていた（評価の 2・3 回目、T131 で直した）
      piece: { devices: [{ kind: d.kind, detail: deviceDetail(d.kind, d.detail), schedule: d.schedule ?? "" }] },
    });
  });
  m.medications.forEach((md, i) => {
    const parts = [md.name, md.schedule, md.amount ? `${md.amount}` : "", md.storage ? `保管は${md.storage}` : ""].filter(Boolean).join(" ");
    out.push({
      id: `med.${i}`,
      group: "医療",
      say: says(`薬は${parts}。`, `・薬：${parts}`, parts, `薬は、${parts}`),
      piece: { medications: [{ name: md.name, category: md.category, schedule: md.schedule ?? "", amount: md.amount ?? "", storage: md.storage ?? "" }] },
    });
  });
  for (const [k, label] of [["allergies", "アレルギー"], ["history", "既往"], ["vaccinations", "予防接種"]] as const) {
    const v = m[k];
    if (!v || v.length === 0) continue;
    out.push({ id: `medical.${k}`, group: "医療", say: all(`${label}は${v.join("、")}。`), piece: { items: v.map((x) => ({ field: `medical.${k}`, value: x })) } });
  }

  const e = l.evacuation;
  e.hazards.forEach((h, i) => {
    if (h.kind === "other") return;
    const w = h.kind === "flood" ? `浸水想定 ${h.depthM ?? ""}m の区域` : h.kind === "landslide" ? "土砂災害の警戒区域" : "津波の浸水区域";
    out.push({ id: `hazard.${i}`, group: "避難", say: says(`自宅は${w}。`, `・自宅のリスク：${HAZARD_LABELS[h.kind]}${h.depthM != null ? ` ${h.depthM}m` : ""}`, w, `家は${w}`), piece: { hazards: [{ kind: h.kind, depth_m: h.depthM != null ? String(h.depthM) : "" }] } });
  });
  if (e.destination1) out.push({ id: "evacuation.destination1", group: "避難", say: says(`避難先は${e.destination1}。`, `・避難先：${e.destination1}`, `避難→${e.destination1}`, `避難先は${e.destination1}`), piece: item("evacuation.destination1", e.destination1) });
  if (e.destination2) out.push({ id: "evacuation.destination2", group: "避難", say: all(`第二の避難先は${e.destination2}。`), piece: item("evacuation.destination2", e.destination2) });
  if (e.transport) {
    // 手段は選ぶ欄と補記（T112）。正解は選ぶ欄（台帳の文字からの読み替え kindFromText）と、選ぶ欄の言葉と違えば補記の文字（T120 で正解の表を直した）
    const kind = e.transportKind ?? kindFromText(e.transport);
    const items = [...(kind ? [{ field: "evacuation.transportKind", value: kind }] : []), ...(kind && TRANSPORT_KIND_LABELS[kind] === e.transport ? [] : [{ field: "evacuation.transport", value: e.transport }])];
    out.push({ id: "evacuation.transport", group: "避難", say: says(`避難の移動は${e.transport}。`, `・移動手段：${e.transport}`, `移動 ${e.transport}`, `移動は${e.transport}`), piece: { items } });
  }
  if (e.support?.length) out.push({ id: "evacuation.support", group: "避難", say: all(`支援者には${e.support.map((s) => SUPPORT_KIND_LABELS[s]).join("と")}をお願いする。`), piece: { items: e.support.map((s) => ({ field: "evacuation.support", value: s })) } });
  if (e.carryItems?.length) out.push({ id: "evacuation.carryItems", group: "避難", say: says(`持ち出す物は${e.carryItems.join("、")}。`, `・持出品：${e.carryItems.join("、")}`, `持出 ${e.carryItems.join("・")}`, `持って出る物は${e.carryItems.join("と")}`), piece: { items: e.carryItems.map((x) => ({ field: "evacuation.carryItems", value: x })) } });
  if (e.route) out.push({ id: "evacuation.route", group: "避難", say: all(`避難経路は${e.route}。`), piece: item("evacuation.route", e.route) });
  if (e.pets) out.push({ id: "evacuation.pets", group: "避難", say: all(`ペットは${e.pets}。`), piece: item("evacuation.pets", e.pets) });
  const hs = b.housing;
  if (hs?.structure) out.push({ id: "housing.structure", group: "避難", say: all(`家は${STRUCTURE_LABELS[hs.structure]}。`), piece: item("basic.housing.structure", hs.structure) });
  if (hs?.floors != null) out.push({ id: "housing.floors", group: "避難", say: all(hs.floors === 1 ? "平屋。" : `${hs.floors}階建て。`), piece: item("basic.housing.floors", String(hs.floors)) });
  if (hs?.floor != null) out.push({ id: "housing.floor", group: "避難", say: all(`普段は${hs.floor}階で過ごしている。`), piece: item("basic.housing.floor", String(hs.floor)) });

  for (const ct of p.contacts) {
    if (ct.kind === "self" || ct.kind === "other") continue;
    const nm: Seg = { secret: ct.name ?? "" };
    const tel: Seg = { secret: ct.phone ?? "" };
    const night = nightOf(ct);
    const nightSay = night === "yes" ? "夜間も来られる" : night === "no" ? "夜は来られない" : "";
    const who = ct.kind === "family" || ct.kind === "supporter" ? `${ct.relation ?? ""}の` : `${roleWord(ct.kind)}は`;
    const note = ct.note && ct.kind !== "family" && ct.kind !== "supporter" ? `（${ct.note}）` : "";
    const line: Line = [who, nm, ct.kind === "family" || ct.kind === "supporter" ? "さん" : "", " TEL ", tel, note, nightSay ? `、${nightSay}` : "", "。"];
    out.push({
      id: `contact.${ct.id}`,
      group: "連絡先",
      say: { prose: line, list: ["・", ...line], memo: line, voice: line },
      piece: { contacts: [{ kind: ct.kind, relation: ct.kind === "family" || ct.kind === "supporter" ? (ct.relation ?? "") : "", night, note: note ? (ct.note ?? "") : "" }] },
    });
  }
  l.notes.forEach((n, i) => out.push({ id: `note.${i}`, group: "特記", say: all(`${n}。`), piece: { notes: [n] } }));
  for (const pd of l.pending) {
    if (pd.status !== "unknown" && pd.status !== "declined") continue;
    if (!(PENDING_KEYS as readonly string[]).includes(pd.field)) continue;
    const name = PENDING_WORDS[pd.field] ?? pd.field;
    out.push({ id: `pending.${pd.field}`, group: "特記", say: all(pd.status === "unknown" ? `${name}はまだ分からない。` : `${name}は答えたくないとのこと。`), piece: { unknowns: [{ field: pd.field, status: pd.status }] } });
  }
  return out;
}

/** 機器の中身から種類の名前を外した物（lib/intake/extract.ts の決まり「detail に種類の名前を重ねず」の答え） */
export function deviceDetail(kind: keyof typeof DEVICE_LABELS, detail: string | null | undefined): string {
  const d = detail?.trim() ?? "";
  if (kind === "other" || d === "") return d;
  return d.split(DEVICE_LABELS[kind]).join(" ").replace(/\s+/g, " ").trim();
}

const PENDING_WORDS: Record<string, string> = { "evacuation.destination2": "第二の避難先", "evacuation.transport": "避難の移動手段", "medical.medications": "薬" };

function roleWord(kind: ContactRow["kind"]): string {
  const words: Partial<Record<ContactRow["kind"], string>> = {
    welfare_commissioner: "民生委員",
    visiting_nurse: "訪問看護",
    care_service: "介護事業所",
    home_doctor: "かかりつけ医",
    pharmacy: "薬局",
    dialysis_center: "透析先",
    city_office: "市役所の担当",
    oxygen_supplier: "機器の業者",
    power_company: "電力会社",
    hospital: "病院",
  };
  return words[kind] ?? "関係先";
}

/**
 * 頭の行（氏名・カナ・生年月日・住所・電話。伏せる所）。生年月日の書き方は入れ方ごとに変える（T118）:
 * 書き起こしは漢数字（昭和十七年四月十八日）、箇条書きは略記（S17.4.18）、ほかは和暦の数字（昭和17年4月18日）
 */
export function identityLine(p: SeedPerson, style: Style): Line {
  const self = p.contacts.find((c) => c.kind === "self");
  const addr = p.ledger.basic.address;
  const writings = p.person.birth_date ? birthWritings(p.person.birth_date) : null;
  const birth = !writings ? "" : style === "voice" ? writings.kanji : style === "list" ? writings.short : writings.digits;
  if (style === "voice") return ["えー、", { secret: p.person.name }, "さん、", { secret: birth }, "生まれで、", { secret: addr ? `${addr.city}${addr.town}` : "" }, "にお住まいです。電話は", { secret: self?.phone ?? "" }, "。"];
  if (style === "list") return ["・氏名：", { secret: p.person.name }, "（", { secret: p.person.kana ?? "" }, "）　", { secret: birth }, "生　", { secret: addr ? `${addr.city}${addr.town}` : "" }, "　TEL ", { secret: self?.phone ?? "" }];
  return [{ secret: p.person.name }, "さん（", { secret: birth }, "生）、", { secret: addr ? `${addr.city}${addr.town}` : "" }, "在住。TEL ", { secret: self?.phone ?? "" }, "。"];
}

export const lineText = (l: Line): string => l.map((s) => (typeof s === "string" ? s : s.secret)).join("");

/** 書き方の言い方（声は言い淀みを足す） */
function sayOf(f: Fact, style: Style, r: () => number, dialect: boolean): Line {
  const line = f.say[style];
  if (style !== "voice") return line;
  const plain = line.every((s) => typeof s === "string");
  return plain ? [voiceOf(lineText(line).replace(/。$/, ""), r, dialect)] : [r() < 0.5 ? "あの、" : "", ...line];
}

/** 文の入力（自由文・書き起こし）を作る。lines は 1 行ずつ */
export function composeLines(p: SeedPerson, facts: readonly Fact[], style: Style, seed: string): Line[] {
  const r = rng(hashSeed(seed));
  const dialect = hashSeed(p.person.id) % 3 === 0;
  const lines: Line[] = [identityLine(p, style)];
  for (const f of facts) lines.push(sayOf(f, style, r, dialect));
  return lines;
}

export function joinLines(lines: readonly Line[], style: Style): string {
  const sep = style === "list" ? "\n" : style === "memo" ? "／" : style === "voice" ? "" : "";
  return lines.map(lineText).join(sep);
}

// ---------- 入力の束 ----------

/** 1 つの入力。pieces は送る単位（文は 1 つ、写真は 1 枚、PDF は頁ごと）の正解の分け方 */
export type InputSpec = {
  id: string;
  personId: string;
  kind: InputKind;
  /** 書き方（文の入力・絵の中の字） */
  style: Style | null;
  /** 文の入力の中身 */
  text?: string;
  /** 絵・PDF を作る物（Chrome で作る。tools/eval/forms/render.ts） */
  doc?: DocSpec;
  /** 送る単位ごとの正解の分け方（仮名化の前の言葉）。PDF は頁ごと（上限を超えた頁も持つ） */
  oracle: ExtractOutput[];
  /** この入力に入れた事実の id（記録用） */
  facts: string[];
};

/** 絵・PDF の中身 */
export type DocSpec =
  | { kind: "handwrite"; lines: Line[]; tilt: number }
  | { kind: "photo"; title: string; lines: Line[]; tilt: number }
  | { kind: "pdf"; title: string; pages: Line[][] }
  | { kind: "heic" };

const STYLES: Style[] = ["prose", "list", "memo"];

/** 手書きのメモに書く群（短いメモ） */
const MEMO_GROUPS: ReadonlyArray<FactGroup> = ["介護", "医療", "避難", "連絡先", "特記"];

export function buildInputs(people: readonly SeedPerson[] = SEED_PEOPLE): InputSpec[] {
  const out: InputSpec[] = [];
  people.forEach((p, i) => {
    const facts = factsOf(p);
    const pid = p.person.id;
    const style = STYLES[i % STYLES.length];
    const all = mergeExtract(facts.map((f) => f.piece));
    const ids = facts.map((f) => f.id);
    out.push({ id: `text-${pid}`, personId: pid, kind: "text", style, text: joinLines(composeLines(p, facts, style, `text-${pid}`), style), oracle: [all], facts: ids });
    out.push({ id: `voice-${pid}`, personId: pid, kind: "voice", style: "voice", text: joinLines(composeLines(p, facts, "voice", `voice-${pid}`), "voice"), oracle: [all], facts: ids });
    // 手書きのメモ: 介護・医療・避難・連絡先・特記の短い言い方
    const memoFacts = facts.filter((f) => MEMO_GROUPS.includes(f.group));
    out.push({
      id: `handwrite-${pid}`,
      personId: pid,
      kind: "handwrite",
      style: "memo",
      doc: { kind: "handwrite", lines: composeLines(p, memoFacts, "memo", `handwrite-${pid}`), tilt: -2.5 + (hashSeed(pid) % 50) / 10 },
      oracle: [mergeExtract(memoFacts.map((f) => f.piece))],
      facts: memoFacts.map((f) => f.id),
    });
    out.push({
      id: `photo-${pid}`,
      personId: pid,
      kind: "photo",
      style: "list",
      doc: { kind: "photo", title: "フェイスシート（在宅）", lines: composeLines(p, facts, "list", `photo-${pid}`), tilt: 1.5 + (hashSeed(`${pid}-t`) % 30) / 10 },
      oracle: [all],
      facts: ids,
    });
    // 複数頁の PDF（3 人）: 本人・介護 / 医療 / 避難 / 連絡先・特記 の 4 頁。読むのは頭の PDF_PAGES_MAX 頁
    if (i % 4 === 0) {
      const groups: FactGroup[][] = [["本人", "介護"], ["医療"], ["避難"], ["連絡先", "特記"]];
      const pageFacts = groups.map((g) => facts.filter((f) => g.includes(f.group)));
      out.push({
        id: `pdf-${pid}`,
        personId: pid,
        kind: "pdf",
        style: "list",
        doc: {
          kind: "pdf",
          title: "居宅サービス計画（写し）",
          pages: pageFacts.map((fs, n) => (n === 0 ? composeLines(p, fs, "list", `pdf-${pid}-${n}`) : composeLines(p, fs, "list", `pdf-${pid}-${n}`).slice(1))),
        },
        oracle: pageFacts.map((fs) => mergeExtract(fs.map((f) => f.piece))),
        facts: pageFacts.flat().map((f) => f.id),
      });
    }
  });
  // 失敗を数える入力: HEIC（ブラウザが開けない形）と、上限を超える長さの書き起こし
  const heic = people[2] ?? people[0];
  out.push({ id: `heic-${heic.person.id}`, personId: heic.person.id, kind: "heic", style: null, doc: { kind: "heic" }, oracle: [emptyExtract()], facts: [] });
  const long = people[5] ?? people[0];
  const longFacts = factsOf(long);
  let longText = "";
  for (let n = 0; longText.length <= INTAKE_CHUNK_MAX; n++) longText += joinLines(composeLines(long, longFacts, "voice", `long-${long.person.id}-${n}`), "voice");
  out.push({ id: `long-${long.person.id}`, personId: long.person.id, kind: "long", style: "voice", text: longText, oracle: [mergeExtract(longFacts.map((f) => f.piece))], facts: longFacts.map((f) => f.id) });
  // 台帳そのまま（入れる欄を通さない）
  for (const p of people) out.push({ id: `ledger-${p.person.id}`, personId: p.person.id, kind: "ledger", style: null, oracle: [], facts: [] });
  return out;
}

// ---------- 絵・PDF の HTML ----------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 1 行の HTML。伏せる所は data-secret の span（場所を測って塗る）。perChar は 1 字ずつ揺らす（手書き風） */
function lineHtml(l: Line, perChar: (() => string) | null): string {
  const chars = (s: string) => (perChar ? [...s].map((ch) => `<span class="ch" style="${perChar()}">${esc(ch)}</span>`).join("") : esc(s));
  return l.map((s) => (typeof s === "string" ? chars(s) : s.secret ? `<span data-secret>${chars(s.secret)}</span>` : "")).join("");
}

/** 手書き風のメモ（教科書体・字ごとの揺れ・紙の傾き・影）。1500×2000 の紙を 1700×2200 の絵に */
export function handwriteHtml(doc: Extract<DocSpec, { kind: "handwrite" }>, seed: string): string {
  const r = rng(hashSeed(seed));
  const jitter = () => `transform: translate(${(r() - 0.5) * 3}px, ${(r() - 0.5) * 5}px) rotate(${(r() - 0.5) * 6}deg)`;
  const lines = doc.lines.map((l) => `<div class="ln">${lineHtml(l, jitter)}</div>`).join("");
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>
html, body { margin: 0; width: 1700px; height: 2200px; background: #8a8378; overflow: hidden; }
.sheet { position: absolute; left: 100px; top: 100px; width: 1500px; height: 2000px; box-sizing: border-box; padding: 110px 90px;
  background: repeating-linear-gradient(#fbfaf3 0 66px, #b9c7da 66px 68px); transform: rotate(${doc.tilt}deg);
  font-family: ${hashSeed(seed) % 2 === 0 ? `"HGGyoshotai", "HG行書体", ` : ""}"UD Digi Kyokasho N", "UD デジタル 教科書体 N", "UD Digi Kyokasho N-R", "Yu Mincho", serif; font-size: 46px; line-height: 68px; color: #1d2a5c; filter: blur(0.5px); }
.ln { white-space: normal; word-break: break-all; }
.ch { display: inline-block; }
.shade { position: absolute; inset: 0; background: radial-gradient(ellipse at 85% 90%, rgba(0,0,0,0.35), rgba(0,0,0,0) 55%), linear-gradient(115deg, rgba(0,0,0,0) 60%, rgba(0,0,0,0.18)); pointer-events: none; }
</style></head><body><div class="sheet">${lines}</div><div class="shade"></div></body></html>`;
}

/** スマホの写真風（机の上の印刷した紙を斜めから。4032×3024 の縦）。noise は机の木目の細かさ（JPEG を大きくする） */
export function photoHtml(doc: Extract<DocSpec, { kind: "photo" }>, seed: string): string {
  const lines = doc.lines.map((l) => `<div class="ln">${lineHtml(l, null)}</div>`).join("");
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>
html, body { margin: 0; width: 3024px; height: 4032px; overflow: hidden; background: #6b4f33; }
canvas { position: absolute; inset: 0; }
.sheet { position: absolute; left: 330px; top: 380px; width: 2360px; height: 3300px; box-sizing: border-box; padding: 170px 160px; background: #f6f5f1;
  transform: perspective(5200px) rotateX(7deg) rotate(${doc.tilt}deg); box-shadow: 0 30px 60px rgba(0,0,0,0.45);
  font-family: "Yu Gothic", "YuGothic", "Meiryo", sans-serif; font-size: 58px; line-height: 96px; color: #222; }
h1 { font-size: 78px; margin: 0 0 60px; font-weight: 700; }
.shade { position: absolute; inset: 0; background: linear-gradient(160deg, rgba(255,255,255,0.12), rgba(0,0,0,0) 40%, rgba(0,0,0,0.28)); }
</style></head><body><canvas id="wood" width="3024" height="4032"></canvas>
<div class="sheet"><h1>${esc(doc.title)}</h1>${lines}</div><div class="shade"></div>
<script>(() => { let a = ${hashSeed(seed)} >>> 0; const r = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const c = document.getElementById("wood").getContext("2d"); const img = c.createImageData(3024, 4032); const d = img.data;
for (let i = 0; i < d.length; i += 4) { d[i] = 70 + r() * 90; d[i + 1] = 50 + r() * 70; d[i + 2] = 30 + r() * 50; d[i + 3] = 255; }
c.putImageData(img, 0, 0); })();</script></body></html>`;
}

/** 複数頁の PDF（印刷すると A4 縦 N 頁。ケアプランの写しの形） */
export function pdfHtml(doc: Extract<DocSpec, { kind: "pdf" }>): string {
  const pages = doc.pages
    .map((ls, i) => `<section class="pg"><h1>${esc(doc.title)}</h1><p class="no">${i + 1} / ${doc.pages.length}</p>${ls.map((l) => `<div class="ln">${lineHtml(l, null)}</div>`).join("")}</section>`)
    .join("");
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>
@page { size: A4 portrait; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
.pg { position: relative; width: 210mm; height: 297mm; box-sizing: border-box; padding: 22mm 20mm; overflow: hidden; break-after: page;
  font-family: "BIZ UDPGothic", "Yu Gothic", sans-serif; font-size: 11pt; line-height: 1.9; color: #000; }
.pg:last-child { break-after: auto; }
h1 { font-size: 15pt; margin: 0 0 6mm; }
.no { position: absolute; right: 20mm; top: 12mm; margin: 0; font-size: 9pt; }
</style></head><body>${pages}</body></html>`;
}
