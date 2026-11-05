// T145: 本人のページの面の編集を区分の中の小さな組に分ける。
// 組の表（lib/intake/fields.ts の FIELD_GROUPS）が台帳の欄の表と読む側の欄を漏れなく・重ならずに覆うこと、
// 面の編集（components/person/SectionEdit.tsx の SectionForm）が各欄をその鍵を持つ組の中に出すことを確かめる。

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SectionForm } from "../../components/person/SectionEdit.tsx";
import { SEED_AT, SEED_PEOPLE, seedConsents, type SeedPerson } from "../../seed/people.ts";
import { CONTACT_KINDS, CONSENT_KINDS, type ContactKind } from "../db/types.ts";
import { FIELDS, type PersonPageRows } from "../person.ts";
import { blankContact, EDIT_SECTIONS, editChanges, editDraft, type EditData, type EditDraft, type EditSection } from "./edit.ts";
import {
  EXTRA_PENDING_KEYS,
  FIELD_GROUPS,
  INTAKE_FIELDS,
  groupOfContactKind,
  groupOfKey,
  groupsOf,
} from "./fields.ts";
import { intakePropsOf } from "./props.ts";

function seedRows(p: SeedPerson): PersonPageRows {
  return {
    person: { ...p.person, ledger: JSON.stringify(p.ledger), created_at: SEED_AT, updated_at: SEED_AT, version: 1 },
    careManagerName: "山本",
    contacts: p.contacts.map((c, i) => ({ ...c, person_id: p.person.id, sort: i })),
    consents: seedConsents(p).map((c) => ({ ...c, recorded_by_name: "山本", recorded_by_role: "care_manager" as const })),
    clocks: p.clocks.map((k, i) => ({ ...k, person_id: p.person.id, sort: i })),
    timeline: [],
  };
}

const editOf = (p: SeedPerson): EditData => intakePropsOf(seedRows(p), false).edit!;

const form = (section: EditSection, d: EditData, draft: EditDraft = editDraft(d), active: string | null = null) =>
  renderToStaticMarkup(createElement(SectionForm, { section, data: d, draft, set: () => {}, active }));

/** 組の箱ごとの中身（data-group="…" の印で切る。組の箱は入れ子にならない） */
function groupSlices(html: string): Array<{ id: string; html: string }> {
  const parts = html.split('data-group="');
  return parts.slice(1).map((p) => ({ id: p.slice(0, p.indexOf('"')), html: p }));
}

const attrs = (html: string, name: string) => [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((m) => m[1]);

/** 読む側の欄（lib/person.ts の FIELDS）のうち、1 つの組に置かない物。心身は移動・感覚・認知の 3 つの組にまたがる 1 行、連絡先は連絡先の種類（contactKinds）で組が決まる */
const COMPOSITE_VIEW_KEYS = new Set(["care", "contacts"]);
/** 面の編集にだけある項目（読む側の欄に無い） */
const EDIT_ONLY_KEYS = new Set(["basic.location"]);
/** 読む側にだけある組（連絡先は関係者の面で直す） */
const VIEW_ONLY_GROUPS = new Set(["medical-doctor"]);

describe("組の表（lib/intake/fields.ts の FIELD_GROUPS、T145）", () => {
  const owners = (key: string) => FIELD_GROUPS.filter((g) => g.keys.includes(key));

  it("台帳の欄の表（INTAKE_FIELDS）の欄は、どれもちょうど 1 つの組に入り、組の区分は欄の区分と同じ", () => {
    for (const f of INTAKE_FIELDS) {
      const gs = owners(f.key);
      expect(gs.map((g) => g.id), f.key).toHaveLength(1);
      expect(gs[0].section, f.key).toBe(f.section);
    }
  });

  it("読む側の欄（lib/person.ts の FIELDS）も、どれもちょうど 1 つの組に入り、区分は同じ（心身・連絡先の 2 つの合わせた行を除く）", () => {
    for (const f of FIELDS) {
      if (COMPOSITE_VIEW_KEYS.has(f.key)) {
        expect(owners(f.key), f.key).toHaveLength(0);
        continue;
      }
      const gs = owners(f.key);
      expect(gs.map((g) => g.id), f.key).toHaveLength(1);
      expect(gs[0].section, f.key).toBe(f.section);
    }
    // 心身の部分（care.*）は全部どこかの組にある
    for (const k of ["walking", "hearing", "vision", "understanding", "judgment", "orientation", "bedridden", "dementia"]) {
      expect(owners(`care.${k}`), k).toHaveLength(1);
    }
  });

  it("「分からない」を残す場所（EXTRA_PENDING_KEYS）と同意の種類も組に入る", () => {
    for (const k of EXTRA_PENDING_KEYS) expect(owners(k), k).toHaveLength(1);
    for (const k of CONSENT_KINDS) expect(owners(`consent.${k}`), k).toHaveLength(1);
  });

  it("組の鍵は台帳の欄の表か読む側の欄か編集だけの項目のどれか（打ち間違いが無い）。1 つの組の中でも重ならない", () => {
    const known = new Set([...INTAKE_FIELDS.map((f) => f.key), ...FIELDS.map((f) => f.key), ...EDIT_ONLY_KEYS]);
    for (const g of FIELD_GROUPS) {
      for (const k of g.keys) expect(known.has(k), `${g.id} ${k}`).toBe(true);
      expect(new Set(g.keys).size, g.id).toBe(g.keys.length);
    }
  });

  it("連絡先の種類（CONTACT_KINDS）は、どれもちょうど 1 つの関係者の組に入る。関係者のほかの組は種類を持たない", () => {
    for (const kind of CONTACT_KINDS) {
      const gs = FIELD_GROUPS.filter((g) => g.contactKinds?.includes(kind));
      expect(gs.map((g) => g.id), kind).toHaveLength(1);
      expect(gs[0].section, kind).toBe("people");
      expect(groupOfContactKind(kind)?.id).toBe(gs[0].id);
    }
    for (const g of FIELD_GROUPS) if (g.section !== "people") expect(g.contactKinds, g.id).toBeUndefined();
  });

  it("組の id は全部で 1 つずつ、見出しは区分の中で 1 つずつで 4 字まで、文にしない（を・が・の・読点・句点なし）", () => {
    expect(new Set(FIELD_GROUPS.map((g) => g.id)).size).toBe(FIELD_GROUPS.length);
    for (const s of EDIT_SECTIONS) {
      const labels = groupsOf(s).map((g) => g.label);
      expect(new Set(labels).size, s).toBe(labels.length);
      expect(labels.length, s).toBeGreaterThanOrEqual(2);
    }
    for (const g of FIELD_GROUPS) {
      expect([...g.label].length, g.label).toBeLessThanOrEqual(4);
      expect(g.label, g.id).not.toMatch(/[をがの、。]/);
    }
  });

  it("groupsOf は表の並び、groupOfKey は欄の下の場所（basic.address.city）も上の鍵の組に", () => {
    for (const s of EDIT_SECTIONS) expect(groupsOf(s)).toEqual(FIELD_GROUPS.filter((g) => g.section === s));
    expect(groupOfKey("basic.address.city")?.id).toBe(groupOfKey("basic.address")?.id);
    expect(groupOfKey("basic.housing.floor")?.section).toBe("evacuation");
    expect(groupOfKey("nothing.here")).toBeUndefined();
  });
});

/** 欄の印（data-…）から、その欄の鍵（組の表の鍵）へ */
function keysIn(slice: string): string[] {
  const out: string[] = [];
  for (const f of attrs(slice, "data-field")) out.push(f);
  for (const _ of attrs(slice, "data-med")) out.push("medical.medications");
  for (const _ of attrs(slice, "data-device")) out.push("medical.devices");
  if (slice.includes("data-new-device-other")) out.push("medical.devices");
  for (const _ of attrs(slice, "data-clock")) out.push("clocks");
  for (const _ of attrs(slice, "data-hazard")) out.push("evacuation.hazards");
  if (slice.includes("data-new-hazard-other")) out.push("evacuation.hazards");
  for (const _ of attrs(slice, "data-note")) out.push("notes");
  for (const k of attrs(slice, "data-consent")) out.push(`consent.${k}`);
  return out;
}

describe("面の編集を組に分ける（components/person/SectionEdit.tsx の SectionForm、T145）", () => {
  it("種の 10 人のどの面も、組の箱は表の並びで出て（読む側だけの組を除く）、各欄はその鍵を持つ組の中に出る", () => {
    for (const p of SEED_PEOPLE) {
      const d = editOf(p);
      const draft = editDraft(d);
      for (const s of EDIT_SECTIONS) {
        const html = form(s, d, draft);
        const slices = groupSlices(html);
        const expected = groupsOf(s).filter((g) => !VIEW_ONLY_GROUPS.has(g.id));
        expect(slices.map((x) => x.id), `${p.person.id} ${s}`).toEqual(expected.map((g) => g.id));
        for (const slice of slices) {
          const group = FIELD_GROUPS.find((g) => g.id === slice.id)!;
          // 見出し
          expect(slice.html, `${p.person.id} ${slice.id}`).toContain(`>${group.label}</`);
          for (const key of keysIn(slice.html)) {
            expect(groupOfKey(key)?.id, `${p.person.id} ${s} ${key}`).toBe(slice.id);
          }
          // 連絡先の行は、その種類の組の中
          for (const cid of attrs(slice.html, "data-contact")) {
            const kind = d.contacts.find((c) => c.id === cid)?.kind;
            expect(group.contactKinds, `${p.person.id} ${cid}`).toContain(kind);
          }
        }
        // 欄の表の欄は全部、ちょうど 1 回出る
        for (const f of INTAKE_FIELDS.filter((x) => x.section === s)) {
          expect(attrs(html, "data-field").filter((k) => k === f.key), `${p.person.id} ${f.key}`).toHaveLength(1);
        }
        // 連絡先も全部（本人の行を含む）
        if (s === "people") {
          expect(attrs(html, "data-contact").sort(), p.person.id).toEqual(d.contacts.map((c) => c.id).sort());
        }
      }
    }
  });

  it("組が 3 つ以上の面は、上に組の目次（表の並び）。押すと飛ぶ先は組の箱。同意の面（2 つ）は目次なし", () => {
    const d = editOf(SEED_PEOPLE[0]);
    for (const s of EDIT_SECTIONS) {
      const html = form(s, d);
      const shown = groupSlices(html).map((x) => x.id);
      const links = attrs(html, "data-group-link");
      if (shown.length >= 3) {
        expect(links, s).toEqual(shown);
        // 目次は組の箱より前
        expect(html.indexOf("data-group-link"), s).toBeLessThan(html.indexOf('data-group="'));
        for (const id of shown) expect(html, id).toMatch(new RegExp(`id="[^"]*${id}"[^>]*data-group="${id}"|data-group="${id}"[^>]*id="[^"]*${id}"`));
      } else {
        expect(links, s).toEqual([]);
      }
    }
    expect(attrs(form("consent", d), "data-group-link")).toEqual([]);
  });

  it("今直している組（active）は見出しを強く・目次の印。ほかの組と、何も選んでいない時は印なし", () => {
    const d = editOf(SEED_PEOPLE[0]);
    const none = form("basic", d);
    expect(none).not.toContain("data-active");
    expect(none).not.toContain('aria-current="true"');
    const html = form("basic", d, editDraft(d), "basic-address");
    const slices = groupSlices(html);
    const active = slices.filter((x) => /^[^>]*data-active/.test(x.html));
    expect(active.map((x) => x.id)).toEqual(["basic-address"]);
    expect(attrs(html, "data-group-link").length).toBeGreaterThan(0);
    expect(html).toMatch(/aria-current="true"[^>]*data-group-link="basic-address"|data-group-link="basic-address"[^>]*aria-current="true"/);
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
  });

  it("組の間は地の色の差（組の箱は面と違う地）。枠線・details・ピル型・番号・等幅・影・グラデーション・中で送る箱を使わない", () => {
    const d = editOf(SEED_PEOPLE[0]);
    for (const s of EDIT_SECTIONS) {
      const html = form(s, d, editDraft(d), groupsOf(s)[0].id);
      expect(html, s).not.toContain("<details");
      expect(html, s).not.toMatch(/font-mono|shadow|gradient|tracking-|overflow-(y-)?(auto|scroll)/);
      // ピル型のボタンにしない（丸は位置の地図のピンの点だけ）
      expect(html, s).not.toMatch(/<(button|a|label)\b[^>]*rounded-full/);
      // 組の箱は枠線を持たない（地の色の差だけ）
      for (const m of html.matchAll(/<[a-z]+[^>]*data-group="[^"]+"[^>]*>/g)) {
        expect(m[0], s).toMatch(/\bbg-panel\b/);
        expect(m[0], s).not.toMatch(/\bborder\b|\bborder-|ring-|outline-solid/);
      }
      // 目次の行は番号を振らない
      expect(html, s).not.toMatch(/data-group-link="[^"]+"[^>]*>\s*0?\d/);
    }
  });

  it("関係者: 連絡先は種類の組に分かれ、足した行は種類の組に出る。組ごとの連絡先追加はその組の種類", () => {
    const p = SEED_PEOPLE.find((x) => x.contacts.some((c) => c.kind === "family") && x.contacts.some((c) => c.kind === "supporter"))!;
    const d = editOf(p);
    const draft = editDraft(d);
    draft.newContacts = [
      { ...blankContact(), kind: "supporter", relation: "隣人" },
      { ...blankContact(), kind: "home_doctor", name: "架空 医院" },
    ];
    const slices = groupSlices(form("people", d, draft));
    const supporter = slices.find((x) => x.id === groupOfContactKind("supporter")!.id)!;
    expect(supporter.html).toContain('data-contact="new"');
    const others = slices.find((x) => x.id === groupOfContactKind("home_doctor")!.id)!;
    expect(others.html).toContain('data-contact="new"');
    // 種類の選択は、種類が 2 つ以上の組（関係先）の足した行だけ。選べるのはその組の種類
    expect(supporter.html).not.toContain('aria-label="連絡先の種類"');
    expect(others.html).toContain('aria-label="連絡先の種類"');
    // 連絡先追加は連絡先の組ごとに 1 つ（本人電話は本人がいれば出さない）
    for (const g of groupsOf("people")) {
      const slice = slices.find((x) => x.id === g.id)!;
      const adds = attrs(slice.html, "data-contact-add");
      const hasSelf = d.contacts.some((c) => c.kind === "self");
      if (g.contactKinds?.includes("self") && hasSelf) expect(adds, g.id).toEqual([]);
      else expect(adds, g.id).toEqual([g.contactKinds![0]]);
    }
    // 足した行の下書き（種類のほかは空）を変えなければ、送る変更は前と同じ形（連絡先 2 行）
    const changes = editChanges("people", d, draft);
    expect(changes.filter((c) => c.t === "contact").map((c) => (c.t === "contact" ? c.value.kind : null))).toEqual(["supporter", "home_doctor"]);
  });

  it("連絡先・薬・時計の行の文字の欄は、入れたあとも欄の名前が見える（下書きの字だけにしない）。距離の選択も名前つき", () => {
    const p = SEED_PEOPLE.find((x) => x.contacts.some((c) => c.kind === "family"))!;
    const d = editOf(p);
    const people = form("people", d);
    const family = d.contacts.find((c) => c.kind === "family")!;
    const row = people.slice(people.indexOf(`data-contact="${family.id}"`));
    const rowEnd = row.indexOf("data-contact=", 20);
    const one = rowEnd > 0 ? row.slice(0, rowEnd) : row;
    for (const label of ["続柄", "名前", "フリガナ", "住所", "電話", "携帯", "備考"]) {
      expect(one, label).toMatch(new RegExp(`<span[^>]*>${label}</span>`));
    }
    expect(one).not.toMatch(/placeholder="(続柄|名前|電話|備考)"/);
    // 距離の選択の字は「距離 …」（夜間・緊急・支援・スマホ・車と同じ形）
    expect(one).toMatch(/距離 /);
    const medical = form("medical", editOf(SEED_PEOPLE[0]));
    expect(medical).toMatch(/<span[^>]*>回数<\/span>/);
    expect(medical).not.toMatch(/placeholder="(薬の名前|回数)"/);
  });

  it("その他の連絡先の続柄が空のあいだは、欄の名前が赤の太字（保存を止める印は前と同じ）", () => {
    const p = SEED_PEOPLE[0];
    const d = editOf(p);
    const draft = editDraft(d);
    draft.newContacts = [{ ...blankContact(), kind: "other" }];
    const html = form("people", d, draft);
    const row = html.slice(html.indexOf('data-contact="new"'));
    expect(row).toMatch(/<span[^>]*text-danger[^>]*>続柄<\/span>/);
  });

  it("どの区分の組の表にも無い連絡先の種類が来ても、行は落とさない（関係先の組に出す）", () => {
    const d = editOf(SEED_PEOPLE[0]);
    const odd = { ...d, contacts: [...d.contacts, { ...d.contacts[1], id: "c-odd", kind: "unknown_kind" as unknown as ContactKind }] };
    const html = form("people", odd);
    expect(html).toContain('data-contact="c-odd"');
  });

});
