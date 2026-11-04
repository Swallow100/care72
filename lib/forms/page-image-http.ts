// 様式の頁の画像を返す（GET /api/forms/mappings/<対応表>/pages/<頁>。T86。サーバーだけ）。
// 場所の確かめの画面と、元の様式の上に値を置く紙が <img> で読む。
//
// 壁: ログインしていなければ 401。対応表を開けない役（ケアマネの役でない・事業所なし）は 403。
// 対応表は自分の事業所の物だけで、ほかの事業所・無い対応表・画像の無い頁は 404（在っても無くても同じ）。
// 中身は様式の頁（白紙か、人が塗った後）で人の値は入らないが、事業所の物なので手元に残さない（private, no-store）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { formsScope } from "./mapping-db.ts";
import { pageImageKey, parsePageImages, type PageImageBucket } from "./page-images.ts";

const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

function refuse(status: 401 | 403 | 404, label: string): Response {
  return Response.json({ ok: false, label }, { status, headers: HEADERS });
}

export async function pageImageGet(
  db: D1Database,
  bucket: Pick<PageImageBucket, "get">,
  p: Principal | null,
  mappingId: string,
  pageRaw: string,
): Promise<Response> {
  if (!p) return refuse(401, "ログイン要");
  const scope = formsScope(p);
  if (!scope) return refuse(403, "権限なし");
  if (!ID.test(mappingId) || !/^[1-9][0-9]?$/.test(pageRaw)) return refuse(404, "該当なし");
  const page = Number(pageRaw);
  const row = await db
    .prepare("SELECT page_images FROM form_mappings WHERE id = ?1 AND office_id = ?2")
    .bind(mappingId, scope.officeId)
    .first<{ page_images: string | null }>();
  const pages = parsePageImages(row?.page_images);
  if (!pages || !pages.some((x) => x.page === page)) return refuse(404, "該当なし");
  const obj = await bucket.get(pageImageKey(scope.officeId, mappingId, page));
  if (!obj) return refuse(404, "該当なし");
  return new Response(obj.body as BodyInit, {
    status: 200,
    headers: { ...HEADERS, "Content-Type": "image/jpeg", "Content-Length": String(obj.size) },
  });
}
