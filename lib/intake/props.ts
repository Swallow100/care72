// 入れる欄（components/person/Intake.tsx）に渡す物を、本人のページの行から作る。サーバーで使う。

import { aiUsable, type AiStatus } from "../claude/status.ts";
import { parseLedger } from "../db/ledger.ts";
import type { ClockCategory, Ledger } from "../db/types.ts";
import type { PersonPageRows } from "../person.ts";
import { questionQueue, type Question } from "./ask.ts";
import type { EditData } from "./edit.ts";
import { isAiConsentRefused } from "./http.ts";

export type IntakeProps = {
  personId: string;
  /** 本人の事業所（T68。面の編集の市の既定・町名の候補・地図の真ん中を components/person/PersonWithIntake.tsx が事業所から読む） */
  officeId: string;
  /** 台帳の版（保存のときに確かめる） */
  version: number;
  /** AI を呼べるか（未設定・上限到達なら「AI 未設定」「AI 上限到達」と手入力） */
  aiReady: boolean;
  /** AI の今の状態（lib/claude/status.ts。T76）。上の印と本日残りに使う。無ければ aiReady だけで「AI 未設定」 */
  aiStatus?: AiStatus;
  /**
   * AI 提供（ai_overseas）が不同意か（T74 の続き）。true なら開いた時点で入れる欄の AI の操作（分ける・写真と PDF 読取・
   * 問いの自由文・再試行）を押せない形にし、上に「同意 拒否」。手で書く欄（面の「編集」・問いの選ぶ答え・次回）は使える。
   * サーバーの入口の 403（lib/intake/http.ts の aiConsentRefusal）はそのまま
   */
  aiConsentRefused: boolean;
  /** 次の問いの順の列 */
  queue: Question[];
  /** 今の台帳（手入力の初めの値、印の見せ方） */
  ledger: Ledger;
  /** 今の時計（印を作るかの見せ方。名前と区分だけ） */
  clocks: Array<{ category: ClockCategory; label: string }>;
  /** 本人のページの面の「編集」に要る今の値（T45） */
  edit: EditData;
};

/** ai は AI の今の状態（lib/claude/cloudflare.ts の aiStatusFor）か、鍵の有無だけ（テスト・前の呼び方） */
export function intakePropsOf(rows: PersonPageRows, ai: boolean | AiStatus): IntakeProps {
  return {
    personId: rows.person.id,
    officeId: rows.person.office_id,
    version: rows.person.version ?? 1,
    aiReady: typeof ai === "boolean" ? ai : aiUsable(ai),
    ...(typeof ai === "boolean" ? {} : { aiStatus: ai }),
    aiConsentRefused: isAiConsentRefused(rows.consents),
    queue: questionQueue(rows),
    ledger: parseLedger(rows.person.ledger),
    clocks: rows.clocks.map((k) => ({ category: k.category, label: k.label })),
    edit: {
      personId: rows.person.id,
      version: rows.person.version ?? 1,
      ledger: parseLedger(rows.person.ledger),
      contacts: rows.contacts.map((c) => ({
        id: c.id,
        kind: c.kind,
        relation: c.relation,
        name: c.name,
        phone: c.phone,
        night_ok: c.night_ok,
        note: c.note,
        emergency_order: c.emergency_order,
        supporter_order: c.supporter_order,
        reach: c.reach,
        has_smartphone: c.has_smartphone,
        has_car: c.has_car,
        kana: c.kana ?? null,
        address: c.address ?? null,
        mobile: c.mobile ?? null,
      })),
      clocks: rows.clocks.map((k) => ({
        id: k.id,
        kind: k.kind,
        category: k.category,
        label: k.label,
        value: k.value,
        unit: k.unit,
        depends_on: k.depends_on,
        depends_check: k.depends_check,
        confirmed_at: k.confirmed_at,
        starts_on: k.starts_on,
        source: k.source,
        source_note: k.source_note,
      })),
      consents: rows.consents.map((c) => ({ kind: c.kind, status: c.status })),
    },
  };
}
