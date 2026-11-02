import { describe, expect, it } from "vitest";
import { SEED_PEOPLE, SEED_ACCOUNTS } from "../../seed/people.ts";
import { toTriagePerson } from "../triage/from-ledger.ts";
import { rank, type Situation, type TriageSignal } from "../triage/index.ts";
import {
  applyManualRanks,
  buildForm9,
  colorCounts,
  currentEdits,
  FORM9_COLUMNS,
  FORM9_TITLE,
  parseRankForm,
  safetyResult,
  type Form9PersonInput,
  type Form9RankEdit,
  type Form9Reports,
} from "./form9.ts";
import { CSV_BOM, csvCell, csvFileNames, form9Csv, mappedCsv } from "./form9-csv.ts";
import { form9Href, parseEdit, parseError, parseSort, sortRows } from "./form9-href.ts";
import { form9Report, tally } from "./form9-report.ts";

const TODAY = "2026-11-02";
const cmName = SEED_ACCOUNTS.find((a) => a.id === "acct-yamamoto")!.display_name;
const people: Form9PersonInput[] = SEED_PEOPLE.map((p) => ({
  person: { ...p.person, ledger: JSON.stringify(p.ledger) },
  careManager: cmName,
  contacts: p.contacts,
  clocks: p.clocks,
}));

const normal = buildForm9(people, { today: TODAY });
const row = (sheet: { rows: { id: string }[] }, id: string) => sheet.rows.find((r) => r.id === id)! as (typeof normal.rows)[number];

// 大雨の発災時（11/3 09:00 JST 発災、10:00 停電、14:00 の時点）
const SITUATION: Situation = {
  disasterAt: "2026-11-03T00:00:00.000Z",
  outageAt: "2026-11-03T01:00:00.000Z",
  now: "2026-11-03T05:00:00.000Z",
};
const SIGNALS: Record<string, TriageSignal[]> = {
  "p-01": [{ color: "red", source: "family", at: "2026-11-03T03:00:00.000Z", canMove: false }],
  "p-03": [{ color: "green", source: "family", at: "2026-11-03T02:00:00.000Z" }],
  "p-04": [{ color: "green", source: "self", at: "2026-11-03T02:30:00.000Z" }],
  "p-06": [{ color: "green", source: "family", at: "2026-11-03T03:30:00.000Z" }],
  "p-08": [{ color: "green", source: "self", at: "2026-11-03T04:00:00.000Z" }],
  "p-10": [{ color: "green", source: "family", at: "2026-11-03T04:10:00.000Z" }],
};
const REPORTS = new Map<string, Form9Reports>([
  ["p-01", { signals: [{ color: "red", source: "family", whereNow: null, injured: null, canMove: false, at: "2026-11-03T03:00:00.000Z" }], entries: [] }],
  [
    "p-02",
    { signals: [], entries: [{ kind: "transported", authorRole: "medical", place: null, at: "2026-11-03T04:50:00.000Z" }] },
  ],
  ["p-03", { signals: [{ color: "green", source: "family", whereNow: "home", injured: null, canMove: null, at: "2026-11-03T02:00:00.000Z" }], entries: [] }],
  ["p-04", { signals: [{ color: "green", source: "self", whereNow: "home", injured: null, canMove: null, at: "2026-11-03T02:30:00.000Z" }], entries: [] }],
  ["p-06", { signals: [{ color: "green", source: "family", whereNow: "shelter", injured: null, canMove: null, at: "2026-11-03T03:30:00.000Z" }], entries: [] }],
  [
    "p-08",
    {
      signals: [{ color: "green", source: "self", whereNow: "shelter", injured: null, canMove: null, at: "2026-11-03T04:00:00.000Z" }],
      entries: [{ kind: "arrived_shelter", authorRole: "medical", place: "うみなり高台の集会所", at: "2026-11-03T04:30:00.000Z" }],
    },
  ],
  ["p-10", { signals: [{ color: "green", source: "family", whereNow: "home", injured: null, canMove: null, at: "2026-11-03T04:10:00.000Z" }], entries: [] }],
]);
const triage = rank(
  SEED_PEOPLE.map((p) => ({
    person: toTriagePerson({ person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks }),
    signals: SIGNALS[p.person.id] ?? [],
  })),
  SITUATION,
);
const disaster = buildForm9(people, { today: TODAY, triage, reports: REPORTS });

describe("様式 9 の列", () => {
  it("ひな形の様式 9 の列の順（No・優先順位 3 つ・地域／区分・氏名・住所・避難場所 2 つ・特記・担当ケアマネ・安否確認できた日）", () => {
    expect(FORM9_TITLE).toBe("様式9：災害時利用者一覧表 (安否確認優先順位)");
    expect(FORM9_COLUMNS.filter((c) => c.origin === "mhlw").map((c) => c.csv)).toEqual([
      "No",
      "優先順位（医療・介護）",
      "優先順位（環境）",
      "優先順位（避難）",
      "地域／区分",
      "氏名（年齢）",
      "住所（自治会）",
      "想定される避難場所（避難所）",
      "想定される避難場所（介護・医療機関）",
      "特記",
      "担当ケアマネ",
      "安否確認できた日",
    ]);
  });

  it("ケア72 の列はひな形の列のあとに置く（緊急連絡先・理由・方法・結果・手直し）", () => {
    const origins = FORM9_COLUMNS.map((c) => c.origin);
    expect(origins.lastIndexOf("mhlw")).toBeLessThan(origins.indexOf("care72"));
    expect(FORM9_COLUMNS.filter((c) => c.origin === "care72").map((c) => c.id)).toEqual([
      "color",
      "reason",
      "emergency1",
      "emergency2",
      "means",
      "result",
      "manual",
    ]);
  });

  it("画面の見出しは 2〜5 字で、読点を付けない", () => {
    for (const c of FORM9_COLUMNS) {
      expect(c.label.length, c.label).toBeLessThanOrEqual(5);
      expect(c.label).not.toMatch(/[、。]/);
    }
  });
});

describe("平時の優先順位（10 人）", () => {
  it("優先の骨格の段 → 時計の短い順 → 支援者なし → カナ。中村さんが一番下", () => {
    expect(normal.mode).toBe("normal");
    expect(normal.rows.map((r) => r.id)).toEqual([
      "p-02", // 1 呼吸器 内蔵電池 3 時間
      "p-01", // 2 酸素 内蔵電池 2 時間
      "p-03", // 3 透析 2 日
      "p-06", // 4 栄養剤 3 日
      "p-08", // 4 インスリン 4 日
      "p-05", // 5 ステロイド 5 日
      "p-07", // 5 DOAC 7 日
      "p-04", // 6 認知症で独居
      "p-09", // 8 降圧薬 7 日
      "p-10", // 8 時計なし
    ]);
    expect(normal.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(normal.rows.every((r) => r.autoRank === r.rank && r.manual === null)).toBe(true);
    expect(normal.rows.every((r) => r.color === null && r.result === null)).toBe(true);
  });

  it("ひな形の列の中身（山田さん）", () => {
    const r = row(normal, "p-01");
    expect(r.cells).toMatchObject({
      no: "2",
      medicalCare: "2 在宅酸素（酸素・抗凝固）",
      environment: "独居・1階・浸水 3 m",
      evacuation: "支援者 2 人・歩行 一部・手段 娘の車",
      area: "かわなぎ町／要介護3",
      nameAge: "山田 ハナ（84）",
      address: "松山市かわなぎ町",
      shelter: "かわなぎ小学校",
      facility: "",
      notes: "薬は 2 階の箪笥",
      careManager: "山本",
      checkedAt: "",
      color: "",
      reason: "酸素 内蔵電池 2 時間",
      emergency1: "娘 森 恵子 090-0000-0011",
      emergency2: "隣人 木村 ヨシ 090-0000-0012",
      means: "本人電話・家族スマホ・連絡先電話",
      result: "",
      manual: "",
    });
  });

  it("病院の避難先は「介護・医療機関」の欄、印の人は特記に「本人の報告は参考」、支援者なしは理由に", () => {
    expect(row(normal, "p-02").cells).toMatchObject({ shelter: "", facility: "かわなぎ総合病院" });
    expect(row(normal, "p-04").cells.notes).toContain("本人の報告は参考");
    expect(row(normal, "p-04").reason).toBe("認知症で独居");
    expect(row(normal, "p-05").reason).toBe("ステロイド 5 日、支援者なし");
    expect(row(normal, "p-05").cells.evacuation).toContain("支援者なし");
    expect(row(normal, "p-03").reason).toBe("透析 次の回まで 2 日、透析先 未確認");
    expect(row(normal, "p-10").reason).toBe("医療の時計なし");
  });

  it("全員の行に全部の列の文字がある（空でもよいが undefined は無い）", () => {
    for (const r of normal.rows) {
      for (const c of FORM9_COLUMNS) expect(typeof r.cells[c.id], `${r.id} ${c.id}`).toBe("string");
      expect(r.cells.nameAge).toMatch(/（\d+）$/);
      expect(r.cells.emergency1).toMatch(/090-0000-00\d\d/);
    }
  });
});

describe("発災時の優先順位（TriageResult を渡す）", () => {
  it("並びはルールの表の順（色 → 時計の残り → 支援者なし → 骨格）", () => {
    expect(disaster.mode).toBe("disaster");
    expect(disaster.rows.map((r) => r.id)).toEqual(triage.map((t) => t.personId));
    expect(disaster.rows.map((r) => r.id)).toEqual([
      "p-01", // 赤 家族が「動けない」
      "p-02", // 赤 呼吸器の電池を超過
      "p-03", // 黄 透析先 未確認
      "p-05", // 灰 ステロイド 残り 115 時間
      "p-07", // 灰 DOAC 残り 163 時間（骨格 5）
      "p-09", // 灰 降圧薬 残り 163 時間（骨格 8）
      "p-04", // 灰 本人の緑は参考
      "p-06", // 緑 栄養剤 残り 67 時間
      "p-08", // 緑 インスリン 残り 92 時間
      "p-10", // 緑
    ]);
  });

  it("色と理由はルールの表のまま、優先の列は状態の言葉", () => {
    expect(row(disaster, "p-01")).toMatchObject({ color: "red", reason: "家族が「動けない」" });
    expect(row(disaster, "p-01").cells.color).toBe("至急");
    expect(row(disaster, "p-03").cells.color).toBe("要確認");
    expect(row(disaster, "p-04").cells.color).toBe("未知");
    expect(row(disaster, "p-10").cells.color).toBe("無事");
    expect(colorCounts(disaster.rows)).toEqual({ red: 2, yellow: 1, gray: 4, green: 3 });
  });

  it("結果の列は信号と経過から入る（いちばん新しい知らせ、時刻つき）", () => {
    expect(row(disaster, "p-01").cells).toMatchObject({ result: "「無事じゃない」 動けない （家族）", checkedAt: "2026-11-03 12:00" });
    expect(row(disaster, "p-02").cells).toMatchObject({ result: "搬送 （医療班）", checkedAt: "2026-11-03 13:50" });
    expect(row(disaster, "p-03").cells.result).toBe("無事 自宅 （家族）");
    expect(row(disaster, "p-08").cells).toMatchObject({ result: "到着 うみなり高台の集会所 （医療班）", checkedAt: "2026-11-03 13:30" });
    expect(row(disaster, "p-09").cells).toMatchObject({ result: "未確認", checkedAt: "" });
    // 本人の報告を当てにしない人の本人の緑は参考。所在に数えない
    expect(row(disaster, "p-04").result).toMatchObject({ label: "無事", by: "本人・参考", tone: null, location: "unknown" });
  });
});

describe("優先順位の手直し", () => {
  it("手で決めた人は決めた位置に入り、ほかは自動の順のまま詰める", () => {
    const auto = ["a", "b", "c", "d", "e"];
    expect(applyManualRanks(auto, new Map([["e", { rank: 1, at: "t1" }]]))).toEqual(["e", "a", "b", "c", "d"]);
    expect(applyManualRanks(auto, new Map([["a", { rank: 3, at: "t1" }]]))).toEqual(["b", "c", "a", "d", "e"]);
    expect(applyManualRanks(auto, new Map([["a", { rank: 99, at: "t1" }]]))).toEqual(["b", "c", "d", "e", "a"]);
    // 同じ順位はあとで直した人が先
    const both = new Map([
      ["d", { rank: 1, at: "2026-11-02T09:00:00.000Z" }],
      ["e", { rank: 1, at: "2026-11-02T10:00:00.000Z" }],
    ]);
    expect(applyManualRanks(auto, both)).toEqual(["e", "d", "a", "b", "c"]);
    // 並びに居ない人の手直しは使わない
    expect(applyManualRanks(auto, new Map([["z", { rank: 1, at: "t1" }]]))).toEqual(auto);
  });

  const edit = (e: Partial<Form9RankEdit> & Pick<Form9RankEdit, "id" | "person_id" | "rank" | "set_at">): Form9RankEdit => ({
    mode: "normal",
    auto_rank: 10,
    reason: "妻が入院中で夜は独り",
    set_by_name: "山本",
    ...e,
  });

  it("中村さんを 1 位に直すと一番上に来て、自動の順位と理由と直した人が残る", () => {
    const edits = [edit({ id: "e1", person_id: "p-10", rank: 1, set_at: "2026-11-02T09:00:00.000Z" })];
    const sheet = buildForm9(people, { today: TODAY, edits });
    expect(sheet.rows.map((r) => r.id).slice(0, 3)).toEqual(["p-10", "p-02", "p-01"]);
    const r = row(sheet, "p-10");
    expect(r).toMatchObject({ rank: 1, autoRank: 10 });
    expect(r.manual).toEqual({ rank: 1, autoRank: 10, reason: "妻が入院中で夜は独り", by: "山本", at: "2026-11-02T09:00:00.000Z" });
    expect(r.cells.no).toBe("1");
    expect(r.cells.manual).toBe("手直し 自動10→1 妻が入院中で夜は独り（山本 2026-11-02 18:00）");
    expect(row(sheet, "p-02")).toMatchObject({ rank: 2, autoRank: 1, manual: null });
  });

  it("あとから「自動に戻す」と自動の順位に戻る。発災時の手直しは平時に効かない", () => {
    const edits = [
      edit({ id: "e1", person_id: "p-10", rank: 1, set_at: "2026-11-02T09:00:00.000Z" }),
      edit({ id: "e2", person_id: "p-10", rank: null, reason: "", set_at: "2026-11-02T09:30:00.000Z" }),
      edit({ id: "e3", person_id: "p-09", rank: 1, mode: "disaster", set_at: "2026-11-02T09:40:00.000Z" }),
    ];
    expect(currentEdits(edits, "normal").size).toBe(0);
    expect([...currentEdits(edits, "disaster").keys()]).toEqual(["p-09"]);
    const sheet = buildForm9(people, { today: TODAY, edits });
    expect(sheet.rows.map((r) => r.id)).toEqual(normal.rows.map((r) => r.id));
    const inDisaster = buildForm9(people, { today: TODAY, triage, reports: REPORTS, edits });
    expect(inDisaster.rows[0]).toMatchObject({ id: "p-09", rank: 1, autoRank: 6 });
    expect(inDisaster.rows[0].color).toBe("gray"); // 手直しは並びだけで、色は変えない
  });

  it("フォームの受け口: 順位は 1〜人数、理由は必須（戻すときは要らない）", () => {
    expect(parseRankForm({ person: "p-10", rank: "1", reason: " 夜は独り " }, 10)).toEqual({
      ok: true,
      value: { personId: "p-10", rank: 1, reason: "夜は独り" },
    });
    expect(parseRankForm({ person: "p-10", rank: "0", reason: "x" }, 10)).toMatchObject({ ok: false, error: "rank" });
    expect(parseRankForm({ person: "p-10", rank: "11", reason: "x" }, 10)).toMatchObject({ ok: false, error: "rank" });
    expect(parseRankForm({ person: "p-10", rank: "1.5", reason: "x" }, 10)).toMatchObject({ ok: false, error: "rank" });
    expect(parseRankForm({ person: "p-10", rank: "2", reason: "  " }, 10)).toMatchObject({ ok: false, error: "reason" });
    expect(parseRankForm({ person: "p-10", rank: "2", reason: "あ".repeat(201) }, 10)).toMatchObject({ ok: false, error: "reason" });
    expect(parseRankForm({ person: "../x", rank: "2", reason: "x" }, 10)).toMatchObject({ ok: false, error: "person" });
    expect(parseRankForm({ person: "p-10", clear: "1" }, 10)).toEqual({
      ok: true,
      value: { personId: "p-10", rank: null, reason: "" },
    });
  });
});

describe("結果の読み方", () => {
  it("知らせが無ければ未確認、緑は居場所、赤はけが・動けない、経過は種類の言葉", () => {
    expect(safetyResult(undefined)).toMatchObject({ label: "未確認", location: "unknown", at: null });
    expect(safetyResult({ signals: [], entries: [] })).toMatchObject({ label: "未確認" });
    const green = safetyResult({
      signals: [{ color: "green", source: "self", whereNow: "other", injured: null, canMove: null, at: "2026-11-03T01:00:00.000Z" }],
      entries: [],
    });
    expect(green).toMatchObject({ label: "無事", detail: "その他", by: "本人", tone: "ok", location: "other" });
    const red = safetyResult({
      signals: [{ color: "red", source: "self", whereNow: null, injured: true, canMove: false, at: "2026-11-03T01:00:00.000Z" }],
      entries: [],
    });
    expect(red).toMatchObject({ label: "「無事じゃない」", detail: "けが・動けない", tone: "urgent" });
  });

  it("避難所に着いたあとの緑は避難所の名前を残す。搬送のあとは搬送", () => {
    const r = safetyResult({
      signals: [{ color: "green", source: "family", whereNow: "shelter", injured: null, canMove: null, at: "2026-11-03T03:00:00.000Z" }],
      entries: [{ kind: "arrived_shelter", authorRole: "government", place: "かわなぎ小学校", at: "2026-11-03T02:00:00.000Z" }],
    });
    expect(r).toMatchObject({ label: "無事", detail: "かわなぎ小学校", location: "shelter", place: "かわなぎ小学校" });
    const t = safetyResult({
      signals: [{ color: "red", source: "family", whereNow: null, injured: null, canMove: null, at: "2026-11-03T01:00:00.000Z" }],
      entries: [{ kind: "transported", authorRole: "medical", place: null, at: "2026-11-03T02:00:00.000Z" }],
    });
    expect(t).toMatchObject({ label: "搬送", by: "医療班", location: "transported" });
  });
});

describe("CSV", () => {
  const csv = form9Csv(normal, { officeName: "デモ事業所", madeAt: "2026-11-02T09:00:00.000Z" });
  const lines = csv.slice(1).split("\r\n");

  it("UTF-8 の BOM で始まり、行の終わりは CRLF（Excel で開ける）", () => {
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.replaceAll("\r\n", "")).not.toMatch(/\n/);
  });

  it("上にひな形の題名と事業所名・作成日、1 行空けて見出し、その下に 10 人の行（優先順位の順）", () => {
    expect(lines[0]).toBe(FORM9_TITLE);
    expect(lines[1]).toBe("事業所名：デモ事業所,作成：2026年11月2日,並び：平時（優先の骨格）");
    expect(lines[2]).toBe("");
    expect(lines[3]).toBe(FORM9_COLUMNS.map((c) => c.csv).join(","));
    const data = lines.slice(4).filter((l) => l !== "");
    expect(data).toHaveLength(10);
    expect(data[0].startsWith("1,1 人工呼吸器・吸引（呼吸器）,")).toBe(true);
    expect(data[9]).toContain("中村 勇（80）");
    for (const l of data) expect(l.split(",").length).toBeGreaterThanOrEqual(FORM9_COLUMNS.length);
  });

  it("「,」「\"」・改行は囲み、式に見える欄は ' を付ける", () => {
    expect(csvCell("かわなぎ町")).toBe("かわなぎ町");
    expect(csvCell("A,B")).toBe('"A,B"');
    expect(csvCell('「無事」"x"')).toBe('"「無事」""x"""');
    expect(csvCell("1行\n2行")).toBe('"1行\n2行"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+81")).toBe("'+81");
    expect(csvCell("090-0000-0011")).toBe("090-0000-0011");
  });

  it("発災時は結果と確認日時が入る", () => {
    const d = form9Csv(disaster, { officeName: "デモ事業所", madeAt: SITUATION.now });
    expect(d).toContain("並び：発災時（色と順位）");
    const first = d.slice(1).split("\r\n")[4];
    expect(first).toContain("至急");
    expect(first).toContain("2026-11-03 12:00");
  });

  it("事業所の自前の様式の対応表で、列を選んで並べ替える（無い列は空欄）", () => {
    const m = mappedCsv(
      normal,
      {
        title: "安否確認リスト（事業所の様式）",
        columns: [
          { header: "順", from: "no" },
          { header: "利用者", from: "nameAge" },
          { header: "連絡先", from: "emergency1" },
          { header: "確認者", from: null },
        ],
      },
      { officeName: "デモ事業所", madeAt: "2026-11-02T09:00:00.000Z" },
    );
    const ls = m.slice(1).split("\r\n");
    expect(ls[0]).toBe("安否確認リスト（事業所の様式）");
    expect(ls[3]).toBe("順,利用者,連絡先,確認者");
    expect(ls[4]).toBe("1,小林 トシ（86）,夫 小林 健一 090-0000-0013,");
  });

  it("ファイルの名前は JST の日時", () => {
    expect(csvFileNames("2026-11-02T09:05:00.000Z")).toEqual({
      ascii: "form9-20261102-1805.csv",
      utf8: "様式9_20261102-1805.csv",
    });
  });
});

describe("市町村への報告の下書き", () => {
  const text = form9Report(disaster, { officeName: "デモ事業所", at: SITUATION.now });

  it("色ごとの人数・所在の内訳・搬送を決まった形の文に", () => {
    const t = tally(disaster.rows);
    expect(t.colors).toEqual({ red: 2, yellow: 1, gray: 4, green: 3 });
    expect(t.locations).toEqual({ home: 2, shelter: 2, other: 0, transported: 1, unknown: 5 });
    expect(t.shelters).toEqual([
      { name: "うみなり高台の集会所", count: 1 },
      { name: "名称不明", count: 1 },
    ]);
    expect(text).toBe(
      [
        "【安否報告（下書き）】",
        "事業所：デモ事業所",
        "時点：2026年11月3日 14:00",
        "対象：利用者 10 人（様式9 災害時利用者一覧表）",
        "",
        "【安否】",
        "至急 2 人、要確認 1 人、未知 4 人、無事 3 人",
        "",
        "【所在】",
        "自宅 2 人",
        "避難所 2 人（うみなり高台の集会所 1 人、名称不明 1 人）",
        "その他 0 人",
        "不明 5 人",
        "",
        "【搬送】",
        "1 人",
        "",
        "至急・要確認の 3 人は事業所で連絡を続けています。",
        "未知の 4 人は安否を確かめています。",
        "",
      ].join("\n"),
    );
  });

  it("氏名・電話を出さず、「危険」「重症」「判定」「診断」を使わない", () => {
    for (const p of SEED_PEOPLE) expect(text).not.toContain(p.person.name);
    expect(text).not.toMatch(/090-/);
    expect(text).not.toMatch(/危険|重症|判定|診断/);
  });

  it("災害の名前と連絡先は渡したときだけ", () => {
    const withMeta = form9Report(disaster, { officeName: "デモ事業所", at: SITUATION.now, disaster: "大雨", contact: "山本" });
    expect(withMeta).toContain("災害：大雨\n");
    expect(withMeta.trimEnd().endsWith("連絡先：山本")).toBe(true);
  });
});

describe("画面の URL と並び替え", () => {
  it("既定の並び（順位）は書かず、手直しの欄と誤りを足す", () => {
    expect(form9Href({})).toBe("/office/form9");
    expect(form9Href({ sort: "rank", edit: "p-10" })).toBe("/office/form9?edit=p-10");
    expect(form9Href({ sort: "kana", edit: "p-10", error: "reason" })).toBe("/office/form9?sort=kana&edit=p-10&error=reason");
    expect(parseSort("area")).toBe("area");
    expect(parseSort("drop table")).toBe("rank");
    expect(parseSort(["kana"])).toBe("rank");
    expect(parseEdit("p-10")).toBe("p-10");
    expect(parseEdit("../p")).toBeNull();
    expect(parseError("rank")).toBe("rank");
    expect(parseError("toString")).toBeNull();
  });

  it("氏名・地域・担当で並べ替えても、同じなら順位の順。CSV は順位の順のまま", () => {
    expect(sortRows(normal.rows, "rank").map((r) => r.id)).toEqual(normal.rows.map((r) => r.id));
    expect(sortRows(normal.rows, "kana").map((r) => r.kana)[0]).toBe("イトウ フミ");
    const byArea = sortRows(normal.rows, "area");
    expect(byArea.filter((r) => r.town === "かわなぎ町").map((r) => r.id)).toEqual(["p-02", "p-01"]);
    expect(sortRows(normal.rows, "manager").map((r) => r.id)).toEqual(normal.rows.map((r) => r.id));
  });
});
