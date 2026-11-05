// 自治体の個別避難計画の様式の一覧（T134、docs/DECISIONS.md「書類」の案（T134））。
// 様式追加の画面（components/forms/mapping/MunicipalPicker.tsx）で、都道府県 → 市町村 → 様式と検索で選ぶ。
// 選ぶとサーバーが一覧の URL から公式の様式を取り、版のハッシュを確かめて返す（lib/forms/municipal-http.ts）。
// 頁の絵にするのはブラウザ（黒塗りの画面 components/person/RedactSheet.tsx。Excel・Word は T119 の道）。
//
// - リポジトリに置くのは目録だけ（URL・版のハッシュ・頁数・利用の条件の要約と印）。役所のファイル本体は置かない
// - サーバーが取るのはここの url だけ（要求から URL を受けない）。url と頁は公式のドメイン（isOfficialHost）だけ
// - 記載例・手引き・同意書・関連の様式は refs にリンクだけ持つ（取り込まない。記載例は値が書いてある）
// - 取り込めない物: 旧形式（.doc・.xls。読み取りの道が断る。PDF に保存してから事業所が自分で入れる）、
//   条件の印が「許諾要」（私的使用の例外の記載が無く無断の複製を禁じる）。松山市はアプリに専用の紙がある（内蔵）
//
// ブラウザでも読む（選ぶ部品が一覧を描く）ので、サーバーだけの物は import しない。

import { MUNICIPAL_CITIES, MUNICIPAL_SKIPPED } from "./municipal-forms-data.ts";

export type MunicipalFormat = "pdf" | "xlsx" | "docx" | "xls" | "doc";
export const MUNICIPAL_FORMATS: readonly MunicipalFormat[] = ["pdf", "xlsx", "docx", "xls", "doc"];

/**
 * 利用の条件の印（各市の著作権の頁を作業者が読んで分けた物。法の判断でなく、取り込みを止めるかの目安）
 * - 自由: 公共データ利用規約・CC BY など、複製・加工してよい
 * - 配布不可: 私的使用・引用を除き無断の複製・転用・改変をしない（ふつうの形。T101 の松山市と同じ）
 * - 要相談: 私的使用・引用の外の複製・転用は事前に相談・申請
 * - 許諾要: 私的使用の例外の記載が無く、無断の複製をすべて禁じる → 取り込まない
 * - 条件不明: 著作権・二次利用の条件の記載が見当たらない
 */
export const TERMS_FLAGS = ["自由", "配布不可", "要相談", "許諾要", "条件不明"] as const;
export type TermsFlag = (typeof TERMS_FLAGS)[number];

export const REF_ROLES = ["記載例", "手引き", "同意書", "関連"] as const;
export type MunicipalRefRole = (typeof REF_ROLES)[number];

export type MunicipalForm = {
  /** 一覧の中の id（市の id と番号。英数字と -） */
  id: string;
  /** 様式名（公式の頁のリンクの字） */
  name: string;
  /** 公式のファイルの URL（取り込みの元。ここ以外から取らない） */
  url: string;
  format: MunicipalFormat;
  /** 確かめた版のファイルの SHA-256（16 進） */
  sha256: string;
  bytes: number;
  /** PDF の頁・Excel のシートの数・Word の頁。旧形式は null */
  pages: number | null;
  /** 版の短い形（年度・頁の更新日） */
  version: string;
  /** 様式の添え（セルフ作成用・医療的ケアなど） */
  note?: string;
  /** アプリに専用の紙がある様式（取り込まない） */
  builtin?: "matsuyama";
};

export type MunicipalRef = { role: MunicipalRefRole; name: string; url: string; format: MunicipalFormat };

export type MunicipalCity = {
  id: string;
  pref: string;
  /** 市町村（区）の名前 */
  name: string;
  /** 公式の頁 */
  pageUrl: string;
  terms: { flag: TermsFlag; summary: string; url: string | null };
  /** 確かめた日（YYYY-MM-DD） */
  checkedAt: string;
  forms: readonly MunicipalForm[];
  refs: readonly MunicipalRef[];
};

/** 探したが一覧に入れなかった市区（理由つき） */
export type MunicipalSkip = { pref: string; city: string; reason: string; pageUrl: string | null };

export { MUNICIPAL_CITIES, MUNICIPAL_SKIPPED };

/** 都道府県（全国地方公共団体コードの順） */
export const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
  "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
  "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
] as const;

// ---------- 公式のドメイン ----------

/** 自治体の型の名前（www.city.〇〇.jp・info.city.〇〇.jp・www.town.〇〇.lg.jp・www.pref.〇〇.lg.jp。村は village と vill） */
const AUTHORITY_LABELS = new Set(["city", "town", "village", "vill", "pref"]);

/** 公式のドメインか（.lg.jp か、.jp で自治体の型の名前を持つ） */
export function isOfficialHost(host: string): boolean {
  const h = host.toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(h) || !h.endsWith(".jp")) return false;
  if (h.endsWith(".lg.jp")) return true;
  return h.split(".").slice(0, -1).some((l) => AUTHORITY_LABELS.has(l));
}

/** 公式のドメインの https の URL か（取り込みの元・転送の先） */
export function isOfficialUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === "https:" && !u.username && !u.password && u.port === "" && isOfficialHost(u.hostname);
}

// ---------- 引く ----------

export type MunicipalEntry = { city: MunicipalCity; form: MunicipalForm };

const ENTRIES: readonly MunicipalEntry[] = MUNICIPAL_CITIES.flatMap((city) => city.forms.map((form) => ({ city, form })));

export function allMunicipalEntries(): readonly MunicipalEntry[] {
  return ENTRIES;
}

/** id の様式。無ければ null */
export function municipalEntry(id: string): MunicipalEntry | null {
  return ENTRIES.find((e) => e.form.id === id) ?? null;
}

export function isMunicipalFormId(v: unknown): v is string {
  return typeof v === "string" && /^[a-z0-9-]{1,40}$/.test(v) && ENTRIES.some((e) => e.form.id === v);
}

// ---------- 取り込めるか ----------

export type MunicipalBlock = "builtin" | "legacy" | "permission";
export type Availability = { ok: true } | { ok: false; reason: MunicipalBlock };

export function availability(e: MunicipalEntry): Availability {
  if (e.form.builtin) return { ok: false, reason: "builtin" };
  if (e.form.format === "doc" || e.form.format === "xls") return { ok: false, reason: "legacy" };
  if (e.city.terms.flag === "許諾要") return { ok: false, reason: "permission" };
  return { ok: true };
}

// ---------- 地域と検索 ----------

export type RegionPref = { pref: string; cities: Array<{ id: string; name: string; forms: number }> };

/** 都道府県 → 市町村（一覧に様式のある所だけ。都道府県はコードの順、市町村は一覧の順） */
export function regionTree(cities: readonly MunicipalCity[] = MUNICIPAL_CITIES): RegionPref[] {
  const out: RegionPref[] = [];
  for (const pref of PREFECTURES) {
    const cs = cities.filter((c) => c.pref === pref && c.forms.length > 0);
    if (cs.length > 0) out.push({ pref, cities: cs.map((c) => ({ id: c.id, name: c.name, forms: c.forms.length })) });
  }
  return out;
}

/** 検索の字をそろえる（NFKC・小文字・空白を外す・カタカナをひらがなに） */
export function normalizeQuery(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/** 検索（都道府県・市町村・様式名・添え・形式。空白で区切った語を全部含む物）。空なら空 */
export function searchMunicipal(query: string, entries: readonly MunicipalEntry[] = ENTRIES): MunicipalEntry[] {
  const words = query
    .normalize("NFKC")
    .split(/\s+/)
    .map(normalizeQuery)
    .filter(Boolean);
  if (words.length === 0) return [];
  return entries.filter((e) => {
    const hay = normalizeQuery(`${e.city.pref}${e.city.name}${e.form.name}${e.form.note ?? ""}${FORMAT_LABELS[e.form.format]}${e.form.format}`);
    return words.every((w) => hay.includes(w));
  });
}

/** 事業所の市（offices.city）から一覧の市。同じ名前が 2 つあれば null */
/**
 * 地域の市の並び（主な市が先、次に周りの市。lib/office/region.ts の regionCitiesOf。T148）を順に見て、一覧にある（名前が 1 つに決まる）
 * 最初の市。様式の一覧の「地域から選ぶ」の初めの市。無ければ null
 */
export function cityForRegion(cities: ReadonlyArray<string | null | undefined>): MunicipalCity | null {
  for (const c of cities) {
    const hit = cityForOffice(c);
    if (hit) return hit;
  }
  return null;
}

export function cityForOffice(officeCity: string | null | undefined): MunicipalCity | null {
  const name = (officeCity ?? "").trim();
  if (!name) return null;
  const hits = MUNICIPAL_CITIES.filter((c) => c.name === name || `${c.pref}${c.name}` === name);
  return hits.length === 1 ? hits[0] : null;
}

// ---------- 画面の言葉と道 ----------

export const FORMAT_LABELS: Record<MunicipalFormat, string> = { pdf: "PDF", xlsx: "Excel", docx: "Word", xls: "Excel旧", doc: "Word旧" };

/** ファイルの形（取り込みの File の type）。旧形式は取り込まない */
export const FORMAT_MIME: Record<MunicipalFormat, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  doc: "application/msword",
};

export const MUNICIPAL_LABELS = {
  title: "地域選択",
  pref: "都道府県",
  city: "市町村",
  form: "様式",
  search: "検索",
  format: "形式",
  pages: "頁",
  version: "版",
  terms: "条件",
  state: "状態",
  fetch: "取得",
  fetching: "取得中",
  versionChanged: "版違い",
  retry: "再読",
  shared: "共有済",
  aiRead: "AI読取",
  imported: "取込済",
  open: "表示",
  officialPage: "公式頁",
  noHit: "該当なし",
  unselected: "未選択",
  skipped: "未収録",
  builtin: "内蔵",
  legacy: "旧形式",
  permission: "許諾要",
} as const;

export const BLOCK_LABELS: Record<MunicipalBlock, string> = {
  builtin: MUNICIPAL_LABELS.builtin,
  legacy: MUNICIPAL_LABELS.legacy,
  permission: MUNICIPAL_LABELS.permission,
};

/** サーバーが公式の URL から取る道（GET。?accept=1 は版違いでも取る） */
export const municipalSourceHref = (id: string, accept = false) => `/api/forms/municipal/${encodeURIComponent(id)}/source${accept ? "?accept=1" : ""}`;

/** 取り込みの File の名前（URL の最後の名前。読めなければ id と形式） */
export function municipalFileName(e: MunicipalEntry): string {
  let last = "";
  try {
    last = decodeURIComponent(new URL(e.form.url).pathname.split("/").pop() ?? "");
  } catch {
    last = "";
  }
  return /\.[a-z]{3,4}$/i.test(last) ? last : `${e.form.id}.${e.form.format}`;
}
