// 発災からの時間ごとの起きやすさの目安（T104）。監督（lib/drill/director.ts の sceneText）と世界（lib/drill/world-oneshot.ts の tickText）に、
// 今の時刻の帯の行だけを「目安」として渡す。Claude を呼ばない。
//
// - 帯は 0〜3・3〜12・12〜24・24〜72 時間。72 時間ちょうどは最後の帯
// - 行の数字は出典の登録簿（lib/sources）の文書の本文にある物だけ。どの行にも出典の id を 1 つ以上付ける
// - kinds は出来事の表（lib/drill/event-catalog.ts）の種類で、その帯に起きやすい物の目安。監督に選ばせる種類を絞らない
//   （差し込める種類は今までどおり台帳と世界で決まる）。時刻は幅を持たせ、決めつけない
// - 体の具合・生き死に・薬の量を書かない。色・順位に使わない
// - 輪にしない: event-catalog.ts・sources を型だけ読む

import type { SourceId } from "../sources/index.ts";
import type { InjectKind } from "./event-catalog.ts";

export const TIME_BANDS = [
  { id: "h0", from: 0, to: 3 },
  { id: "h3", from: 3, to: 12 },
  { id: "h12", from: 12, to: 24 },
  { id: "h24", from: 24, to: 72 },
] as const;
export type TimeBand = (typeof TIME_BANDS)[number];
export type TimeBandId = TimeBand["id"];

/** 目安の 1 行。text は Claude に渡す文（画面の言葉ではない） */
export type TimeLine = {
  text: string;
  /** この帯に起きやすい出来事の表の種類（目安。空なら種類に結び付けない） */
  kinds: ReadonlyArray<InjectKind>;
  /** 出典の登録簿の id（1 つ以上） */
  sources: ReadonlyArray<SourceId>;
};

/** 帯ごとの目安（数字は出典の本文の物だけ） */
export const TIMELINE: Readonly<Record<TimeBandId, ReadonlyArray<TimeLine>>> = {
  h0: [
    {
      text: "停電が始まる。広い範囲の停電では、全域で約 11 時間止まった例がある（北海道の地震）",
      kinds: ["outage_spread"],
      sources: ["soumu-iburi-2019"],
    },
    {
      text: "停電で在宅酸素の濃縮器・人工呼吸器・吸引器は電池やボンベに切り替わり、その残りの時間が減り始める",
      kinds: [],
      sources: ["nanbyo-shishin-2017"],
    },
    {
      text: "避難所は初動（発災当日）。備蓄の毛布を配るほどの段階",
      kinds: [],
      sources: ["cao-hinanjo-2016"],
    },
    {
      text: "福祉避難所は、支援者の到着が間に合わないなどで初日に開かないことがある",
      kinds: [],
      sources: ["cao-fukushi-2021"],
    },
  ],
  h3: [
    {
      text: "停電が長引くと、携帯の基地局の予備電源が尽きて止まる局が増えていく（北海道の地震では発災の日の夜に最大約 6,500 局）",
      kinds: ["mobile_down", "outage_spread"],
      sources: ["soumu-iburi-2019"],
    },
    {
      text: "固定電話の回線にも支障が出る（北海道の地震では約 14 万回線）",
      kinds: ["line_down"],
      sources: ["soumu-iburi-2019"],
    },
    {
      text: "避難所はまだ発災当日の段階。福祉避難所は初日に開かないことがある",
      kinds: [],
      sources: ["cao-hinanjo-2016", "cao-fukushi-2021"],
    },
  ],
  h12: [
    {
      text: "携帯の止まる基地局が最も多くなるころ（北海道の地震では発災から約 18 時間の発表で最大）。市町村役場をカバーする基地局の停電対策は少なくとも 24 時間（義務）",
      kinds: ["mobile_down"],
      sources: ["soumu-iburi-2019", "soumu-tsushin-2026"],
    },
    {
      text: "断水が続く（熊本の地震では最大約 44.6 万戸）",
      kinds: ["water_station"],
      sources: ["mhlw-water-2016"],
    },
    {
      text: "透析は断水・停電・施設の被害でできなくなることがある。次の透析の日が近い人の透析先の様子を確かめる時期",
      kinds: ["dialysis_flooded", "hospital_closed"],
      sources: ["jadp-dialysis-2023"],
    },
    {
      text: "福祉避難所は初日に間に合わなければ、そのあとに開く",
      kinds: ["welfare_shelter_open"],
      sources: ["cao-fukushi-2021"],
    },
  ],
  h24: [
    {
      text: "停電の解消が進む（北海道の地震では約 30 時間後に 5 割、約 64 時間後に電力会社の復旧の宣言）。一部の地域は長く続く",
      kinds: ["outage_eta"],
      sources: ["soumu-iburi-2019"],
    },
    {
      text: "断水は 72 時間のうちには戻らないことが多い（過去の主な地震と大雨の最大断水日数はどれも 3 日以上）",
      kinds: ["water_station"],
      sources: ["mhlw-water-2016"],
    },
    {
      text: "避難所は応急期（3 日目まで）。床にマットや段ボールを敷く段階で、簡易ベッドは 4 日目以降",
      kinds: [],
      sources: ["cao-hinanjo-2016"],
    },
    {
      text: "行政の支援が始まる目安は被災後 3 日目。それまでは事業所と家の備えで持ちこたえる",
      kinds: [],
      sources: ["mhlw-bcp-2020"],
    },
    {
      text: "中断できない薬と栄養剤は 1 週間分ほどの備えが勧められている。手元の残りが少ない人の薬の手配が要る時期",
      kinds: ["pharmacy_closed"],
      sources: ["nanbyo-shishin-2017"],
    },
    {
      text: "透析の次の回が来る人は、透析先の様子と受け入れ先を確かめる",
      kinds: ["dialysis_flooded", "hospital_closed"],
      sources: ["jadp-dialysis-2023"],
    },
  ],
};

/** 発災からの時間の帯（負は最初の帯、72 時間以上は最後の帯） */
export function bandOf(hour: number): TimeBand {
  const h = Number.isFinite(hour) ? Math.max(0, hour) : 0;
  return TIME_BANDS.find((b) => h < b.to) ?? TIME_BANDS[TIME_BANDS.length - 1];
}

/** 帯の言い方（「発災から 3〜12 時間」） */
export function bandWords(b: TimeBand): string {
  return `発災から ${b.from}〜${b.to} 時間`;
}

/** 目安の行の出典の全部（重ねない。監督の根拠の一覧 DIRECTOR_SOURCES に入れる物） */
export const TIMELINE_SOURCES: ReadonlyArray<SourceId> = [...new Set(Object.values(TIMELINE).flatMap((ls) => ls.flatMap((l) => l.sources)))];

/**
 * 今の時刻の帯の目安の文。監督は種類と根拠の id を添え（with: "director"）、世界は文だけ（with: "world"。世界の部屋の
 * 種類は出来事の表と違い、根拠の一覧も渡していないため）
 */
export function timelineText(hour: number, opts: { with: "director" | "world" }): string {
  const b = bandOf(hour);
  const lines = TIMELINE[b.id].map((l) => {
    if (opts.with === "world") return `- ${l.text}`;
    const kinds = l.kinds.length > 0 ? `種類: ${l.kinds.join("、")}。` : "";
    return `- ${l.text}（${kinds}出典: ${l.sources.join("、")}）`;
  });
  return [`この時間帯（${bandWords(b)}）に起きやすい事（公的な資料からの目安。決めつけない。時刻は前後してよい）:`, ...lines].join("\n");
}

// ---------- 起きやすい物と起きにくい物（T121） ----------
// 評価の 1 回目で、同じ想定の回どうしの出来事が似て（薬局の休止・回線の不通がほとんどの回に出る）、時間帯の目安の外に出やすかった。
// 表に行を足して直さず、監督と世界に「この時間帯に起きやすい物・起きにくい物」と「この訓練の傾向」を渡して自由さで直す。
// 傾向は訓練ごとの種（開始の時刻と想定。再生で同じ）から揺らす。決めつけない（起きにくい物も、筋が通れば使ってよい）。

/** 起きやすさを揺らす種類（訓練する人〔自分〕の種類は外す。主役は担当の人） */
const LEANING_KINDS: ReadonlyArray<InjectKind> = [
  "supply_left",
  "dialysis_flooded",
  "road_blocked",
  "line_down",
  "nurse_away",
  "going_home",
  "outage_eta",
  "outage_spread",
  "mobile_down",
  "road_reopen",
  "welfare_shelter_open",
  "shelter_full",
  "water_station",
  "pharmacy_closed",
  "helper_closed",
  "nurse_station_closed",
  "hospital_closed",
  "vendor_round",
  "family_stranded",
  "car_sleep",
  "no_fridge",
  "neighbor_help",
  "info_confusion",
  "aftershock",
  "landslide_warn",
  "wandering",
];

/** 種の文字から 32 bit の数（FNV-1a） */
export function seedNumber(seed: string): number {
  let h = 0x811c9dc5;
  for (const ch of seed) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 種から 0 以上 1 未満の数の並び（mulberry32） */
export function seededRandom(seed: string): () => number {
  let a = seedNumber(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 種で並びを混ぜる（元は変えない） */
export function seededShuffle<T>(xs: ReadonlyArray<T>, seed: string): T[] {
  const r = seededRandom(seed);
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 訓練の種（開始の時刻と想定から。同じ訓練なら同じ、訓練ごとに違う） */
export function drillSeed(state: { startedAt: string; scenario: string }): string {
  return `${state.scenario}|${state.startedAt}`;
}

/** 種類ごとの目安の帯（TIMELINE の kinds から。どの帯にも書いていない種類は無い） */
const BANDS_OF: ReadonlyMap<InjectKind, ReadonlyArray<TimeBandId>> = (() => {
  const m = new Map<InjectKind, TimeBandId[]>();
  for (const [band, lines] of Object.entries(TIMELINE) as Array<[TimeBandId, ReadonlyArray<TimeLine>]>) {
    for (const l of lines) for (const k of l.kinds) m.set(k, [...new Set([...(m.get(k) ?? []), band])]);
  }
  return m;
})();

/** この訓練で起きやすい種類と起きにくい種類（種から 3 つずつ。帯の目安とは別に、訓練ごとの流れの違い） */
export function drillLeanings(seed: string): { more: InjectKind[]; less: InjectKind[] } {
  const xs = seededShuffle(LEANING_KINDS, `${seed}|leaning`);
  return { more: xs.slice(0, 3), less: xs.slice(3, 6) };
}

export type OddsLines = {
  /** この時間帯に起きやすい種類（帯の目安。と、この訓練で起きやすい種類） */
  likely: InjectKind[];
  /** この時間帯に起きにくい種類（目安では別の帯の種類。と、この訓練で起きにくい種類） */
  unlikely: InjectKind[];
};

/** 今の帯とこの訓練の種から、起きやすい・起きにくい種類（重ねない。起きやすい方が先） */
export function oddsOf(hour: number, seed: string | null | undefined): OddsLines {
  const band = bandOf(hour).id;
  const listed = [...BANDS_OF.entries()];
  const inBand = listed.filter(([, bs]) => bs.includes(band)).map(([k]) => k);
  const outBand = listed.filter(([, bs]) => !bs.includes(band)).map(([k]) => k);
  const lean = seed ? drillLeanings(seed) : { more: [], less: [] };
  // 訓練の傾向は帯の目安を越えない（帯の外の種類は、この訓練で起きやすくても起きにくい側のまま）
  const unlikely = [...new Set([...outBand, ...lean.less])];
  const likely = [...new Set([...inBand, ...lean.more])].filter((k) => !unlikely.includes(k));
  return { likely, unlikely };
}

/**
 * 監督・世界に渡す起きやすさの文。監督は種類の英字、世界は words（種類 → 言葉。出来事の表の印）の言葉で。
 * 決めつけない（起きにくい物も、筋が通れば使ってよい。使うなら時刻をずらす）
 */
export function oddsText(hour: number, seed: string | null | undefined, words?: (k: InjectKind) => string): string {
  const o = oddsOf(hour, seed);
  const say = (ks: ReadonlyArray<InjectKind>) => (ks.length > 0 ? ks.map((k) => (words ? words(k) : k)).join("、") : "なし");
  return [
    "起きやすさ（目安。この時間帯と、この訓練の傾向。訓練ごとに変わる）:",
    `- 起きやすい: ${say(o.likely)}`,
    `- 起きにくい（使うなら筋が通るときだけ、1 回まで）: ${say(o.unlikely)}`,
  ].join("\n");
}
