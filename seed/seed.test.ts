import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ageOn } from "../lib/age.ts";
import { migratedSqlite } from "../lib/db/test-d1.ts";
import { seedRows } from "../lib/forms/print-harness.ts";
import { buildMatsuyamaSheet } from "../lib/forms/matsuyama.ts";
import { matsuyamaUnconfirmed } from "../lib/forms/unconfirmed.ts";
import { questionQueue } from "../lib/intake/ask.ts";
import { INTAKE_FIELDS, isFilled, ledgerValue } from "../lib/intake/fields.ts";
import { SEED_ACCOUNTS, SEED_OFFICES, SEED_PEOPLE, seedConsents } from "./people.ts";
import { CLEAR_ORDER, seedStatements } from "./sql.ts";

const SEED_DAY = "2026-11-02";

describe("種のデータ（架空の 10 人）", () => {
  it("docs/SPEC.md の表の 10 人で、11 人目は入れない", () => {
    expect(SEED_PEOPLE.map((p) => p.person.name)).toEqual([
      "山田 ハナ",
      "小林 トシ",
      "田中 茂",
      "佐藤 キミ",
      "伊藤 フミ",
      "高橋 ユキ",
      "加藤 正",
      "井上 誠",
      "渡辺 清",
      "中村 勇",
    ]);
  });

  it("年齢は表のとおり（2026-11-02 で）", () => {
    const ages = SEED_PEOPLE.map((p) => ageOn(p.person.birth_date!, SEED_DAY));
    expect(ages).toEqual([84, 86, 79, 88, 89, 91, 78, 76, 82, 80]);
  });

  it("電話は全部 090-0000-00NN で、連絡先の電話と携帯は重ならない（地域の組織の電話も同じ形）", () => {
    const phones = SEED_PEOPLE.flatMap((p) => p.contacts.flatMap((c) => [c.phone, c.mobile ?? null])).filter(
      (v): v is string => v !== null,
    );
    expect(phones.length).toBeGreaterThan(0);
    for (const ph of phones) expect(ph).toMatch(/^090-0000-00\d\d$/);
    expect(new Set(phones).size).toBe(phones.length);
    // 地域の組織（自主防災会）は同じ地区の人で同じ電話。連絡先の番号とは重ならない
    const orgPhones = SEED_PEOPLE.map((p) => p.ledger.local?.orgPhone);
    for (const ph of orgPhones) expect(ph).toMatch(/^090-0000-00\d\d$/);
    for (const ph of orgPhones) expect(phones).not.toContain(ph);
  });

  it("住所は町名までで、番地の数字を持たない", () => {
    for (const p of SEED_PEOPLE) {
      const a = p.ledger.basic.address;
      expect(a, p.person.name).toBeDefined();
      expect(a!.town).not.toMatch(/[0-9０-９]/);
      expect(Object.keys(a!).sort()).toEqual(["city", "town"]);
    }
  });

  it("同意の違いは 7（支援者への提供）と 9（医療班への提供）だけ。AI 提供（T74）は 10 人とも同意", () => {
    const refused = SEED_PEOPLE.flatMap((p) =>
      seedConsents(p)
        .filter((c) => c.status !== "granted")
        .map((c) => `${p.person.id}:${c.kind}`),
    );
    expect(refused).toEqual(["p-07:supporters", "p-09:medical"]);
    for (const p of SEED_PEOPLE) expect(seedConsents(p)).toHaveLength(5);
  });

  it("人が付ける欄: 3 田中の透析の時計は頼り先 透析先・未確認、8 井上のインスリンは保管 確認済（表の入力にしない）、4 佐藤に本人の報告を当てにしない印。ほかは無い", () => {
    const checks = SEED_PEOPLE.flatMap((p) =>
      p.clocks.filter((k) => k.depends_on !== null || k.depends_check !== null).map((k) => [p.person.id, k.id, k.depends_on, k.depends_check]),
    );
    expect(checks).toEqual([
      ["p-03", "k-03-1", "dialysis_center", "unconfirmed"],
      ["p-08", "k-08-1", "storage", "confirmed"],
    ]);
    const marked = SEED_PEOPLE.filter((p) => p.person.self_report_unreliable === 1).map((p) => p.person.id);
    expect(marked).toEqual(["p-04"]);
  });

  it("頼り先と確認は両方あるか、両方無いか（SQL の CHECK）", () => {
    // migrations を全部流す（種の入れ直しは 0002 以降の表も空にするので、0001 だけでは通らない）
    const db = migratedSqlite();
    for (const s of seedStatements()) db.exec(s);
    const put = (id: string, dependsOn: string | null, check: string | null) =>
      db
        .prepare(
          `INSERT INTO clocks (id, person_id, kind, category, label, value, unit, starts_on, depends_on, depends_check)
           VALUES (?, 'p-08', 'supply', 'insulin', 'x', 4, 'day', 'outage', ?, ?)`,
        )
        .run(id, dependsOn, check);
    expect(() => put("k-x1", "refrigeration", null)).toThrow();
    expect(() => put("k-x2", null, "unconfirmed")).toThrow();
    expect(() => put("k-x3", "refrigeration", "maybe")).toThrow();
    expect(() => put("k-x4", "refrigeration", "confirmed")).not.toThrow();
    db.close();
  });

  it("migration と種の SQL が SQLite で通る（外部キーと CHECK を含めて）", () => {
    // migrations を全部流す（種の入れ直しは 0002 以降の表も空にするので、0001 だけでは通らない）
    const db = migratedSqlite();
    for (const s of seedStatements()) db.exec(s);
    const count = (t: string) => (db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
    // デモ事業所の 10 人と、確認用の事業所（T144）の写しの 10 人
    expect(count("people")).toBe(20);
    expect(count("consents")).toBe(100);
    expect(count("contacts")).toBe(2 * SEED_PEOPLE.reduce((n, p) => n + p.contacts.length, 0));
    expect(count("clocks")).toBe(2 * SEED_PEOPLE.reduce((n, p) => n + p.clocks.length, 0));
    // 2 回流しても同じ（最初に空にする）
    for (const s of seedStatements()) db.exec(s);
    expect(count("people")).toBe(20);
    db.close();
  });
});

describe("台帳の書き込み（T142）", () => {
  const TODAY = "2026-11-05";
  const ids = SEED_PEOPLE.map((p) => p.person.id);

  // 空けた所の訳（docs/progress/t142.md）:
  // - 質問で埋める流れの見本: 1 山田の pending 3 つ（避難先 2・夜間支援・ワーファリンの残り）と 7 加藤の夜間支援、山田の既往・予防接種・手帳
  // - 計画は未作成（骨子）: 4 佐藤・5 伊藤・9 渡辺の避難先 1・2 と経路（訓練の採点 lib/drill/score.ts の様式 9 の空欄がこの 3 人を数える）
  // - 紙の頁に余白が無い: 段差・ペット・避難先 2・既往・予防接種・寝たきりの印の一部（埋めると計画書・本人の 1 枚が 3 頁目にあふれる）
  // - 決まり: 世帯の書き足しは施設・その他の世帯の欄。手帳・難病は無い人は空（「なし」と書くと紙の □ に印が付く）。手段の書き足しは選ぶ欄と同じ言葉なら書かない
  it("台帳の項目（入れる欄の表）は、空けると決めた所のほかは埋まっている", () => {
    const empty = Object.fromEntries(
      SEED_PEOPLE.map((p) => [p.person.id, INTAKE_FIELDS.filter((f) => !isFilled(ledgerValue(p.ledger, f.key))).map((f) => f.key)]),
    );
    const d2 = ["evacuation.destination2Means", "evacuation.destination2Minutes"];
    const tail = ["basic.householdNote", "care.handbook", "care.intractableDisease"];
    expect(empty).toEqual({
      "p-01": ["medical.history", "medical.vaccinations", "evacuation.destination2", "evacuation.barriers", "evacuation.pets", ...d2, ...tail],
      "p-02": ["evacuation.destination2", "evacuation.barriers", "evacuation.pets", ...d2, "basic.householdNote", "care.intractableDisease"],
      "p-03": ["medical.history", "medical.vaccinations", "evacuation.destination2", "evacuation.barriers", "evacuation.pets", ...d2, ...tail],
      "p-04": ["evacuation.destination1", "evacuation.destination2", "evacuation.route", "evacuation.barriers", "evacuation.destination1Minutes", ...d2, ...tail],
      "p-05": ["evacuation.destination1", "evacuation.destination2", "evacuation.route", "evacuation.destination1Minutes", ...d2, ...tail],
      "p-06": ["evacuation.destination2", "evacuation.barriers", "evacuation.pets", ...d2, "basic.householdNote", "care.bedridden", "care.handbook", "care.intractableDisease"],
      "p-07": tail,
      "p-08": tail,
      "p-09": ["evacuation.destination1", "evacuation.destination2", "evacuation.transport", "evacuation.route", "evacuation.destination1Minutes", ...d2, ...tail],
      "p-10": tail,
    });
  });

  it("わざと残す未確認（pending）は 1 山田の 3 つと 7 加藤の 1 つ。ほかの人に pending は無い", () => {
    const pending = Object.fromEntries(SEED_PEOPLE.map((p) => [p.person.id, p.ledger.pending.map((x) => `${x.field}:${x.status}`)]));
    expect(pending).toEqual({
      "p-01": ["medical.medications.warfarin.remaining:unknown", "people.night_supporter:not_asked", "evacuation.destination2:unknown"],
      "p-02": [],
      "p-03": [],
      "p-04": [],
      "p-05": [],
      "p-06": [],
      "p-07": ["people.night_supporter:not_asked"],
      "p-08": [],
      "p-09": [],
      "p-10": [],
    });
  });

  it("連絡先は名前のある人にフリガナ（カタカナ）と住所（町名まで、番地なし）と電話。夜間に来られる人は 1 山田・7 加藤のほか全員分かっている", () => {
    const comes = new Set(["family", "supporter", "welfare_commissioner", "visiting_nurse"]);
    for (const p of SEED_PEOPLE) {
      for (const c of p.contacts) {
        if (c.kind === "self") continue;
        expect(c.name, c.id).toBeTruthy();
        expect(c.address, c.id).toMatch(/^\S+[都府県市] \S+$/);
        expect(c.address, c.id).not.toMatch(/[0-9０-９]/);
        expect(c.phone ?? c.mobile, c.id).toBeTruthy();
        // 2 小林の訪問看護のフリガナは空ける（計画書の 1 頁目に余白が無い）
        if (c.id === "c-02-2") expect(c.kana, c.id).toBeNull();
        else expect(c.kana, c.id).toMatch(/^[ァ-ヶー]+( [ァ-ヶー]+)?$/);
      }
      const night = p.contacts.filter((c) => comes.has(c.kind)).map((c) => c.night_ok);
      if (p.person.id === "p-01" || p.person.id === "p-07") expect(night.every((n) => n === null), p.person.id).toBe(true);
      else expect(night.some((n) => n !== null), p.person.id).toBe(true);
    }
  });

  it("かかりつけ医は 3 田中のほか全員、薬局は薬のある人（7 加藤は紙の余白で除く）。介護の事業所は誰にも無い（訓練の出来事の適格が変わらないように）", () => {
    const has = (kind: string) => SEED_PEOPLE.filter((p) => p.contacts.some((c) => c.kind === kind)).map((p) => p.person.id);
    expect(has("home_doctor")).toEqual(ids.filter((id) => id !== "p-03"));
    expect(has("pharmacy")).toEqual(["p-01", "p-04", "p-05", "p-08", "p-09"]);
    expect(has("care_service")).toEqual([]);
  });

  it("計画書（松山市）の紙の未確認の欄は、空けると決めた所だけ", () => {
    const left = Object.fromEntries(
      SEED_PEOPLE.map((p) => [p.person.id, matsuyamaUnconfirmed(buildMatsuyamaSheet(seedRows(p), { today: TODAY, officeName: "デモ事業所" })).fields.map((f) => f.name)]),
    );
    expect(left).toEqual({
      // 本人の電話は 1 人 1 つ（T68）で、固定電話のある山田の携帯番号は置く所が無い。事業所等は介護の事業所を足さないので空く
      "p-01": ["本人 携帯番号", "事業所等", "医薬品情報", "事前避難場所", "特記 医療", "夜間支援"],
      // 吸引器の内蔵電池（時計を足すと色と連絡の順が変わり得るので足さない）
      "p-02": ["実施者2 フリガナ", "事前避難場所", "特記 医療"],
      "p-03": ["事業所等", "かかりつけ医・薬局", "事前避難場所", "特記 医療"],
      // 用量（今の種に無いので足さない）と、時計の無い薬の残り。計画は未作成の 3 人は避難先と経路
      "p-04": ["事業所等", "医薬品情報", "事前避難場所", "市指定避難所", "市指定避難所 手段", "避難経路"],
      "p-05": ["事業所等", "医薬品情報", "事前避難場所", "市指定避難所", "市指定避難所 手段", "避難経路"],
      "p-06": ["事業所等", "事前避難場所"],
      "p-07": ["事業所等", "医薬品情報", "夜間支援"],
      "p-08": ["事業所等", "医薬品情報"],
      // 避難のタイミングはハザードから決まる（ハザードの無い 9 渡辺・10 中村は未確認）
      "p-09": ["事業所等", "医薬品情報", "避難のタイミング", "事前避難場所", "市指定避難所", "市指定避難所 手段", "避難経路"],
      "p-10": ["事業所等", "避難のタイミング"],
    });
  });

  it("次の問いの列（質問で埋める流れ）は、空けると決めた所だけ", () => {
    const queue = Object.fromEntries(SEED_PEOPLE.map((p) => [p.person.id, questionQueue(seedRows(p)).map((q) => q.label)]));
    expect(Object.keys(queue)).toEqual(ids);
    expect(queue).toEqual({
      "p-01": ["ワーファリン 用量", "ワーファリン 保管", "夜間支援", "既往", "予防接種", "段差", "ペット", "手帳", "難病"],
      "p-02": ["避難先2", "段差", "ペット", "難病", "訪問看護 フリガナ"],
      "p-03": ["既往", "予防接種", "避難先2", "段差", "ペット", "手帳", "難病"],
      "p-04": ["抗認知症薬 残り", "抗認知症薬 用量", "避難先1", "避難先2", "経路", "段差", "手帳", "難病"],
      "p-05": ["ステロイド 用量", "支援者1", "避難先1", "避難先2", "経路", "手帳", "難病"],
      "p-06": ["避難先2", "段差", "ペット", "寝たきり", "手帳", "難病"],
      "p-07": ["抗凝固薬（DOAC） 用量", "夜間支援", "手帳", "難病"],
      "p-08": ["インスリン 用量", "手帳", "難病"],
      "p-09": ["降圧薬 用量", "避難先1", "避難先2", "経路", "手帳", "難病"],
      "p-10": ["手帳", "難病"],
    });
  });
});

describe("種の入れ直し（npm run db:reset）", () => {
  /** migrations の全部の表と、その表が外部キーで指す表 */
  function migrationTables(): Map<string, Set<string>> {
    const dir = new URL("../migrations/", import.meta.url);
    const sql = readdirSync(dir)
      .filter((n) => n.endsWith(".sql"))
      .sort()
      .map((n) => readFileSync(new URL(n, dir), "utf8"))
      .join("\n");
    const out = new Map<string, Set<string>>();
    for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+) \(([\s\S]*?)\n\);/g)) {
      const refs = new Set([...m[2].matchAll(/REFERENCES (\w+)/g)].map((r) => r[1]).filter((t) => t !== m[1]));
      out.set(m[1], refs);
    }
    return out;
  }

  it("消す順は migrations の表を全部含み、外部キーで指す側（子）が指される側（親）より先", () => {
    const tables = migrationTables();
    expect(tables.size).toBeGreaterThanOrEqual(14);
    expect([...CLEAR_ORDER].sort()).toEqual([...tables.keys()].sort());
    const at = (t: string) => CLEAR_ORDER.indexOf(t as (typeof CLEAR_ORDER)[number]);
    for (const [child, parents] of tables) {
      for (const parent of parents) expect(at(child), `${child} → ${parent}`).toBeLessThan(at(parent));
    }
  });

  it("AI を呼んだあと・災害モード・事業所の経過・様式 9 の手直し・信号のあとでも流し直せて、全部種に戻る", () => {
    const db = migratedSqlite();
    for (const s of seedStatements()) db.exec(s);
    const office = SEED_OFFICES[0].id;
    const account = SEED_ACCOUNTS[0].id;
    const at = "2026-11-04T01:00:00.000Z";
    db.prepare(
      `INSERT INTO ai_calls (id, office_id, purpose, model, day, status, started_at) VALUES ('ai-1', ?, 'ledger_input', 'm', '2026-11-04', 'pending', ?)`,
    ).run(office, at);
    db.prepare(
      `INSERT INTO disaster_state (office_id, kind, started_at, started_by, updated_by, updated_at) VALUES (?, 'heavy_rain', ?, ?, ?, ?)`,
    ).run(office, at, account, account, at);
    db.prepare(
      `INSERT INTO office_timeline_entries (id, office_id, author_id, author_role, kind, occurred_at) VALUES ('ot-1', ?, ?, 'care_manager', 'disaster_on', ?)`,
    ).run(office, account, at);
    db.prepare(
      `INSERT INTO form9_rank_edits (id, office_id, person_id, mode, rank, auto_rank, reason, set_by, set_at) VALUES ('f9-1', ?, 'p-01', 'disaster', 1, 2, '理由', ?, ?)`,
    ).run(office, account, at);
    db.prepare(`INSERT INTO signals (id, person_id, color, source, occurred_at) VALUES ('s-1', 'p-01', 'red', 'self', ?)`).run(at);
    db.prepare(
      `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, signal_id, occurred_at) VALUES ('t-1', 'p-01', ?, 'care_manager', 'signal', 's-1', ?)`,
    ).run(account, at);
    db.prepare(`UPDATE people SET qr_generation = 2, qr_issued_at = ? WHERE id = 'p-01'`).run(at);

    for (const s of seedStatements()) db.exec(s);
    const count = (t: string) => (db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
    for (const t of ["ai_calls", "disaster_state", "office_timeline_entries", "form9_rank_edits", "signals", "timeline_entries"]) {
      expect(count(t), t).toBe(0);
    }
    expect(count("people")).toBe(20);
    // QR は未作成に戻る（版 0）
    expect(db.prepare(`SELECT qr_generation AS g, qr_issued_at AS t FROM people WHERE id = 'p-01'`).get()).toEqual({ g: 0, t: null });
    db.close();
  });

  it("種はアンケートの表（本物の答え）を消さず、外部キーは取引の終わりまで後回しにする", () => {
    const sql = seedStatements();
    expect(sql[0]).toBe("PRAGMA defer_foreign_keys = true;");
    for (const table of ["survey_responses", "survey_shares", "survey_answers", "survey_links", "survey_attempts"]) {
      expect(sql.some((s) => s.startsWith(`DELETE FROM ${table}`))).toBe(false);
      expect(CLEAR_ORDER).toContain(table);
    }
    expect(sql.some((s) => s === "DELETE FROM offices;")).toBe(true);
  });
});
