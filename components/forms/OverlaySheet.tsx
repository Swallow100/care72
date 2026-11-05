// 元の様式の上に台帳の値を置いた紙（T86。lib/forms/overlay-sheet.ts）。頁ごとに元の様式の頁の画像を下に敷き、
// 欄の矩形（画像の上の比）に値の字・レ点・丸を置く。頁の数は元の様式の頁の画像の数で、欄に収まらない値と場所の無い欄の値は最後の「別紙」へ。
// 字の大きさと行は lib/forms/overlay-sheet.ts が見積もって決めた物で、ここでは折らない（行の中は nowrap）。
// 元の様式に無い物（頁の下の文書名・頁番号）は様式の頁に刷らない。別紙だけ前からの紙面の形（欄の名前と値の 2 列）。
// 状態を持たない（Server Component のまま、テストで renderToStaticMarkup できる）。見た目は paper.css・mapped-paper.css・overlay-paper.css。

import type { CSSProperties } from "react";
import type { FieldBox } from "@/lib/forms/mapping";
import type { OverlayItem, OverlaySheet as Sheet } from "@/lib/forms/overlay-sheet";
import { PaperFoot } from "./PaperFoot";

const mm = (n: number) => `${n.toFixed(2)}mm`;
const pct = (n: number) => `${(n * 100).toFixed(3)}%`;
const at = (b: FieldBox): CSSProperties => ({ left: pct(b.x), top: pct(b.y), width: pct(b.w), height: pct(b.h) });
const cols: CSSProperties = { gridTemplateColumns: "50mm minmax(0, 1fr)" };

function Item({ it }: { it: OverlayItem }) {
  if (it.kind === "text") {
    return (
      <div
        className={`ov-text${it.top ? " ov-top" : ""}${it.tight ? " ov-tight" : ""}`}
        style={{ ...at(it.box), fontSize: `${it.fontPt}pt` }}
        data-field={it.fieldId}
        data-font={it.fontPt}
        data-shifted={it.shifted ? "1" : undefined}
      >
        {it.lines.map((l, i) => (
          <span key={i} className="ov-ln">
            {l}
          </span>
        ))}
      </div>
    );
  }
  if (it.kind === "image") {
    // 欄に置く画像（避難経路の地図。T101 の受け口、T106）。欄の箱の大きさで描いた SVG を欄の中にそのまま置く
    // （<img> にすると中の地理院タイルを読まない）。中身は lib/forms/frame-build.ts の routeMapFor が数と固定の言葉だけで作った物
    return (
      <div className="ov-pic" style={at(it.box)} role="img" aria-label={it.alt} data-field={it.fieldId} data-slot={it.slot} dangerouslySetInnerHTML={{ __html: it.svg }} />
    );
  }
  // レ点は □ の形のまま、丸は字の場所に合わせて伸ばす
  return it.mark === "check" ? (
    <svg className="ov-mark" style={at(it.box)} viewBox="0 0 10 10" preserveAspectRatio="xMidYMid meet" aria-hidden data-field={it.fieldId} data-mark="check">
      <polyline points="1.8,5.2 4.2,7.9 8.6,1.8" strokeWidth={1.1} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg className="ov-mark" style={at(it.box)} viewBox="0 0 10 10" preserveAspectRatio="none" aria-hidden data-field={it.fieldId} data-mark="circle">
      <ellipse cx={5} cy={5} rx={5.2} ry={5.6} strokeWidth={1} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function OverlaySheet({
  sheet,
  imageSrc,
  checked,
  fill = false,
  kind = "overlay",
  edit = false,
}: {
  sheet: Sheet;
  imageSrc: (page: number) => string;
  /** 別紙の注の「対応表 確認 …」。原本の枠の紙（T101）は空にして、注を出典の形にする */
  checked: string;
  /** 未記入の色付けの版（T101）。既定は色なし（提出に使う紙） */
  fill?: boolean;
  /** data-sheet の値。原本の枠の紙は matsuyama・kiroku（印刷のテストが紙を見分ける） */
  kind?: string;
  /**
   * 紙に直接書く窓の押す所を描く（T117。components/forms/PaperEdit.tsx が押せる欄に印を付けて受ける）。画面だけで、印刷では消す（paper-edit.css）
   */
  edit?: boolean;
}) {
  return (
    <div className="paper-scroll">
      <div className="paper-stack" data-paper-root data-sheet={kind} data-person={sheet.personId} data-typeface={sheet.typeface} data-fill={fill ? "1" : undefined}>
        {sheet.pages.map((p) => (
          <section
            key={p.page}
            className={`paper overlay ${p.landscape ? "land" : ""} ${sheet.typeface === "mincho" ? "mincho" : ""}`}
            aria-label={`${p.page} ページ`}
            data-page={p.page}
          >
            <div className="ov-img" style={{ left: mm(p.image.x), top: mm(p.image.y), width: mm(p.image.w), height: mm(p.image.h) }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- 元の様式の頁の画像（R2 の物を API から）。印刷に出すので <img> */}
              <img className="ov-bg" src={imageSrc(p.page)} alt={`${sheet.title} ${p.page}頁`} />
              {/*
                未記入の色付け。字と印の下、元の様式の頁の上に重ねて掛け合わせる（罫線と刷ってある字は黒のまま）。
                台帳に無い欄（帯の未確認と同じ。ケアマネが聞いて足す）は黄の塗り、台帳に値があるのに置けなかった欄（アプリの直す所。T133）は黄の塗りに破線の縁
              */}
              {fill &&
                p.fills.map((f) => (
                  <div
                    key={f.keys.join(" ")}
                    className={f.kind === "fix" ? "ov-fill ov-fix" : "ov-fill"}
                    style={at(f.box)}
                    data-fill-keys={f.keys.join(" ")}
                    data-fill-kind={f.kind ?? "ask"}
                    aria-hidden
                  />
                ))}
              {p.items.map((it) => (
                <Item key={`${it.fieldId}-${it.kind}${it.kind === "text" && it.part !== undefined ? `-${it.part}` : ""}`} it={it} />
              ))}
              {edit &&
                (p.targets ?? []).map((t) => (
                  <div key={`edit-${t.keys.join(" ")}`} className="ov-edit" style={at(t.box)} data-edit-key={t.keys.join(" ")} />
                ))}
            </div>
          </section>
        ))}
        {sheet.annex.length > 0 && (
          <section className="paper form mapped" aria-label="別紙" data-annex={sheet.annex.length}>
            <div className="head-row">
              <h1 className="title">別紙　{sheet.title}</h1>
              <div className="top-col">
                <span className="nowrap">様式 {sheet.issuer}</span>
              </div>
            </div>
            <div className="top">
              <span>
                対象者 <span>{sheet.name}</span>
              </span>
            </div>
            <div className="blk">
              <div className="grid" style={cols}>
                {sheet.annex.map((r) => (
                  <div key={r.fieldId} className="row" data-field={r.fieldId} data-reason={r.reason}>
                    <span className="lbl">{r.label}</span>
                    <span className="f-v">
                      {r.lines.map((l, i) => (
                        <span key={i} className="ln">
                          {l}
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="small-note foot-note">
              <p>{`※様式の欄に収まらない値（欄に「別紙」）と、様式に位置の無い欄の値。値は台帳から差し込み${checked ? `（対応表 確認 ${checked}）` : ""}`}</p>
            </div>
            <PaperFoot doc={`${sheet.title} 別紙`} name={sheet.name} page={1} total={1} />
          </section>
        )}
      </div>
    </div>
  );
}
