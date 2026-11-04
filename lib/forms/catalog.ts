// 書類の一覧（T47 の 3）。ケア72 が出す書類と、計画書に使える様式を 1 か所に持つ。
// 本人のページの書類の行（lib/person.ts の documentBlocks）、紙面の画面の上の帯（components/forms/FormAbout.tsx）、
// 事業所の「使う様式」（components/office/FormChoice.tsx）、README の「書類」の節が、ここの言葉を使う
// （README は手で書き、lib/forms/catalog.test.ts が正式な名前と版の一致を見る）。
// 書類の id は本人の範囲の書類の id（lib/consent/scope.ts の ScopeDocument と DOCUMENT_LABELS）と、計画書の様式の id。
// lib/person.ts も読むので、様式の部品（matsuyama.ts・form9.ts。lib/person.ts を読む）は読まない。版・題・リンクは
// ここに字で持ち、lib/forms/catalog.test.ts がそれぞれの元（MATSUYAMA_FORM_VERSION・FORM9_TITLE ほか）と同じかを見る。

import { CAO_GUIDELINE_PAGES, CAO_GUIDELINE_URL } from "./cao-form.fixture.ts";

const MATSUYAMA_FORM_URL =
  "https://www.city.matsuyama.ehime.jp/kurashi/fukushi/shogai/hinankodo/kobetsuhinannkeikaku.files/R8.9.10keikaku.pdf";
const MATSUYAMA_FORM_VERSION = "2026.9.10";
const FORM9_TITLE = "様式9：災害時利用者一覧表 (安否確認優先順位)";

export type CatalogEntry = {
  id: string;
  /** 正式な名前（元の様式の題。ケア72 の様式は書類の名前） */
  official: string;
  /** 短い名前（画面の行の名前） */
  short: string;
  /** 何の書類か（1 文） */
  what: string;
  /** 誰が誰に出す */
  who: string;
  /** 誰が誰に出すの短い形（画面の注。「本人・家族 → 市」） */
  route: string;
  /** いつ使う */
  when: string;
  /** 出典と版。ケア72 の様式は「ケア72 の様式」 */
  source: string;
  /** 版の短い形（画面の注。「松山市 様式【2026.9.10】」・「ケア72 独自」） */
  version: string;
  /** 元の様式（リンクだけ。リポジトリに入れない） */
  url?: string;
};

/** 計画書に使える様式の id。matsuyama と cao はコードに持つ様式、mapping:<id> は事業所が確かめた対応表 */
export type PlanFormId = "matsuyama" | "cao" | `mapping:${string}`;

export const MATSUYAMA_ENTRY: CatalogEntry = {
  id: "matsuyama",
  official: "松山市避難行動要支援者名簿登録申込書 兼 個別避難計画",
  short: "計画書（松山市）",
  what: "避難支援に要る本人・支援者・避難先・医療の情報をまとめた計画。市の名簿への登録の申込を兼ねる",
  who: "本人・家族が市へ出す（作るのはケアマネ）",
  route: "本人・家族 → 市",
  when: "平時。計画を作ったとき・変わったとき",
  source: `松山市 様式【${MATSUYAMA_FORM_VERSION}】`,
  version: `松山市 様式【${MATSUYAMA_FORM_VERSION}】`,
  url: MATSUYAMA_FORM_URL,
};

export const CAO_ENTRY: CatalogEntry = {
  id: "cao",
  official: "個別避難計画（様式例）",
  short: "計画書（内閣府）",
  what: "国の取組指針の様式例。市町村の様式の元になっている形",
  who: "本人・家族が市町村へ出す（市町村の様式があればそちら）",
  route: "本人・家族 → 市町村",
  when: "平時。松山市以外で、市町村の様式がまだ無いとき",
  // 欄の対応表は T08 で手で起こした物（lib/forms/cao-form.fixture.ts）。T47 では元の PDF を開けず、欄の照合はまだ（docs/progress/t47.md の問い）
  source: `内閣府 避難行動要支援者の避難行動支援に関する取組指針（令和7年6月更新）${CAO_GUIDELINE_PAGES}・対応表は手作成で未照合`,
  version: "内閣府 取組指針 令和7年6月更新・対応表 未照合",
  url: CAO_GUIDELINE_URL,
};

/** ケア72 が出す書類（本人のページの書類の行の順） */
export const DOCUMENT_CATALOG = {
  matsuyama: MATSUYAMA_ENTRY,
  medical: {
    id: "medical",
    official: "医療要約（災害診療記録2018 の基本情報の順）",
    short: "医療要約",
    what: "本人のページの医療の記録を、避難所の医療班が災害診療記録2018 に写せる順に並べた 1 枚",
    who: "ケアマネが医療班・主治医へ渡す（医療班への提供に同意がある人だけ）",
    route: "ケアマネ → 医療班・主治医",
    when: "発災後。避難所・救護所で",
    source: "災害診療記録2018（一般診療版）の欄の順",
    version: "災害診療記録2018 の順",
  },
  own: {
    id: "own",
    official: "本人の1枚",
    short: "本人の1枚",
    what: "本人・家族が読む、やさしい日本語の 1 枚（誰が来る・どこへ逃げる・何を持つ）。裏に医療要約と QR",
    who: "ケアマネが本人・家族・支援者へ渡す",
    route: "ケアマネ → 本人・家族・支援者",
    when: "平時に渡し、玄関などに貼る",
    source: "ケア72 の様式（元の様式なし）",
    version: "ケア72 独自",
  },
  qr: {
    id: "qr",
    official: "医療要約の QR",
    short: "QR",
    what: "医療班がスマホで読む QR。医療要約の画面が開く（期限つき）",
    who: "ケアマネが本人の1枚の裏に刷る",
    route: "ケアマネ → 医療班",
    when: "発災後。医療班が読む",
    source: "ケア72 の様式（元の様式なし）",
    version: "ケア72 独自",
  },
  phone: {
    id: "phone",
    official: "本人・家族のスマホ入口",
    short: "スマホ入口",
    what: "本人・家族が自分のスマホで安否のボタンを開くリンクと QR（期限 180 日、再発行で前の物は無効）",
    who: "ケアマネが本人・家族・支援者へ渡す（紙・LINE などの渡し方は事業所が決める）",
    route: "ケアマネ → 本人・家族・支援者",
    when: "平時に渡し、発災時に本人・家族が開く",
    source: "ケア72 の様式（元の様式なし）",
    version: "ケア72 独自",
  },
  form9: {
    id: "form9",
    official: FORM9_TITLE,
    short: "様式9",
    what: "事業所の利用者を安否確認の順に並べた一覧。発災時は市町村への報告の下書きも",
    who: "事業所の管理者が使い、市町村へ報告する",
    route: "事業所 → 市町村",
    when: "平時に作り、発災時に安否確認の順に",
    source: "厚生労働省 介護施設・事業所の自然災害 BCP ひな形 様式9",
    version: "厚労省 BCP ひな形 様式9",
  },
} as const satisfies Record<string, CatalogEntry>;

/** 事業所が確かめた対応表の様式（T08）。題と発行元は対応表から */
export function mappingEntry(m: { id: string; title: string; issuer: string; checkedAt: string | null }): CatalogEntry {
  return {
    id: `mapping:${m.id}`,
    official: m.title,
    short: `計画書（${m.issuer || "読込様式"}）`,
    what: "事業所が読み込んだ自治体の様式に、本人のページの値を欄の順で差し込んだ物",
    who: "本人・家族が市町村へ出す（作るのはケアマネ）",
    route: "本人・家族 → 市町村",
    when: "平時。その市町村の人の計画",
    source: `${m.issuer || "発行元 未確認"}の様式（対応表 確認済${m.checkedAt ? ` ${m.checkedAt.slice(0, 10)}` : ""}）`,
    version: `${m.issuer || "発行元 未確認"} 対応表 確認済${m.checkedAt ? ` ${m.checkedAt.slice(0, 10)}` : ""}`,
  };
}

/**
 * 書類の 1 行の小さな注の中身（正式な名前・誰が誰に出す・版。11/3 10:2x）。説明の文（what・when）は画面に出さない（T79。常設の説明文を置かない）
 * 例: ["松山市避難行動要支援者名簿登録申込書 兼 個別避難計画", "本人・家族 → 市", "松山市 様式【2026.9.10】"]
 */
export function aboutParts(e: CatalogEntry, opts: { official?: boolean } = {}): string[] {
  return opts.official === false ? [e.route, e.version] : [e.official, e.route, e.version];
}

/** 注の区切り（名前に「・」が入るので別の字） */
export const ABOUT_SEPARATOR = " ／ ";

/** 書類の 1 行の小さな注（例:「松山市避難行動要支援者名簿登録申込書 兼 個別避難計画 ／ 本人・家族 → 市 ／ 松山市 様式【2026.9.10】」） */
export function aboutLine(e: CatalogEntry): string {
  return aboutParts(e).join(ABOUT_SEPARATOR);
}
