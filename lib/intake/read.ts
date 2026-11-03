// 入れる欄の「写真・PDF を読む」（T45）。ケアプラン・お薬手帳・紹介状・様式の写真か PDF を、Opus の文書の目で台帳の欄に分ける。
// 文の分け方（lib/intake/extract.ts）と同じ形（ExtractSchema）で返させ、同じ差分（lib/intake/diff.ts）にする。決めるのはケアマネ。
//
// - 受け取る物と上限は様式の読み取り（lib/forms/form-read.ts の toFormFile・FORM_FILE_MAX_BYTES）のまま。中身の頭で形を決める
// - 1 要求 1 枚（長い処理にしない。何枚かはブラウザから 1 枚ずつ送る）。写真・PDF は保存しない
// - 用途は ledger_input（台帳の入力）のまま、モデルだけ Opus にする（ai_calls の用途を足すと表の作り直しが要るため）
// - 仮名化: 「本人」（今の台帳）は lib/pseudonym を通す。写真・PDF の中の文字は仮名化の層では伏せられないので、
//   送る前にブラウザの黒塗りの画面（T52、components/person/RedactSheet.tsx）で人が氏名・住所・電話・町名・生年月日・保険者番号を塗り、
//   塗った後の画像（JPEG、EXIF なし）だけをサーバーが受ける（lib/intake/read-form.ts）。PDF は頁ごとに画像にしてから。
//   塗り残しに備えて、氏名・住所・電話を出力に書かないよう指示し（INTAKE_READ_SYSTEM）、返った文字は名前・電話を伏せ字に戻してから差分にする。
//   伏せ字が残る所は画面で印が付き、人が直す

import { askJson, type AskJsonContext, type AskJsonRequest } from "../claude/call.ts";
import { OPUS } from "../claude/models.ts";
import type { FormFile } from "../forms/form-read.ts";
import type { PersonPageRows } from "../person.ts";
import {
  pseudonymize,
  pseudonymizeText,
  restoreText,
  type ClaudePerson,
  type ForClaude,
  type PseudonymKey,
} from "../pseudonym/index.ts";
import { buildDiff } from "./diff.ts";
import { EXTRACT_RULES, pseudonymInputOf, type ExtractOptions, type IntakeProposal } from "./extract.ts";
import { ExtractSchema, type ExtractOutput } from "./schema.ts";

export const INTAKE_READ_SYSTEM = [
  "入力の画像は、在宅の本人についての書類（ケアプラン・お薬手帳・紹介状・個別避難計画の様式など）の写真か PDF の 1 頁。これを個別避難計画の台帳の欄に分ける。",
  "画像の黒く塗りつぶした四角は、ケアマネが隠した所（氏名・住所・電話など）。中身を推し量らない・出さない。",
  "入力の JSON の「本人」は今の台帳（仮名化済み）。書類の本人は「A さん」と書く。",
  "書類の中の氏名・住所・電話番号・生年月日・保険者番号は出力に書かない。人の名前は（氏名）、町名・番地は（町名）、電話番号は（電話）と書く。",
  "手書きで読めない所・かすれた所・切れた所は推し量らずに出さない。書類に無いことを足さない。",
  "下の決まりの「入力の文」は、書類に書かれた文のこと。",
  "",
  EXTRACT_RULES,
].join("\n");

/** Claude に渡す要求。本人は仮名化の層を通った物、書類は添え物（文の前に置く） */
export function buildReadIntakeRequest(person: ForClaude<ClaudePerson[]>, file: FormFile): AskJsonRequest<typeof ExtractSchema> {
  return {
    purpose: "ledger_input",
    model: OPUS,
    system: INTAKE_READ_SYSTEM,
    input: { 本人: person },
    attachments: [file.attachment],
    schema: ExtractSchema,
  };
}

/** 文字の値を全部同じ関数に通した写し（形は変えない） */
function mapStrings<T>(v: T, f: (s: string) => string): T {
  if (typeof v === "string") return f(v) as T;
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, f)) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, f)])) as T;
  return v;
}

/**
 * 返った物に書類から写した氏名・電話が残っていれば、仮名化と同じ置き換えで伏せる（本人は A さん、連絡先は役割名、電話は（電話））。
 * このあと差分にするときに仮名を氏名に戻す。台帳に無い名前は残りうる（文の分け方と同じ）
 */
export function sealReadOutput(out: ExtractOutput, key: PseudonymKey): ExtractOutput {
  return mapStrings(out, (s) => pseudonymizeText(s, key).text);
}

/**
 * 写真・PDF を読ませ、今の台帳と並べた差分にする。
 * 失敗: AiNotConfigured・AiLimitReached・AiCallFailed・AiRefused・AiBadOutput（lib/claude/errors.ts）、PseudonymLeakError
 */
export async function readIntake(rows: PersonPageRows, file: FormFile, ctx: AskJsonContext, opts: ExtractOptions): Promise<IntakeProposal> {
  const input = pseudonymInputOf(rows);
  const { payload, key } = pseudonymize([input], { on: opts.today });
  const r = await askJson(buildReadIntakeRequest(payload, file), ctx);
  const sealed = sealReadOutput(r.value, key);
  const restore = (s: string) => restoreText(s, key);
  const { items, dropped } = buildDiff({ ledger: input.ledger, contacts: rows.contacts }, sealed, { text: restore, note: restore });
  return { ai: { model: r.model }, items, dropped };
}
