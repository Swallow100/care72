// 警報・地震の市町村と、事業所の市・利用者の住所の市を文字で突き合わせる（T72）。
// 「松山市」=「松山市」。区のある市は電文の市町村が「○○市○○区」の形なので、前方一致で市に当てる。それ以上の読み替えはしない
// （町名・番地・緯度経度への当てはめ、隣の市への広げ、似た名前の寄せをしない。同じ名前の市が別の県にあっても見分けない。docs/progress/t72.md の問い）。

/** 前後の空白を落とす（全角の空白も） */
function clean(s: string): string {
  return s.replace(/^[\s　]+|[\s　]+$/g, "");
}

/** 市（事業所・利用者の住所）と電文の市町村の名前が同じ市か */
export function sameCity(city: string, areaName: string): boolean {
  const c = clean(city);
  const a = clean(areaName);
  if (!c || !a) return false;
  if (a === c) return true;
  // 区のある市: 市の名前で始まり、残りが「○○区」
  return c.endsWith("市") && a.startsWith(c) && /^[^市町村]+区$/.test(a.slice(c.length));
}

/** 市の一覧（重ねない。空は落とす。最初に事業所の市を置くので順を保つ） */
export function uniqueCities(cities: ReadonlyArray<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const c of cities) {
    const v = c ? clean(c) : "";
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** 電文の市町村の名前が、市の一覧のどれかに当たるか。当たった市（無ければ null） */
export function cityOf(cities: ReadonlyArray<string>, areaName: string): string | null {
  return cities.find((c) => sameCity(c, areaName)) ?? null;
}
