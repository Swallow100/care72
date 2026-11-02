// 同意の範囲（docs/tasks/T24.md）。役 × 同意の組で見える区分・経過・書類・録音・書き足し・提供の記録。
// 種の 9 渡辺（医療班への提供に同意なし）と 7 加藤（支援者への提供に同意なし）は種の同意の行（seedConsents）から読む。

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE, seedConsents } from "../../seed/people.ts";
import type { Role } from "../auth/roles.ts";
import type { ConsentKind, ConsentStatus, PersonOrigin } from "../db/types.ts";
import { consentScopeHasAddress, peopleMode, viewScope, type ScopeInput } from "./scope.ts";

function input(
  statuses: Partial<Record<ConsentKind, ConsentStatus>>,
  opts: { origin?: PersonOrigin; medicalScope?: string | null } = {},
): ScopeInput {
  const consents = (Object.entries(statuses) as Array<[ConsentKind, ConsentStatus]>).map(([kind, status]) => ({
    kind,
    status,
    scope: kind === "medical" ? (opts.medicalScope ?? null) : null,
  }));
  return { consents, origin: opts.origin ?? "care_manager" };
}

function seeded(id: string): ScopeInput {
  const p = SEED_PEOPLE.find((x) => x.person.id === id)!;
  return { consents: seedConsents(p), origin: p.person.origin };
}

const ALL: Partial<Record<ConsentKind, ConsentStatus>> = {
  registry: "granted",
  plan_share: "granted",
  supporters: "granted",
  medical: "granted",
};

describe("役 × 同意の組で見える区分", () => {
  it("ケアマネは同意を問わず全部。経過は全部、書類と録音も開け、診察・配薬は書かない", () => {
    for (const statuses of [ALL, { medical: "refused" as const, supporters: "refused" as const }, {}]) {
      const s = viewScope("care_manager", input(statuses));
      expect(s.items).toEqual(["identity", "medical", "evacuation", "people", "address", "basic", "consent", "plan"]);
      expect(peopleMode(s)).toBe("all");
      expect(s.timeline).toBe("all");
      expect(s.documents).toEqual(["matsuyama", "medical", "own", "qr", "mapped"]);
      expect(s.recordings).toBe(true);
      expect(s.writes).toEqual(["safety_check", "transported", "arrived_shelter", "note"]);
      expect(s.provision).toBeNull();
    }
  });

  it("医療班・行政は医療班への提供に同意があれば 本人確認・医療・避難・人の一部。住所・基本・同意は無い", () => {
    for (const role of ["medical", "government"] as const) {
      const s = viewScope(role, input(ALL));
      expect(s.items).toEqual(["identity", "medical", "evacuation", "people_partial"]);
      expect(peopleMode(s)).toBe("partial");
      expect(s.timeline).toBe("all");
      expect(s.documents).toEqual(["medical"]);
      expect(s.recordings).toBe(false);
      expect(s.writes).toEqual(["safety_check", "examined", "medication_given", "transported", "arrived_shelter", "note"]);
      expect(s.provision).toEqual({ basis: "consent", sections: ["identity", "medical", "evacuation", "people_partial"] });
    }
  });

  it("住所は医療班への提供の同意の範囲にあるときだけ", () => {
    const s = viewScope("medical", input(ALL, { medicalScope: JSON.stringify({ address: true }) }));
    expect(s.items).toEqual(["identity", "medical", "evacuation", "people_partial", "address"]);
    expect(s.provision?.sections).toEqual(["identity", "medical", "evacuation", "people_partial", "address"]);
    // 範囲に無い・読めない・形の違う物は住所なし
    for (const bad of [null, "{}", '{"address":false}', '["address"]', "not json", '{"address":"yes"}']) {
      expect(viewScope("medical", input(ALL, { medicalScope: bad })).items).not.toContain("address");
    }
    // 同意なしの人に範囲が書いてあっても住所は出ない
    expect(viewScope("medical", input({ medical: "refused" }, { medicalScope: '{"address":true}' })).items).toEqual(["identity"]);
  });

  it("医療班・行政は同意なし・未確認なら本人確認だけ。経過は医療班・行政の書いた行だけ、書類も録音も開けない", () => {
    for (const statuses of [{ ...ALL, medical: "refused" as const }, { ...ALL, medical: "unconfirmed" as const }, {}]) {
      for (const role of ["medical", "government"] as const) {
        const s = viewScope(role, input(statuses));
        expect(s.items).toEqual(["identity"]);
        expect(peopleMode(s)).toBeNull();
        expect(s.timeline).toBe("staff");
        expect(s.documents).toEqual([]);
        expect(s.recordings).toBe(false);
        // 診た・薬を渡したなどは書ける（自分たちの記録）
        expect(s.writes).toContain("examined");
        expect(s.provision).toEqual({ basis: "vital", sections: ["identity"] });
      }
    }
  });

  it("その場で登録した人（同意の行が無い）は同意ありと同じ区分で、根拠は生命保護。同意なしを記録したら本人確認だけ", () => {
    const s = viewScope("medical", input({}, { origin: "on_site" }));
    expect(s.items).toEqual(["identity", "medical", "evacuation", "people_partial"]);
    // 医療要約は医療班への提供の同意で作る書類なので、同意の行の無い人には無い
    expect(s.documents).toEqual([]);
    expect(s.provision).toEqual({ basis: "vital", sections: ["identity", "medical", "evacuation", "people_partial"] });
    expect(viewScope("medical", input({ medical: "refused" }, { origin: "on_site" })).items).toEqual(["identity"]);
  });

  it("支援者（家族のスマホ）は支援者への提供に同意があれば 避難・人と経過。なし・未確認は何も無い", () => {
    const s = viewScope("family", input(ALL));
    expect(s.items).toEqual(["evacuation", "people"]);
    expect(s.timeline).toBe("all");
    expect(s.documents).toEqual([]);
    expect(s.recordings).toBe(false);
    expect(s.writes).toEqual([]);
    expect(s.provision).toBeNull();
    for (const status of ["refused", "unconfirmed"] as const) {
      const n = viewScope("family", input({ ...ALL, supporters: status }));
      expect(n.items).toEqual([]);
      expect(n.timeline).toBe("none");
    }
    // 医療班への提供の同意は支援者に効かない
    expect(viewScope("family", input({ supporters: "granted", medical: "refused" })).items).toEqual(["evacuation", "people"]);
  });

  it("本人は自分の全部（書き足しは本人のスマホから）、役未選択は何も無い", () => {
    const self = viewScope("self", input({ medical: "refused" }));
    expect(self.items).toContain("medical");
    expect(self.recordings).toBe(true);
    expect(self.writes).toEqual([]);
    const none = viewScope("unselected", input(ALL));
    expect(none).toMatchObject({ items: [], timeline: "none", documents: [], recordings: false, writes: [], provision: null });
  });
});

describe("種の同意の違い（7 加藤・9 渡辺）", () => {
  it("9 渡辺（医療班への提供に同意なし）は医療班・行政に医療が出ない", () => {
    for (const role of ["medical", "government"] as Role[]) {
      const s = viewScope(role, seeded("p-09"));
      expect(s.items).not.toContain("medical");
      expect(s.items).toEqual(["identity"]);
      expect(s.documents).not.toContain("medical");
    }
    // 支援者への提供には同意しているので、支援者には人が出る
    expect(viewScope("family", seeded("p-09")).items).toContain("people");
  });

  it("7 加藤（支援者への提供に同意なし）は支援者に人が出ない。医療班には医療・人の一部が出る", () => {
    const supporter = viewScope("family", seeded("p-07"));
    expect(supporter.items).not.toContain("people");
    expect(supporter.items).toEqual([]);
    expect(supporter.timeline).toBe("none");
    const staff = viewScope("medical", seeded("p-07"));
    expect(staff.items).toEqual(["identity", "medical", "evacuation", "people_partial"]);
  });

  it("ほかの 8 人は医療班に 医療・避難・人の一部、支援者に 避難・人。種に住所の範囲は無い", () => {
    for (const p of SEED_PEOPLE.filter((x) => !["p-07", "p-09"].includes(x.person.id))) {
      expect(viewScope("medical", seeded(p.person.id)).items).toEqual(["identity", "medical", "evacuation", "people_partial"]);
      expect(viewScope("family", seeded(p.person.id)).items).toEqual(["evacuation", "people"]);
    }
    expect(consentScopeHasAddress(null)).toBe(false);
  });
});
