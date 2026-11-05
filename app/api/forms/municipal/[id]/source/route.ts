import { principalFromRequest } from "@/lib/auth/server";
import { municipalSourceGet } from "@/lib/forms/municipal-http";

type Ctx = { params: Promise<{ id: string }> };

// 一覧の公式の様式を取る（T134）。取る先は lib/forms/municipal-forms.ts の一覧の url だけ（要求から URL を受けない）。
// 転送は自分でたどり、一覧のホストの中だけ（lib/forms/municipal-http.ts の fetchOfficial）。版が違えば 409（?accept=1 なら今の版を返す）。
// 取った版を事業所の R2 に記録する（読み取りが共有の対応表を引くため）。ファイル本体は置かない
export async function GET(request: Request, { params }: Ctx) {
  const { principal, env } = await principalFromRequest(request);
  const { id } = await params;
  const accept = new URL(request.url).searchParams.get("accept") === "1";
  return municipalSourceGet(
    {
      fetch: (url) => fetch(url, { redirect: "manual" }),
      bucket: { put: (key, value, options) => env.RECORDINGS.put(key, value, options) },
    },
    principal,
    id,
    accept,
  );
}
