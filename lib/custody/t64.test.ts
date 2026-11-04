// T64: 医療班の受け持ちの表と現場の登録で、機器の「その他」に名前を付ける（T57 で台帳に足した devices の detail）。
// - 表の機器の 1 語は lib/labels.ts の deviceText（「その他（電動ベッド）」、ほかの種類は名前だけ）。担当一覧の行も同じ形
// - 現場の登録（新規登録）は、その他を選ぶと名前（1 行、40 字）が要る。空なら断る（名前が無いと何か分からない）。ほかの種類の名前は落とす
// - その他の名前が Claude に流れる道は今の台帳の自由文と同じ仮名化（lib/pseudonym）だけ。ここでは Claude を呼ばない

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_AT, SEED_PEOPLE, seedConsents } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import { toPersonView, type PersonPageRows } from "../person.ts";
import type { Principal } from "../auth/principal.ts";
import { loadCaseload } from "../caseload.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import type { Ledger } from "../db/types.ts";
import { DEVICE_LABELS, deviceText } from "../labels.ts";
import { staffActor, type StaffActor } from "./actor.ts";
import { loadStaffBoard } from "./board.ts";
import { DEVICE_NAME_MAX, parseOnSite } from "./forms.ts";
import { registerRequest } from "./http.ts";
import { CUSTODY_ERROR_LABELS, CUSTODY_ERROR_STATUS } from "./labels.ts";
import { onSiteLedger, receive } from "./store.ts";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const TODAY = "2026-11-03";
const DISASTER_AT = "2026-11-03T00:00:00.000Z";
const AT = "2026-11-03T01:00:00.000Z";
const NOW = "2026-11-03T02:00:00.000Z";
const SHELTER = "みどり小学校";

const medical: Principal = {
  role: "medical",
  judge: true,
  admin: false,
  accountId: "acct-judge",
  displayName: null,
  office: { id: "office-demo", name: "デモ事業所", kind: "demo" },
  caseloadOf: null,
  personId: null,
  contactId: null,
};
const actor = (): StaffActor => staffActor(medical)!;

function heavyRain() {
  sqlite
    .prepare(
      `INSERT INTO disaster_state (office_id, kind, started_at, started_by, outage_scope, version, updated_by, updated_at)
       VALUES ('office-demo', 'heavy_rain', ?, 'acct-yamamoto', 'none', 1, 'acct-yamamoto', ?)`,
    )
    .run(DISASTER_AT, DISASTER_AT);
}

const KUBO = {
  name: "久保 シゲ",
  kana: "くぼ しげ",
  age: "82",
  medications: "",
  contact: {},
  shelter: SHELTER,
};

const ledgerOf = (id: string) => JSON.parse((sqlite.prepare("SELECT ledger FROM people WHERE id = ?").get(id) as { ledger: string }).ledger) as Ledger;
const peopleCount = () => (sqlite.prepare("SELECT count(*) AS n FROM people").get() as { n: number }).n;

describe("機器の 1 語（deviceText）", () => {
  it("その他は名前を括弧で添える。名前が空・空白なら「その他」だけ", () => {
    expect(deviceText({ kind: "other", detail: "電動ベッド" })).toBe("その他（電動ベッド）");
    expect(deviceText({ kind: "other", detail: "  電動ベッド  " })).toBe("その他（電動ベッド）");
    expect(deviceText({ kind: "other" })).toBe("その他");
    expect(deviceText({ kind: "other", detail: "   " })).toBe("その他");
  });

  it("ほかの種類は DEVICE_LABELS のまま（中身の書き足しは添えない）", () => {
    expect(deviceText({ kind: "oxygen", detail: "安静時 2 L/分" })).toBe("在宅酸素");
    expect(deviceText({ kind: "tube_feeding", detail: "胃ろう 経管栄養" })).toBe(DEVICE_LABELS.tube_feeding);
    for (const kind of ["oxygen", "ventilator", "suction", "tube_feeding", "dialysis"] as const) {
      expect(deviceText({ kind })).toBe(DEVICE_LABELS[kind]);
    }
  });
});

describe("現場の登録の読み方（parseOnSite）", () => {
  it("その他は名前つきで受け、ほかの種類の名前は落とす。並びは DEVICE_KINDS の順、重ねない", () => {
    const r = parseOnSite(
      {
        ...KUBO,
        devices: [
          { kind: "other", detail: " 電動ベッド " },
          { kind: "oxygen", detail: "書いても落とす" },
          { kind: "oxygen" },
        ],
      },
      TODAY,
    );
    expect(r.ok && r.value.devices).toEqual([{ kind: "oxygen" }, { kind: "other", detail: "電動ベッド" }]);
  });

  it("前の形（種類の文字の並び）も読む。その他を文字だけで送ると名前が無いので断る", () => {
    const r = parseOnSite({ ...KUBO, devices: ["suction", "oxygen"] }, TODAY);
    expect(r.ok && r.value.devices).toEqual([{ kind: "oxygen" }, { kind: "suction" }]);
    expect(parseOnSite({ ...KUBO, devices: ["other"] }, TODAY)).toEqual({ ok: false, error: "device" });
  });

  it("その他で名前が空・空白なら断る（機器名 未入力）", () => {
    for (const detail of [undefined, "", "   ", null]) {
      expect(parseOnSite({ ...KUBO, devices: [{ kind: "other", detail }] }, TODAY), String(detail)).toEqual({ ok: false, error: "device" });
    }
    expect(CUSTODY_ERROR_LABELS.device).toBe("機器名 未入力");
    expect(CUSTODY_ERROR_STATUS.device).toBe(400);
  });

  it(`名前は 1 行 ${DEVICE_NAME_MAX} 字まで。長い・改行・知らない種類は入力不正`, () => {
    expect(DEVICE_NAME_MAX).toBe(40);
    const ok = parseOnSite({ ...KUBO, devices: [{ kind: "other", detail: "あ".repeat(40) }] }, TODAY);
    expect(ok.ok).toBe(true);
    expect(parseOnSite({ ...KUBO, devices: [{ kind: "other", detail: "あ".repeat(41) }] }, TODAY)).toEqual({ ok: false, error: "invalid" });
    // 改行と続く空白は 1 つの空白にそろえて 1 行に。制御文字は断る
    const joined = parseOnSite({ ...KUBO, devices: [{ kind: "other", detail: "電動\nベッド" }] }, TODAY);
    expect(joined.ok && joined.value.devices).toEqual([{ kind: "other", detail: "電動 ベッド" }]);
    expect(parseOnSite({ ...KUBO, devices: [{ kind: "other", detail: "電動\u0007ベッド" }] }, TODAY)).toEqual({ ok: false, error: "invalid" });
    expect(parseOnSite({ ...KUBO, devices: [{ kind: "bed", detail: "電動ベッド" }] }, TODAY)).toEqual({ ok: false, error: "invalid" });
    expect(parseOnSite({ ...KUBO, devices: [42] }, TODAY)).toEqual({ ok: false, error: "invalid" });
  });

  it("台帳に写すのは その他 の名前だけ", () => {
    const l = onSiteLedger({
      medications: [],
      devices: [{ kind: "oxygen" }, { kind: "other", detail: "電動ベッド" }],
    });
    expect(l.medical.devices).toEqual([{ kind: "oxygen" }, { kind: "other", detail: "電動ベッド" }]);
  });
});

describe("現場の登録 → 台帳 → 受け持ちの表（D1）", () => {
  it("その他の名前が台帳に入り、受け持ちの表の機器に「その他（電動ベッド）」と出る", async () => {
    heavyRain();
    const out = await registerRequest(
      db,
      medical,
      { ...KUBO, devices: [{ kind: "oxygen" }, { kind: "other", detail: "電動ベッド" }] },
      { at: AT, today: TODAY },
    );
    expect(out.status).toBe(200);
    const id = (out.body as { personId: string }).personId;
    expect(ledgerOf(id).medical.devices).toEqual([{ kind: "oxygen" }, { kind: "other", detail: "電動ベッド" }]);
    const row = (await loadStaffBoard(db, actor(), TODAY, NOW)).rows.find((r) => r.personId === id)!;
    expect(row.devices).toEqual(["在宅酸素", "その他（電動ベッド）"]);
  });

  it("その他で名前が空なら登録しない（400「機器名 未入力」、人も受け持ちも増えない）", async () => {
    const before = peopleCount();
    const out = await registerRequest(db, medical, { ...KUBO, devices: [{ kind: "other", detail: "" }] }, { at: AT, today: TODAY });
    expect(out).toMatchObject({ status: 400, body: { ok: false, error: "device", label: "機器名 未入力" } });
    expect(peopleCount()).toBe(before);
    expect((sqlite.prepare("SELECT count(*) AS n FROM custody").get() as { n: number }).n).toBe(0);
  });

  it("台帳から受け入れた人（高橋 p-06、T57 の種）も受け持ちの表で名前つき", async () => {
    heavyRain();
    await receive(db, actor(), { personId: "p-06", shelter: SHELTER, via: "search" }, AT);
    const row = (await loadStaffBoard(db, actor(), TODAY, NOW)).rows.find((r) => r.personId === "p-06")!;
    expect(row.devices).toEqual(["経管栄養", "その他（電動ベッド（エアマット））"]);
  });

  it("担当一覧の行の機器も同じ形", async () => {
    const data = await loadCaseload(db, { officeId: "office-demo", careManagerId: "acct-yamamoto" }, TODAY, NOW);
    const takahashi = data!.rows.find((r) => r.id === "p-06")!;
    expect(takahashi.devices).toEqual(["経管栄養", "その他（電動ベッド（エアマット））"]);
    // その他の無い人は前と同じ（種類の名前だけ）
    const yamada = data!.rows.find((r) => r.id === "p-01")!;
    expect(yamada.devices.every((d) => !d.includes("（"))).toBe(true);
  });
});

// ---------- 本人のページの機器の行も「その他（名前）」の 1 語 ----------

describe("本人のページの機器の行", () => {
  const TODAY_PAGE = "2026-11-02";
  function viewOf(id: string) {
    const p = SEED_PEOPLE.find((x) => x.person.id === id)!;
    const rows: PersonPageRows = {
      person: { ...p.person, ledger: JSON.stringify(p.ledger), created_at: SEED_AT, updated_at: SEED_AT },
      careManagerName: "山本",
      contacts: p.contacts.map((c, i) => ({ ...c, person_id: p.person.id, sort: i })),
      consents: seedConsents(p).map((c) => ({ ...c, recorded_by_name: "山本", recorded_by_role: "care_manager" as const })),
      clocks: p.clocks.map((k, i) => ({ ...k, person_id: p.person.id, sort: i })),
      timeline: [],
    };
    return toPersonView(rows, { today: TODAY_PAGE, mode: "normal" });
  }
  const devices = (id: string) => {
    const v = viewOf(id);
    const row = v.sections
      .flatMap((s) => s.blocks)
      .flatMap((b) => (b.type === "row" ? [b.row] : []))
      .find((r) => r.key === "medical.devices")!;
    return row.field.kind === "lines" ? row.field.lines.map((l) => l.map((s) => s.text).filter((t) => t !== "")) : [];
  };

  it("その他は「その他（名前）」の 1 語で、名前を別の欄に重ねない", () => {
    const d = devices("p-06");
    expect(d[1][0]).toBe("その他（電動ベッド（エアマット））");
    expect(d[1].filter((t) => t.includes("電動ベッド"))).toHaveLength(1);
  });

  it("ほかの種類は前と同じ（種類と中身を別の欄に）", () => {
    expect(devices("p-06")[0].slice(0, 2)).toEqual(["経管栄養", "胃ろう 経管栄養"]);
    expect(devices("p-01")[0].slice(0, 2)).toEqual(["在宅酸素", "酸素濃縮器 1 L/分"]);
  });
});
