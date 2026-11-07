// T184: 審査員の通し点検で見つかった画面の直しが戻らないように。中身を描くか、元の字を読んで確かめる。

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROLE_LABELS } from "./auth/roles.ts";
import { REQUEST_LABELS } from "./custody/labels.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("T184 の 3: 本人のページから医療班へ", () => {
  it("見える字はヘッダーの入口と同じ「医療班」と役のアイコン（押すと役が替わる）", () => {
    expect(REQUEST_LABELS.toStaff).toBe(ROLE_LABELS.medical);
    const section = read("../components/person/RequestSection.tsx");
    expect(section).toContain(`icon={RoleIcon} name="role" value={staffRole}`);
    expect(read("../components/AppHeader.tsx")).toContain("<StaffEntry label={ROLE_LABELS.medical} name={REQUEST_LABELS.toStaffName}");
  });
});
