// /favicon.ico（T79、11/4 の点検の低: 404 だった）。ブラウザとクローラーは決まってこの名前を取りに来るので、
// 印の正本 app/icon.svg（Next が /icon.svg で出す）へ送る。.ico の別の絵は持たない（同じ印を 2 か所で持たない）。
// ログインの前でも開ける（画面ではない）。行き先は同じ所の相対の URL
export function GET(): Response {
  return new Response(null, { status: 308, headers: { Location: "/icon.svg", "Cache-Control": "public, max-age=86400" } });
}
