// T184: 審査員の通し点検で見つかった画面の直しが戻らないように。中身を描くか、元の字を読んで確かめる。

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROLE_LABELS } from "./auth/roles.ts";
import { REQUEST_LABELS } from "./custody/labels.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("T184 の 9: 役選択の画面", () => {
  it("画面に無い「右上の役変更」を指さない", () => {
    expect(read("../app/login/role/page.tsx")).not.toMatch(/右上|再選択/);
  });
});

describe("T184 の 3: 本人のページから医療班へ", () => {
  it("見える字はヘッダーの入口と同じ「医療班」と役のアイコン（押すと役が替わる）", () => {
    expect(REQUEST_LABELS.toStaff).toBe(ROLE_LABELS.medical);
    const section = read("../components/person/RequestSection.tsx");
    expect(section).toContain(`icon={RoleIcon} name="role" value={staffRole}`);
    expect(read("../components/AppHeader.tsx")).toContain("<StaffEntry label={ROLE_LABELS.medical} name={REQUEST_LABELS.toStaffName}");
  });
});

describe("T184 の 6: 訓練の開始", () => {
  it("常設の説明（仮想モードの 1 行）を開始の面に置かない", () => {
    const page = read("../app/drill/page.tsx");
    expect(page).not.toContain("VIRTUAL_LABELS");
    expect(page).not.toContain("data-virtual-note");
  });
});

describe("T184 の 5: 訓練の着信", () => {
  it("鳴っている間は下の幅いっぱいの帯で、帯の高さぶんの余白を足す（押せる物に重ねたままにしない）", () => {
    const call = read("../components/drill/IncomingCall.tsx");
    const ringing = call.slice(call.indexOf("if (!talkingNow) {"), call.indexOf("// 応答した通話の間だけ画面の上に重ねる"));
    expect(ringing).toContain("<IncomingRoom />");
    expect(ringing).not.toContain("right-4 bottom-4");
    for (const a of ["later", "decline", "answer"]) expect(ringing).toContain(`data-incoming-action="${a}"`);
    expect(call).toMatch(/if \(later\) \{[^]*<IncomingRoom \/>/);
  });
});
