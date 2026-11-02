import { isSameOrigin } from "@/lib/auth/cookie";
import { denied } from "@/lib/auth/guard";
import { principalFromRequest } from "@/lib/auth/server";
import { intakeError } from "@/lib/intake/http";
import { saveIntake, SaveRequestSchema } from "@/lib/intake/save";

// 入れる欄の保存: 人が確かめた変更（Claude の分け方・問いの答え・手入力）を今の台帳に当て直して書く。
// ケアマネの役だけ。版が画面で読んだときと違えば 409（競合）。経過に「入力」を 1 行
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return intakeError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const no = denied(principal, "save");
  if (no) return no;
  if (!principal) return intakeError("forbidden");

  const body = SaveRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return intakeError("invalid");
  const r = await saveIntake(env.DB, principal, body.data);
  if (!r.ok) return intakeError(r.error);
  return Response.json(r, { headers: { "Cache-Control": "no-store" } });
}
