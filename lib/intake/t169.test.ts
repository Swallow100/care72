// T169: 飛んだ先の案内。欄の名前（pending の field）から本人のページの欄への 1 か所の表（lib/intake/targets.ts）が、全部の未確認の欄を覆うこと。
// 見る方の画面（PersonView）と面の編集（SectionForm）の両方で、対象の欄に紫の印（data-target）が付くことを確かめる。対応の無い欄が出たらここで落ちる。

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams("open=p-01"),
}));

import { PersonView } from "../../components/person/PersonView.tsx";
import { SectionEdit, SectionForm } from "../../components/person/SectionEdit.tsx";
import { SEED_AT, SEED_PEOPLE, seedConsents, type SeedPerson } from "../../seed/people.ts";
import type { Ledger } from "../db/types.ts";
import { buildSidePane, worklistOf } from "../map/side.ts";
import { TARGET_LABELS } from "../labels.ts";
import { fieldLabelOf, FIELDS, focusKeyOf, parseFieldFocus, toPersonView, type PersonPageRows } from "../person.ts";
import { EDIT_SECTIONS, editDraft, type EditData } from "./edit.ts";
import { EXTRA_PENDING_KEYS, FIELD_GROUPS, INTAKE_FIELDS } from "./fields.ts";
import { intakePropsOf } from "./props.ts";
import { editTargetOf, FIELD_PLACES, FOCUS_ALL } from "./targets.ts";

const TODAY = "2026-11-02";

function seedRows(p: SeedPerson, pending?: Ledger["pending"]): PersonPageRows {
  const ledger = pending ? { ...p.ledger, pending } : p.ledger;
  return {
    person: { ...p.person, ledger: JSON.stringify(ledger), created_at: SEED_AT, updated_at: SEED_AT, version: 1 },
    careManagerName: "山本",
    contacts: p.contacts.map((c, i) => ({ ...c, person_id: p.person.id, sort: i })),
    consents: seedConsents(p).map((c) => ({ ...c, recorded_by_name: "山本", recorded_by_role: "care_manager" as const })),
    clocks: p.clocks.map((k, i) => ({ ...k, person_id: p.person.id, sort: i })),
    timeline: [],
  };
}

const yamada = SEED_PEOPLE.find((p) => p.person.id === "p-01")!;
const emptyClock = yamada.clocks.find((k) => k.value == null)!;
const contact = yamada.contacts[0];

/** 面の編集に入れる所が無い欄（表で null。見る方の画面だけ紫） */
const NO_EDIT = new Set(["basic.birth", "basic.selfReport"]);

/** 全部の未確認の場所: 読む側の欄・台帳の欄の表・分からないを残す場所・種の全員の未確認・時計・薬の残りと用量・連絡先の問い */
const ALL_FIELDS = [
  ...new Set([
    ...FIELDS.map((f) => f.key),
    ...INTAKE_FIELDS.map((f) => f.key),
    ...EXTRA_PENDING_KEYS,
    ...SEED_PEOPLE.flatMap((p) => p.ledger.pending.map((x) => x.field)),
    `clocks.${emptyClock.id}`,
    "medical.medications.0.remaining",
    "medical.medications.0.amount",
    "medical.medications.0.storage",
    `contacts.${contact.id}.kana`,
    `contacts.${contact.id}.mobile`,
  ]),
];

const onePending = (field: string) => seedRows(yamada, [{ field, status: "unknown" }]);
const viewOf = (rows: PersonPageRows, focus: string | null, jump = true) =>
  toPersonView(rows, { today: TODAY, reading: true, focus: parseFieldFocus(focus ?? undefined), jump });
const readHtml = (rows: PersonPageRows, focus: string | null) =>
  renderToStaticMarkup(createElement(PersonView, { view: viewOf(rows, focus), level: 2 }));
const editOf = (rows: PersonPageRows): EditData => intakePropsOf(rows, false).edit!;

describe("1 か所の表（lib/intake/targets.ts）", () => {
  it("読む側の欄（FIELDS）の全部の鍵を持ち、余分が無い", () => {
    expect(Object.keys(FIELD_PLACES).sort()).toEqual(FIELDS.map((f) => f.key).sort());
  });

  it("場所は組の表にある項目か組で、打ち間違いが無い", () => {
    const groups = new Set(FIELD_GROUPS.map((g) => g.id));
    const keys = new Set(FIELD_GROUPS.flatMap((g) => g.keys));
    for (const [k, place] of Object.entries(FIELD_PLACES)) {
      for (const i of place?.items ?? []) expect(keys.has(i), `${k} ${i}`).toBe(true);
      for (const g of place?.groups ?? []) expect(groups.has(g), `${k} ${g}`).toBe(true);
    }
  });

  it("面の編集に入れる所が無い欄は決めた物だけ", () => {
    expect(Object.entries(FIELD_PLACES).flatMap(([k, v]) => (v ? [] : [k])).sort()).toEqual([...NO_EDIT].sort());
  });

  it("薬の残りと時計は時計の行、連絡先の問いはその連絡先の行まで絞る", () => {
    expect(editTargetOf("medical.medications.0.remaining", "medical.medications", "k-1")?.clocks).toEqual(["k-1"]);
    expect(editTargetOf("contacts.c-1.kana", "contacts", null)?.contacts).toEqual(["c-1"]);
    expect(editTargetOf("care.walking", "care", null)?.items).toEqual(["care.walking"]);
  });
});

describe("全部の未確認の欄で飛べる", () => {
  it.each(ALL_FIELDS)("%s", (field) => {
    const rows = onePending(field);
    const focus = focusKeyOf(field);
    // URL に載せる鍵は表に通る（任意の文字を受けない）
    expect(parseFieldFocus(focus), "鍵").toBe(focus);

    // 見る方の画面: 紫の欄が 1 つ以上と「要入力」
    const html = readHtml(rows, focus);
    expect(html, "見る方の紫").toContain("data-target");
    expect(html, "見る方の印").toContain(TARGET_LABELS.mark);
    // 欄の名前が読める（その他に落ちない）
    expect(fieldLabelOf(field), "欄の名前").not.toBe("その他");

    // 面の編集: どこかの区分の欄が紫のまま。入れる所が無い欄だけ紫なし
    const view = viewOf(rows, focus);
    const edit = editOf(rows);
    const forms = EDIT_SECTIONS.map((section) =>
      renderToStaticMarkup(createElement(SectionForm, { section, data: edit, draft: editDraft(edit), set: () => {}, targets: view.target?.edit ?? null })),
    ).join("");
    if (NO_EDIT.has(focus)) expect(forms).not.toContain("data-target");
    else expect(forms, "編集の紫").toContain("data-target");
  });

  it("種の未確認の欄（10 人）は、右の面の欄の名前の行からも同じ鍵で飛ぶ", () => {
    for (const p of SEED_PEOPLE) {
      for (const x of p.ledger.pending) {
        expect(readHtml(seedRows(p), focusKeyOf(x.field)), `${p.person.id} ${x.field}`).toContain("data-target");
      }
    }
  });
});

describe("紫の出方", () => {
  const rows = seedRows(yamada);

  it("field が無ければ紫なし。未確認の印は押して飛べる（ケアマネの役）", () => {
    const html = readHtml(rows, null);
    expect(html).not.toContain("data-target");
    expect(html).not.toContain(TARGET_LABELS.mark);
    expect(html).toContain(`data-jump="evacuation.destination2"`);
    expect(html).toContain(`data-jump="${FOCUS_ALL}"`);
    expect(html).toContain('data-jump="section:evacuation"');
    expect(html).toContain("field=evacuation.destination2");
    // 今の画面（?open=）のまま field だけ足す
    expect(html).toContain("open=p-01");
  });

  it("飛べない見方（医療班・行政）にはリンクを出さない", () => {
    const html = renderToStaticMarkup(createElement(PersonView, { view: viewOf(rows, null, false), level: 2 }));
    expect(html).not.toContain("data-jump");
  });

  it("欄を 1 つ選ぶとその欄だけ紫、all は全部", () => {
    const one = readHtml(rows, "evacuation.destination2");
    expect(one.match(/data-target=""/g)).toHaveLength(1);
    expect(one).toMatch(/data-field="evacuation\.destination2"[^>]*data-target=""/);
    expect(readHtml(rows, FOCUS_ALL).match(/data-target=""/g)).toHaveLength(yamada.ledger.pending.length);
  });

  it("見る方の画面の薬の残りの未確認は時計の段に出る（前は印が消えて数と合わなかった）", () => {
    const html = readHtml(rows, "medical.medications");
    expect(html).toMatch(/data-clock="[^"]*" data-target=""/);
    expect(renderToStaticMarkup(createElement(PersonView, { view: viewOf(rows, null), level: 2 })).match(/data-pending="/g)).toHaveLength(yamada.ledger.pending.length);
  });

  it("値が入って未確認が消えたら紫も消える（URL の field は残っていても）", () => {
    const cleared = seedRows(yamada, yamada.ledger.pending.filter((p) => p.field !== "evacuation.destination2"));
    const html = readHtml(cleared, "evacuation.destination2");
    expect(html).not.toContain("data-target");
    expect(viewOf(cleared, "evacuation.destination2").target).toBeNull();
  });

  it("知らない field は受けない（DOM にも URL にも写さない）", () => {
    expect(parseFieldFocus("<script>")).toBeNull();
    expect(parseFieldFocus("section:nothing")).toBeNull();
    expect(parseFieldFocus(["evacuation.destination2", "x"])).toBe("evacuation.destination2");
    expect(readHtml(rows, "<script>")).not.toContain("data-target");
  });

  it("面の編集を開く前の見出しに「要入力」、編集の組の目次にも印", () => {
    const view = viewOf(rows, "evacuation.destination2");
    const html = renderToStaticMarkup(createElement(PersonView, { view, level: 2, edit: editOf(rows) }));
    expect(html).toMatch(/data-section="evacuation"[\s\S]*?data-target-tag/);
    const edit = editOf(rows);
    const form = renderToStaticMarkup(createElement(SectionForm, { section: "evacuation", data: edit, draft: editDraft(edit), set: () => {}, targets: view.target?.edit ?? null }));
    expect(form).toContain("data-group-target");
    expect(form.match(/data-group-target/g)).toHaveLength(1);
    // SectionEdit はそのまま受け取れる
    expect(renderToStaticMarkup(createElement(SectionEdit, { section: "evacuation", data: edit, head: null, children: null, targets: view.target?.edit ?? null }))).toContain("data-edit-open");
  });
});

describe("紫は「今入れる欄」の意味にだけ", () => {
  const ALLOWED = new Set(["components/person/Target.tsx"]);
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? files(p) : p.endsWith(".tsx") ? [p] : [];
    });

  it("mark-target の色を使う部品は components/person/Target.tsx だけ", () => {
    const root = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const hits = ["components", "app"]
      .flatMap((d) => files(join(root, d)))
      .filter((f) => readFileSync(f, "utf8").includes("mark-target"))
      .map((f) => f.slice(root.length).replace(/\\/g, "/"));
    expect(hits.filter((f) => !ALLOWED.has(f))).toEqual([]);
    expect(existsSync(join(root, "components/person/Target.tsx"))).toBe(true);
  });

  it("CSS 変数はライトとダークの両方にある", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    expect(css.match(/--mark-target: #[0-9a-f]{6}/g)).toHaveLength(2);
    expect(css).toContain("--color-mark-target: var(--mark-target)");
  });

  it("印の言葉は 2〜4 字", () => {
    expect([...TARGET_LABELS.mark].length).toBeGreaterThanOrEqual(2);
    expect([...TARGET_LABELS.mark].length).toBeLessThanOrEqual(4);
  });
});

describe("右の面の見直し・未確認の行", () => {
  it("1 人 1 行で、見直しの人が先、欄の名前ごとに飛ぶ先", () => {
    const rows = [
      { id: "a", plan: "created", pending: 5 },
      { id: "b", plan: "draft", pending: 1 },
    ];
    const items = worklistOf({
      pendingTop: rows.map((r) => ({ id: r.id, name: r.id, href: "/", pending: r.pending, labels: [], fields: [], plan: r.plan as "draft" })),
    });
    expect(items.map((r) => r.id)).toEqual(["b", "a"]);
    expect(buildSidePane).toBeTypeOf("function");
  });
});
