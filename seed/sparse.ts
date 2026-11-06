// T142 より前の種の台帳と連絡先（空きの多い形）。テストだけが使う。
// T142 でデモ事業所の 10 人の台帳を埋めた（seed/people.ts）。空いた欄を埋める流れ（入れる欄・問い・紙から質問・面の編集）や、
// 空欄の数・紙の未確認を試すテストは、この空きの多い形を使う（人・時計・同意は今の種と同じ。台帳と連絡先だけが前の形）。
// 種のデータの決まり（全員架空・町名は架空・番地なし・電話は 090-0000-00NN）は seed/people.ts と同じ。

import type { Ledger } from "../lib/db/types.ts";
import { SEED_PEOPLE, type SeedContact, type SeedPerson } from "./people.ts";

const SPARSE: Record<string, { ledger: Ledger; contacts: SeedContact[] }> = {
  "p-01": {
    ledger: {basic: {sex: "female", address: {city: "松山市", town: "かわなぎ町"}, location: {lat: 33.812, lng: 132.7487}, housing: {floor: 1, floors: 2, structure: "wood", type: "detached"}, household: "alone", contactMeans: {landline: true, smartphone: "uses"}}, care: {careLevel: "care3", walking: "some", hearing: "ok", vision: "ok", understanding: "ok", judgment: "ok", orientation: "ok", bedridden: false, dementia: false}, medical: {devices: [{kind: "oxygen", detail: "酸素濃縮器 1 L/分"}], medications: [{name: "ワーファリン", category: "anticoagulant", schedule: "1 日 1 回", interruptionRisk: true}]}, evacuation: {hazards: [{kind: "flood", depthM: 3}], destination1: "かわなぎ小学校", transport: "娘の車", carryItems: ["予備ボンベ", "薬", "お薬手帳"]}, notes: ["薬は 2 階の箪笥"], pending: [{field: "medical.medications.warfarin.remaining", status: "unknown"}, {field: "people.night_supporter", status: "not_asked"}, {field: "evacuation.destination2", status: "unknown"}]},
    contacts: [
      {relation: null, name: null, phone: "090-0000-0001", reach: null, emergency_order: null, supporter_order: null, night_ok: null, has_car: null, has_smartphone: null, note: "固定電話", id: "c-01-0", kind: "self"},
      {relation: "娘", name: "森 恵子", phone: "090-0000-0011", reach: "in_city", emergency_order: 1, supporter_order: 1, night_ok: null, has_car: 1, has_smartphone: 1, note: null, id: "c-01-1", kind: "family"},
      {relation: "隣人", name: "木村 ヨシ", phone: "090-0000-0012", reach: "nearby", emergency_order: 2, supporter_order: 2, night_ok: null, has_car: 0, has_smartphone: 0, note: "82 歳", id: "c-01-2", kind: "supporter"},
    ],
  },
  "p-02": {
    ledger: {basic: {sex: "female", address: {city: "松山市", town: "かわなぎ町"}, location: {lat: 33.8022, lng: 132.7665}, housing: {floor: 1, floors: 2, structure: "wood", type: "detached"}, household: "with_spouse", contactMeans: {landline: true, smartphone: "none"}}, care: {careLevel: "care3", walking: "hard", bedridden: true, dementia: false}, medical: {devices: [{kind: "ventilator", detail: "気管切開"}, {kind: "suction", schedule: "1 日 6 回"}], medications: []}, evacuation: {hazards: [{kind: "flood", depthM: 3}], destination1: "かわなぎ総合病院", transport: "訪問看護と夫", carryItems: ["吸引器", "予備の回路", "バッテリー"]}, notes: [], pending: []},
    contacts: [
      {relation: null, name: null, phone: "090-0000-0002", reach: null, emergency_order: null, supporter_order: null, night_ok: null, has_car: null, has_smartphone: null, note: "固定電話", id: "c-02-0", kind: "self"},
      {relation: "夫", name: "小林 健一", phone: "090-0000-0013", reach: "together", emergency_order: 1, supporter_order: 1, night_ok: 1, has_car: 1, has_smartphone: 1, note: null, id: "c-02-1", kind: "family"},
      {relation: null, name: "かわなぎ訪問看護", phone: "090-0000-0014", reach: "in_city", emergency_order: 2, supporter_order: 2, night_ok: null, has_car: null, has_smartphone: null, note: null, id: "c-02-2", kind: "visiting_nurse"},
      {relation: null, name: "かわなぎ医療機器", phone: "090-0000-0031", reach: "in_city", emergency_order: null, supporter_order: null, night_ok: 1, has_car: null, has_smartphone: null, note: "呼吸器の予備電池を届ける", id: "c-02-3", kind: "oxygen_supplier"},
    ],
  },
  "p-03": {
    ledger: {basic: {sex: "male", address: {city: "松山市", town: "みずほし町"}, location: {lat: 33.8226, lng: 132.7197}, housing: {floor: 2, floors: 2, structure: "wood", type: "detached"}, household: "with_spouse", contactMeans: {landline: true, smartphone: "none"}}, care: {careLevel: "care2", walking: "some", bedridden: false, dementia: false}, medical: {devices: [{kind: "dialysis", detail: "血液透析", schedule: "月水金"}], medications: []}, evacuation: {hazards: [{kind: "flood", depthM: 0.5}], destination1: "みずほし公民館", transport: "長男の車", carryItems: ["透析手帳", "薬"]}, notes: [], pending: []},
    contacts: [
      {relation: null, name: null, phone: "090-0000-0003", reach: null, emergency_order: null, supporter_order: null, night_ok: null, has_car: null, has_smartphone: null, note: "固定電話", id: "c-03-0", kind: "self"},
      {relation: "妻", name: "田中 和子", phone: "090-0000-0015", reach: "together", emergency_order: 1, supporter_order: 1, night_ok: 1, has_car: 0, has_smartphone: 1, note: null, id: "c-03-1", kind: "family"},
      {relation: "長男", name: "田中 浩", phone: "090-0000-0016", reach: "in_city", emergency_order: 2, supporter_order: 2, night_ok: null, has_car: 1, has_smartphone: 1, note: null, id: "c-03-2", kind: "family"},
      {relation: "長女", name: "岡田 由美", phone: "090-0000-0017", reach: "out_of_pref", emergency_order: 3, supporter_order: null, night_ok: null, has_car: null, has_smartphone: 1, note: null, id: "c-03-3", kind: "family"},
      {relation: null, name: "みずほし透析クリニック", phone: "090-0000-0018", reach: "in_city", emergency_order: null, supporter_order: null, night_ok: null, has_car: null, has_smartphone: null, note: "月水金の午前", id: "c-03-4", kind: "dialysis_center"},
      {relation: null, name: "みずほし総合病院", phone: "090-0000-0032", reach: "in_city", emergency_order: null, supporter_order: null, night_ok: null, has_car: null, has_smartphone: null, note: "シャントの手術をした病院", id: "c-03-5", kind: "hospital"},
    ],
  },
  "p-04": {
    ledger: {basic: {sex: "female", address: {city: "松山市", town: "くぬぎ谷町"}, location: {lat: 33.8525, lng: 132.7988}, housing: {floor: 1, floors: 1, structure: "wood", type: "detached"}, household: "alone", contactMeans: {landline: true, smartphone: "none"}}, care: {careLevel: "care2", walking: "ok", understanding: "some", judgment: "hard", orientation: "hard", bedridden: false, dementia: true}, medical: {devices: [], medications: [{name: "抗認知症薬", category: "other", schedule: "1 日 1 回"}]}, evacuation: {hazards: [{kind: "landslide"}]}, notes: [], pending: []},
    contacts: [
      {relation: null, name: null, phone: "090-0000-0004", reach: null, emergency_order: null, supporter_order: null, night_ok: null, has_car: null, has_smartphone: null, note: "固定電話", id: "c-04-0", kind: "self"},
      {relation: null, name: "清水 正子", phone: "090-0000-0019", reach: "nearby", emergency_order: 1, supporter_order: 1, night_ok: null, has_car: null, has_smartphone: null, note: null, id: "c-04-1", kind: "welfare_commissioner"},
      {relation: "息子", name: "佐藤 隆", phone: "090-0000-0020", reach: "out_of_pref", emergency_order: 2, supporter_order: null, night_ok: null, has_car: null, has_smartphone: 1, note: null, id: "c-04-2", kind: "family"},
    ],
  },
  "p-05": {
    ledger: {basic: {sex: "female", address: {city: "松山市", town: "みずほし町"}, location: {lat: 33.8346, lng: 132.7303}, housing: {floor: 2, floors: 2, structure: "wood", type: "detached"}, household: "alone", contactMeans: {landline: true, smartphone: "none"}}, care: {careLevel: "care4", walking: "hard", bedridden: true, dementia: false}, medical: {devices: [], medications: [{name: "ステロイド", category: "steroid", schedule: "1 日 1 回", interruptionRisk: true}]}, evacuation: {hazards: [{kind: "flood", depthM: 0.5}]}, notes: [], pending: []},
    contacts: [
      {relation: null, name: null, phone: "090-0000-0005", reach: null, emergency_order: null, supporter_order: null, night_ok: null, has_car: null, has_smartphone: null, note: "固定電話", id: "c-05-0", kind: "self"},
      {relation: "甥", name: "伊藤 拓也", phone: "090-0000-0021", reach: "far", emergency_order: 1, supporter_order: null, night_ok: null, has_car: null, has_smartphone: 1, note: null, id: "c-05-1", kind: "family"},
    ],
  },
  "p-06": {
    ledger: {basic: {sex: "female", address: {city: "松山市", town: "あしなみ町"}, location: {lat: 33.8243, lng: 132.7543}, housing: {floor: 1, floors: 2, structure: "wood", type: "detached"}, household: "with_child", contactMeans: {landline: true, smartphone: "none"}}, care: {careLevel: "care4", walking: "hard", dementia: false}, medical: {devices: [{kind: "tube_feeding", detail: "胃ろう 経管栄養"}, {kind: "other", detail: "電動ベッド（エアマット）"}], medications: []}, evacuation: {hazards: [{kind: "flood", depthM: 1}], destination1: "あしなみ小学校", transport: "娘の車", carryItems: ["栄養剤", "注入の道具"]}, notes: [], pending: []},
    contacts: [
      {relation: null, name: null, phone: "090-0000-0006", reach: null, emergency_order: null, supporter_order: null, night_ok: null, has_car: null, has_smartphone: null, note: "固定電話", id: "c-06-0", kind: "self"},
      {relation: "娘", name: "高橋 美和", phone: "090-0000-0022", reach: "together", emergency_order: 1, supporter_order: 1, night_ok: 1, has_car: 1, has_smartphone: 1, note: null, id: "c-06-1", kind: "family"},
      {relation: "息子", name: "高橋 修", phone: "090-0000-0023", reach: "in_city", emergency_order: 2, supporter_order: 2, night_ok: null, has_car: 1, has_smartphone: 1, note: null, id: "c-06-2", kind: "family"},
      {relation: "孫", name: "高橋 翔太", phone: "090-0000-0024", reach: "in_city", emergency_order: 3, supporter_order: null, night_ok: null, has_car: null, has_smartphone: 1, note: null, id: "c-06-3", kind: "family"},
    ],
  },
  "p-07": {
    ledger: {basic: {sex: "male", address: {city: "松山市", town: "くぬぎ谷町"}, location: {lat: 33.8585, lng: 132.7816}, housing: {floor: 1, floors: 1, structure: "wood", type: "detached"}, household: "alone", contactMeans: {mobile: true, smartphone: "uses"}}, care: {careLevel: "care2", walking: "some", bedridden: false, dementia: false}, medical: {devices: [], medications: [{name: "抗凝固薬（DOAC）", category: "anticoagulant", schedule: "1 日 2 回", interruptionRisk: true}]}, evacuation: {hazards: [{kind: "landslide"}], destination1: "くぬぎ谷集会所"}, notes: [], pending: [{field: "people.night_supporter", status: "not_asked"}]},
    contacts: [
      {relation: null, name: null, phone: "090-0000-0007", reach: null, emergency_order: null, supporter_order: null, night_ok: null, has_car: null, has_smartphone: null, note: "携帯", id: "c-07-0", kind: "self"},
      {relation: "弟", name: "加藤 実", phone: "090-0000-0025", reach: "in_city", emergency_order: 1, supporter_order: 2, night_ok: null, has_car: 1, has_smartphone: 1, note: null, id: "c-07-1", kind: "family"},
      {relation: null, name: "前田 和夫", phone: "090-0000-0026", reach: "nearby", emergency_order: 2, supporter_order: 1, night_ok: null, has_car: null, has_smartphone: null, note: null, id: "c-07-2", kind: "welfare_commissioner"},
    ],
  },
  "p-08": {
    ledger: {basic: {sex: "male", address: {city: "松山市", town: "うみなり町"}, location: {lat: 33.854, lng: 132.7105}, housing: {floor: 2, floors: 2, structure: "wood", type: "detached"}, household: "with_child", contactMeans: {mobile: true, smartphone: "uses"}}, care: {careLevel: "support2", walking: "ok", bedridden: false, dementia: false}, medical: {devices: [], medications: [{name: "インスリン", category: "insulin", schedule: "朝夕", storage: "冷蔵庫", needsRefrigeration: true, interruptionRisk: true}]}, evacuation: {hazards: [{kind: "tsunami"}], destination1: "うみなり高台の集会所", transport: "徒歩", carryItems: ["インスリン", "保冷バッグ", "血糖の測定器"]}, notes: [], pending: []},
    contacts: [
      {relation: null, name: null, phone: "090-0000-0008", reach: null, emergency_order: null, supporter_order: null, night_ok: null, has_car: null, has_smartphone: null, note: "携帯", id: "c-08-0", kind: "self"},
      {relation: "息子", name: "井上 大輔", phone: "090-0000-0027", reach: "together", emergency_order: 1, supporter_order: 1, night_ok: 1, has_car: 1, has_smartphone: 1, note: null, id: "c-08-1", kind: "family"},
    ],
  },
  "p-09": {
    ledger: {basic: {sex: "male", address: {city: "松山市", town: "そらみ台"}, location: {lat: 33.8655, lng: 132.74}, housing: {floor: 2, floors: 2, structure: "wood", type: "detached"}, household: "alone", contactMeans: {mobile: true, smartphone: "uses"}}, care: {careLevel: "care1", walking: "ok", bedridden: false, dementia: false}, medical: {devices: [], medications: [{name: "降圧薬", category: "other", schedule: "1 日 1 回"}]}, evacuation: {hazards: []}, notes: [], pending: []},
    contacts: [
      {relation: null, name: null, phone: "090-0000-0009", reach: null, emergency_order: null, supporter_order: null, night_ok: null, has_car: null, has_smartphone: null, note: "携帯", id: "c-09-0", kind: "self"},
      {relation: "娘", name: "石川 真理", phone: "090-0000-0028", reach: "in_city", emergency_order: 1, supporter_order: null, night_ok: null, has_car: 1, has_smartphone: 1, note: null, id: "c-09-1", kind: "family"},
      {relation: "隣人", name: "藤田 ミチ", phone: "090-0000-0029", reach: "nearby", emergency_order: 2, supporter_order: 1, night_ok: null, has_car: null, has_smartphone: null, note: null, id: "c-09-2", kind: "supporter"},
    ],
  },
  "p-10": {
    ledger: {basic: {sex: "male", address: {city: "松山市", town: "そらみ台"}, location: {lat: 33.8735, lng: 132.7502}, housing: {floor: 2, floors: 2, structure: "wood", type: "detached"}, household: "with_spouse", contactMeans: {landline: true, smartphone: "none"}}, care: {careLevel: "support1", walking: "ok", bedridden: false, dementia: false}, medical: {devices: [], medications: []}, evacuation: {hazards: [], destination1: "そらみ台小学校", transport: "徒歩"}, notes: [], pending: []},
    contacts: [
      {relation: null, name: null, phone: "090-0000-0010", reach: null, emergency_order: null, supporter_order: null, night_ok: null, has_car: null, has_smartphone: null, note: "固定電話", id: "c-10-0", kind: "self"},
      {relation: "妻", name: "中村 幸子", phone: "090-0000-0030", reach: "together", emergency_order: 1, supporter_order: 1, night_ok: 1, has_car: null, has_smartphone: 1, note: null, id: "c-10-1", kind: "family"},
    ],
  },
};

/** 前の形の 10 人（台帳と連絡先だけ前の形、ほかは今の種） */
export const SPARSE_PEOPLE: SeedPerson[] = SEED_PEOPLE.map((p) => ({ ...p, ledger: SPARSE[p.person.id].ledger, contacts: SPARSE[p.person.id].contacts }));
