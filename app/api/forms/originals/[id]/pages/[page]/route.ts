import { principalFromRequest } from "@/lib/auth/server";
import { originalPageGet } from "@/lib/forms/originals-http";

type Ctx = { params: Promise<{ id: string; page: string }> };

// 取り込んだ元の様式の原本の頁（PNG）。紙面の下に敷く（T101）。自分の事業所の物だけ。中身は lib/forms/originals-http.ts
export async function GET(request: Request, { params }: Ctx) {
  const { principal, env } = await principalFromRequest(request);
  const { id, page } = await params;
  return originalPageGet({ get: (key) => env.RECORDINGS.get(key) }, principal, id, page);
}
