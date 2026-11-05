// 行の詳細の「全部」（docs/tasks/T132.md）。発災時の行の詳細（lib/list/detail.ts）から開く、台帳の平時の情報の全部。
// 面（関係者・医療・避難・基本）は本人のページと同じ組み立て（lib/person.ts の toPersonView。平時の形、ケアマネの範囲）を読み、
// ここで作り直さない。関係者の面の「連絡先」の一覧だけは、1 人 1 行の連絡先（FullContact）に置き換える:
// 担当一覧は電話のリンク（tel:）、訓練は番号を出さず行を押すと対応の欄で手を選ぶ（components/drill/ContactPick.tsx）。
// 色と連絡順には使わない。D1 を使わない所（テストしやすいよう分けた）。

import type { ContactKind, PersonRow } from "../db/types.ts";
import { nightText } from "../ledger-words.ts";
import { CONTACT_KIND_LABELS, CONTACT_REACH_LABELS, CONTACT_ROLE_LABELS, FULL_LABELS } from "../labels.ts";
import { telHref, toPersonView, type PersonPageRows, type Section } from "../person.ts";
import type { ClockForDetail, ContactForDetail } from "./detail.ts";

/** 来てくれる人の連絡先（夜間に来られるかを出す。本人のページと同じ区分） */
const COMES_KINDS: ReadonlySet<ContactKind> = new Set(["family", "supporter", "welfare_commissioner", "visiting_nurse"]);

/** 連絡先の一覧に出さない種類（医療の面に出る機関。本人のページの関係者と同じ） */
const IN_MEDICAL: ReadonlySet<ContactKind> = new Set(["home_doctor", "pharmacy", "dialysis_center"]);

/** 「全部」の面の並び（関係者を先に。訓練の手を選ぶ所） */
const FULL_SECTIONS = ["people", "medical", "evacuation", "basic"] as const;

export type FullContact = {
  id: string;
  kind: ContactKind;
  /** 名前（無ければ間柄か種類） */
  name: string;
  /** 間柄（名前があるときだけ。名前が無ければ name が間柄） */
  relation: string | null;
  /** 種類の印（家族・支援者・民生委員など）。名前の代わりに出した言葉と同じ・その他は null */
  kindMark: string | null;
  /** 役割の印（「緊急 1」「支援 1」） */
  roles: string[];
  /** 夜間の印（来てくれる人だけ）。ok は来訪可 */
  night: { text: string; ok: boolean } | null;
  /** 灰の小さな字で並べる事実（距離・車あり／なし・スマホあり／なし・住所） */
  facts: string[];
  /** 電話（担当一覧だけが描く。訓練は「電話あり」「電話なし」だけ） */
  phone: { text: string; tel: string } | null;
  mobile: { text: string; tel: string } | null;
  note: string | null;
};

export type FullDetail = {
  /** 本人と、医療の面に出る機関のほかの連絡先（本人 → 緊急の順 → 支援の順 → 台帳の並び） */
  contacts: FullContact[];
  /** 本人のページの面（関係者・医療・避難・基本）。関係者は連絡先の一覧の行を除く（役割の空き・みまもり員・実施組織・夜間支援） */
  sections: Section[];
};

export type FullInput = {
  person: Pick<PersonRow, "birth_date" | "self_report_unreliable" | "ledger">;
  contacts: ReadonlyArray<ContactForDetail>;
  clocks: ReadonlyArray<ClockForDetail>;
  /** 年齢を数える日（JST、YYYY-MM-DD） */
  today: string;
};

function phoneOf(v: string | null | undefined): { text: string; tel: string } | null {
  const t = v?.trim();
  return t ? { text: t, tel: telHref(t) } : null;
}

/** 連絡先 1 人（本人のページの関係者の 1 人 1 行と同じ並び: 名前・間柄・種類・役割・夜間・距離・車・スマホ・電話・住所・備考） */
export function fullContact(c: ContactForDetail): FullContact {
  const name = c.name?.trim() || c.relation?.trim() || CONTACT_KIND_LABELS[c.kind];
  const kind = CONTACT_KIND_LABELS[c.kind];
  const facts: string[] = [];
  if (c.reach) facts.push(CONTACT_REACH_LABELS[c.reach]);
  if (c.has_car === 1) facts.push(FULL_LABELS.carYes);
  if (c.has_car === 0) facts.push(FULL_LABELS.carNo);
  if (c.has_smartphone === 1) facts.push(FULL_LABELS.smartphoneYes);
  if (c.has_smartphone === 0) facts.push(FULL_LABELS.smartphoneNo);
  if (c.address?.trim()) facts.push(c.address.trim());
  return {
    id: c.id,
    kind: c.kind,
    name,
    relation: c.name?.trim() && c.relation?.trim() ? c.relation.trim() : null,
    kindMark: c.kind !== "other" && kind !== name ? kind : null,
    roles: [
      ...(c.emergency_order != null ? [`${CONTACT_ROLE_LABELS.emergency} ${c.emergency_order}`] : []),
      ...(c.supporter_order != null ? [`${CONTACT_ROLE_LABELS.supporter} ${c.supporter_order}`] : []),
    ],
    night: COMES_KINDS.has(c.kind) ? { text: nightText(c.night_ok), ok: c.night_ok === 1 } : null,
    facts,
    phone: phoneOf(c.phone),
    mobile: phoneOf(c.mobile),
    note: c.note?.trim() || null,
  };
}

/** 並び: 本人 → 緊急の順 → 支援の順 → 台帳の並び */
function order(a: ContactForDetail, b: ContactForDetail): number {
  const self = (c: ContactForDetail) => (c.kind === "self" ? 0 : 1);
  const by = (k: "emergency_order" | "supporter_order") => (a[k] ?? Infinity) - (b[k] ?? Infinity);
  return self(a) - self(b) || by("emergency_order") || by("supporter_order") || a.sort - b.sort || (a.id < b.id ? -1 : 1);
}

/** 「全部」の中身を作る */
export function buildFullDetail(x: FullInput): FullDetail {
  const contacts = [...x.contacts];
  const rows: PersonPageRows = {
    person: {
      id: "",
      office_id: "",
      care_manager_id: null,
      name: "",
      kana: "",
      birth_date: x.person.birth_date,
      plan_status: "draft",
      origin: "care_manager",
      self_report_unreliable: x.person.self_report_unreliable,
      ledger: x.person.ledger,
      created_at: "",
      updated_at: "",
    },
    careManagerName: null,
    contacts,
    consents: [],
    clocks: x.clocks.map((k) => ({ ...k, sort: k.sort ?? 0 })),
    timeline: [],
  };
  const view = toPersonView(rows, { today: x.today });
  const sections = FULL_SECTIONS.flatMap((id): Section[] => {
    const s = view.sections.find((v) => v.id === id);
    if (!s) return [];
    if (id !== "people") return [s];
    return [{ ...s, blocks: s.blocks.filter((b) => !(b.type === "row" && b.row.key === "people.contacts")) }];
  });
  return {
    contacts: contacts.filter((c) => !IN_MEDICAL.has(c.kind)).sort(order).map(fullContact),
    sections,
  };
}

/** 訓練の「全部」: 面の中の電話の番号（tel のある言葉）を「電話あり」に（訓練の画面から本物の番号にかけない、T17 の決め） */
export function withoutPhones(sections: ReadonlyArray<Section>): Section[] {
  return sections.map((s) => ({
    ...s,
    blocks: s.blocks.map((b) => {
      if (b.type !== "row" || b.row.field.kind !== "lines") return b;
      // 番号の代わりに「電話あり」（番号があることは残す）
      const lines = b.row.field.lines.map((l) => l.map((seg) => (seg.tel ? { text: FULL_LABELS.phoneYes, tone: "muted" as const } : seg)));
      return { ...b, row: { ...b.row, field: { kind: "lines" as const, lines } } };
    }),
  }));
}
