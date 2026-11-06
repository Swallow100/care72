// 受け持ちの一覧（/staff、docs/tasks/T23.md）。自分のアカウントの開いた受け持ちを、1 人 1 行で読む。事業所をまたぐ。
//
// 状態の色と理由はケアマネの一覧と同じルールの表（lib/triage、lib/disaster/triage.ts の triageInDisaster）で出す。
// 入力も同じ: 台帳の時計・信号（訓練でない物）・ケアマネの上書き・受け入れ（「到着 避難所」）。
// 状況は本人の事業所の災害モード。本人の事業所が平時か所属なしなら、その人のいちばん早い受け入れを発災の時刻とみなし、
// 停電なしで表に当てる（決めた所。docs/progress/t23.md）。上の人数は状態の 4 色（ケアマネの一覧・事業所・様式 9 と同じ形）。
// 受け持ちの一覧には受け入れたあとの人だけが出るので、漢字の氏名を出してよい（受け入れの前の検索のヒットはカナだけ）。
// 医療の列（印・薬・機器・残り）と理由は同意の範囲（T24、lib/consent/scope.ts）: 医療班への提供に同意の無い人は空にして渡す
// （画面は client の部品なので、範囲の外の値は応答に入れない）。色と並びの番号は全部の台帳から出す。
// 搬送で閉じた受け入れ（ほかのアカウントの物）も表の入力に入れる（lib/custody/arrivals.ts、「搬送 行き先」）。

import type { D1Database } from "@cloudflare/workers-types";
import { ageOn } from "../age.ts";
import { marksOf } from "../caseload.ts";
import { canOpenDocument, scopeHas, viewScope } from "../consent/scope.ts";
import { parseLedger } from "../db/ledger.ts";
import type { ClockRow, ConsentStatus, ContactRow, OfficeKind, PersonOrigin, PersonRow } from "../db/types.ts";
import { deviceText } from "../labels.ts";
import { loadSituation } from "../disaster/db.ts";
import { loadOfficeOverrides, type StoredOverride } from "../disaster/override.ts";
import { personSituation, shortJst, type DisasterSituation } from "../disaster/state.ts";
import { toTriageSignal, triageInDisaster, withinDisaster, type SignalForTriage } from "../disaster/triage.ts";
import { remainOf, SOURCE_LABELS, type Remain } from "../list/detail.ts";
import { DETAIL_LABELS } from "../list/labels.ts";
import { PRESSED_LABELS } from "../signals/labels.ts";
import { COLOR_TONES, markItems, type MarkItem, type StateTone } from "../person.ts";
import { toTriagePerson } from "../triage/from-ledger.ts";
import { compareResults, type Color, type GreenVia, type Situation, type TriageResult } from "../triage/index.ts";
import { DEMO_OFFICE_ID } from "../auth/demo.ts";
import { demoPersonSql } from "../auth/wall.ts";
import type { StaffActor } from "./actor.ts";
import { ARRIVAL_COLUMNS, triageArrivals, type ArrivalRow } from "./arrivals.ts";
import { CUSTODY_LABELS, shownViaSql, type ShownVia } from "./labels.ts";

export type StaffRow = {
  custodyId: string;
  personId: string;
  name: string;
  kana: string;
  age: number | null;
  ageReported: boolean;
  /** 医療依存の短い印（酸素・透析など。担当一覧と同じ） */
  marks: string[];
  /** 同じ印に時計のいちばん短い残りと色（「酸素 4h」。担当一覧と同じ）。375 の幅で医療の列を省くとき氏名の下に出す（T54） */
  markItems: MarkItem[];
  /** 薬の名前（その場で登録した人は時計が無いので、台帳の薬を短く） */
  medications: string[];
  /** 台帳の機器（酸素・透析など）の言葉 */
  devices: string[];
  remain: Pick<Remain, "label" | "text" | "hours" | "tone"> | null;
  shelter: string;
  /** 入り方（依頼から受け入れた物は request。T163） */
  via: ShownVia;
  /** 受け入れた時刻（ISO）と画面の言い方 */
  receivedAt: string;
  receivedWhen: string;
  /** 事業所の名前。所属なしは「所属なし」 */
  office: string;
  unaffiliated: boolean;
  color: Color;
  tone: StateTone;
  /** 表の緑が受入・搬送から来たか（T78）。状態の言葉を「受入」「搬送」にする（lib/labels.ts の stateLabel）。色と順は変えない */
  greenVia?: GreenVia;
  /** 理由の 1 行。医療が範囲の外の人は空（時計・薬の名前が入るので） */
  reason: string;
  /**
   * 受入の前の最後の知らせが赤のとき、その答え（T78。「本人「けが」「動けない」 11/4 10:00」）。受入で表が緑になっても、
   * けが・動けないのまま来たことが行で分かるように。医療が範囲の外の人は出さない（経過の信号の行と同じ。lib/consent/scope.ts）
   */
  before?: string | null;
  /** 表の並び（1 から）。並べ替えても変わらない */
  rank: number;
  /** 医療要約（T07）を開けるか（医療班への提供に同意がある人。lib/consent/scope.ts） */
  summary: boolean;
};

export type StaffBoard = {
  rows: StaffRow[];
  counts: Record<Color, number>;
  /** 自分の開いた受け持ちの避難所（名前の順） */
  shelters: string[];
  /** 要配慮: 医療依存の印（時計）・機器・薬のどれかが台帳にある人の数（医療が範囲にある人だけ数える） */
  medical: number;
};

type CustodyJoin = Pick<PersonRow, "name" | "kana" | "birth_date" | "self_report_unreliable" | "ledger" | "office_id"> & {
  custody_id: string;
  person_id: string;
  shelter: string;
  via: ShownVia;
  received_at: string;
  reported_age: number | null;
  office_name: string;
  office_kind: OfficeKind;
  origin: PersonOrigin;
  /** 医療班への提供の同意と範囲（行が無ければ null） */
  medical_status: ConsentStatus | null;
  medical_scope: string | null;
};

type ClockForBoard = Pick<
  ClockRow,
  "person_id" | "kind" | "category" | "label" | "value" | "unit" | "starts_on" | "depends_on" | "depends_check"
>;
type ContactForBoard = Pick<ContactRow, "person_id" | "supporter_order">;

const IDS = "SELECT value FROM json_each(?1)";

/**
 * 受入の前の最後の知らせ（訓練でない・撤回していない信号。発災から受入の時刻まで）が赤なら、その答えの 1 行（T78）。
 * 誰が・けが・動けない（答えが無ければ「無事じゃない」）・時刻。色と順には使わない（表示だけ）
 */
export function beforeReceive(
  signals: ReadonlyArray<Pick<SignalForTriage, "color" | "source" | "injured" | "can_move" | "occurred_at">>,
  receivedAt: string,
  situation: Situation,
): string | null {
  const until = Date.parse(receivedAt);
  const last = signals
    .filter((s) => withinDisaster(s.occurred_at, situation) && Date.parse(s.occurred_at) <= until)
    .reduce<(typeof signals)[number] | null>((a, s) => (a && Date.parse(a.occurred_at) > Date.parse(s.occurred_at) ? a : s), null);
  if (!last || last.color !== "red") return null;
  const words: string[] = [];
  if (last.injured === 1) words.push(DETAIL_LABELS.injured);
  if (last.can_move === 0) words.push(DETAIL_LABELS.immobile);
  const said = words.length > 0 ? words.map((w) => `「${w}」`).join("") : `「${PRESSED_LABELS.red}」`;
  return `${SOURCE_LABELS[last.source]}${said} ${shortJst(last.occurred_at)}`;
}

/**
 * 自分の受け持ちを読む。now は ISO、today は JST の日付。
 * 審査員（壁の中）はデモの人だけ（T81。前から開いていたほかの事業所の人の受け持ちも出さない。毎朝 4 時の戻しで閉じる）
 */
export async function loadStaffBoard(
  db: D1Database,
  actor: StaffActor,
  today: string,
  now: string = new Date().toISOString(),
): Promise<StaffBoard> {
  const custody = await db
    .prepare(
      `SELECT c.id AS custody_id, c.person_id, c.shelter, ${shownViaSql("c")} AS via, c.received_at,
              p.name, p.kana, p.birth_date, p.reported_age, p.self_report_unreliable, p.ledger, p.office_id, p.origin,
              o.name AS office_name, o.kind AS office_kind,
              (SELECT s.status FROM consents s WHERE s.person_id = p.id AND s.kind = 'medical') AS medical_status,
              (SELECT s.scope FROM consents s WHERE s.person_id = p.id AND s.kind = 'medical') AS medical_scope
         FROM custody c JOIN people p ON p.id = c.person_id JOIN offices o ON o.id = p.office_id
        WHERE c.holder_id = ?1 AND c.released_at IS NULL${actor.walled ? ` AND ${demoPersonSql("p", actor.wallOffice ?? DEMO_OFFICE_ID)}` : ""}
        ORDER BY c.received_at DESC, c.id`,
    )
    .bind(actor.accountId)
    .all<CustodyJoin>();
  const rows = custody.results;
  if (rows.length === 0) return { rows: [], counts: { red: 0, yellow: 0, gray: 0, green: 0 }, shelters: [], medical: 0 };

  const ids = JSON.stringify([...new Set(rows.map((r) => r.person_id))]);
  const [clocks, contacts, signals, arrivals] = await db.batch([
    db
      .prepare(
        `SELECT person_id, kind, category, label, value, unit, starts_on, depends_on, depends_check FROM clocks
          WHERE person_id IN (${IDS}) ORDER BY person_id, sort, id`,
      )
      .bind(ids),
    db.prepare(`SELECT person_id, supporter_order FROM contacts WHERE person_id IN (${IDS})`).bind(ids),
    db
      .prepare(
        `SELECT person_id, color, source, injured, can_move, classes, classified_by, occurred_at FROM signals
          WHERE drill_id IS NULL AND retracted_at IS NULL AND person_id IN (${IDS}) ORDER BY occurred_at, created_at, id`,
      )
      .bind(ids),
    db
      .prepare(`SELECT ${ARRIVAL_COLUMNS} FROM custody WHERE person_id IN (${IDS}) ORDER BY received_at, id`)
      .bind(ids),
  ]);
  const by = <T extends { person_id: string }>(list: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of list) m.set(r.person_id, [...(m.get(r.person_id) ?? []), r]);
    return m;
  };
  const clocksOf = by(clocks.results as ClockForBoard[]);
  const contactsOf = by(contacts.results as ContactForBoard[]);
  const signalsOf = by(signals.results as SignalForTriage[]);
  const arrivalsOf = by(arrivals.results as ArrivalRow[]);

  // 事業所ごとの災害の状況と上書き（所属なしは読まない）
  const offices = [...new Set(rows.filter((r) => r.office_kind !== "unaffiliated").map((r) => r.office_id))];
  const situations = new Map<string, DisasterSituation | null>();
  const overrides = new Map<string, Map<string, StoredOverride>>();
  for (const officeId of offices) {
    const s = await loadSituation(db, officeId, now);
    situations.set(officeId, s);
    if (s) overrides.set(officeId, await loadOfficeOverrides(db, officeId, s));
  }

  const results: Array<{ row: StaffRow; triage: TriageResult }> = rows.map((r) => {
    const ledger = parseLedger(r.ledger);
    const myClocks = clocksOf.get(r.person_id) ?? [];
    const myArrivals = arrivalsOf.get(r.person_id) ?? [];
    const officeSituation = situations.get(r.office_id) ?? null;
    // 平時・所属なし: いちばん早い受け入れを発災とみなし、停電なし
    const situation: DisasterSituation | Situation = officeSituation ?? {
      now,
      disasterAt: myArrivals[0]?.received_at ?? r.received_at,
      outageAt: null,
    };
    const town = ledger.basic.address?.town ?? null;
    const override = overrides.get(r.office_id)?.get(r.person_id);
    const triage = triageInDisaster(
      {
        person: toTriagePerson({
          person: { id: r.person_id, self_report_unreliable: r.self_report_unreliable },
          ledger,
          contacts: contactsOf.get(r.person_id) ?? [],
          clocks: myClocks,
        }),
        signals: (signalsOf.get(r.person_id) ?? []).filter((x) => withinDisaster(x.occurred_at, situation)).map(toTriageSignal),
        arrivals: triageArrivals(myArrivals, situation),
        ...(override ? { override } : {}),
        town,
      },
      situation,
    );
    const own = personSituation(situation, town);
    const remain = remainOf(myClocks, own);
    const unaffiliated = r.office_kind === "unaffiliated";
    // 同意の範囲（本人のページと同じ所）。医療が範囲の外なら医療の列と理由を空に
    const scope = viewScope(actor.role, {
      consents: [{ kind: "medical", status: r.medical_status ?? "unconfirmed", scope: r.medical_scope }],
      origin: r.origin,
    });
    const medicalShown = scopeHas(scope, "medical");
    return {
      triage,
      row: {
        custodyId: r.custody_id,
        personId: r.person_id,
        name: r.name,
        kana: r.kana,
        age: r.birth_date ? ageOn(r.birth_date, today) : r.reported_age,
        ageReported: !r.birth_date && r.reported_age !== null,
        marks: medicalShown ? marksOf(myClocks) : [],
        markItems: medicalShown ? markItems(myClocks, own) : [],
        medications: medicalShown ? ledger.medical.medications.map((m) => m.name) : [],
        devices: medicalShown ? ledger.medical.devices.map(deviceText) : [],
        remain: medicalShown && remain ? { label: remain.label, text: remain.text, hours: remain.hours, tone: remain.tone } : null,
        shelter: r.shelter,
        via: r.via,
        receivedAt: r.received_at,
        receivedWhen: shortJst(r.received_at),
        office: unaffiliated ? CUSTODY_LABELS.unaffiliated : r.office_name,
        unaffiliated,
        color: triage.color,
        tone: COLOR_TONES[triage.color],
        ...(triage.greenVia ? { greenVia: triage.greenVia } : {}),
        reason: medicalShown ? triage.reason : "",
        before: medicalShown ? beforeReceive(signalsOf.get(r.person_id) ?? [], r.received_at, situation) : null,
        rank: 0,
        summary: canOpenDocument(scope, "medical"),
      },
    };
  });

  results
    .slice()
    .sort((a, b) => compareResults(a.triage, b.triage))
    .forEach((x, i) => {
      x.row.rank = i + 1;
    });

  const counts: Record<Color, number> = { red: 0, yellow: 0, gray: 0, green: 0 };
  for (const x of results) counts[x.row.color] += 1;
  return {
    rows: results.map((x) => x.row).sort((a, b) => a.rank - b.rank),
    counts,
    shelters: [...new Set(rows.map((r) => r.shelter))].sort((a, b) => a.localeCompare(b, "ja")),
    medical: results.filter((x) => x.row.marks.length + x.row.devices.length + x.row.medications.length > 0).length,
  };
}
