// QR の部品。本人の 1 枚（T06）の裏と、本人のページの QR の画面（印刷）に置く。
// 状態を持たない（Server Component のまま、テストで renderToStaticMarkup できる）。
// 白地に黒で描く（紙に刷っても、ダークの画面でも反転させない。読み取りの機械は反転に弱い）。
// 添えるのは「この QR は医療班が読みます」の 1 行と期限だけ。URL の文字は出さない（トークンを書き写させない）。

import { formatJst } from "@/lib/person";
import { qrMatrix, qrSvgPath, QR_QUIET } from "@/lib/qr/image";
import { QR_LABELS } from "@/lib/qr/labels";

export function QrBlock({
  url,
  expiresAt,
  sizeMm = 32,
}: {
  /** QR に入れる URL（/q/<token> の絶対 URL） */
  url: string;
  /** 期限（ISO）。日付（JST）で出す */
  expiresAt: string;
  /** QR の一辺（mm）。紙の上の大きさ */
  sizeMm?: number;
}) {
  const m = qrMatrix(url);
  const box = m.size + QR_QUIET * 2;
  return (
    <figure className="inline-flex items-center gap-3 rounded bg-[#fff] p-2 text-[#111]" data-qr-block>
      <svg
        viewBox={`0 0 ${box} ${box}`}
        style={{ width: `${sizeMm}mm`, height: `${sizeMm}mm` }}
        shapeRendering="crispEdges"
        role="img"
        aria-label={QR_LABELS.title}
      >
        <rect width={box} height={box} fill="#fff" />
        <path d={qrSvgPath(m)} fill="#000" />
      </svg>
      <figcaption className="flex flex-col gap-1 text-sm leading-snug">
        <span className="font-bold">{QR_LABELS.blockNote}</span>
        <span className="tabular-nums">
          {QR_LABELS.expires} {formatJst(expiresAt).slice(0, 10)}
        </span>
      </figcaption>
    </figure>
  );
}
