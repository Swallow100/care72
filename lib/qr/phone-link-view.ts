// 本人のページの「スマホ入口」の画面に出す形（T69a）。本人のページの行（lib/person.ts）と本人の行の版から組む。Claude は呼ばない。
// 画面（components/phone/PhoneLinkPanel.tsx）はここの形を描くだけ。
//
// - 本人用: 1 行。台帳のスマホ（basic.contactMeans.smartphone）が「使用可」でなくても出す（押せるかは本人と家族が決める）
// - 家族用: 連絡先のうち答えられる種類（家族・支援者・民生委員。lib/signals/labels.ts の SIGNAL_WRITER_KINDS）の行ごと。
//   本人の電話（self）・機関の連絡先は出さない（開く口も通さない）。スマホ有（has_smartphone 1）を上に、そのあと緊急連絡先の順
// - URL と QR は有効な版があるときだけ（未発行・期限切れ・一覧外は出さない。出しても開けない）

import { parseLedger } from "../db/ledger.ts";
import { CONTACT_KIND_LABELS, SMARTPHONE_LABELS } from "../labels.ts";
import type { PersonPageRows } from "../person.ts";
import { isSignalWriterKind } from "../signals/labels.ts";
import { PHONE_LINK_LABELS } from "./phone-labels.ts";
import { phoneLinkUrl } from "./phone-link.ts";
import { currentPhoneLinkToken, phoneLinkState, type PhoneLinkRow, type PhoneLinkState } from "./phone-link-store.ts";

export type PhoneLinkItem = {
  /** 行の鍵: 本人用は "self"、家族用は連絡先の id */
  key: string;
  kind: "self" | "family";
  /** 名前（連絡先の名前が空なら種類の名前） */
  name: string;
  /** 続柄（娘）か種類（支援者）。本人用は null */
  relation: string | null;
  /** スマホの印（本人は台帳の値「スマホ 使用可」、家族はスマホ有のときだけ「スマホ有」）。無ければ null */
  smartphone: string | null;
  /** 開く URL（/s/<token> の絶対 URL）。有効な版が無ければ null */
  url: string | null;
};

export type PhoneLinkView = {
  personId: string;
  state: PhoneLinkState;
  /** 本人が一覧から外れている（リンクは通らない。発行もしない） */
  unlisted: boolean;
  self: PhoneLinkItem;
  family: PhoneLinkItem[];
};

type Contact = PersonPageRows["contacts"][number];

/** 家族用に出す連絡先の並び: スマホ有 → 緊急連絡先の順（無い物は後）→ 並びの順 → id */
export function familyLinkContacts(rows: Pick<PersonPageRows, "person" | "contacts">): Contact[] {
  const order = (c: Contact) => c.emergency_order ?? Number.MAX_SAFE_INTEGER;
  return rows.contacts
    .filter((c) => c.person_id === rows.person.id && isSignalWriterKind(c.kind))
    .sort(
      (a, b) =>
        Number(b.has_smartphone === 1) - Number(a.has_smartphone === 1) ||
        order(a) - order(b) ||
        a.sort - b.sort ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

function ownSmartphone(ledger: string): string | null {
  try {
    const v = parseLedger(ledger).basic.contactMeans?.smartphone;
    return v ? `${PHONE_LINK_LABELS.ownPhone} ${SMARTPHONE_LABELS[v]}` : null;
  } catch {
    return null;
  }
}

/** 画面の形。origin は要求の元（lib/qr/url.ts の originFromHeaders）。無ければ URL を出さない。now は秒 */
export async function buildPhoneLinkView(
  rows: Pick<PersonPageRows, "person" | "contacts">,
  link: PhoneLinkRow,
  opts: { now: number; origin: string | null; secret: string },
): Promise<PhoneLinkView> {
  const state = phoneLinkState(link, opts.now);
  const unlisted = link.unlisted_at !== null;
  const usable = state.status === "active" && !unlisted && opts.origin !== null;
  const url = async (contactId: string | null) => {
    if (!usable) return null;
    const token = await currentPhoneLinkToken(rows.person.id, contactId, link, opts.secret);
    return token ? phoneLinkUrl(opts.origin!, token) : null;
  };
  const self: PhoneLinkItem = {
    key: "self",
    kind: "self",
    name: rows.person.name,
    relation: null,
    smartphone: ownSmartphone(rows.person.ledger),
    url: await url(null),
  };
  const family = await Promise.all(
    familyLinkContacts(rows).map(
      async (c): Promise<PhoneLinkItem> => ({
        key: c.id,
        kind: "family",
        name: c.name?.trim() || CONTACT_KIND_LABELS[c.kind],
        relation: c.relation?.trim() || CONTACT_KIND_LABELS[c.kind],
        smartphone: c.has_smartphone === 1 ? PHONE_LINK_LABELS.smartphone : null,
        url: await url(c.id),
      }),
    ),
  );
  return { personId: rows.person.id, state, unlisted, self, family };
}
