// CSV を落とす応答（T62。様式 9 の CSV〔app/office/form9/csv/route.ts〕と同じ見出し）。
// 氏名が入るので Cache-Control: no-store。ファイルの名前は ASCII と日本語（filename*）の 2 つ。

export function csvResponse(body: string, names: { ascii: string; utf8: string }): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${names.ascii}"; filename*=UTF-8''${encodeURIComponent(names.utf8)}`,
      "Cache-Control": "no-store",
    },
  });
}
