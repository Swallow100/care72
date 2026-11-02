// 紙の下の端の 1 行（余白の中）: 左に文書名と対象者、右に頁番号「1 / 2」。頁が離れても何の何枚目か分かるように。
// 本人の 1 枚の表は本人が読む面なので頁番号だけ（漢字に全部ふりがなを付ける決まり。名前は題名にある）。
// 状態を持たない（Server Component のまま、テストで renderToStaticMarkup できる）。見た目は paper.css の .paper-foot。

export function PaperFoot({ doc, name, page, total }: { doc?: string; name?: string | null; page: number; total: number }) {
  return (
    <div className="paper-foot" data-paper-foot={`${page}/${total}`}>
      <span>
        {doc}
        {name && <>　{name}</>}
      </span>
      <span className="nowrap">
        {page} / {total}
      </span>
    </div>
  );
}
