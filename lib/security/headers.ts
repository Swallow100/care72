// 安全のための見出し（見直しの安全 低。next.config.ts の headers が全部の道に付ける）。
// - Content-Security-Policy: ほかの頁の枠（iframe）に入れさせない（frame-ancestors 'none'。ケア72 は自分の頁も枠に入れない）。
//   ほかに壊さない物だけ: <base> は同じ origin だけ（base-uri）、<object>・<embed> は使わない（object-src）、フォームの送り先は
//   同じ origin だけ（form-action。ログイン・ログアウト・役の切替・様式の保存は全部同じ origin に送り、移る先も同じ origin）。
//   script-src・style-src・img-src・connect-src・media-src は付けない（Next の差し込みの script、地理院のタイル、気象庁の雨雲の
//   取り次ぎ、声の音、黒塗りの画面の blob: の画像と pdf.js の worker を、ここでは縛らない。縛るなら nonce と一覧が要る）
// - X-Content-Type-Options: nosniff（形の見出しのとおりにだけ読む）
// - Referrer-Policy: strict-origin-when-cross-origin（外へは origin だけ。/s/・/q/・アンケート・本人のスマホの案内の頁は meta の no-referrer がさらに絞る）
// 配信（OpenNext・Workers）では、Workers の assets が出す静的な物（/_next/static/・/sw.js・public/）はこの見出しを通らない
// （worker を通らずに出る）。頁（HTML）と route の応答には付く。

export const CONTENT_SECURITY_POLICY = ["frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'", "form-action 'self'"].join("; ");

export const SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];
