// T74: 同意の「AI 提供」（ai_overseas。Claude〔海外の事業者〕に仮名化した台帳を渡すこと）と、入れる欄の文の形の伏せ。
// migration 0024 の契約、種の 10 人と新しい人の行、不同意の人の入れる欄の AI を 403 で断る（未確認は通す）、
// 録音の分類・見え方（様式・QR・医療要約・範囲）は AI 提供に関係なく前と同じ、入れる欄の「伏せ字 N」。
// D1 は node:sqlite に種の 10 人。Claude は偽の client（本物の API は呼ばない）。

import Anthropic from "@anthropic-ai/sdk";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  principal: null as unknown,
  env: null as unknown,
  ctx: null as unknown,
  aiContextCalls: 0,
}));

// route（app/api/intake/*）の外の物だけ差し替える: ログイン（cookie と getCloudflareContext）と事業所の AI の文脈
vi.mock("../auth/server.ts", () => ({ principalFromRequest: async () => ({ principal: h.principal, env: h.env }) }));
vi.mock("../claude/cloudflare.ts", () => ({
  aiContextFor: async () => {
    h.aiContextCalls++;
    if (!h.ctx) {
      const { AiNotConfigured } = await import("../claude/errors.ts");
      throw new AiNotConfigured("anthropic");
    }
    return h.ctx;
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

import { POST as extractPOST } from "../../app/api/intake/extract/route.ts";
import { Intake, LogBubble, type LogEntry } from "../../components/person/Intake.tsx";
import { SEED_PEOPLE, seedConsents } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { sealClassifyInput, classify } from "../classify/classify.ts";
import type { AskJsonContext } from "../claude/call.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { SONNET } from "../claude/models.ts";
import { d1UsageStore } from "../claude/usage.ts";
import { CONSENT_KINDS, type ConsentStatus } from "../db/types.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { buildMatsuyamaSheet } from "../forms/matsuyama.ts";
import { buildMedicalSummary } from "../forms/medical-summary.ts";
import { buildOwnSheet } from "../forms/own-sheet.ts";
import { cleanWords, SPEECH_MAX } from "../drill/persona.ts";
import { reviewWords } from "../drill/review.ts";
import { cleanFarewell, cleanNarration, cleanReason } from "../drill/world-apply.ts";
import { pseudonymInputOf } from "../intake/extract.ts";
import { aiConsentRefusal } from "../intake/http.ts";
import { intakePropsOf, type IntakeProps } from "../intake/props.ts";
import { CONSENT_KIND_LABELS } from "../labels.ts";
import { createPerson } from "../office/people.ts";
import { officeActor } from "../office/scope.ts";
import { loadPersonPage, toPersonView, type PersonPageRows } from "../person.ts";
import { findLeaks, maskReply, pseudonymize, pseudonymizeText } from "../pseudonym/index.ts";
import { buildQrPage } from "../qr/view.ts";
import { AI_CONSENT_REFUSED_LABEL } from "./labels.ts";
import { scopeOfRows } from "./scope.ts";

const AT = "2026-11-04T05:00:00.000Z";
const TODAY = "2026-11-04";
const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
const MIGRATIONS = new URL("../../migrations/", import.meta.url);

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
  h.principal = null;
  h.env = { DB: db };
  h.ctx = null;
  h.aiContextCalls = 0;
});
afterEach(() => sqlite.close());

const yamamoto = (): Principal => ({
  role: "care_manager",
  judge: false,
  admin: true,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: DEMO,
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
});

const setAi = (personId: string, status: ConsentStatus | null) => {
  sqlite.prepare("DELETE FROM consents WHERE person_id = ? AND kind = 'ai_overseas'").run(personId);
  if (status) {
    sqlite
      .prepare("INSERT INTO consents (person_id, kind, status, recorded_by, recorded_at) VALUES (?, 'ai_overseas', ?, 'acct-yamamoto', ?)")
      .run(personId, status, AT);
  }
};

const rowsOf = async (personId: string): Promise<PersonPageRows> => (await loadPersonPage(db, yamamoto(), personId))!;

// ---------- migration 0024 ----------

/** migrations のうち name より前の物だけを流した DB（外部キーを効かせる） */
function migratedBefore(name: string): DatabaseSync {
  const d = new DatabaseSync(":memory:");
  d.exec("PRAGMA foreign_keys = ON;");
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql") && n < name).sort()) {
    d.exec(readFileSync(new URL(f, MIGRATIONS), "utf8"));
  }
  return d;
}

describe("migration 0024（同意の種類に AI 提供）", () => {
  it("consents の CHECK に ai_overseas。列・主キー (person_id, kind)・外部キーは 0001 のまま、退けた表は残らない", () => {
    const tables = sqlite.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name LIKE 'consents%'").all() as Array<{ name: string; sql: string }>;
    expect(tables.map((t) => t.name)).toEqual(["consents"]);
    expect(tables[0].sql).toContain("'ai_overseas'");
    const cols = sqlite.prepare("PRAGMA table_info(consents)").all() as Array<{ name: string; notnull: number; pk: number }>;
    expect(cols.map((c) => [c.name, c.notnull, c.pk])).toEqual([
      ["person_id", 1, 1],
      ["kind", 1, 2],
      ["status", 1, 0],
      ["scope", 0, 0],
      ["recorded_by", 0, 0],
      ["recorded_at", 1, 0],
      ["expires_at", 0, 0],
      ["note", 0, 0],
    ]);
    const fks = sqlite.prepare("PRAGMA foreign_key_list(consents)").all() as Array<{ table: string; from: string; on_delete: string }>;
    expect(fks.map((f) => [f.table, f.from, f.on_delete]).sort()).toEqual([
      ["accounts", "recorded_by", "NO ACTION"],
      ["people", "person_id", "CASCADE"],
    ]);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("ai_overseas の行は入り、知らない種類と同じ人・種類の 2 行目は断る", () => {
    setAi("p-01", "refused");
    expect(sqlite.prepare("SELECT status FROM consents WHERE person_id = 'p-01' AND kind = 'ai_overseas'").get()).toEqual({ status: "refused" });
    expect(() =>
      sqlite.prepare("INSERT INTO consents (person_id, kind, status, recorded_at) VALUES ('p-01', 'ai_other', 'granted', ?)").run(AT),
    ).toThrow(/CHECK/);
    expect(() =>
      sqlite.prepare("INSERT INTO consents (person_id, kind, status, recorded_at) VALUES ('p-01', 'ai_overseas', 'granted', ?)").run(AT),
    ).toThrow(/UNIQUE|PRIMARY/);
  });

  it("前からある行（4 種類・範囲・期限・備考）はそのまま写る", () => {
    const d = migratedBefore("0024");
    d.exec("INSERT INTO offices (id, name, kind, city) VALUES ('office-x', '架空事業所', 'regular', '松山市')");
    d.exec("INSERT INTO accounts (id, office_id, role, display_name) VALUES ('acct-x', 'office-x', 'care_manager', '架空 ケアマネ')");
    d.exec("INSERT INTO people (id, office_id, care_manager_id, name, kana, birth_date) VALUES ('p-x', 'office-x', 'acct-x', '架空 花子', 'カクウ ハナコ', '1940-01-01')");
    const insert = d.prepare(
      "INSERT INTO consents (person_id, kind, status, scope, recorded_by, recorded_at, expires_at, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    insert.run("p-x", "registry", "granted", null, "acct-x", AT, null, null);
    insert.run("p-x", "plan_share", "refused", null, "acct-x", AT, "2027-11-04", "家族と相談");
    insert.run("p-x", "supporters", "unconfirmed", null, null, AT, null, null);
    insert.run("p-x", "medical", "granted", '{"address":true}', "acct-x", AT, null, null);
    // 0024 の前は ai_overseas を断る
    expect(() => insert.run("p-x", "ai_overseas", "granted", null, "acct-x", AT, null, null)).toThrow(/CHECK/);
    const before = d.prepare("SELECT * FROM consents ORDER BY kind").all();
    d.exec(readFileSync(new URL("0024_consent_ai.sql", MIGRATIONS), "utf8"));
    expect(d.prepare("SELECT * FROM consents ORDER BY kind").all()).toEqual(before);
    insert.run("p-x", "ai_overseas", "refused", null, "acct-x", AT, null, null);
    expect(d.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    // 本人を消すと同意も消える（ON DELETE CASCADE が残っている）
    d.exec("DELETE FROM people WHERE id = 'p-x'");
    expect(d.prepare("SELECT count(*) AS n FROM consents").get()).toEqual({ n: 0 });
    d.close();
  });
});

// ---------- 種と新しい人 ----------

describe("同意の行", () => {
  it("種の 10 人は AI 提供も「同意」（seedConsents が CONSENT_KINDS から作る）。ほかの 4 種類は前のまま", () => {
    expect(CONSENT_KINDS).toEqual(["registry", "plan_share", "supporters", "medical", "ai_overseas"]);
    for (const p of SEED_PEOPLE) expect(seedConsents(p).find((c) => c.kind === "ai_overseas")?.status, p.person.id).toBe("granted");
    const rows = sqlite.prepare("SELECT person_id, status FROM consents WHERE kind = 'ai_overseas' ORDER BY person_id").all() as Array<{ status: string }>;
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.status === "granted")).toBe(true);
    // 種の不同意（p-07 支援者・p-09 医療班）は前のまま
    const refused = sqlite.prepare("SELECT person_id, kind FROM consents WHERE status = 'refused' ORDER BY person_id, kind").all();
    expect(refused).toEqual(
      SEED_PEOPLE.flatMap((p) => p.refusedConsents.map((r) => ({ person_id: p.person.id, kind: r.kind }))).sort((a, b) =>
        a.person_id === b.person_id ? (a.kind < b.kind ? -1 : 1) : a.person_id < b.person_id ? -1 : 1,
      ),
    );
  });

  it("新しい人（利用者追加）は 5 種類とも「未確認」の行で入る", async () => {
    const r = await createPerson(
      db,
      officeActor(yamamoto())!,
      { name: "架空 一郎", kana: "カクウ イチロウ", birthDate: "1941-04-01", sex: "male", careManagerId: "acct-yamamoto" },
      AT,
    );
    if (!r.ok) throw new Error("足せない");
    const rows = sqlite.prepare("SELECT kind, status FROM consents WHERE person_id = ? ORDER BY kind").all(r.id);
    expect(rows).toEqual([...CONSENT_KINDS].sort().map((kind) => ({ kind, status: "unconfirmed" })));
  });

  it("本人のページの同意の区分に「AI 提供」が 1 行増える（種の人は同意）", async () => {
    expect(CONSENT_KIND_LABELS.ai_overseas).toBe("AI 提供");
    const v = toPersonView(await rowsOf("p-01"), { today: TODAY });
    const consent = v.sections.find((s) => s.id === "consent")!;
    const rows = consent.blocks.flatMap((b) => (b.type === "row" ? [b.row] : []));
    expect(rows.map((r) => r.label)).toEqual(["名簿登録", "計画共有", "支援者提供", "医療班提供", "AI 提供"]);
    expect(JSON.stringify(rows.at(-1)!.field)).toContain("同意");
  });
});

// ---------- 入れる欄の AI の入口 ----------

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

function fakeClaude(value: unknown) {
  const calls: Params[] = [];
  const client: ClaudeClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return {
            id: "msg_test",
            type: "message",
            role: "assistant",
            model: SONNET,
            content: [{ type: "text", text: JSON.stringify(value), citations: null }],
            stop_reason: "end_turn",
            stop_details: null,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          } as unknown as Anthropic.Beta.Messages.BetaMessage;
        },
      },
    },
  };
  return { client, calls };
}

const EMPTY_OUTPUT = { items: [], medications: [], devices: [], hazards: [], contacts: [], notes: [], unknowns: [] };

const extract = (personId: string, text: string) =>
  extractPOST(
    new Request("https://care72.app/api/intake/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ personId, text }),
    }),
  );

describe("AI 提供の同意で入れる欄の AI を断る", () => {
  it("aiConsentRefusal: 不同意だけ 403「同意 拒否」。未確認・同意・行なしは通す", async () => {
    const res = aiConsentRefusal([{ kind: "ai_overseas", status: "refused" }]);
    expect(res?.status).toBe(403);
    expect(await res!.json()).toEqual({ ok: false, error: "consent_refused", label: AI_CONSENT_REFUSED_LABEL });
    expect(AI_CONSENT_REFUSED_LABEL).toBe("同意 拒否");
    for (const status of ["unconfirmed", "granted"] as const) expect(aiConsentRefusal([{ kind: "ai_overseas", status }])).toBeNull();
    expect(aiConsentRefusal([])).toBeNull();
    // ほかの同意の不同意では断らない（医療班提供の不同意の人も入れる欄は使える）
    expect(aiConsentRefusal([{ kind: "medical", status: "refused" }, { kind: "supporters", status: "refused" }])).toBeNull();
  });

  it("文を分ける入口: 不同意の人は 403 で、事業所の AI の文脈も開かない（Claude を呼ばない）", async () => {
    h.principal = yamamoto();
    setAi("p-01", "refused");
    const res = await extract("p-01", "隣の田中さんが鍵を持っている");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "consent_refused", label: "同意 拒否" });
    expect(h.aiContextCalls).toBe(0);
  });

  it("未確認・行なしは通る（AI の文脈まで進む）", async () => {
    h.principal = yamamoto();
    for (const status of ["unconfirmed", null] as const) {
      setAi("p-02", status);
      h.aiContextCalls = 0;
      const res = await extract("p-02", "娘さんが来た");
      expect(res.status, String(status)).toBe(503);
      expect(await res.json()).toMatchObject({ error: "ai_not_configured" });
      expect(h.aiContextCalls).toBe(1);
    }
  });

  it("同意の人: 入れる欄の文は門を通って（氏名）（住所）（郵便番号）（メール）になり、「伏せ字 N」の数が返る", async () => {
    h.principal = yamamoto();
    const { client, calls } = fakeClaude(EMPTY_OUTPUT);
    const usage = migratedSqlite();
    usage.exec("INSERT INTO offices (id, name, kind, city) VALUES ('office-demo', 'デモ事業所', 'demo', '松山市')");
    const ctx: AskJsonContext = {
      env: { ANTHROPIC_API_KEY: "dummy" },
      usage: d1UsageStore(d1FromSqlite(usage)),
      office: { id: "office-demo", kind: "demo" },
      now: () => new Date(AT),
      claude: client,
    };
    h.ctx = ctx;
    const text = "隣の田中さんが鍵を持っている。○○病院の佐藤先生が主治医。娘の家は愛媛県松山市○○町 1-2-3、〒790-0001、連絡は x@y。娘さんは毎日来る";
    const res = await extract("p-01", text);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { masked: number; ai: { model: string } };
    expect(body.masked).toBe(5);
    expect(calls).toHaveLength(1);
    const sent = JSON.stringify(calls[0].messages);
    for (const secret of ["田中", "佐藤", "愛媛県", "1-2-3", "790-0001", "x@y", "山田", "ハナ"]) expect(sent, secret).not.toContain(secret);
    for (const mark of ["隣の（氏名）", "○○病院の（氏名）", "（住所）", "（郵便番号）", "（メール）", "娘さんは毎日来る"]) expect(sent, mark).toContain(mark);
    usage.close();
  });

  it("写真・PDF を読む入口も、本人の行を読んだすぐあと・Claude を呼ぶ前に同じ確かめを通る", () => {
    for (const path of ["../../app/api/intake/extract/route.ts", "../../app/api/intake/read/route.ts"]) {
      const src = readFileSync(new URL(path, import.meta.url), "utf8");
      const load = src.indexOf("await loadPersonPage(");
      const check = src.indexOf("aiConsentRefusal(rows.consents)");
      const ai = src.indexOf("aiContextFor(");
      expect(load, path).toBeGreaterThan(0);
      expect(check, path).toBeGreaterThan(load);
      expect(ai, path).toBeGreaterThan(check);
    }
  });

  it("録音の分類は AI 提供の同意に関係なく動く（本人が押して話した物。入れる欄の入口を通らない）", async () => {
    setAi("p-01", "refused");
    const rows = await rowsOf("p-01");
    const { key } = pseudonymize([pseudonymInputOf(rows)], { on: TODAY });
    const { client, calls } = fakeClaude({ category: "injury", confidence: 0.9, memo: {} });
    const usage = migratedSqlite();
    usage.exec("INSERT INTO offices (id, name, kind, city) VALUES ('office-demo', 'デモ事業所', 'demo', '松山市')");
    const ctx: AskJsonContext = {
      env: { ANTHROPIC_API_KEY: "dummy" },
      usage: d1UsageStore(d1FromSqlite(usage)),
      office: { id: "office-demo", kind: "demo" },
      now: () => new Date(AT),
      claude: client,
    };
    await classify(sealClassifyInput({ transcript: "足をけがして動けない", answers: null, audio: null }, key), ctx);
    expect(calls).toHaveLength(1);
    // 録音・訓練・まとめの道は同意の種類を見ない（断るのは入れる欄の入口の 1 か所だけ）
    for (const path of ["../classify/classify.ts", "../drill/persona.ts", "../signals/phone.ts"]) {
      expect(readFileSync(new URL(path, import.meta.url), "utf8"), path).not.toMatch(/ai_overseas|aiConsentRefusal/);
    }
    usage.close();
  });
});

// ---------- 見え方は変わらない ----------

describe("AI 提供は見え方（範囲・様式・QR・医療要約・本人の 1 枚）に使わない", () => {
  it("同意・不同意・未確認・行なしで、どの役の範囲も書類も同じ", async () => {
    for (const id of ["p-01", "p-07", "p-09"]) {
      const variants: PersonPageRows[] = [];
      for (const status of ["granted", "refused", "unconfirmed", null] as const) {
        setAi(id, status);
        variants.push(await rowsOf(id));
      }
      const [base, ...rest] = variants;
      const opts = { today: TODAY, officeName: "デモ事業所" };
      for (const v of rest) {
        for (const role of ["care_manager", "medical", "government", "family", "self"] as const) {
          expect(scopeOfRows(role, v), `${id} ${role}`).toEqual(scopeOfRows(role, base));
        }
        expect(buildMatsuyamaSheet(v, opts), id).toEqual(buildMatsuyamaSheet(base, opts));
        expect(buildMedicalSummary(v, opts), id).toEqual(buildMedicalSummary(base, opts));
        expect(buildOwnSheet(v, opts), id).toEqual(buildOwnSheet(base, opts));
        expect(buildQrPage(v, opts), id).toEqual(buildQrPage(base, opts));
      }
    }
  });
});

// ---------- 画面 ----------

describe("入れる欄の「伏せ字 N」", () => {
  const split = (masked?: number): LogEntry => ({
    id: "log-1",
    who: "ai",
    kind: "split",
    say: "2 項目に分けました",
    proposal: { model: SONNET, dropped: 0, rows: [], ...(masked === undefined ? {} : { masked }) },
    state: "open",
  });
  const draw = (e: LogEntry) =>
    renderToStaticMarkup(
      createElement(LogBubble, {
        entry: e,
        props: {} as IntakeProps,
        busy: false,
        aiReady: true,
        onRows: () => {},
        onSave: async () => {},
        onDiscard: () => {},
        onRetry: () => {},
      }),
    );

  it("伏せた所があれば AI の吹き出しに「伏せ字 N」の 1 語（何を伏せたかは出さない）。無ければ出さない", () => {
    const html = draw(split(3));
    expect(html).toContain('data-intake="masked"');
    expect(html).toMatch(/伏せ字 3/);
    expect(draw(split(0))).not.toContain('data-intake="masked"');
    expect(draw(split())).not.toContain('data-intake="masked"');
  });
});

// ---------- T74 の続き（11/4 設計の答え） ----------

describe("不同意の人は本人のページを開いた時点で入れる欄の AI を押せない", () => {
  const draw = (rows: PersonPageRows, aiReady = true) =>
    renderToStaticMarkup(createElement(Intake, { ...intakePropsOf(rows, aiReady), level: 1 }));

  it("props: 不同意だけ aiConsentRefused。未確認・同意・行なしは false", async () => {
    for (const [status, want] of [["refused", true], ["unconfirmed", false], ["granted", false], [null, false]] as const) {
      setAi("p-01", status);
      expect(intakePropsOf(await rowsOf("p-01"), true).aiConsentRefused, String(status)).toBe(want);
    }
  });

  it("開いた時点で上に「同意 拒否」、分ける・写真と PDF 読取は押せない。文字の欄・問いの選ぶ答え・次回は使える", async () => {
    setAi("p-01", "refused");
    const h = draw(await rowsOf("p-01"));
    expect(h).toContain("同意 拒否");
    const split = h.match(/<button[^>]*data-intake="split"[^>]*>/)![0];
    expect(split).toMatch(/disabled=""/);
    const read = h.match(/<label[^>]*data-intake="read"[^>]*>/)![0];
    expect(read).toContain('aria-disabled="true"');
    expect(read).toContain("pointer-events-none");
    const file = h.match(/<input[^>]*type="file"[^>]*>/)![0];
    expect(file).toMatch(/disabled=""/);
    // 文字の欄は書ける（手で書いて残す。分けるのは押せない）
    const text = h.match(/<textarea[^>]*aria-label="入力"[^>]*>/)![0];
    expect(text).not.toMatch(/disabled=""/);
    // 鍵が無くても「同意 拒否」が先（何が止めているかを出す）
    expect(draw(await rowsOf("p-01"), false)).toContain("同意 拒否");
  });

  it("同意・未確認の人は今までどおり（鍵があれば押せる、無ければ AI 未設定）", async () => {
    for (const status of ["granted", "unconfirmed"] as const) {
      setAi("p-01", status);
      const h = draw(await rowsOf("p-01"));
      expect(h, status).not.toContain("同意 拒否");
      expect(h.match(/<label[^>]*data-intake="read"[^>]*>/)![0], status).not.toContain("aria-disabled");
      expect(draw(await rowsOf("p-01"), false), status).toContain("AI 未設定");
    }
  });
});

describe("Claude の返事の作った名前は捨てずに伏せ字に（入力側は今のまま厳しい）", () => {
  const p01 = SEED_PEOPLE.find((p) => p.person.id === "p-01")!;
  const { key } = pseudonymize([{ person: p01.person, ledger: p01.ledger, contacts: p01.contacts, clocks: p01.clocks, consents: seedConsents(p01) }], {
    on: TODAY,
  });

  it("maskReply: 作った名前・住所・郵便番号・メールは伏せ字に置き換えて返す。台帳の名前・電話・電話の形は null", () => {
    expect(maskReply("隣の佐藤さんが水を持ってきてくれた", key)).toBe("隣の（氏名）が水を持ってきてくれた");
    expect(maskReply("娘さんと A さんは無事", key)).toBe("娘さんと A さんは無事");
    expect(maskReply("避難所は愛媛県松山市○○町 1-2-3、〒790-0001、x@y", key)).toBe("避難所は（住所）、（郵便番号）、（メール）");
    expect(maskReply("山田 ハナが家にいる", key)).toBeNull();
    expect(maskReply("娘の番号は 090-0000-0011", key)).toBeNull();
    expect(maskReply("電話は 089-000-0000", key)).toBeNull();
  });

  it("入力側（Claude に渡す前）は今のまま: 形が残れば findLeaks が見つけ、pseudonymizeText は伏せてから門を通す", () => {
    expect(findLeaks("隣の佐藤さん", key)).toEqual(["敬称つきの名前"]);
    expect(pseudonymizeText("隣の佐藤さん", key).text).toBe("隣の（氏名）");
    // 門の実行時の確かめ: 伏せたあとの物は通り、伏せていない形は通らない（findLeaks の結果は呼ぶ側で止める）
    expect(findLeaks(pseudonymizeText("隣の佐藤さん", key), key)).toEqual([]);
  });

  it("本人役の言葉: 近所の人の名前を作っても黙らず（氏名）に。仮名は「本人」に。台帳の名前・電話は今までどおり捨てる", () => {
    expect(cleanWords("隣の佐藤さんが来てくれた", key, SPEECH_MAX)).toBe("隣の（氏名）が来てくれた");
    expect(cleanWords("A さんの家に田中さんがいる", key, SPEECH_MAX)).toBe("本人の家に（氏名）がいる");
    expect(cleanWords("娘さんが来た", key, SPEECH_MAX)).toBe("娘さんが来た");
    expect(cleanWords("山田 ハナです", key, SPEECH_MAX)).toBeNull();
    expect(cleanWords("090-0000-0011 に電話して", key, SPEECH_MAX)).toBeNull();
  });

  it("講評・世界の 1 文・結末と理由も同じ（伏せ字のあとに仮名を氏名に戻す）", () => {
    expect(reviewWords("A さんの隣の佐藤さんに頼めば早かった", key, 200)).toBe("山田 ハナさんの隣の（氏名）に頼めば早かった");
    expect(reviewWords("山田 ハナへの電話が遅い", key, 200)).toBeNull();
    const n = cleanNarration("田中さんの店の前の道が水につかった", key);
    expect(n).toEqual({ room: "（氏名）の店の前の道が水につかった", text: "（氏名）の店の前の道が水につかった" });
    expect(cleanNarration("090-0000-0011 から通報", key)).toBeNull();
    expect(cleanFarewell("A さんのもとに佐藤さんが着く前に時間が過ぎた", key)).toBe("山田 ハナさんのもとに（氏名）が着く前に時間が過ぎた");
    expect(cleanReason("近所の鈴木さんも道が通れなかった", key)).toBe("近所の（氏名）も道が通れなかった");
    expect(cleanReason("山田 ハナの家は停電", key)).toBeNull();
  });
});
