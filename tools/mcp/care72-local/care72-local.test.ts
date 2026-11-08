// 手元の MCP（tools/mcp/care72-local）。種を入れた D1 の写しを一時フォルダに作り、読む関数と、子の処理として起こしたサーバーを確かめる。
// 返す物は仮名化の層（lib/pseudonym）を通る。種の氏名・電話・町名が返事に出ないことを、種の値と照らして見る。

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../../seed/people.ts";
import { seedStatements } from "../../../seed/sql.ts";
import {
  aiUsage,
  checkLeaks,
  drillDetail,
  drillEvents,
  findLocalD1,
  getPerson,
  listDrills,
  listPeople,
  loadRoster,
  openReadOnly,
} from "./data.ts";
import { TOOL_NAMES } from "./tools.ts";

const ON = "2026-11-02";
// migrations を名前の順に全部（種の入れ直しは 0002 以降の表も空にするので、0001 だけでは通らない）
const migrationsDir = new URL("../../../migrations/", import.meta.url);
const migration = readdirSync(migrationsDir)
  .filter((n) => n.endsWith(".sql"))
  .sort()
  .map((n) => readFileSync(new URL(n, migrationsDir), "utf8"))
  .join("\n");
const serverPath = fileURLToPath(new URL("./server.ts", import.meta.url));

const p01 = SEED_PEOPLE[0];
const daughter = p01.contacts.find((c) => c.kind === "family")!;

/** 種の氏名・カナ・電話・町名（返事に出てはいけない値） */
const SEED_SECRETS = SEED_PEOPLE.flatMap((p) => [
  p.person.name,
  p.person.kana,
  ...(p.ledger.basic.address?.town ? [p.ledger.basic.address.town] : []),
  ...p.contacts.flatMap((c) => [c.name, c.phone].filter((v): v is string => !!v)),
]);

function expectNoSeedSecrets(text: string) {
  for (const s of SEED_SECRETS) expect(text.includes(s), "種の値が出た").toBe(false);
}

let dir: string;
let dbFile: string;

/** 表と種を 1 つの書き込み（transaction）で入れる。文ごとにディスクへ書くと Windows で 2 秒近くかかり、全部のテストを流す混んだ時に時間切れになる */
function seededDb(file: string, withDrill: boolean) {
  const db = new DatabaseSync(file);
  db.exec("BEGIN");
  db.exec(migration);
  db.exec(seedStatements().join("\n"));
  if (withDrill) {
    db.exec(
      `INSERT INTO drills (id, office_id, scenario, status, step, sim_hour, world, score, started_at)
       VALUES ('drill-t', 'office-demo', 'heavy_rain', 'running', 2, 3, '{"roads":"市坪西町の道は通れない"}', NULL, '2026-11-02T08:00:00.000Z')`,
    );
    const ev = db.prepare(
      `INSERT INTO drill_events (id, drill_id, seq, step, sim_hour, person_id, actor, kind, payload)
       VALUES (?, 'drill-t', ?, ?, ?, ?, ?, ?, ?)`,
    );
    ev.run("e1", 1, 1, 1, null, "director", "incident", JSON.stringify({ text: "警戒レベル 4" }));
    ev.run(
      "e2",
      2,
      2,
      3,
      "p-01",
      "persona",
      "persona_turn",
      JSON.stringify({
        action: "娘に電話する",
        speech: `${daughter.name}に ${daughter.phone} でかけた`,
        contactsCaremanager: false,
        pressesRed: false,
        location: "home",
        condition: "息が苦しい",
      }),
    );
    ev.run(
      "e3",
      3,
      2,
      3,
      "p-02",
      "persona",
      "persona_turn",
      JSON.stringify({ action: "待つ", speech: "停電した", contactsCaremanager: true, pressesRed: false, location: "home", condition: "変わりない" }),
    );
    ev.run("e4", 4, 2, 3, "p-01", "care_manager", "action", JSON.stringify({ action: "call_person" }));
  }
  db.exec("COMMIT");
  db.close();
}

/** 表を 1 つだけ持つ小さな .sqlite（置き場の探し方は表があるかだけを見る） */
function tableOnly(file: string, table: string) {
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY)`);
  db.close();
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "care72-mcp-"));
  dbFile = join(dir, "local.sqlite");
  seededDb(dbFile, true);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("手元の D1 を探す", () => {
  it("miniflare の置き場から、people の表がある .sqlite を選ぶ（metadata.sqlite・people の無い物は選ばない、あれば新しい方）", () => {
    // 手元の D1 の置き場（リポジトリの .wrangler）は見ず、一時フォルダに置き場の形を作る
    const root = join(dir, "proj");
    const d1 = join(root, ".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject");
    mkdirSync(d1, { recursive: true });
    tableOnly(join(d1, "metadata.sqlite"), "people");
    tableOnly(join(d1, "zzz999.sqlite"), "_cf_KV");
    writeFileSync(join(d1, "notes.txt"), "x");
    writeFileSync(join(d1, "broken.sqlite"), "SQLite でない");
    tableOnly(join(d1, "abc123.sqlite"), "people");
    expect(findLocalD1(root)).toBe(join(d1, "abc123.sqlite"));
    tableOnly(join(d1, "def456.sqlite"), "people");
    utimesSync(join(d1, "abc123.sqlite"), new Date("2026-11-01T00:00:00Z"), new Date("2026-11-01T00:00:00Z"));
    utimesSync(join(d1, "def456.sqlite"), new Date("2026-11-02T00:00:00Z"), new Date("2026-11-02T00:00:00Z"));
    expect(findLocalD1(root)).toBe(join(d1, "def456.sqlite"));
  });

  it("無ければ null", () => {
    expect(findLocalD1(join(dir, "none"))).toBeNull();
  });
});

describe("読む関数（仮名で返す）", () => {
  const withRoster = <T>(f: (db: DatabaseSync, roster: ReturnType<typeof loadRoster>) => T): T => {
    const db = openReadOnly(dbFile);
    try {
      return f(db, loadRoster(db, ON));
    } finally {
      db.close();
    }
  };

  it("people: 種の 10 人を id の順に A さん〜J さん。氏名・電話・町名は出ない", () => {
    const rows = withRoster((_, r) => listPeople(r));
    expect(rows.map((r) => r.alias)).toEqual("ABCDEFGHIJ".split("").map((c) => `${c} さん`));
    expect(rows.map((r) => r.id)).toEqual(SEED_PEOPLE.map((p) => p.person.id));
    expectNoSeedSecrets(JSON.stringify(rows));
  });

  it("person: 仮名・仮名の字・id のどれでも同じ人。ペルソナに渡るのと同じ形（連絡先は役割名）", () => {
    const [a, b, c] = withRoster((_, r) => [getPerson(r, "A さん"), getPerson(r, "A"), getPerson(r, "p-01")]);
    expect(a).toEqual(b);
    expect(a).toEqual(c);
    expect(a?.alias).toBe("A さん");
    expect(a?.contacts.map((x) => x.role)).toContain("娘");
    expectNoSeedSecrets(JSON.stringify(a));
    expect(withRoster((_, r) => getPerson(r, "Z さん"))).toBeNull();
  });

  it("drills: 一覧と出来事の数", () => {
    const rows = withRoster((db) => listDrills(db, 10));
    expect(rows).toEqual([
      expect.objectContaining({ id: "drill-t", scenario: "heavy_rain", status: "running", step: 2, events: 4, scored: false }),
    ]);
  });

  it("drill_events: 置き換える前の漏れを leaks に、payload は仮名に置き換えて返す", () => {
    const events = withRoster((db, r) => drillEvents(db, r, { drillId: "drill-t" }));
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    const e2 = events[1];
    expect(e2.alias).toBe("A さん");
    expect(e2.leaks).toEqual(expect.arrayContaining(["A さんの娘の名前", "A さんの電話", "電話番号らしい並び"]));
    expect(JSON.stringify(e2.payload)).toContain("A さんの娘");
    expect(JSON.stringify(e2.payload)).toContain("（電話）");
    expect(events[2].leaks).toEqual([]);
    expectNoSeedSecrets(JSON.stringify(events));
  });

  it("drill_events: 種類・仮名・刻みで絞る", () => {
    const persona = withRoster((db, r) => drillEvents(db, r, { drillId: "drill-t", kind: "persona_turn" }));
    expect(persona.map((e) => e.seq)).toEqual([2, 3]);
    const b = withRoster((db, r) => drillEvents(db, r, { drillId: "drill-t", person: "B" }));
    expect(b.map((e) => e.seq)).toEqual([3]);
    const step1 = withRoster((db, r) => drillEvents(db, r, { drillId: "drill-t", toStep: 1 }));
    expect(step1.map((e) => e.seq)).toEqual([1]);
  });

  it("drill: 世界の状態は仮名に置き換え、仮名ごとに種類別の数と最初の時刻", () => {
    const d = withRoster((db, r) => drillDetail(db, r, "drill-t"));
    expect(JSON.stringify(d?.world)).toContain("（町名）");
    expect(d?.byKind).toEqual({ incident: 1, persona_turn: 2, action: 1 });
    expect(d?.byPerson["A さん"]).toEqual({
      persona_turn: { count: 1, firstSimHour: 3 },
      action: { count: 1, firstSimHour: 3 },
    });
    expectNoSeedSecrets(JSON.stringify(d));
    expect(withRoster((db, r) => drillDetail(db, r, "nope"))).toBeNull();
  });

  it("check_leaks: 何が漏れたかだけを返す（値は返さない）", () => {
    const leaks = withRoster((_, r) => checkLeaks(r, `${p01.person.name}さんは元気`));
    // 台帳の氏名と、敬称つきの名前の形（T74）。どちらも何が漏れたかだけで値は無い
    expect(leaks).toEqual(["A さんの氏名", "敬称つきの名前"]);
    expect(withRoster((_, r) => checkLeaks(r, "A さんは家にいる"))).toEqual([]);
  });

  it("ai_usage: 呼んだ回数と token を日・用途・モデルごとに（本文は無い表）", () => {
    expect(withRoster((db) => aiUsage(db))).toEqual([]);
    const w = new DatabaseSync(dbFile);
    w.exec(
      `INSERT INTO ai_calls (id, office_id, purpose, model, day, status, input_tokens, output_tokens, started_at)
       VALUES ('a1', 'office-demo', 'persona', 'claude-haiku-5-5', '2026-11-05', 'ok', 100, 20, '2026-11-05T00:00:00.000Z'),
              ('a2', 'office-demo', 'persona', 'claude-haiku-5-5', '2026-11-05', 'ok', 50, 10, '2026-11-05T00:01:00.000Z')`,
    );
    w.close();
    expect(withRoster((db) => aiUsage(db, "2026-11-05"))).toEqual([
      {
        day: "2026-11-05",
        officeId: "office-demo",
        purpose: "persona",
        model: "claude-haiku-5-5",
        status: "ok",
        calls: 2,
        inputTokens: 150,
        outputTokens: 30,
      },
    ]);
  });
});

describe("サーバー（stdio の子の処理）", () => {
  async function connect(env: Record<string, string>) {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      env: { ...env, PATH: process.env.PATH ?? "" },
      stderr: "ignore",
    });
    const client = new Client({ name: "care72-test", version: "0.0.0" });
    await client.connect(transport);
    return client;
  }
  const text = (r: unknown) =>
    ((r as { content: Array<{ type: string; text?: string }> }).content ?? []).map((c) => c.text ?? "").join("");

  it("道具の一覧が tools.ts と同じで、どれも読むだけの印", async () => {
    const client = await connect({ CARE72_D1_PATH: dbFile });
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
      for (const t of tools) expect(t.annotations?.readOnlyHint, t.name).toBe(true);
    } finally {
      await client.close();
    }
  }, 30_000);

  it("people と check_leaks を呼ぶと仮名で返り、種の値は出ない", async () => {
    const client = await connect({ CARE72_D1_PATH: dbFile });
    try {
      const people = text(await client.callTool({ name: "people", arguments: {} }));
      expect(people).toContain("A さん");
      expect(people).toContain("J さん");
      expectNoSeedSecrets(people);
      const leaks = text(await client.callTool({ name: "check_leaks", arguments: { text: `${daughter.name}に電話` } }));
      expect(leaks).toContain("A さんの娘の名前");
      expectNoSeedSecrets(leaks);
    } finally {
      await client.close();
    }
  }, 30_000);

  it("手元の D1 が無ければ、落ちずに db:reset を促す誤りを返す", async () => {
    const client = await connect({ CARE72_D1_PATH: join(dir, "missing.sqlite") });
    try {
      const r = await client.callTool({ name: "people", arguments: {} });
      expect(r.isError).toBe(true);
      expect(text(r)).toContain("npm run db:reset");
    } finally {
      await client.close();
    }
  }, 30_000);
});
