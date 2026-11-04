// 様式の読み取り（docs/tasks/T08.md）。写真（JPEG・PNG）か PDF の空の様式を Opus に読ませ、欄と台帳の項目の対応表（JSON）を出させる。
//
// - Claude に渡すのは様式の写真・PDF と、台帳の項目表（lib/forms/mapping.ts の key と名前。値は無い）だけ。
//   様式には人の値が無い前提だが、書き込みがあっても読まないよう指示する（FORM_READ_SYSTEM の 6）。
// - 1 要求 1 回（長い処理にしない）。上限は lib/claude/usage.ts（用途 form_read、Opus、effort high）。
// - 返った対応表は checkReadResult で台帳の一覧と照らし（無い項目名は弾く）、下書きとして保存する。使うのはケアマネが確かめてから。
// - 同じ写真・PDF（SHA-256 が同じ）は読み直さない（lib/forms/mapping-db.ts の findByHash を先に引く）。
// - T83: 画面からは黒塗りの画面（components/person/RedactSheet.tsx）を通した頁の画像（JPEG）を頁の順に受け、1 回の呼び出しに並べて渡す
//   （app/api/forms/read、送る形は lib/forms/read-upload.ts）。記入済みの様式に書かれた値は人が黒く塗ってから送る。

import { Buffer } from "node:buffer";
import * as z from "zod";
import { askJson, type AiMark, type AskJsonContext, type AskJsonRequest, type ClaudeAttachment } from "../claude/call.ts";
import { sealItemCatalog } from "../pseudonym/index.ts";
import { CONFIDENCES, FIELD_SHAPES, FORM_FILE_MAX_BYTES, checkReadResult, itemCatalog, type CheckedRead } from "./mapping.ts";

export { FORM_FILE_MAX_BYTES };

// ---------- 受け取る写真・PDF ----------

export type FormFileKind = "image" | "pdf";
export type FormFile = { kind: FormFileKind; attachment: ClaudeAttachment; bytes: number };
export type FormFileError = "empty" | "too_large" | "type";

/** 中身の頭で形を決める（ブラウザの言う形は信じない）。JPEG・PNG・PDF のほかは断る */
export function sniffFormFile(bytes: Uint8Array): { kind: "image"; mediaType: "image/jpeg" | "image/png" } | { kind: "pdf" } | null {
  const head = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (head([0xff, 0xd8, 0xff])) return { kind: "image", mediaType: "image/jpeg" };
  if (head([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: "image", mediaType: "image/png" };
  if (head([0x25, 0x50, 0x44, 0x46, 0x2d])) return { kind: "pdf" };
  return null;
}

/** 受け取った物を確かめて、Claude に添える形にする */
export function toFormFile(bytes: Uint8Array): { ok: true; file: FormFile } | { ok: false; error: FormFileError } {
  if (bytes.length === 0) return { ok: false, error: "empty" };
  if (bytes.length > FORM_FILE_MAX_BYTES) return { ok: false, error: "too_large" };
  const t = sniffFormFile(bytes);
  if (!t) return { ok: false, error: "type" };
  const data = Buffer.from(bytes).toString("base64");
  const attachment: ClaudeAttachment = t.kind === "pdf" ? { kind: "pdf", data } : { kind: "image", mediaType: t.mediaType, data };
  return { ok: true, file: { kind: t.kind, attachment, bytes: bytes.length } };
}

/** 同じ様式か見分ける印（SHA-256 の 16 進） */
export async function formHash(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- Claude への頼み ----------

export const FORM_READ_SYSTEM = [
  "入力の画像・PDF は、日本の市町村などの個別避難計画・名簿登録の様式（空の書式）。入力の JSON の「items」はケア72 の台帳の項目表（key と名前と説明だけで、値は無い）。",
  "1. 様式の記入欄を、頁ごとに上から下、左から右の順に全部挙げる。見出しだけの行・注意書き・説明文は欄にしない。",
  "2. □ の選択肢が並び 1 つを選ぶ欄は 1 欄（shape choice）にし、選択肢を様式の順に options に入れる。「あてはまるものすべて」のように □ ごとに独立した項目は、□ ごとに 1 欄（shape check）にする。",
  "3. label は様式に印刷された欄の名前のまま（言い換えない）。段の見出しは section（例「緊急時の連絡先①」）。position は欄の場所を短く（例「表 上から 3 段目 右」）。page は 1 から。",
  "4. shape: text 文字・date 日付・choice 選ぶ・check □ 1 つ・phone 電話番号・lines 何行かの自由記入・handwrite 本人の署名・押印・受付印など人が手で書く欄。",
  "5. item はその欄に入れる値に合う台帳の項目の key を items から 1 つ。合う物が無い・決められない欄は null。items に無い key を作らない。手で書く欄は null。",
  "6. 様式に書き込まれた値（氏名・住所・電話番号・日付）があっても読まない。出力に書かない。黒く塗りつぶした四角は、ケアマネが隠した所。中身を推し量らない・出さない。",
  "画像が何枚かあれば、並びの順に 1 枚が 1 頁（page は 1 から）。",
  "7. confidence: high は名前も中身も合う、medium は中身は近いが範囲が違う、low は推測。reason は対応の理由を 30 字まで。",
  "title は様式の題名、issuer は様式を出した所（分からなければ空）、pages は頁の数。",
].join("\n");

/** 返事の形。いちばん外は object。item は文字のまま受け、台帳の一覧との照合は checkReadResult で（無い名前で全体を落とさない） */
export const ReadSchema = z.object({
  title: z.string(),
  issuer: z.string(),
  pages: z.number().int(),
  fields: z.array(
    z.object({
      page: z.number().int(),
      section: z.string(),
      label: z.string(),
      position: z.string(),
      shape: z.enum(FIELD_SHAPES),
      options: z.array(z.string()),
      item: z.string().nullable(),
      confidence: z.enum(CONFIDENCES),
      reason: z.string(),
    }),
  ),
});

/** 頼み。様式の頁（1 つか、頁の順に何枚か）を並べて 1 回で渡す */
export function buildReadRequest(file: FormFile | ReadonlyArray<FormFile>): AskJsonRequest<typeof ReadSchema> {
  const files: ReadonlyArray<FormFile> = Array.isArray(file) ? file : [file as FormFile];
  return {
    purpose: "form_read",
    system: FORM_READ_SYSTEM,
    input: sealItemCatalog({ items: itemCatalog() }),
    attachments: files.map((f) => f.attachment),
    schema: ReadSchema,
  };
}

export type FormReadResult = CheckedRead & { mark: AiMark };

/** 様式を読ませて対応表（下書き）にする。失敗は askJson の例外（AiNotConfigured・AiLimitReached・AiRefused・AiBadOutput・AiCallFailed） */
export async function readForm(file: FormFile | ReadonlyArray<FormFile>, ctx: AskJsonContext): Promise<FormReadResult> {
  const r = await askJson(buildReadRequest(file), ctx);
  const checked = checkReadResult(r.value);
  return { ...checked, mark: { ai: r.ai, model: r.model, purpose: r.purpose } };
}
