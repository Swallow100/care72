// 本人の 1 枚（docs/tasks/T06.md）。本人・家族・支援者が玄関に貼る A4 の表の文を、台帳から定型で組む。Claude は呼ばない。
// 本人のスマホの普段の画面（T10）も同じ文を使うので、文は「段 → 行 → 言葉（ふりがな付き）」のデータで返し、
// 描き方は components の側（紙面は components/forms/OwnSheet.tsx、言葉は EasyText.tsx）。
//
// 決まり:
// - やさしい日本語: 短い文、1 行に 1 つ、否定形を使わない。漢字にはふりがな（lib/forms/easy-words.ts）
// - 載せる物: 逃げるところ（避難先と行き方）、逃げるとき（大雨と地震の両方）、来てくれる人（支援者 1・2）、
//   持っていく物（薬の名前は台帳の言葉のまま、機器、持出品、この紙）、電話（ケアマネ・家族・かかりつけ）、
//   本人の言葉（台帳の特記のまま）、命が危ないと感じたら、すぐ119番へ
// - 載せない物: 医学の説明、「なぜこの行があるか」、薬の用量・回数、時計の値（ケアマネと主治医だけが見る物）
// - 逃げるときの大雨は、ハザードのある人だけ「警戒レベル 3」（計画書 lib/forms/matsuyama.ts の risk.timing と同じ決まり）。
//   地震は、津波のある人は「揺れたら すぐ」、在宅避難の印（evacuation.stayHome）のある人は「ゆれが おさまったら、家の なかの
//   安全な ところで」と、小さな添え「あぶないときは [避難先1] へ。ケアマネから 電話が きます」（津波が先。T37）、ほかは「揺れが おさまったら」
// - 支援者提供の同意が無い人（不同意・未確認）は、来てくれる人の名前・電話を出さず「計画で 決めた 人」
// - 空いた所は「ケアマネジャーと 決めます」（否定形にしない）。台帳に無い電話（ケアマネ・かかりつけ）は手で書く線。
//   どちらも画面の上の「未確認」に数える（open）
// - 医療班提供の同意は表に効かない（裏の医療要約 T07 にだけ効く。紙面の側で buildMedicalSummary の結果を出す）

import type { ConsentKind, ConsentStatus, ContactKind, DeviceKind } from "../db/types.ts";
import { parseLedger } from "../db/ledger.ts";
import { CONTACT_KIND_LABELS } from "../labels.ts";
import type { PersonPageRows } from "../person.ts";
import { easy, kanjiWithoutRuby, nameWithKana, plainText, yomi, type Word } from "./easy-words.ts";

export type { Word } from "./easy-words.ts";

/** 段の並び（紙面の上から） */
export const OWN_BLOCKS = ["where", "when", "who", "carry", "call", "words"] as const;
export type OwnBlockId = (typeof OWN_BLOCKS)[number];

/** 段の見出し（やさしい日本語、ふりがなの書き方） */
export const OWN_BLOCK_HEADINGS: Record<OwnBlockId, string> = {
  where: "{逃|に}げる ところ",
  when: "{逃|に}げる とき",
  who: "{来|き}てくれる {人|ひと}",
  carry: "{持|も}って いく もの",
  call: "{電話|でんわ}",
  words: "{本人|ほんにん}の ことば",
};

/** 決まった文（やさしい日本語、ふりがなの書き方） */
export const OWN_PHRASES = {
  title: "の {避難|ひなん}の {紙|かみ}",
  san: "さん",
  decideWithCm: "ケアマネジャーと {決|き}めます",
  walk: "{歩|ある}いて {行|い}きます",
  go: "で {行|い}きます",
  or: "または ",
  rainHead: "{大雨|おおあめ}の とき",
  rainLevel3: "{警戒|けいかい}レベル 3 が {出|で}たら {逃|に}げます",
  quakeHead: "{地震|じしん}の とき",
  quakeTsunami: "{揺|ゆ}れたら すぐ {逃|に}げます",
  quakeAfter: "{揺|ゆ}れが おさまったら {逃|に}げます",
  // 在宅避難の人（台帳の evacuation.stayHome。docs/DECISIONS.md 11/3 04:0x の 8）。地震の行と、小さな添えの 1 行（2 つの文を「。」でつなぐ）
  quakeStay: "ゆれが おさまったら、{家|いえ}の なかの {安全|あんぜん}な ところで",
  quakeStayDangerLead: "あぶないときは ",
  quakeStayDangerTail: " へ",
  quakeStayDangerNoPlace: "あぶないときは {逃|に}げる ところへ",
  quakeStayCall: "ケアマネから {電話|でんわ}が きます",
  comesByCar: "{車|くるま}で {迎|むか}えに {来|き}ます",
  comes: "{迎|むか}えに {来|き}ます",
  night: "{夜|よる}も {来|き}ます",
  planned: "{計画|けいかく}で {決|き}めた {人|ひと}が {来|き}ます",
  medicine: "{薬|くすり}",
  thisPaper: "この {紙|かみ}",
  careManager: "ケアマネジャー",
  homeDoctor: "かかりつけの {病院|びょういん}",
  dialysis: "{透析|とうせき}の {病院|びょういん}",
  // 119 の 1 行（11/3 16:0x 確定。アドバイザーの OK 例のまま。「と感じたら」で判断が本人の側）。本人・家族のスマホと本人の 1 枚が同じ文
  emergencyLead: "{命|いのち}が {危|あぶ}ないと {感|かん}じたら、すぐ",
  emergencyNumber: "119",
  emergencyTail: "{番|ばん}へ",
} as const;

/** 119 の 1 行の文（ふりがな・分かち書きを外した形）。画面・紙のどこでもこの文で、AI の出力や話の中身で出し分けない */
export const EMERGENCY_TEXT = "命が危ないと感じたら、すぐ119番へ";

/** 119 の 1 行の言葉（119 は太く）。本人の 1 枚の紙・本人と家族のスマホが同じこれを使う（一般の案内。本人の状態の判定ではない） */
export function emergencyWords(): Word[] {
  return [
    ...easy(OWN_PHRASES.emergencyLead),
    { text: " " },
    { text: OWN_PHRASES.emergencyNumber, strong: true },
    ...easy(OWN_PHRASES.emergencyTail),
  ];
}

/** 機器の持ち物の言葉（透析は持ち物にしない。透析手帳などは持出品に） */
const DEVICE_CARRY: Partial<Record<DeviceKind, string>> = {
  oxygen: "{酸素|さんそ}の {機械|きかい}",
  ventilator: "{人工呼吸器|じんこうこきゅうき}",
  suction: "{吸引器|きゅういんき}",
  tube_feeding: "{経管栄養|けいかんえいよう}の {道具|どうぐ}",
};

/** 人の連絡先（名前に「さん」を付け、ふりがなを推し量らない）。ほかは機関の名前 */
const PERSON_KINDS: ReadonlySet<ContactKind> = new Set(["self", "family", "supporter", "welfare_commissioner"]);

// ---------- 形 ----------

/** 電話の欄。番号があれば番号、無ければ手で書く線（null） */
export type OwnPhone = { number: string | null };

export type OwnLine = {
  /** 行の名前（テスト・画面の描き分け。where.place・who.1・call.cm など） */
  key: string;
  words: Word[];
  /** 大きさ: lead は一番大きく（避難先）、sub は小さく添える（夜も来ます・または） */
  tone?: "lead" | "sub";
  /** 電話の欄のある行だけ */
  phone?: OwnPhone;
};

export type OwnBlock = { id: OwnBlockId; heading: Word[]; lines: OwnLine[] };

/**
 * 台帳から埋まらなかった所（ケアマネの画面の上に出す。紙には出さない）。
 * decide は紙に「ケアマネジャーと 決めます」と出た所（台帳に足す）、write は紙に手で書く線を出した所（台帳に欄が無い電話）
 */
export type OwnOpen = { key: string; label: string; kind: "decide" | "write" };

export type OwnSheet = {
  personId: string;
  name: string;
  /** 「山田 ハナさんの 避難の 紙」 */
  title: Word[];
  blocks: OwnBlock[];
  /** 命が危ないと感じたら、すぐ119番へ */
  emergency: Word[];
  /** 作った日（JST、YYYY-MM-DD）と事業所 */
  today: string;
  officeName: string | null;
  /** 「作った 日 2026年11月2日 デモ事業所」（紙の下に小さく） */
  made: Word[];
  /** 落とした範囲（支援者提供の同意が無い） */
  withheld: ConsentKind[];
  open: OwnOpen[];
  /** ふりがなの付かなかった漢字（読みの表に無い。人の名前は数えない） */
  noReading: string[];
};

export type OwnBuildOptions = {
  /** 作る日（JST、YYYY-MM-DD） */
  today: string;
  officeName: string | null;
};

// ---------- 組み立て ----------

type Contact = PersonPageRows["contacts"][number];

const byOrder = (key: "supporter_order" | "emergency_order") => (a: Contact, b: Contact) =>
  (a[key] ?? Number.POSITIVE_INFINITY) - (b[key] ?? Number.POSITIVE_INFINITY) || a.sort - b.sort;

/** 台帳（本人のページの行）から本人の 1 枚の文を組む */
export function buildOwnSheet(rows: PersonPageRows, opts: OwnBuildOptions): OwnSheet {
  const { person } = rows;
  const ledger = parseLedger(person.ledger);
  const { medical, evacuation } = ledger;
  const contacts = [...rows.contacts].sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));
  const consentOf = (k: ConsentKind): ConsentStatus => rows.consents.find((c) => c.kind === k)?.status ?? "unconfirmed";
  const supportersShared = consentOf("supporters") === "granted";

  const noReading: string[] = [];
  const open: OwnOpen[] = [];
  /** 台帳の値にふりがなを付け、付かなかった漢字を数える */
  const v = (text: string): Word[] => {
    const r = yomi(text);
    for (const m of r.missing) if (!noReading.includes(m)) noReading.push(m);
    return r.words;
  };
  const p = (key: keyof typeof OWN_PHRASES, strong = false) => easy(OWN_PHRASES[key], { strong });
  const sp: Word = { text: " " };
  const decide = (key: string, label: string): OwnLine => {
    open.push({ key, label, kind: "decide" });
    return { key, words: p("decideWithCm") };
  };

  /** 連絡先の呼び方: 人は「娘の 森 恵子さん」、機関は名前 */
  const who = (c: Contact): Word[] => {
    const kindLabel = CONTACT_KIND_LABELS[c.kind];
    if (!PERSON_KINDS.has(c.kind)) return v(c.name ?? kindLabel);
    const rel = c.relation ? v(c.relation) : c.kind === "family" || c.kind === "supporter" ? [] : v(kindLabel);
    if (!c.name) return rel.length > 0 ? rel : v(kindLabel);
    const name: Word[] = [{ text: c.name, name: true }, ...p("san")];
    return rel.length > 0 ? [...rel, { text: "の " }, ...name] : name;
  };

  // ---- 逃げるところ ----
  const where: OwnLine[] = [];
  if (evacuation.destination1) {
    where.push({ key: "where.place", words: v(evacuation.destination1).map((w) => ({ ...w, strong: true })), tone: "lead" });
    const transport = evacuation.transport?.trim();
    if (transport) {
      where.push({ key: "where.means", words: transport === "徒歩" ? p("walk") : [...v(transport), ...p("go")] });
    }
  } else {
    where.push(decide("where.place", "逃げるところ"));
  }
  if (evacuation.destination2) {
    where.push({ key: "where.second", words: [...p("or"), ...v(evacuation.destination2)], tone: "sub" });
  }

  // ---- 逃げるとき（大雨と地震の両方） ----
  const hazards = evacuation.hazards;
  if (hazards.length === 0) open.push({ key: "when.rain", label: "逃げるとき（大雨）", kind: "decide" });
  const tsunami = hazards.some((h) => h.kind === "tsunami");
  // 地震: 津波のある人は「揺れたら すぐ」（在宅避難の印があっても津波が先）。在宅避難の人は家の中で待ち、危ないときに避難先へ
  const stayHome = !tsunami && evacuation.stayHome === true;
  const when: OwnLine[] = [
    {
      key: "when.rain",
      words: [...p("rainHead", true), sp, ...(hazards.length > 0 ? p("rainLevel3") : p("decideWithCm"))],
    },
    {
      key: "when.quake",
      words: [...p("quakeHead", true), sp, ...(tsunami ? p("quakeTsunami") : stayHome ? p("quakeStay") : p("quakeAfter"))],
    },
  ];
  if (stayHome) {
    // 地震の行に添える 1 行は小さく（「または」「夜も 来ます」と同じ添え）。2 つの文を「。」でつなぐ。
    // 2 行に分けると、物の多い人（山田 ハナ・田中 茂の台帳に印を付けて測った）の表が 1 頁に収まらない
    const place = evacuation.destination1?.trim();
    when.push({
      key: "when.quake.stay",
      words: [
        ...(place ? [...p("quakeStayDangerLead"), ...v(place), ...p("quakeStayDangerTail")] : p("quakeStayDangerNoPlace")),
        { text: "。" },
        ...p("quakeStayCall"),
      ],
      tone: "sub",
    });
  }

  // ---- 来てくれる人（支援者 1・2） ----
  const supporters = contacts.filter((c) => c.supporter_order != null).sort(byOrder("supporter_order"));
  const comes: OwnLine[] = [];
  const shown = new Set<string>();
  if (supporters.length === 0) {
    comes.push(decide("who.none", "来てくれる人"));
  } else if (!supportersShared) {
    comes.push({ key: "who.planned", words: p("planned") });
  } else {
    for (const c of supporters) {
      shown.add(c.id);
      comes.push({
        key: `who.${c.supporter_order}`,
        words: [...who(c), { text: "が " }, ...(c.has_car === 1 ? p("comesByCar") : p("comes"))],
        phone: { number: c.phone },
      });
      if (c.night_ok === 1) comes.push({ key: `who.${c.supporter_order}.night`, words: p("night"), tone: "sub" });
    }
  }

  // ---- 持っていく物 ----
  const carry: OwnLine[] = [];
  for (const [i, m] of medical.medications.entries()) {
    const words = [...p("medicine"), sp, ...v(m.name)];
    if (m.storage) words.push({ text: "（" }, ...v(m.storage), { text: "）" });
    carry.push({ key: `carry.medication.${i}`, words });
  }
  const deviceTexts: string[] = [];
  for (const [i, d] of medical.devices.entries()) {
    const markup = DEVICE_CARRY[d.kind];
    if (!markup) continue;
    const words = easy(markup);
    deviceTexts.push(plainText(words));
    carry.push({ key: `carry.device.${i}`, words });
  }
  const items = evacuation.carryItems;
  if (items === undefined) open.push({ key: "carry.items", label: "持出品", kind: "decide" });
  const seen = new Set<string>([...medical.medications.map((m) => m.name), ...deviceTexts]);
  for (const [i, item] of (items ?? []).entries()) {
    const s = item.trim();
    // 薬の名前を上に書いた人は、持出品の「薬」を重ねない（同じ言葉も 1 回）
    if (s === "" || seen.has(s) || ((s === "薬" || s === "くすり") && medical.medications.length > 0)) continue;
    seen.add(s);
    carry.push({ key: `carry.item.${i}`, words: v(s) });
  }
  carry.push({ key: "carry.paper", words: p("thisPaper") });

  // ---- 電話（ケアマネ・家族・かかりつけ） ----
  const call: OwnLine[] = [];
  const cm: Word[] = [...p("careManager")];
  if (rows.careManagerName) cm.push(sp, { text: rows.careManagerName, name: true }, ...p("san"));
  if (opts.officeName) cm.push({ text: "（" }, ...v(opts.officeName), { text: "）" });
  call.push({ key: "call.cm", words: cm, phone: { number: null } });
  open.push({ key: "call.cm", label: "ケアマネの電話", kind: "write" });
  // 家族: 緊急連絡先の順。来てくれる人に電話を出した人は重ねない（同意の無い人の家族はここに出す。計画書の近親者と同じ）
  const family = contacts.filter((c) => c.kind === "family" && !shown.has(c.id)).sort(byOrder("emergency_order"));
  for (const c of family) call.push({ key: `call.family.${c.id}`, words: who(c), phone: { number: c.phone } });
  const doctors = contacts.filter((c) => c.kind === "home_doctor");
  if (doctors.length === 0) {
    call.push({ key: "call.doctor", words: p("homeDoctor"), phone: { number: null } });
    open.push({ key: "call.doctor", label: "かかりつけの電話", kind: "write" });
  }
  for (const c of doctors) {
    call.push({ key: `call.doctor.${c.id}`, words: [...p("homeDoctor"), sp, ...v(c.name ?? "")], phone: { number: c.phone } });
  }
  for (const c of contacts.filter((x) => x.kind === "dialysis_center")) {
    call.push({ key: `call.dialysis.${c.id}`, words: [...p("dialysis"), sp, ...v(c.name ?? "")], phone: { number: c.phone } });
  }

  // ---- 本人の言葉（特記のまま） ----
  const words: OwnLine[] = ledger.notes.filter((n) => n.trim() !== "").map((n, i) => ({ key: `words.${i}`, words: v(n) }));

  // ---- 作った日 ----
  const [y, mo, d] = opts.today.split("-").map(Number);
  const made = easy(`{作|つく}った {日|ひ} ${y}{年|ねん}${mo}{月|がつ}${d}{日|にち}`);
  if (opts.officeName) made.push(sp, ...v(opts.officeName));

  const lines: Record<OwnBlockId, OwnLine[]> = { where, when, who: comes, carry, call, words };
  const blocks: OwnBlock[] = OWN_BLOCKS.filter((id) => lines[id].length > 0).map((id) => ({
    id,
    heading: easy(OWN_BLOCK_HEADINGS[id]),
    lines: lines[id],
  }));

  return {
    personId: person.id,
    name: person.name,
    title: [...nameWithKana(person.name, person.kana), ...p("san"), ...easy(OWN_PHRASES.title)],
    blocks,
    emergency: emergencyWords(),
    today: opts.today,
    officeName: opts.officeName,
    made,
    withheld: supportersShared || supporters.length === 0 ? [] : ["supporters"],
    open,
    noReading,
  };
}

// ---------- 確かめの道具 ----------

/** 1 枚の全部の言葉（題名・段の見出し・行・119・作った日） */
export function allWords(s: OwnSheet): Word[] {
  return [
    ...s.title,
    ...s.blocks.flatMap((b) => [...b.heading, ...b.lines.flatMap((l) => l.words)]),
    ...s.emergency,
    ...s.made,
  ];
}

/** 1 行の文字（ふりがなを落とす）。電話の番号は後ろに */
export function lineText(l: OwnLine): string {
  const phone = l.phone ? ` ${l.phone.number ?? "＿"}` : "";
  return `${plainText(l.words)}${phone}`;
}

/** 段の文字（テスト・画面の要約用） */
export function blockText(s: OwnSheet, id: OwnBlockId): string {
  return s.blocks.find((b) => b.id === id)?.lines.map(lineText).join(" / ") ?? "";
}

/** ふりがなの無い漢字（人の名前を除く）。紙に出す前の確かめ */
export function sheetKanjiWithoutRuby(s: OwnSheet): string[] {
  return kanjiWithoutRuby(allWords(s));
}
