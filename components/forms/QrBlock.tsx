// QR の部品。本人の 1 枚（T06）の裏と、本人のページの QR の画面（印刷）に置く。
// 状態を持たない（Server Component のまま、テストで renderToStaticMarkup できる）。
// 白地に黒で描く（紙に刷っても、ダークの画面でも反転させない。読み取りの機械は反転に弱い）。
// 添えるのは「この QR は医療班が読みます」の 1 行と期限だけ。URL の文字は出さない（トークンを書き写させない）。
// caption を外すと QR の四角だけ（一辺 sizeMm、周りの白も中に含む）。本人の 1 枚の裏は題名の段に 24mm（OWN_QR_MM）で置き、
// 1 行と期限は段の右の小さな字に出す（四角の外に字を足すと、裏の要約が 1 頁に収まらない）。

import { formatJst } from "@/lib/person";
import { qrMatrix, qrSvgPath, QR_QUIET } from "@/lib/qr/image";
import { QR_LABELS } from "@/lib/qr/labels";

/** 期限の日付（JST の YYYY-MM-DD） */
export function qrExpiryDate(expiresAt: string): string {
  return formatJst(expiresAt).slice(0, 10);
}

export function QrBlock({
  url,
  expiresAt,
  sizeMm = 32,
  caption = true,
}: {
  /** QR に入れる URL（/q/<token> の絶対 URL） */
  url: string;
  /** 期限（ISO）。日付（JST）で出す */
  expiresAt: string;
  /** QR の一辺（mm）。紙の上の大きさ */
  sizeMm?: number;
  /** 1 行と期限を QR の横に添えるか。外すと一辺 sizeMm の四角だけ */
  caption?: boolean;
}) {
  const m = qrMatrix(url);
  const box = m.size + QR_QUIET * 2;
  const size = `${sizeMm}mm`;
  const svg = (
    <svg
      viewBox={`0 0 ${box} ${box}`}
      style={{ display: "block", width: size, height: size }}
      shapeRendering="crispEdges"
      role="img"
      aria-label={QR_LABELS.title}
    >
      <rect width={box} height={box} fill="#fff" />
      <path d={qrSvgPath(m)} fill="#000" />
    </svg>
  );
  if (!caption) {
    // 余白・枠・字を足さない（紙面の中で一辺 sizeMm の場所だけを取る）
    return (
      <figure style={{ margin: 0, padding: 0, flex: "none", width: size, height: size }} data-qr-block data-qr="code">
        {svg}
      </figure>
    );
  }
  return (
    <figure className="inline-flex items-center gap-3 rounded bg-[#fff] p-2 text-[#111]" data-qr-block>
      {svg}
      <figcaption className="flex flex-col gap-1 text-sm leading-snug">
        <span className="font-bold">{QR_LABELS.blockNote}</span>
        <span className="tabular-nums">
          {QR_LABELS.expires} {qrExpiryDate(expiresAt)}
        </span>
      </figcaption>
    </figure>
  );
}
