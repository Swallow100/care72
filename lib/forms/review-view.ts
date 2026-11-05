// 紙の画面の見直しの帯に渡す物（T136）。紙の画面（サーバー）が作り、components/forms/PaperReview.tsx（ブラウザ）が描く。
// 決まりの見直しは開くたびに数える。AI の見直しは、今の紙の版で回した物だけを出す（紙が変われば「前の紙」の印で、もう一度回せる）。

import type { D1Database } from "@cloudflare/workers-types";
import type { ConsentKind, ConsentStatus } from "../db/types.ts";
import { isAiConsentRefused } from "../intake/http.ts";
import type { OverlaySheet } from "./overlay-sheet.ts";
import { loadReviewState, type FieldFix } from "./review-db.ts";
import type { ReviewFormKey } from "./review-load.ts";
import { ruleReview, sheetHash, type ReviewFinding, type ReviewSubject } from "./review.ts";

export type PaperReviewProps = {
  person: string;
  form: ReviewFormKey;
  hash: string;
  rule: ReviewFinding[];
  /** 今の紙の版の AI の見直し（無ければ null） */
  ai: ReviewFinding[] | null;
  /** 前の紙の版で AI の見直しを回した（紙が変わった） */
  stale: boolean;
  /** 再考で直した欄（AI の直し。戻せる） */
  fixes: Array<{ field: string; label: string; reason: string; round: number }>;
  confirmed: { at: string; by: string | null } | null;
  /** 対応表の紙（再考できる） */
  redoable: boolean;
  /** 本人の AI 提供が不同意でない（AI の見直しを押せる） */
  canAi: boolean;
};

export async function paperReviewProps(
  db: D1Database,
  args: {
    personId: string;
    formKey: ReviewFormKey;
    subject: ReviewSubject;
    sheet: OverlaySheet;
    consents: ReadonlyArray<{ kind: ConsentKind; status: ConsentStatus }>;
    fixes?: ReadonlyMap<string, FieldFix>;
  },
): Promise<PaperReviewProps> {
  const hash = await sheetHash(args.sheet);
  const state = await loadReviewState(db, args.personId, args.formKey, hash);
  const labels = new Map(args.subject.fields.map((f) => [f.id, f.label]));
  return {
    person: args.personId,
    form: args.formKey,
    hash,
    rule: ruleReview(args.subject),
    ai: state.run ? state.run.body.findings : null,
    stale: state.stale,
    fixes: [...(args.fixes?.values() ?? [])].map((f) => ({ field: f.field, label: labels.get(f.field) ?? f.field, reason: f.reason, round: f.round })),
    confirmed: state.confirmed,
    redoable: args.subject.redoable,
    canAi: !isAiConsentRefused(args.consents),
  };
}
