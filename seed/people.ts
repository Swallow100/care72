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
  GeoPoint,
  Ledger,
  OfficeRow,
  PersonRow,
} from "../lib/db/types.ts";

/** 種を入れた時刻（2026-11-02 12:00 JST） */
export const SEED_AT = "2026-11-02T03:00:00.000Z";

export const CITY = "松山市";

/** 試用事業所の印（judge_sandbox、T115）は種に持たない（0） */
export type SeedOffice = Omit<OfficeRow, "created_at" | "judge_sandbox">;
/**
 * 停止の印（disabled_at）と審査員が足した印（judge_made、T81）は種に持たない（NULL と 0。種の戻しも戻す）。
 * 初期パスワードの印（password_initial、T114）も持たない（表の既定。種のアカウントは固定で、印は出さない）
 */
export type SeedAccount = Omit<AccountRow, "created_at" | "disabled_at" | "judge_made" | "password_initial">;
/**
 * 連絡先のフリガナ・住所・携帯（T117、migration 0029）も種に持つ（T142）。種の文は 0029 の列を書くので、0029 の前の形の D1 に種を流す
 * migration ごとのテストは 0029 を先に当てる（0029 は contacts に列を足すだけ）
 */
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

// デモ事業所は審査員・動画の物。協力事業所は協力してくれるケアマネの訓練の物で、審査員には見せない。
// 協力事業所には利用者を入れない。ケアマネ 1 人の枠だけ（名前は空。本人が入れる）。
// 様式（plan_form）は 3 つとも松山市（種は松山市。lib/forms/plan-form.ts の defaultPlanForm と同じ。種に書くので、審査員が
// /office で様式を変えても毎朝の戻しで松山市に戻る。T68）。地図の中心（T68、migration 0017）はデモ事業所だけ松山市の市街
// （lib/map/center.ts の DEFAULT_CENTER と同じ値）。協力事業所・所属なしは未設定（null）
export const SEED_OFFICES: SeedOffice[] = [
  // ハザード（offices.hazards、T125）は持たない（NULL = 区域なし。架空の街の高台で、訓練の区域の出来事は事業所に効かない）。
  // 種の行に列を足すと migration 0030 の前の D1 に種を入れられなくなる
  { id: "office-demo", name: "デモ事業所", kind: "demo", city: CITY, plan_form: "matsuyama", center_lat: 33.84, center_lng: 132.765 },
  // 確認用の事業所（T144）。見本のケアマネ（山本）のログインが入る、デモ事業所と同じ種の事業所（中の 10 人・災害モード・訓練は
  // lib/seed/check.ts がデモ事業所の種から写す）。審査員は入らない。作者が山本で確かめた物が審査員のデモ事業所に効かないように
  { id: "office-demo-check", name: "デモ事業所（確認用）", kind: "demo", city: CITY, plan_form: "matsuyama", center_lat: 33.84, center_lng: 132.765 },
  { id: "office-partner", name: "協力事業所", kind: "regular", city: CITY, plan_form: "matsuyama", center_lat: null, center_lng: null },
  // 所属なし（T23）。医療班・行政がその場で作った人の置き場。ケアマネはいない。ケアマネが引き受けると自分の事業所へ移る
  { id: "office-unaffiliated", name: "所属なし", kind: "unaffiliated", city: CITY, plan_form: "matsuyama", center_lat: null, center_lng: null },
];

// パスワードのハッシュは種に書かない（null）。山本（確認用の事業所の chk-acct-yamamoto）のハッシュは手元の鍵のファイルの
// CAREMANAGER_DEMO_PASSWORD_HASH から seed/build-sql.ts が入れる（npm run hash-password で作る）。
// 審査員は表の行でなく env の JUDGE_PASSWORD_HASH で入る（3 つの ID で同じパスワード、T144）。acct-judge・acct-judge-2・acct-judge-3 は
// 審査員が書いた物の書き手の行で、ログインには使わない。
export const SEED_ACCOUNTS: SeedAccount[] = [
  // 審査員の担当一覧の持ち主（10 人の担当）。ログインの ID は持たない（T144。ログインの山本は確認用の事業所の chk-acct-yamamoto）
  {
    id: "acct-yamamoto",
    office_id: "office-demo",
    role: "care_manager",
    is_office_admin: 1,
    display_name: "山本",
    login_id: null,
    password_hash: null,
  },
  // 2 人目のケアマネ（T79。架空、ログインの ID なし。担当 0 人）。審査員が担当の一括変更とケアマネの管理を試すときの相手。
  // 変えられないアカウント（lib/auth/demo.ts の FIXED_ACCOUNT_IDS）で、改名・管理者・停止・再発行はサーバーが断る
  {
    id: "acct-nishimura",
    office_id: "office-demo",
    role: "care_manager",
    is_office_admin: 0,
    display_name: "西村",
    login_id: null,
    password_hash: null,
  },
  // 審査員の書き手（T144 から 3 つ。経過の書き手で誰が書いたか分かる名前）
  {
    id: "acct-judge",
    office_id: "office-demo",
    role: "judge",
    is_office_admin: 0,
    display_name: "審査員 1",
    login_id: null,
    password_hash: null,
  },
  {
    id: "acct-judge-2",
    office_id: "office-demo",
    role: "judge",
    is_office_admin: 0,
    display_name: "審査員 2",
    login_id: null,
    password_hash: null,
  },
  {
    id: "acct-judge-3",
    office_id: "office-demo",
    role: "judge",
    is_office_admin: 0,
    display_name: "審査員 3",
    login_id: null,
    password_hash: null,
  },
  // 確認用の事業所の山本（T144。ログインの ID はここ、管理者）と西村の写し（ログインの ID なし、担当 0 人）。どちらも変えられないアカウント
  {
    id: "chk-acct-yamamoto",
    office_id: "office-demo-check",
    role: "care_manager",
    is_office_admin: 1,
    display_name: "山本",
    login_id: "yamamoto",
    password_hash: null,
  },
  {
    id: "chk-acct-nishimura",
    office_id: "office-demo-check",
    role: "care_manager",
    is_office_admin: 0,
    display_name: "西村",
    login_id: null,
    password_hash: null,
  },
  {
    id: "acct-partner-cm",
    office_id: "office-partner",
    role: "care_manager",
    is_office_admin: 1,
    display_name: "",
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
    kana: null,
    address: null,
    mobile: null,
    ...c,
  };
}

/** 連絡先の住所（市町村と町名まで。番地は持たない。町名は架空、県外・遠方の市区も架空） */
const inCity = (town: string) => `${CITY} ${town}`;

/** 時計の既定。値のある時計は確かめ済みにしておく。外の物に頼らない（頼り先なし） */
function clock(c: Partial<SeedClock> & Pick<SeedClock, "id" | "kind" | "category" | "label" | "starts_on">): SeedClock {
  return {
    value: null,
    unit: null,
    source: null,
    source_note: null,
    confirmed_at: c.value == null ? null : SEED_AT,
    depends_on: null,
    depends_check: null,
    note: null,
    ...c,
  };
}

const emptyMedical = (): Ledger["medical"] => ({ devices: [], medications: [] });

/**
 * 地図のピンの位置（T14）。架空の位置で、町名と同じく実在の人・家と関係ない。
 * 松山市の市街の中で、台帳のハザードと重ねる層が食い違わない所（浸水 3 m は深い色の区域、浸水 0.5〜1 m は浅い色の区域、
 * 土砂は警戒区域の山すそ、津波は海沿いの浸水想定、なしはどの層も無い所）を選んだ。
 * 家に当たらないよう、空中写真で田畑・空き地・運動場・公園などの開けた所を見て置いた。確かめた手順は docs/progress/t14.md
 */
export const SEED_LOCATIONS: Record<string, GeoPoint> = {
  "p-01": { lat: 33.812, lng: 132.7487 }, // かわなぎ町 浸水 3 m
  "p-02": { lat: 33.8022, lng: 132.7665 }, // かわなぎ町 浸水 3 m
  "p-03": { lat: 33.8226, lng: 132.7197 }, // みずほし町 浸水 0.5 m
  "p-04": { lat: 33.8525, lng: 132.7988 }, // くぬぎ谷町 土砂
  "p-05": { lat: 33.8346, lng: 132.7303 }, // みずほし町 浸水 0.5 m
  "p-06": { lat: 33.8243, lng: 132.7543 }, // あしなみ町 浸水 1 m
  "p-07": { lat: 33.8585, lng: 132.7816 }, // くぬぎ谷町 土砂
  "p-08": { lat: 33.854, lng: 132.7105 }, // うみなり町 津波
  "p-09": { lat: 33.8655, lng: 132.74 }, // そらみ台 なし
  "p-10": { lat: 33.8735, lng: 132.7502 }, // そらみ台 なし
};

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
      self_report_unreliable: 0,
    },
    ledger: {
      basic: {
        sex: "female",
        address: { city: CITY, town: "かわなぎ町" },
        location: SEED_LOCATIONS["p-01"],
        housing: { floor: 1, floors: 2, structure: "wood", builtYear: 1972, bedroom: "1 階 奥の和室", type: "detached" },
        household: "alone",
        // スマホは使える（審査員の「本人スマホ」は山田で、訓練の想定でも本人が 3 時間に赤を押す。T26、設計の側の決定）。
        // 本人の電話は 1 人 1 つ（T68）なので、携帯の番号は置く所が無く、紙の本人の携帯番号は未確認のまま（docs/progress/t142.md の問い）
        contactMeans: { landline: true, mobile: true, email: false, smartphone: "uses" },
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
          // 用量は今の種に無いので足さない（医療の助言をしない）。保管は本人の言葉（特記の「薬は 2 階の箪笥」）にある
          { name: "ワーファリン", category: "anticoagulant", schedule: "1 日 1 回", interruptionRisk: true },
        ],
        allergies: [],
        // 既往・予防接種・手帳は空けておく（質問で埋める流れの見本。埋めると本人の 1 枚の裏が 3 頁目にあふれる。docs/progress/t142.md）
      },
      // 避難先 2 は未確認のまま（下の pending。質問で埋める流れの見本。T142）。段差・ペットは空ける（計画書の 2 頁目に余白が無い）
      evacuation: {
        hazards: [{ kind: "flood", depthM: 3 }],
        destination1: "かわなぎ小学校",
        destination1Minutes: 10,
        stayHome: false,
        route: "家から北へ市道を進み、小学校の体育館へ。堤防沿いの道は通らない",
        transportKind: "family_car",
        transport: "娘の車",
        nearest: "かわなぎ中学校",
        nearestMeans: "foot",
        nearestMinutes: 15,
        carryItems: ["予備ボンベ", "薬", "お薬手帳"],
        myTimeline: "none",
        support: ["call", "assist"],
        supportNote: "娘が車で迎えに来る。隣人が声を掛ける",
      },
      local: { watcher: "大野 節子", orgName: "第 1 地区 自主防災会", orgPhone: phone(71) },
      notes: ["薬は 2 階の箪笥"],
      pending: [
        { field: "medical.medications.warfarin.remaining", status: "unknown" },
        { field: "people.night_supporter", status: "not_asked" },
        { field: "evacuation.destination2", status: "unknown" },
      ],
    },
    // 夜間に来られるかは未確認のまま（pending の夜間支援。night_ok を書かない）
    contacts: [
      contact({ id: "c-01-0", kind: "self", phone: phone(1), note: "固定電話" }),
      contact({
        id: "c-01-1",
        kind: "family",
        relation: "娘",
        name: "森 恵子",
        kana: "モリ ケイコ",
        address: inCity("ほたる坂町"),
        phone: phone(11),
        mobile: phone(33),
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
        kana: "キムラ ヨシ",
        address: inCity("かわなぎ町"),
        phone: phone(12),
        reach: "nearby",
        emergency_order: 2,
        supporter_order: 2,
        has_car: 0,
        has_smartphone: 0,
        note: "82 歳",
      }),
      contact({ id: "c-01-3", kind: "home_doctor", name: "かわなぎ内科医院", kana: "カワナギナイカイイン", address: inCity("かわなぎ町"), phone: phone(42) }),
      contact({ id: "c-01-4", kind: "pharmacy", name: "かわなぎ薬局", kana: "カワナギヤッキョク", address: inCity("かわなぎ町"), phone: phone(52) }),
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
      self_report_unreliable: 0,
    },
    ledger: {
      basic: {
        sex: "female",
        address: { city: CITY, town: "かわなぎ町" },
        location: SEED_LOCATIONS["p-02"],
        housing: { floor: 1, floors: 2, structure: "wood", builtYear: 1980, bedroom: "1 階 居間", type: "detached" },
        household: "with_spouse",
        contactMeans: { landline: true, mobile: false, email: false, smartphone: "none" },
      },
      care: {
        careLevel: "care3",
        handbook: "身体 1 級（呼吸器）",
        walking: "hard",
        hearing: "ok",
        vision: "ok",
        understanding: "ok",
        judgment: "ok",
        orientation: "ok",
        bedridden: true,
        dementia: false,
      },
      medical: {
        // 吸引器の内蔵電池は時計が無い（時計を足すと色と連絡の順が変わり得るので足さない。紙は未確認のまま。docs/progress/t142.md）
        devices: [
          { kind: "ventilator", detail: "気管切開" },
          { kind: "suction", schedule: "1 日 6 回" },
        ],
        medications: [],
        allergies: [],
        history: ["ALS", "気管切開"],
        vaccinations: ["インフルエンザ", "肺炎球菌"],
      },
      // 段差・ペットは空ける（埋めると計画書〔前からの紙面〕が 3 頁目にあふれる）。避難先 2 も空ける（本人の 1 枚の表が在宅避難の行を足すと 3 頁目にあふれる）。docs/progress/t142.md
      evacuation: {
        hazards: [{ kind: "flood", depthM: 3 }],
        destination1: "かわなぎ総合病院",
        destination1Minutes: 15,
        stayHome: false,
        route: "夫の車で病院へ。訪問看護が付き添い、呼吸器と吸引器を積む",
        transportKind: "other",
        transport: "訪問看護と夫",
        nearest: "かわなぎ小学校",
        nearestMeans: "family_car",
        nearestMinutes: 5,
        carryItems: ["吸引器", "予備の回路", "バッテリー"],
        myTimeline: "app",
        support: ["assist", "other"],
        supportNote: "夫の車で、訪問看護が付き添う",
      },
      local: { watcher: "松井 和代", orgName: "第 1 地区 自主防災会", orgPhone: phone(71) },
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
        kana: "コバヤシ ケンイチ",
        address: inCity("かわなぎ町"),
        phone: phone(13),
        reach: "together",
        emergency_order: 1,
        supporter_order: 1,
        night_ok: 1,
        has_car: 1,
        has_smartphone: 1,
      }),
      // 訪問看護のフリガナは空ける（計画書の 1 頁目に余白が無い）
      contact({
        id: "c-02-2",
        kind: "visiting_nurse",
        name: "かわなぎ訪問看護",
        address: inCity("かわなぎ町"),
        phone: phone(14),
        reach: "in_city",
        emergency_order: 2,
        supporter_order: 2,
      }),
      // T57: 新しい種類の見本（酸素業者）。支援の順は付けない（ルールの表の結果を変えない）
      contact({
        id: "c-02-3",
        kind: "oxygen_supplier",
        name: "かわなぎ医療機器",
        kana: "カワナギイリョウキキ",
        address: inCity("かわなぎ町"),
        phone: phone(31),
        reach: "in_city",
        night_ok: 1,
        note: "呼吸器の予備電池を届ける",
      }),
      contact({ id: "c-02-4", kind: "home_doctor", name: "かわなぎ在宅クリニック", kana: "カワナギザイタククリニック", address: inCity("かわなぎ町"), phone: phone(43) }),
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

  // 3 緑だが透析先が未確認で黄（時計の頼り先の確認が未確認。docs/DECISIONS.md「色と連絡順」）。訓練: 透析施設が浸水 → 別の施設を探す
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
      self_report_unreliable: 0,
    },
    ledger: {
      basic: {
        sex: "male",
        address: { city: CITY, town: "みずほし町" },
        location: SEED_LOCATIONS["p-03"],
        housing: { floor: 2, floors: 2, structure: "wood", builtYear: 1985, bedroom: "2 階 南の洋室", type: "detached" },
        household: "with_spouse",
        contactMeans: { landline: true, mobile: false, email: false, smartphone: "none" },
      },
      care: {
        careLevel: "care2",
        walking: "some",
        hearing: "some",
        vision: "ok",
        understanding: "ok",
        judgment: "ok",
        orientation: "ok",
        bedridden: false,
        dementia: false,
      },
      medical: {
        devices: [{ kind: "dialysis", detail: "血液透析", schedule: "月水金" }],
        medications: [],
        allergies: ["ヨード造影剤"],
        // 既往・予防接種・手帳は空けておく（埋めると本人の 1 枚の裏が 3 頁目にあふれる。透析の行で余白が無い。docs/progress/t142.md）
      },
      // 段差・ペットは空ける（埋めると計画書〔前からの紙面〕が 3 頁目にあふれる）。避難先 2 も空ける（本人の 1 枚の表が在宅避難の行を足すと 3 頁目にあふれる）。docs/progress/t142.md
      evacuation: {
        hazards: [{ kind: "flood", depthM: 0.5 }],
        destination1: "みずほし公民館",
        destination1Minutes: 10,
        stayHome: false,
        route: "長男の車で県道を通って公民館へ。透析の日は透析先へ直に向かう",
        transportKind: "family_car",
        transport: "長男の車",
        nearest: "みずほし小学校",
        nearestMeans: "foot",
        nearestMinutes: 10,
        carryItems: ["透析手帳", "薬"],
        myTimeline: "paper",
        support: ["call", "assist"],
        supportNote: "長男が車で迎えに来る。妻が透析手帳を持つ",
      },
      local: { watcher: "村上 清", orgName: "第 2 地区 自主防災会", orgPhone: phone(72) },
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
        kana: "タナカ カズコ",
        address: inCity("みずほし町"),
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
        kana: "タナカ ヒロシ",
        address: inCity("しおかぜ町"),
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
        kana: "オカダ ユミ",
        address: "広島県 あさぎ市",
        phone: phone(17),
        mobile: phone(35),
        reach: "out_of_pref",
        emergency_order: 3,
        night_ok: 0,
        has_car: 1,
        has_smartphone: 1,
      }),
      contact({
        id: "c-03-4",
        kind: "dialysis_center",
        name: "みずほし透析クリニック",
        kana: "ミズホシトウセキクリニック",
        address: inCity("みずほし町"),
        phone: phone(18),
        reach: "in_city",
        note: "月水金の午前",
      }),
      // T57: 新しい種類の見本（病院）。順は付けない
      contact({
        id: "c-03-5",
        kind: "hospital",
        name: "みずほし総合病院",
        kana: "ミズホシソウゴウビョウイン",
        address: inCity("みずほし町"),
        phone: phone(32),
        reach: "in_city",
        note: "シャントの手術をした病院",
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
        // 透析先が受け入れられるかはまだ確かめていない（docs/DECISIONS.md「色と連絡順」）
        depends_on: "dialysis_center",
        depends_check: "unconfirmed",
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
      // 本人の報告を当てにしない印。ケアマネが付けた（docs/DECISIONS.md「色と連絡順」）
      self_report_unreliable: 1,
    },
    ledger: {
      basic: {
        sex: "female",
        address: { city: CITY, town: "くぬぎ谷町" },
        location: SEED_LOCATIONS["p-04"],
        housing: { floor: 1, floors: 1, structure: "wood", builtYear: 1968, bedroom: "1 階 居間の隣", type: "detached" },
        household: "alone",
        contactMeans: { landline: true, mobile: false, email: false, smartphone: "none" },
      },
      care: {
        careLevel: "care2",
        walking: "ok",
        hearing: "ok",
        vision: "ok",
        understanding: "some",
        judgment: "hard",
        orientation: "hard",
        bedridden: false,
        dementia: true,
      },
      medical: {
        devices: [],
        // 残りの日数は時計が無い（時計を足すと色と連絡の順が変わり得るので足さない）。用量は今の種に無いので足さない
        medications: [{ name: "抗認知症薬", category: "other", schedule: "1 日 1 回", storage: "台所の引き出し（民生委員と確認）" }],
        allergies: [],
        history: ["アルツハイマー型認知症"],
        vaccinations: ["インフルエンザ"],
      },
      // 計画は未作成（骨子）。避難先 1・2 と経路は空けておく（訓練の採点 lib/drill/score.ts の様式 9 の空欄がこの 3 人を数える。手段・支援の内容・最寄りの避難場所は聞いた事実）。
      // 段差は空ける（埋めると計画書〔前からの紙面〕が 3 頁目にあふれる）
      evacuation: {
        hazards: [{ kind: "landslide" }],
        stayHome: false,
        transportKind: "foot",
        transport: "民生委員と歩いて",
        nearest: "くぬぎ谷公民館",
        nearestMeans: "foot",
        nearestMinutes: 5,
        pets: "なし",
        carryItems: ["薬", "お薬手帳", "眼鏡"],
        myTimeline: "none",
        support: ["call", "guide"],
        supportNote: "民生委員が声を掛けて一緒に歩く。息子は県外",
      },
      local: { watcher: "小川 照子", orgName: "第 3 地区 自主防災会", orgPhone: phone(73) },
      notes: [],
      pending: [],
    },
    contacts: [
      contact({ id: "c-04-0", kind: "self", phone: phone(4), note: "固定電話" }),
      contact({
        id: "c-04-1",
        kind: "welfare_commissioner",
        name: "清水 正子",
        kana: "シミズ マサコ",
        address: inCity("くぬぎ谷町"),
        phone: phone(19),
        mobile: phone(81),
        reach: "nearby",
        emergency_order: 1,
        supporter_order: 1,
        night_ok: 1,
        has_car: 0,
        // 本人も周りもスマホで押せない筋（想定の表の 4 佐藤の行）
        has_smartphone: 0,
      }),
      contact({
        id: "c-04-2",
        kind: "family",
        relation: "息子",
        name: "佐藤 隆",
        kana: "サトウ タカシ",
        address: "兵庫県 はなぶさ市",
        phone: phone(20),
        mobile: phone(36),
        reach: "out_of_pref",
        emergency_order: 2,
        night_ok: 0,
        has_car: 1,
        has_smartphone: 1,
      }),
      contact({ id: "c-04-3", kind: "home_doctor", name: "くぬぎ谷診療所", kana: "クヌギダニシンリョウジョ", address: inCity("くぬぎ谷町"), phone: phone(45) }),
      contact({ id: "c-04-4", kind: "pharmacy", name: "くぬぎ谷薬局", kana: "クヌギダニヤッキョク", address: inCity("くぬぎ谷町"), phone: phone(55) }),
    ],
    refusedConsents: [],
    clocks: [
      clock({
        id: "k-04-1",
        kind: "condition",
        category: "dementia",
        label: "本人の申告は参考",
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
      self_report_unreliable: 0,
    },
    ledger: {
      basic: {
        sex: "female",
        address: { city: CITY, town: "みずほし町" },
        location: SEED_LOCATIONS["p-05"],
        housing: { floor: 2, floors: 2, structure: "wood", builtYear: 1976, bedroom: "2 階 東の和室", type: "detached" },
        household: "alone",
        contactMeans: { landline: true, mobile: false, email: false, smartphone: "none" },
      },
      care: {
        careLevel: "care4",
        walking: "hard",
        hearing: "some",
        vision: "some",
        understanding: "ok",
        judgment: "ok",
        orientation: "ok",
        bedridden: true,
        dementia: false,
      },
      medical: {
        devices: [],
        // 用量は今の種に無いので足さない
        medications: [{ name: "ステロイド", category: "steroid", schedule: "1 日 1 回", storage: "枕元の薬箱", interruptionRisk: true }],
        allergies: [],
        history: ["関節リウマチ"],
        vaccinations: ["インフルエンザ"],
      },
      // 避難を手伝う人（支援者の順）はいない（骨子の「寝たきり・支援者なし」。送迎は手配が要る）。
      // 計画は未作成（骨子）。避難先 1・2 と経路は空けておく（4 佐藤と同じ）
      evacuation: {
        hazards: [{ kind: "flood", depthM: 0.5 }],
        stayHome: false,
        barriers: "2 階から階段だけ",
        transportKind: "pickup",
        transport: "福祉車両の送迎（手配が要る）",
        nearest: "みずほし小学校",
        nearestMeans: "pickup",
        nearestMinutes: 10,
        pets: "なし",
        carryItems: ["ステロイド", "お薬手帳", "おむつ"],
        myTimeline: "none",
        support: ["assist"],
        supportNote: "避難を手伝う人がいない。送迎と運び出しは事業所と市に頼む",
      },
      local: { watcher: "長谷川 久美", orgName: "第 2 地区 自主防災会", orgPhone: phone(72) },
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
        kana: "イトウ タクヤ",
        address: "東京都 ことぶき区",
        phone: phone(21),
        mobile: phone(37),
        reach: "far",
        emergency_order: 1,
        night_ok: 0,
        has_car: 1,
        has_smartphone: 1,
      }),
      contact({ id: "c-05-2", kind: "home_doctor", name: "みずほし在宅診療所", kana: "ミズホシザイタクシンリョウジョ", address: inCity("みずほし町"), phone: phone(46) }),
      contact({ id: "c-05-3", kind: "pharmacy", name: "みずほし調剤薬局", kana: "ミズホシチョウザイヤッキョク", address: inCity("みずほし町"), phone: phone(56) }),
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
      self_report_unreliable: 0,
    },
    ledger: {
      basic: {
        sex: "female",
        address: { city: CITY, town: "あしなみ町" },
        location: SEED_LOCATIONS["p-06"],
        housing: { floor: 1, floors: 2, structure: "wood", builtYear: 1983, bedroom: "1 階 居間の隣", type: "detached" },
        household: "with_child",
        contactMeans: { landline: true, mobile: false, email: false, smartphone: "none" },
      },
      // 寝たきりの印は書かない（歩行 困難で同じに数える。lib/triage。本人の 1 枚の裏に場所が無い）
      care: {
        careLevel: "care4",
        walking: "hard",
        hearing: "some",
        vision: "some",
        understanding: "some",
        judgment: "some",
        orientation: "ok",
        dementia: false,
      },
      medical: {
        // T57: 「その他」の機器の見本（時計は作らない。ルールの表の結果は変わらない）
        devices: [{ kind: "tube_feeding", detail: "胃ろう 経管栄養", schedule: "1 日 3 回" }, { kind: "other", detail: "電動ベッド（エアマット）" }],
        medications: [],
        allergies: [],
        history: ["脳梗塞"],
        vaccinations: ["インフルエンザ", "肺炎球菌"],
      },
      // 段差・ペットは空ける（埋めると計画書〔前からの紙面〕が 3 頁目にあふれる）。避難先 2 も空ける（本人の 1 枚の表が在宅避難の行を足すと 3 頁目にあふれる）。docs/progress/t142.md
      evacuation: {
        hazards: [{ kind: "flood", depthM: 1 }],
        destination1: "あしなみ小学校",
        destination1Minutes: 10,
        stayHome: false,
        route: "娘の車で支流の橋を渡らずに小学校へ",
        transportKind: "family_car",
        transport: "娘の車",
        nearest: "あしなみ公民館",
        nearestMeans: "wheelchair",
        nearestMinutes: 10,
        carryItems: ["栄養剤", "注入の道具"],
        myTimeline: "paper",
        support: ["assist"],
        supportNote: "娘が車いすを押して車に乗せる。息子が手伝いに来る",
      },
      local: { watcher: "原田 敏子", orgName: "第 4 地区 自主防災会", orgPhone: phone(74) },
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
        kana: "タカハシ ミワ",
        address: inCity("あしなみ町"),
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
        kana: "タカハシ オサム",
        address: inCity("そらみ台"),
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
        kana: "タカハシ ショウタ",
        address: inCity("ほたる坂町"),
        phone: phone(24),
        reach: "in_city",
        emergency_order: 3,
        night_ok: 0,
        has_car: 1,
        has_smartphone: 1,
      }),
      contact({ id: "c-06-4", kind: "home_doctor", name: "あしなみ在宅クリニック", kana: "アシナミザイタククリニック", address: inCity("あしなみ町"), phone: phone(47) }),
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
      self_report_unreliable: 0,
    },
    ledger: {
      basic: {
        sex: "male",
        address: { city: CITY, town: "くぬぎ谷町" },
        location: SEED_LOCATIONS["p-07"],
        housing: { floor: 1, floors: 1, structure: "wood", builtYear: 1970, bedroom: "奥の和室", type: "detached" },
        household: "alone",
        // 固定電話は無い（訓練の家の電話の見方 lib/drill/comms.ts の homeOf と同じ値）
        contactMeans: { landline: false, mobile: true, email: false, smartphone: "uses" },
      },
      care: {
        careLevel: "care2",
        walking: "some",
        hearing: "some",
        vision: "ok",
        understanding: "ok",
        judgment: "ok",
        orientation: "ok",
        bedridden: false,
        dementia: false,
      },
      medical: {
        devices: [],
        // 用量は今の種に無いので足さない
        medications: [
          { name: "抗凝固薬（DOAC）", category: "anticoagulant", schedule: "1 日 2 回", storage: "居間の棚", interruptionRisk: true },
        ],
        allergies: [],
        history: ["心房細動"],
        vaccinations: ["インフルエンザ"],
      },
      evacuation: {
        hazards: [{ kind: "landslide" }],
        destination1: "くぬぎ谷集会所",
        destination1Minutes: 10,
        destination2: "弟の家",
        destination2Means: "family_car",
        destination2Minutes: 20,
        stayHome: false,
        route: "県道を下って集会所へ。山すその道は通らない",
        barriers: "玄関に 20 cm の段差",
        transportKind: "family_car",
        transport: "弟の車",
        nearest: "くぬぎ谷公民館",
        nearestMeans: "foot",
        nearestMinutes: 10,
        pets: "なし",
        carryItems: ["薬", "お薬手帳", "携帯の充電器"],
        myTimeline: "none",
        support: ["call", "guide"],
        supportNote: "民生委員が声を掛け、弟が車で迎えに来る",
      },
      local: { watcher: "近藤 勝", orgName: "第 3 地区 自主防災会", orgPhone: phone(73) },
      notes: [],
      // 夜間支援は未確認のまま（質問で埋める流れの見本。night_ok を書かない。T142）
      pending: [{ field: "people.night_supporter", status: "not_asked" }],
    },
    contacts: [
      contact({ id: "c-07-0", kind: "self", phone: phone(7), note: "携帯" }),
      contact({
        id: "c-07-1",
        kind: "family",
        relation: "弟",
        name: "加藤 実",
        kana: "カトウ ミノル",
        address: inCity("ほたる坂町"),
        phone: phone(25),
        mobile: phone(40),
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
        kana: "マエダ カズオ",
        address: inCity("くぬぎ谷町"),
        phone: phone(26),
        reach: "nearby",
        emergency_order: 2,
        supporter_order: 1,
        has_car: 0,
        has_smartphone: 0,
      }),
      contact({ id: "c-07-3", kind: "home_doctor", name: "くぬぎ谷内科", kana: "クヌギダニナイカ", address: inCity("くぬぎ谷町"), phone: phone(48) }),
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

  // 8 地震の主役。津波で高台の集会所へ、インスリンの残り 4 日の時計が発災から走る（保管は確認の欄）
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
      self_report_unreliable: 0,
    },
    ledger: {
      basic: {
        sex: "male",
        address: { city: CITY, town: "うみなり町" },
        location: SEED_LOCATIONS["p-08"],
        housing: { floor: 2, floors: 2, structure: "wood", builtYear: 1990, bedroom: "2 階 北の和室", type: "detached" },
        household: "with_child",
        // 固定電話は無い（lib/drill/comms.ts の homeOf と同じ値）
        contactMeans: { landline: false, mobile: true, email: true, smartphone: "uses" },
      },
      care: {
        careLevel: "support2",
        walking: "ok",
        hearing: "ok",
        vision: "some",
        understanding: "ok",
        judgment: "ok",
        orientation: "ok",
        bedridden: false,
        dementia: false,
      },
      medical: {
        devices: [],
        // 用量は今の種に無いので足さない
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
        allergies: ["ペニシリン"],
        history: ["2 型糖尿病"],
        vaccinations: ["インフルエンザ", "新型コロナ"],
      },
      evacuation: {
        hazards: [{ kind: "tsunami" }],
        destination1: "うみなり高台の集会所",
        destination1Minutes: 15,
        destination2: "高台の親類の家",
        destination2Means: "family_car",
        destination2Minutes: 10,
        stayHome: false,
        route: "海と反対の坂を上って高台の集会所へ。海沿いの国道は通らない",
        barriers: "玄関に小さな段差",
        transportKind: "foot",
        transport: "徒歩",
        nearest: "うみなり津波避難タワー",
        nearestMeans: "foot",
        nearestMinutes: 5,
        pets: "なし",
        carryItems: ["インスリン", "保冷バッグ", "血糖の測定器"],
        myTimeline: "app",
        support: ["call"],
        supportNote: "息子が声を掛けて一緒に歩く",
      },
      local: { watcher: "坂本 恵", orgName: "第 5 地区 自主防災会", orgPhone: phone(75) },
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
        kana: "イノウエ ダイスケ",
        address: inCity("うみなり町"),
        phone: phone(27),
        mobile: phone(84),
        reach: "together",
        emergency_order: 1,
        supporter_order: 1,
        night_ok: 1,
        has_car: 1,
        has_smartphone: 1,
      }),
      contact({ id: "c-08-2", kind: "home_doctor", name: "うみなり内科医院", kana: "ウミナリナイカイイン", address: inCity("うみなり町"), phone: phone(49) }),
      contact({ id: "c-08-3", kind: "pharmacy", name: "うみなり薬局", kana: "ウミナリヤッキョク", address: inCity("うみなり町"), phone: phone(59) }),
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
        // 手元の残りの日数（物の時計 B）で、発災から走る。冷蔵が切れると走る、はやめた（未開封なら冷蔵が切れてもしばらく使える。
        // jadec-insulin-2023）。暑さ・冷蔵は「確認」の欄の項目（頼り先 保管）で、ルールの表の入力にしない。docs/DECISIONS.md「色と連絡順」
        starts_on: "disaster",
        source: "pharmacy",
        depends_on: "storage",
        depends_check: "confirmed",
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
      self_report_unreliable: 0,
    },
    ledger: {
      basic: {
        sex: "male",
        address: { city: CITY, town: "そらみ台" },
        location: SEED_LOCATIONS["p-09"],
        housing: { floor: 2, floors: 2, structure: "wood", builtYear: 1995, bedroom: "2 階 奥の部屋", type: "apartment" },
        household: "alone",
        // 固定電話は無い（lib/drill/comms.ts の homeOf と同じ値）
        contactMeans: { landline: false, mobile: true, email: false, smartphone: "uses" },
      },
      care: {
        careLevel: "care1",
        walking: "ok",
        hearing: "some",
        vision: "ok",
        understanding: "ok",
        judgment: "ok",
        orientation: "ok",
        bedridden: false,
        dementia: false,
      },
      medical: {
        devices: [],
        // 用量は今の種に無いので足さない
        medications: [{ name: "降圧薬", category: "other", schedule: "1 日 1 回", storage: "台所の薬箱" }],
        allergies: [],
        history: ["高血圧"],
        vaccinations: ["インフルエンザ"],
      },
      // ハザードは無い（対照）。避難のタイミングの欄はハザードから決まるので、紙は未確認のまま（docs/progress/t142.md）。
      // 計画は未作成（骨子）。避難先 1・2 と経路は空けておく（4 佐藤と同じ）
      evacuation: {
        hazards: [],
        stayHome: false,
        barriers: "2 階へは外階段だけ",
        transportKind: "foot",
        nearest: "そらみ台公園",
        nearestMeans: "foot",
        nearestMinutes: 5,
        pets: "なし",
        carryItems: ["降圧薬", "お薬手帳", "眼鏡"],
        myTimeline: "none",
        support: ["call"],
        supportNote: "隣人が声を掛ける",
      },
      local: { watcher: "遠藤 弘", orgName: "第 6 地区 自主防災会", orgPhone: phone(76) },
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
        kana: "イシカワ マリ",
        address: inCity("ほたる坂町"),
        phone: phone(28),
        mobile: phone(41),
        reach: "in_city",
        emergency_order: 1,
        night_ok: 0,
        has_car: 1,
        has_smartphone: 1,
      }),
      contact({
        id: "c-09-2",
        kind: "supporter",
        relation: "隣人",
        name: "藤田 ミチ",
        kana: "フジタ ミチ",
        address: inCity("そらみ台"),
        phone: phone(29),
        mobile: phone(85),
        reach: "nearby",
        emergency_order: 2,
        supporter_order: 1,
        night_ok: 1,
        has_car: 0,
        has_smartphone: 0,
      }),
      contact({ id: "c-09-3", kind: "home_doctor", name: "そらみ台内科", kana: "ソラミダイナイカ", address: inCity("そらみ台"), phone: phone(50) }),
      contact({ id: "c-09-4", kind: "pharmacy", name: "そらみ台薬局", kana: "ソラミダイヤッキョク", address: inCity("そらみ台"), phone: phone(60) }),
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
      self_report_unreliable: 0,
    },
    ledger: {
      basic: {
        sex: "male",
        address: { city: CITY, town: "そらみ台" },
        location: SEED_LOCATIONS["p-10"],
        housing: { floor: 2, floors: 2, structure: "wood", builtYear: 1988, bedroom: "2 階 和室", type: "detached" },
        household: "with_spouse",
        contactMeans: { landline: true, mobile: false, email: false, smartphone: "none" },
      },
      care: {
        careLevel: "support1",
        walking: "ok",
        hearing: "ok",
        vision: "ok",
        understanding: "ok",
        judgment: "ok",
        orientation: "ok",
        bedridden: false,
        dementia: false,
      },
      medical: { ...emptyMedical(), allergies: [], history: [], vaccinations: ["インフルエンザ"] },
      // ハザードは無い（対照）。避難のタイミングの欄はハザードから決まるので、紙は未確認のまま（docs/progress/t142.md）
      evacuation: {
        hazards: [],
        destination1: "そらみ台小学校",
        destination1Minutes: 10,
        destination2: "そらみ台集会所",
        destination2Means: "foot",
        destination2Minutes: 5,
        stayHome: false,
        route: "台地の中の道を妻と歩いて小学校へ",
        barriers: "玄関に小さな段差",
        transportKind: "foot",
        transport: "徒歩",
        nearest: "そらみ台公園",
        nearestMeans: "foot",
        nearestMinutes: 5,
        pets: "なし",
        carryItems: ["お薬手帳", "眼鏡", "水"],
        myTimeline: "paper",
        support: ["call"],
        supportNote: "妻と一緒に歩いて避難する",
      },
      local: { watcher: "青木 文子", orgName: "第 6 地区 自主防災会", orgPhone: phone(76) },
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
        kana: "ナカムラ サチコ",
        address: inCity("そらみ台"),
        phone: phone(30),
        mobile: phone(86),
        reach: "together",
        emergency_order: 1,
        supporter_order: 1,
        night_ok: 1,
        // 同居の車は無い（徒歩で避難する。lib/drill/person-facts.ts の planOf の同居で車のある人と同じ値）
        has_car: 0,
        has_smartphone: 1,
      }),
      contact({ id: "c-10-2", kind: "home_doctor", name: "そらみ台クリニック", kana: "ソラミダイクリニック", address: inCity("そらみ台"), phone: phone(51) }),
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
