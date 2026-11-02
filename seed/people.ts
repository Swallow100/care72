// デモ事業所の種のデータ。docs/SPEC.md の「架空の 10 人（骨子、11/2）」から起こした。
// 全員架空で、実在の人・事業所と関係ない。町名は架空、番地は付けない。電話は 090-0000-00NN で、かけない。
// 11 人目（台帳に無い人）は医療班がその場で作る筋なので、ここには入れない。

import { CONSENT_KINDS } from "../lib/db/types.ts";
import type {
  AccountRow,
  ClockRow,
  ConsentKind,
  ConsentRow,
  ContactRow,
  Ledger,
  OfficeRow,
  PersonRow,
} from "../lib/db/types.ts";

/** 種を入れた時刻（2026-11-02 12:00 JST） */
export const SEED_AT = "2026-11-02T03:00:00.000Z";

export const CITY = "松山市";

export type SeedOffice = Omit<OfficeRow, "created_at">;
export type SeedAccount = Omit<AccountRow, "created_at">;
export type SeedContact = Omit<ContactRow, "person_id" | "created_at" | "sort">;
export type SeedClock = Omit<ClockRow, "person_id" | "sort">;
export type SeedPerson = {
  person: Omit<PersonRow, "ledger" | "version" | "created_at" | "updated_at">;
  ledger: Ledger;
  contacts: SeedContact[];
  /** 書いていない同意は「同意あり」 */
  refusedConsents: Array<{ kind: ConsentKind; note: string }>;
  clocks: SeedClock[];
};

export const SEED_OFFICES: SeedOffice[] = [
  { id: "office-demo", name: "デモ事業所", kind: "demo", city: CITY },
];

export const SEED_ACCOUNTS: SeedAccount[] = [
  {
    id: "acct-yamamoto",
    office_id: "office-demo",
    role: "care_manager",
    is_office_admin: 1,
    display_name: "山本",
    login_id: null,
    password_hash: null,
  },
];

const OFFICE = "office-demo";
const CM = "acct-yamamoto";

function phone(n: number): string {
  return `090-0000-00${String(n).padStart(2, "0")}`;
}

/** 連絡先の既定。書いた所だけ上書きする */
function contact(c: Partial<SeedContact> & Pick<SeedContact, "id" | "kind">): SeedContact {
  return {
    relation: null,
    name: null,
    phone: null,
    reach: null,
    emergency_order: null,
    supporter_order: null,
    night_ok: null,
    has_car: null,
    has_smartphone: null,
    note: null,
    ...c,
  };
}

/** 時計の既定。値のある時計は確かめ済みにしておく */
function clock(c: Partial<SeedClock> & Pick<SeedClock, "id" | "kind" | "category" | "label" | "starts_on">): SeedClock {
  return {
    value: null,
    unit: null,
    source: null,
    source_note: null,
    confirmed_at: c.value == null ? null : SEED_AT,
    note: null,
    ...c,
  };
}

const emptyMedical = (): Ledger["medical"] => ({ devices: [], medications: [] });

export const SEED_PEOPLE: SeedPerson[] = [
  // 1 動画の主役。計画のデモで空欄を埋める。大雨: 赤 → 録音にうめき声。地震: 停電で酸素の時計が走る
  {
    person: {
      id: "p-01",
      office_id: OFFICE,
      care_manager_id: CM,
      name: "山田 ハナ",
      kana: "ヤマダ ハナ",
      birth_date: "1942-04-18",
      plan_status: "draft",
      origin: "care_manager",
    },
    ledger: {
      basic: {
        sex: "female",
        address: { city: CITY, town: "かわなぎ町" },
        housing: { floor: 1, floors: 2, structure: "wood" },
        household: "alone",
        contactMeans: { landline: true, smartphone: "none" },
      },
      care: {
        careLevel: "care3",
        walking: "some",
        hearing: "ok",
        vision: "ok",
        understanding: "ok",
        judgment: "ok",
        orientation: "ok",
        bedridden: false,
        dementia: false,
      },
      medical: {
        devices: [{ kind: "oxygen", detail: "酸素濃縮器 1 L/分" }],
        medications: [
          { name: "ワーファリン", category: "anticoagulant", schedule: "1 日 1 回", interruptionRisk: true },
        ],
      },
      evacuation: {
        hazards: [{ kind: "flood", depthM: 3 }],
        destination1: "かわなぎ小学校",
        transport: "娘の車",
        carryItems: ["予備ボンベ", "薬", "お薬手帳"],
      },
      notes: ["薬は 2 階の箪笥"],
      pending: [
        { field: "medical.medications.warfarin.remaining", status: "unknown" },
        { field: "people.night_supporter", status: "not_asked" },
        { field: "evacuation.destination2", status: "unknown" },
      ],
    },
    contacts: [
      contact({ id: "c-01-0", kind: "self", phone: phone(1), note: "固定電話" }),
      contact({
        id: "c-01-1",
        kind: "family",
        relation: "娘",
        name: "森 恵子",
        phone: phone(11),
        reach: "in_city",
        emergency_order: 1,
        supporter_order: 1,
        has_car: 1,
        has_smartphone: 1,
      }),
      contact({
        id: "c-01-2",
        kind: "supporter",
        relation: "隣人",
        name: "木村 ヨシ",
        phone: phone(12),
        reach: "nearby",
        emergency_order: 2,
        supporter_order: 2,
        has_car: 0,
        has_smartphone: 0,
        note: "82 歳",
      }),
    ],
    refusedConsents: [],
    clocks: [
      clock({
        id: "k-01-1",
        kind: "device",
        category: "oxygen",
        label: "酸素 内蔵電池",
        value: 2,
        unit: "hour",
        starts_on: "outage",
        source: "device_manual",
      }),
      clock({
        id: "k-01-2",
        kind: "supply",
        category: "oxygen",
        label: "酸素 予備ボンベ",
        value: 8,
        unit: "hour",
        starts_on: "outage",
        source: "device_manual",
      }),
      clock({
        id: "k-01-3",
        kind: "medication",
        category: "anticoagulant",
        label: "ワーファリン",
        starts_on: "disaster",
        note: "残りの日数は未確認",
      }),
    ],
  },

  // 2 未知のまま電池の時計で赤に上がる。訓練: 訪問看護に出向いてもらうのが正解の手、行き先は病院
  {
    person: {
      id: "p-02",
      office_id: OFFICE,
      care_manager_id: CM,
      name: "小林 トシ",
      kana: "コバヤシ トシ",
      birth_date: "1940-02-09",
      plan_status: "trained",
      origin: "care_manager",
    },
    ledger: {
      basic: {
        sex: "female",
        address: { city: CITY, town: "かわなぎ町" },
        housing: { floor: 1, floors: 2, structure: "wood" },
        household: "with_spouse",
        contactMeans: { landline: true, smartphone: "none" },
      },
      care: { careLevel: "care3", walking: "hard", bedridden: true, dementia: false },
      medical: {
        devices: [
          { kind: "ventilator", detail: "気管切開" },
          { kind: "suction", schedule: "1 日 6 回" },
        ],
        medications: [],
      },
      evacuation: {
        hazards: [{ kind: "flood", depthM: 3 }],
        destination1: "かわなぎ総合病院",
        transport: "訪問看護と夫",
        carryItems: ["吸引器", "予備の回路", "バッテリー"],
      },
      notes: [],
      pending: [],
    },
    contacts: [
      contact({ id: "c-02-0", kind: "self", phone: phone(2), note: "固定電話" }),
      contact({
        id: "c-02-1",
        kind: "family",
        relation: "夫",
        name: "小林 健一",
        phone: phone(13),
        reach: "together",
        emergency_order: 1,
        supporter_order: 1,
        night_ok: 1,
        has_car: 1,
        has_smartphone: 1,
      }),
      contact({
        id: "c-02-2",
        kind: "visiting_nurse",
        name: "かわなぎ訪問看護",
        phone: phone(14),
        reach: "in_city",
        emergency_order: 2,
        supporter_order: 2,
      }),
    ],
    refusedConsents: [],
    clocks: [
      clock({
        id: "k-02-1",
        kind: "device",
        category: "ventilator",
        label: "人工呼吸器 内蔵電池",
        value: 3,
        unit: "hour",
        starts_on: "outage",
        source: "device_manual",
      }),
    ],
  },

  // 3 緑だが透析先が未確認で黄（表とのずれは docs/PROGRESS.md）。訓練: 透析施設が浸水 → 別の施設を探す
  {
    person: {
      id: "p-03",
      office_id: OFFICE,
      care_manager_id: CM,
      name: "田中 茂",
      kana: "タナカ シゲル",
      birth_date: "1947-06-21",
      plan_status: "consented",
      origin: "care_manager",
    },
    ledger: {
      basic: {
        sex: "male",
        address: { city: CITY, town: "みずほし町" },
        housing: { floor: 2, floors: 2, structure: "wood" },
        household: "with_spouse",
        contactMeans: { landline: true, smartphone: "none" },
      },
      care: { careLevel: "care2", walking: "some", bedridden: false, dementia: false },
      medical: {
        devices: [{ kind: "dialysis", detail: "血液透析", schedule: "月水金" }],
        medications: [],
      },
      evacuation: {
        hazards: [{ kind: "flood", depthM: 0.5 }],
        destination1: "みずほし公民館",
        transport: "長男の車",
        carryItems: ["透析手帳", "薬"],
      },
      notes: [],
      pending: [],
    },
    contacts: [
      contact({ id: "c-03-0", kind: "self", phone: phone(3), note: "固定電話" }),
      contact({
        id: "c-03-1",
        kind: "family",
        relation: "妻",
        name: "田中 和子",
        phone: phone(15),
        reach: "together",
        emergency_order: 1,
        supporter_order: 1,
        night_ok: 1,
        has_car: 0,
        has_smartphone: 1,
      }),
      contact({
        id: "c-03-2",
        kind: "family",
        relation: "長男",
        name: "田中 浩",
        phone: phone(16),
        reach: "in_city",
        emergency_order: 2,
        supporter_order: 2,
        has_car: 1,
        has_smartphone: 1,
      }),
      contact({
        id: "c-03-3",
        kind: "family",
        relation: "長女",
        name: "岡田 由美",
        phone: phone(17),
        reach: "out_of_pref",
        emergency_order: 3,
        has_smartphone: 1,
      }),
      contact({
        id: "c-03-4",
        kind: "dialysis_center",
        name: "みずほし透析クリニック",
        phone: phone(18),
        reach: "in_city",
        note: "月水金の午前",
      }),
    ],
    refusedConsents: [],
    clocks: [
      clock({
        id: "k-03-1",
        kind: "supply",
        category: "dialysis",
        label: "透析 次の回まで",
        value: 2,
        unit: "day",
        starts_on: "disaster",
        source: "facility",
      }),
    ],
  },

  // 4 認知症で本人の信号が当てにならない。未知。民生委員に電話して確かめる
  {
    person: {
      id: "p-04",
      office_id: OFFICE,
      care_manager_id: CM,
      name: "佐藤 キミ",
      kana: "サトウ キミ",
      birth_date: "1938-03-05",
      plan_status: "none",
      origin: "care_manager",
    },
    ledger: {
      basic: {
        sex: "female",
        address: { city: CITY, town: "くぬぎ谷町" },
        housing: { floor: 1, floors: 1, structure: "wood" },
        household: "alone",
        contactMeans: { landline: true, smartphone: "none" },
      },
      care: {
        careLevel: "care2",
        walking: "ok",
        understanding: "some",
        judgment: "hard",
        orientation: "hard",
        bedridden: false,
        dementia: true,
      },
      medical: {
        devices: [],
        medications: [{ name: "抗認知症薬", category: "other", schedule: "1 日 1 回" }],
      },
      evacuation: { hazards: [{ kind: "landslide" }] },
      notes: [],
      pending: [],
    },
    contacts: [
      contact({ id: "c-04-0", kind: "self", phone: phone(4), note: "固定電話" }),
      contact({
        id: "c-04-1",
        kind: "welfare_commissioner",
        name: "清水 正子",
        phone: phone(19),
        reach: "nearby",
        emergency_order: 1,
        supporter_order: 1,
      }),
      contact({
        id: "c-04-2",
        kind: "family",
        relation: "息子",
        name: "佐藤 隆",
        phone: phone(20),
        reach: "out_of_pref",
        emergency_order: 2,
        has_smartphone: 1,
      }),
    ],
    refusedConsents: [],
    clocks: [
      clock({
        id: "k-04-1",
        kind: "condition",
        category: "dementia",
        label: "認知症 本人の信号が当てにならない",
        starts_on: "none",
        source: "care_manager",
        confirmed_at: SEED_AT,
      }),
    ],
  },

  // 5 灰だが支援者なしで次に上がる。訓練: 自分が出向く → 道路が通れない → 福祉避難所に依頼
  {
    person: {
      id: "p-05",
      office_id: OFFICE,
      care_manager_id: CM,
      name: "伊藤 フミ",
      kana: "イトウ フミ",
      birth_date: "1937-01-27",
      plan_status: "none",
      origin: "care_manager",
    },
    ledger: {
      basic: {
        sex: "female",
        address: { city: CITY, town: "みずほし町" },
        housing: { floor: 2, floors: 2, structure: "wood" },
        household: "alone",
        contactMeans: { landline: true, smartphone: "none" },
      },
      care: { careLevel: "care4", walking: "hard", bedridden: true, dementia: false },
      medical: {
        devices: [],
        medications: [{ name: "ステロイド", category: "steroid", schedule: "1 日 1 回", interruptionRisk: true }],
      },
      evacuation: { hazards: [{ kind: "flood", depthM: 0.5 }] },
      notes: [],
      pending: [],
    },
    contacts: [
      contact({ id: "c-05-0", kind: "self", phone: phone(5), note: "固定電話" }),
      contact({
        id: "c-05-1",
        kind: "family",
        relation: "甥",
        name: "伊藤 拓也",
        phone: phone(21),
        reach: "far",
        emergency_order: 1,
        has_smartphone: 1,
      }),
    ],
    refusedConsents: [],
    clocks: [
      clock({
        id: "k-05-1",
        kind: "medication",
        category: "steroid",
        label: "ステロイド",
        value: 5,
        unit: "day",
        starts_on: "disaster",
        source: "pharmacy",
      }),
    ],
  },

  // 6 家族が緑。訓練: 栄養剤を持ち出し忘れた出来事が途中で来る
  {
    person: {
      id: "p-06",
      office_id: OFFICE,
      care_manager_id: CM,
      name: "高橋 ユキ",
      kana: "タカハシ ユキ",
      birth_date: "1935-07-30",
      plan_status: "consented",
      origin: "care_manager",
    },
    ledger: {
      basic: {
        sex: "female",
        address: { city: CITY, town: "あしなみ町" },
        housing: { floor: 1, floors: 2, structure: "wood" },
        household: "with_child",
        contactMeans: { landline: true, smartphone: "none" },
      },
      care: { careLevel: "care4", walking: "hard", dementia: false },
      medical: {
        devices: [{ kind: "tube_feeding", detail: "胃ろう 経管栄養" }],
        medications: [],
      },
      evacuation: {
        hazards: [{ kind: "flood", depthM: 1 }],
        destination1: "あしなみ小学校",
        transport: "娘の車",
        carryItems: ["栄養剤", "注入の道具"],
      },
      notes: [],
      pending: [],
    },
    contacts: [
      contact({ id: "c-06-0", kind: "self", phone: phone(6), note: "固定電話" }),
      contact({
        id: "c-06-1",
        kind: "family",
        relation: "娘",
        name: "高橋 美和",
        phone: phone(22),
        reach: "together",
        emergency_order: 1,
        supporter_order: 1,
        night_ok: 1,
        has_car: 1,
        has_smartphone: 1,
      }),
      contact({
        id: "c-06-2",
        kind: "family",
        relation: "息子",
        name: "高橋 修",
        phone: phone(23),
        reach: "in_city",
        emergency_order: 2,
        supporter_order: 2,
        has_car: 1,
        has_smartphone: 1,
      }),
      contact({
        id: "c-06-3",
        kind: "family",
        relation: "孫",
        name: "高橋 翔太",
        phone: phone(24),
        reach: "in_city",
        emergency_order: 3,
        has_smartphone: 1,
      }),
    ],
    refusedConsents: [],
    clocks: [
      clock({
        id: "k-06-1",
        kind: "supply",
        category: "tube_feeding",
        label: "栄養剤",
        value: 3,
        unit: "day",
        starts_on: "disaster",
        source: "family",
      }),
    ],
  },

  // 7 灰のまま。支援者への提供に同意していない（行政の画面で住所が出ない例）。訓練: 土砂の警戒で避難を渋る
  {
    person: {
      id: "p-07",
      office_id: OFFICE,
      care_manager_id: CM,
      name: "加藤 正",
      kana: "カトウ タダシ",
      birth_date: "1948-09-14",
      plan_status: "draft",
      origin: "care_manager",
    },
    ledger: {
      basic: {
        sex: "male",
        address: { city: CITY, town: "くぬぎ谷町" },
        housing: { floor: 1, floors: 1, structure: "wood" },
        household: "alone",
        contactMeans: { mobile: true, smartphone: "uses" },
      },
      care: { careLevel: "care2", walking: "some", bedridden: false, dementia: false },
      medical: {
        devices: [],
        medications: [
          { name: "抗凝固薬（DOAC）", category: "anticoagulant", schedule: "1 日 2 回", interruptionRisk: true },
        ],
      },
      evacuation: { hazards: [{ kind: "landslide" }], destination1: "くぬぎ谷集会所" },
      notes: [],
      pending: [{ field: "people.night_supporter", status: "not_asked" }],
    },
    contacts: [
      contact({ id: "c-07-0", kind: "self", phone: phone(7), note: "携帯" }),
      contact({
        id: "c-07-1",
        kind: "family",
        relation: "弟",
        name: "加藤 実",
        phone: phone(25),
        reach: "in_city",
        emergency_order: 1,
        supporter_order: 2,
        has_car: 1,
        has_smartphone: 1,
      }),
      contact({
        id: "c-07-2",
        kind: "welfare_commissioner",
        name: "前田 和夫",
        phone: phone(26),
        reach: "nearby",
        emergency_order: 2,
        supporter_order: 1,
      }),
    ],
    refusedConsents: [{ kind: "supporters", note: "支援者への提供に同意していない" }],
    clocks: [
      clock({
        id: "k-07-1",
        kind: "medication",
        category: "anticoagulant",
        label: "DOAC",
        value: 7,
        unit: "day",
        starts_on: "disaster",
        source: "pharmacy",
      }),
    ],
  },

  // 8 地震の主役。津波で高台の集会所へ、冷蔵が切れてインスリンの時計が走る
  {
    person: {
      id: "p-08",
      office_id: OFFICE,
      care_manager_id: CM,
      name: "井上 誠",
      kana: "イノウエ マコト",
      birth_date: "1950-05-03",
      plan_status: "trained",
      origin: "care_manager",
    },
    ledger: {
      basic: {
        sex: "male",
        address: { city: CITY, town: "うみなり町" },
        housing: { floor: 2, floors: 2, structure: "wood" },
        household: "with_child",
        contactMeans: { mobile: true, smartphone: "uses" },
      },
      care: { careLevel: "support2", walking: "ok", bedridden: false, dementia: false },
      medical: {
        devices: [],
        medications: [
          {
            name: "インスリン",
            category: "insulin",
            schedule: "朝夕",
            storage: "冷蔵庫",
            needsRefrigeration: true,
            interruptionRisk: true,
          },
        ],
      },
      evacuation: {
        hazards: [{ kind: "tsunami" }],
        destination1: "うみなり高台の集会所",
        transport: "徒歩",
        carryItems: ["インスリン", "保冷バッグ", "血糖の測定器"],
      },
      notes: [],
      pending: [],
    },
    contacts: [
      contact({ id: "c-08-0", kind: "self", phone: phone(8), note: "携帯" }),
      contact({
        id: "c-08-1",
        kind: "family",
        relation: "息子",
        name: "井上 大輔",
        phone: phone(27),
        reach: "together",
        emergency_order: 1,
        supporter_order: 1,
        night_ok: 1,
        has_car: 1,
        has_smartphone: 1,
      }),
    ],
    refusedConsents: [],
    clocks: [
      clock({
        id: "k-08-1",
        kind: "supply",
        category: "insulin",
        label: "インスリン",
        value: 4,
        unit: "day",
        starts_on: "outage",
        source: "pharmacy",
        note: "要冷蔵。停電で走る",
      }),
    ],
  },

  // 9 灰のまま。何も起きない対照。医療班への提供に同意していない
  {
    person: {
      id: "p-09",
      office_id: OFFICE,
      care_manager_id: CM,
      name: "渡辺 清",
      kana: "ワタナベ キヨシ",
      birth_date: "1944-08-11",
      plan_status: "none",
      origin: "care_manager",
    },
    ledger: {
      basic: {
        sex: "male",
        address: { city: CITY, town: "そらみ台" },
        housing: { floor: 2, floors: 2, structure: "wood" },
        household: "alone",
        contactMeans: { mobile: true, smartphone: "uses" },
      },
      care: { careLevel: "care1", walking: "ok", bedridden: false, dementia: false },
      medical: {
        devices: [],
        medications: [{ name: "降圧薬", category: "other", schedule: "1 日 1 回" }],
      },
      evacuation: { hazards: [] },
      notes: [],
      pending: [],
    },
    contacts: [
      contact({ id: "c-09-0", kind: "self", phone: phone(9), note: "携帯" }),
      contact({
        id: "c-09-1",
        kind: "family",
        relation: "娘",
        name: "石川 真理",
        phone: phone(28),
        reach: "in_city",
        emergency_order: 1,
        has_car: 1,
        has_smartphone: 1,
      }),
      contact({
        id: "c-09-2",
        kind: "supporter",
        relation: "隣人",
        name: "藤田 ミチ",
        phone: phone(29),
        reach: "nearby",
        emergency_order: 2,
        supporter_order: 1,
      }),
    ],
    refusedConsents: [{ kind: "medical", note: "医療班への提供に同意していない" }],
    clocks: [
      clock({
        id: "k-09-1",
        kind: "medication",
        category: "other",
        label: "降圧薬",
        value: 1,
        unit: "week",
        starts_on: "disaster",
        source: "pharmacy",
        note: "週単位",
      }),
    ],
  },

  // 10 緑。対照。様式 9 の一番下
  {
    person: {
      id: "p-10",
      office_id: OFFICE,
      care_manager_id: CM,
      name: "中村 勇",
      kana: "ナカムラ イサム",
      birth_date: "1946-10-02",
      plan_status: "consented",
      origin: "care_manager",
    },
    ledger: {
      basic: {
        sex: "male",
        address: { city: CITY, town: "そらみ台" },
        housing: { floor: 2, floors: 2, structure: "wood" },
        household: "with_spouse",
        contactMeans: { landline: true, smartphone: "none" },
      },
      care: { careLevel: "support1", walking: "ok", bedridden: false, dementia: false },
      medical: emptyMedical(),
      evacuation: { hazards: [], destination1: "そらみ台小学校", transport: "徒歩" },
      notes: [],
      pending: [],
    },
    contacts: [
      contact({ id: "c-10-0", kind: "self", phone: phone(10), note: "固定電話" }),
      contact({
        id: "c-10-1",
        kind: "family",
        relation: "妻",
        name: "中村 幸子",
        phone: phone(30),
        reach: "together",
        emergency_order: 1,
        supporter_order: 1,
        night_ok: 1,
        has_smartphone: 1,
      }),
    ],
    refusedConsents: [],
    clocks: [],
  },
];

/** 同意 4 つを行にする。refusedConsents に無い物は同意あり */
export function seedConsents(p: SeedPerson): ConsentRow[] {
  return CONSENT_KINDS.map((kind) => {
    const refused = p.refusedConsents.find((r) => r.kind === kind);
    return {
      person_id: p.person.id,
      kind,
      status: refused ? "refused" : "granted",
      scope: null,
      recorded_by: CM,
      recorded_at: SEED_AT,
      expires_at: null,
      note: refused?.note ?? null,
    };
  });
}
