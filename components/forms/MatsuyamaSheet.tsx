// 松山市の様式の紙面（A4 縦の 2 ページ）。欄の名前と順は lib/forms/matsuyama.ts の MATSUYAMA_FIELDS、刷ってある文は MATSUYAMA_TEXTS。
// 状態を持たない（Server Component のまま、テストで renderToStaticMarkup できる）。
// 字の太さは市の様式のとおり（T47）: 太いのは段の名前 7 つ（近親者及緊急時の連絡先・避難支援等実施者・避難支援等実施組織・
// 私の避難場所・住居・支援の内容・避難経路）と、同意の問いとマイ・タイムラインの選択肢の言葉だけ。題・欄の名前・値は太くしない。
// 様式に名前の無い欄（□ の並び・空の行）は名前を出さない。様式に無い欄（夜間支援）は特記事項の書き込みの中に出す。
// 字の書体・大きさは市の様式のとおり（T85。lib/forms/form-audit.ts の MATSUYAMA_AUDIT.paper）: 様式で明朝の字（題・あて先・同意の問い・
// 地域の支援者と代理人の欄の名前・注の多く・市受付印）は .mc（BIZ UDP明朝）、刷ってある文には data-tx（MATSUYAMA_TEXTS の名前）を付け、
// 大きさは paper.css の .paper.matsuyama が持つ。近親者の段の注は太く下線、2 頁の下の注 1 つ目は下線（.u。様式のとおり）。
// 見た目は components/forms/paper.css（読み込むのはページの側。テストでは読まない）。

import type { CSSProperties, ReactNode } from "react";
import {
  cellText,
  MATSUYAMA_BLOCKS,
  MATSUYAMA_TEXTS as TX,
  matsuyamaField,
  type MatsuyamaKey,
  type MatsuyamaSheet as Sheet,
} from "@/lib/forms/matsuyama";
import { paperText } from "@/lib/forms/paper-text";
import { ROUTE_MAP_ANNEX_MM, type RouteMapImage } from "@/lib/forms/frame-build";
import type { SlotImage } from "@/lib/forms/frame-sheet";
import { ANNEX_MARK } from "@/lib/forms/overlay-sheet";
import { ROUTE_LABELS } from "@/lib/labels";
import { FormCell } from "./FormCell";
import { PaperFoot } from "./PaperFoot";

type Size = "sm" | "lg";

function F({
  s,
  k,
  size,
  bare,
  boldOptions,
  boldLabel,
  mincho,
  inline,
  note,
  style,
  after,
}: {
  s: Sheet;
  k: MatsuyamaKey;
  size?: Size;
  /** 値のあとに続ける物（避難経路の「地図 別紙」。行を増やさない） */
  after?: ReactNode;
  /** 見出しの段に名前があるときは欄の名前を出さない */
  bare?: boolean;
  /** 選択肢の言葉が様式で太い欄（同意の問い・マイ・タイムライン） */
  boldOptions?: boolean;
  /** 欄の名前が様式で太い欄（支援の内容） */
  boldLabel?: boolean;
  /** 欄の名前が様式で明朝の欄（地域の支援者・代理人） */
  mincho?: boolean;
  /** 欄の名前を値の左に並べる（様式で名前と（　）が 1 行の欄。地域の支援者） */
  inline?: boolean;
  /** 欄の名前に添える様式の注（tx は MATSUYAMA_TEXTS の名前） */
  note?: { text: string; tx: keyof typeof TX };
  style?: CSSProperties;
}) {
  const def = matsuyamaField(k);
  const showLabel = !bare && !def.unnamed;
  const cls = [size, boldOptions ? "opt-b" : "", inline ? "il" : ""].filter(Boolean).join(" ") || undefined;
  const labelCls = ["f-l", boldLabel ? "b" : "", mincho ? "mc" : ""].filter(Boolean).join(" ");
  return (
    <div className={cls} data-field={k} style={style}>
      {showLabel ? (
        <span className={labelCls}>
          {def.label}
          {note && (
            <span className="f-n" data-tx={note.tx}>
              {note.text}
            </span>
          )}
        </span>
      ) : (
        inline && <span className={labelCls} />
      )}
      <span className="f-v">
        <FormCell cell={s.cells[k]} />
        {after}
      </span>
    </div>
  );
}

const cols = (template: string): CSSProperties => ({ gridTemplateColumns: template });

/** 避難経路の文の欄に「地図 別紙」を右上に置くときの欄（文は印の手前で折り返す） */
const ROUTE_ANNEX_CELL: CSSProperties = { position: "relative", paddingRight: "17mm" };

const SUPPORTER_PARTS = ["kana", "name", "address", "phone", "mobile", "relation", "consent"] as const;

/**
 * 実施者 1 人の欄。様式の並び: 左の細い列に縦書きで「実施者１」、次の列にフリガナと氏名（1 つの枠に重ねる）と住所、
 * その右に電話番号・携帯番号・関係、右の端に同意※
 */
function Supporter({ s, n }: { s: Sheet; n: 1 | 2 }) {
  const k = <T extends string>(part: T) => `supporter${n}.${part}` as MatsuyamaKey;
  // 同意のない範囲は欄ごとに並べず 1 つにまとめる（同意※は出す）
  const withheld = s.cells[k("name")];
  if (withheld.kind === "withheld") {
    return (
      <div className="grid" style={cols("6mm 2fr 1fr")} data-sub={`supporter${n}`}>
        <div className="cap vcap">実施者{n === 1 ? "１" : "２"}</div>
        <div data-fields={SUPPORTER_PARTS.filter((p) => p !== "consent").map(k).join(" ")}>
          <span className="f-l">氏名・連絡先</span>
          <span className="f-v">
            <FormCell cell={withheld} />
          </span>
        </div>
        <F s={s} k={k("consent")} size="lg" />
      </div>
    );
  }
  return (
    <div className="grid" style={cols("6mm minmax(26mm, 1.1fr) minmax(33mm, 1.1fr) 17mm")} data-sub={`supporter${n}`}>
      <div className="cap vcap" style={{ gridRow: "span 3" }}>
        実施者{n === 1 ? "１" : "２"}
      </div>
      <div className="stack" style={{ gridRow: "span 2" }}>
        <F s={s} k={k("kana")} size="sm" />
        <F s={s} k={k("name")} size="lg" />
      </div>
      <F s={s} k={k("phone")} />
      <F s={s} k={k("consent")} size="lg" style={{ gridRow: "span 3" }} />
      <F s={s} k={k("mobile")} />
      <F s={s} k={k("address")} />
      <F s={s} k={k("relation")} />
    </div>
  );
}

function PageOne({ s }: { s: Sheet }) {
  return (
    <section className="paper form matsuyama" aria-label="1 ページ" data-page="1">
      <div className="top">
        <span data-tx="version">{TX.version}</span>
        <span data-field="head.number">
          【<span style={{ display: "inline-block", width: "28mm" }} />】
        </span>
      </div>
      <h1 className="title mc" data-tx="title">
        {TX.title}
      </h1>
      <div className="top">
        <span className="mc" data-tx="to">
          {TX.to}
        </span>
        <span data-field="head.date" className="nowrap mc">
          {paperText(cellText(s.cells["head.date"]))} 作成
        </span>
      </div>

      <div className="blk" data-block="target">
        <div className="blk-h">対象者</div>
        <div className="grid" style={cols("1.7fr 0.7fr 1.7fr 1fr")}>
          <F s={s} k="target.kana" />
          <F s={s} k="target.sex" />
          <F s={s} k="target.birth" />
          <F s={s} k="target.district" />
        </div>
        <div className="grid" style={cols("1.55fr 1.45fr 1.1fr 1.1fr")}>
          <F s={s} k="target.name" size="lg" />
          <F s={s} k="target.address" size="lg" />
          <F s={s} k="target.phone" />
          <F s={s} k="target.mobile" />
        </div>
        {/* 区分の □ の右に 地域の支援者 の行（民生・児童委員・みまもり員・事業所等・名前の無い行） */}
        <div className="grid" style={cols("1fr 1fr")} data-block="local">
          <F s={s} k="target.category" style={{ gridRow: "span 4" }} />
          <F s={s} k="local.welfare" inline mincho />
          <F s={s} k="local.watcher" inline mincho />
          <F s={s} k="local.office" inline mincho />
          <F s={s} k="local.other" inline mincho />
        </div>
        <div className="grid" style={cols("1.5fr 1fr")}>
          <F s={s} k="target.household" />
          <F s={s} k="target.timeline" boldOptions />
        </div>
      </div>

      {/* 同意の段（様式に段の名前は無い。問いの文と 同意する・同意しない） */}
      <div className="blk key grow-last" data-block="consent">
        <div className="grid" style={cols("1fr 44mm")}>
          <div className="q mc" data-tx="consentRegistry">
            {TX.consentRegistry}
          </div>
          <F s={s} k="consent.registry" size="lg" boldOptions />
          <div className="q mc" data-tx="consentPlanShare">
            {TX.consentPlanShare}
          </div>
          <F s={s} k="consent.planShare" size="lg" boldOptions />
        </div>
        <div className="grid" style={cols("1fr")}>
          <div className="q mc" data-tx="confirmed">
            {TX.confirmed}
          </div>
        </div>
        <div className="grid" style={cols("1fr 1.4fr")} data-block="sign">
          <F s={s} k="sign.self" />
          <F s={s} k="sign.proxy" mincho note={{ text: TX.proxyNote, tx: "proxyNote" }} />
        </div>
      </div>

      <div className="blk" data-block="kin">
        <div className="blk-h b">
          近親者及緊急時の連絡先
          <span className="note b u mc" data-tx="kinNote">
            {TX.kinNote}
          </span>
        </div>
        <div className="grid" style={cols("0.9fr 1.3fr 0.5fr 1.3fr 1.1fr 1fr")}>
          <F s={s} k="kin.kana" size="sm" />
          <F s={s} k="kin.name" size="lg" />
          <F s={s} k="kin.relation" />
          <F s={s} k="kin.phone" />
          <F s={s} k="kin.mobile" />
          <F s={s} k="kin.address" />
        </div>
      </div>

      <div className="blk key" data-block="supporters">
        <div className="blk-h b" data-tx="supportersHead">
          {TX.supportersHead}
          <span className="note mc" data-tx="supportersNote">
            {TX.supportersNote}
          </span>
        </div>
        <div className="grid" style={cols("1fr 1fr")}>
          <Supporter s={s} n={1} />
          <Supporter s={s} n={2} />
        </div>
      </div>

      <div className="blk" data-block="org">
        <div className="blk-h b">
          避難支援等実施組織
          <span className="note mc" data-tx="orgNote">
            {TX.orgNote}
          </span>
        </div>
        <div className="grid" style={cols("2fr 1fr 1fr")}>
          <F s={s} k="org.name" />
          <F s={s} k="org.phone" />
          <F s={s} k="org.consent" />
        </div>
      </div>

      <div className="small-note">
        <p className="mc" data-tx="supporterConsentNote">
          {TX.supporterConsentNote}
        </p>
      </div>
      <PaperFoot doc="個別避難計画" name={s.name} page={1} total={2} />
    </section>
  );
}

function ShelterRow({ s, id, note }: { s: Sheet; id: "pre" | "near" | "city"; note?: string }) {
  const place = `shelter.${id}.place` as MatsuyamaKey;
  const minutes = `shelter.${id}.minutes` as MatsuyamaKey;
  return (
    <>
      <div className="cap" data-cap={id}>
        {matsuyamaField(place).label}
        {note && (
          <span className="f-l" data-tx="preNote">
            {note}
          </span>
        )}
      </div>
      <F s={s} k={place} size="lg" bare />
      <F s={s} k={`shelter.${id}.means`} />
      {/* 様式は「【時間】（　）分」 */}
      <div data-field={minutes}>
        <span className="f-l">{matsuyamaField(minutes).label}</span>
        <span className="f-v">
          （<FormCell cell={s.cells[minutes]} />）分
        </span>
      </div>
    </>
  );
}

/**
 * 特記事項の書き込みの 1 段（段の名前は小さく灰色で行の頭に。様式の欄の名前ではない）。
 * 値の無い段（空き枠）は段ごと刷らない（T111。原本の枠の紙と同じ）。「なし」と分かっている段（夜間支援 なし）は刷る
 */
function NotePart({ s, k }: { s: Sheet; k: MatsuyamaKey }) {
  if (s.cells[k].kind === "empty") return null;
  return (
    <div className="part" data-field={k}>
      <span className="lead">{matsuyamaField(k).label}</span>
      <span className="f-v">
        <FormCell cell={s.cells[k]} />
      </span>
    </div>
  );
}

function PageTwo({ s, map }: { s: Sheet; map: boolean }) {
  return (
    <section className="paper form matsuyama" aria-label="2 ページ" data-page="2">
      <div className="blk key" data-block="plan">
        <div className="grid" style={cols("1fr 1.4fr")}>
          <F s={s} k="plan.author" />
          <F s={s} k="medical.doctor" />
        </div>
        <div className="grid" style={cols("1fr")} data-block="drugs">
          <F s={s} k="medical.drugs" size="lg" />
        </div>
      </div>

      <div className="blk" data-block="risk">
        <div className="grid" style={cols("1.6fr 1fr")}>
          <F s={s} k="risk.home" />
          <F s={s} k="risk.timing" />
        </div>
        <div className="grid" style={cols("1fr")}>
          <F s={s} k="risk.issues" />
        </div>
      </div>

      <div className="blk key" data-block="shelter">
        <div className="blk-h b">私の避難場所</div>
        <div className="grid" style={cols("34mm 1fr 1.1fr 24mm")}>
          <ShelterRow s={s} id="pre" note={TX.preNote} />
          <ShelterRow s={s} id="near" />
          <ShelterRow s={s} id="city" />
        </div>
      </div>

      <div className="blk" data-block="housing">
        <div className="blk-h b">住居</div>
        <div className="grid" style={cols("1fr 1.2fr 1.4fr 0.8fr 0.8fr")}>
          <F s={s} k="housing.type" />
          <F s={s} k="housing.structure" />
          <F s={s} k="housing.floors" />
          <F s={s} k="housing.room" />
          <F s={s} k="housing.bedroom" />
        </div>
      </div>

      <div className="blk" data-block="support">
        <div className="grid" style={cols("1fr")}>
          <F s={s} k="support.kinds" boldLabel />
        </div>
      </div>

      <div className="blk key grow" data-block="notes">
        <div className="blk-h">
          <span className="nowrap">特記事項</span>
          <span className="note" data-tx="notesNote">
            {TX.notesNote}
          </span>
          <span className="end" data-field="notes.annex">
            別紙 <FormCell cell={s.cells["notes.annex"]} />
          </span>
        </div>
        {/* 様式では 1 つの書き込みの欄。中を段に分けて書く */}
        <div className="grid" style={cols("1fr")}>
          <div className="parts">
            <NotePart s={s} k="notes.medical" />
            <NotePart s={s} k="notes.words" />
            <NotePart s={s} k="supporter.night" />
            <NotePart s={s} k="notes.other" />
          </div>
        </div>
      </div>

      <div className="blk grow" data-block="route">
        <div className="blk-h b">
          避難経路
          <span className="note mc" data-tx="routeNote">
            {TX.routeNote}
          </span>
          <span className="end" data-field="route.map">
            {matsuyamaField("route.map").label} <FormCell cell={s.cells["route.map"]} />
          </span>
        </div>
        <div className="grid" style={cols("1fr")}>
          {/* 地図は 2 頁に場所が無いので別紙（T106）。段の右上に「地図 別紙」（行を増やさない。文はその手前で折り返す） */}
          <F
            s={s}
            k="route.text"
            bare
            style={map ? ROUTE_ANNEX_CELL : undefined}
            after={
              map && (
                <span className="route-annex" data-annex-mark="route-map">
                  {ROUTE_LABELS.paperMap} {ANNEX_MARK}
                </span>
              )
            }
          />
        </div>
      </div>

      {/* 様式の並び: 注は幅いっぱい、その下の行の左に松山市長、右に横長の市受付印の枠 */}
      <div className="small-note">
        <p className="mc u" data-tx="footPrepare">
          {TX.footPrepare}
        </p>
        <p className="mc" data-tx="footNoGuarantee">
          {TX.footNoGuarantee}
        </p>
        <p className="plain" data-tx="footUse">
          {TX.footUse}
        </p>
      </div>
      <div className="foot">
        <div className="nowrap" data-tx="mayor">
          {TX.mayor}
        </div>
        <div className="stamp mc" data-field="city.stamp">
          {matsuyamaField("city.stamp").label}
        </div>
      </div>
      <PaperFoot doc="個別避難計画" name={s.name} page={2} total={2} />
    </section>
  );
}

/**
 * 避難経路の地図の別紙（T106）。前からの紙面の 2 頁は詰めてあり（T85）、避難経路の段に地図の場所が無い（種の 10 人で空きは 1.65〜27mm）。
 * T101 の決まり（欄に収まらない物は欄に「別紙」、最後に別紙の頁）のとおり、地図はこの頁に。頁の数は 2 ＋ 別紙 1。
 * 地図は箱の大きさで描いた SVG を箱の中にそのまま置く（<img> にすると中の地理院タイルを読まない）。中身は routeMapFor が数と固定の言葉だけで作った物
 */
function RouteMapAnnex({ s, pic }: { s: Sheet; pic: SlotImage }) {
  return (
    <section className="paper form matsuyama route-annex-page" aria-label={ANNEX_MARK} data-annex="route-map">
      <div className="head-row">
        <h1 className="title">
          {ANNEX_MARK}　{MATSUYAMA_BLOCKS.route}
        </h1>
      </div>
      <div className="top">
        <span>
          対象者 <span data-field="target.name">{s.name}</span>
        </span>
      </div>
      <div className="blk" data-block="route-annex">
        <div className="route-map" role="img" aria-label={pic.alt} data-slot="route-map" dangerouslySetInnerHTML={{ __html: pic.svg }} />
      </div>
      <PaperFoot doc={`個別避難計画 ${ANNEX_MARK}`} name={s.name} page={1} total={1} />
    </section>
  );
}

/** routeMap は避難経路の地図（lib/forms/frame-build.ts の routeMapFor。無ければ置かない）。あれば段に「地図 別紙」、地図は別紙の頁 */
export function MatsuyamaSheet({ sheet, routeMap = null }: { sheet: Sheet; routeMap?: RouteMapImage | null }) {
  const pic = routeMap?.(ROUTE_MAP_ANNEX_MM) ?? null;
  return (
    <div className="paper-scroll">
      <div className="paper-stack" data-paper-root data-sheet="matsuyama" data-person={sheet.personId}>
        <PageOne s={sheet} />
        <PageTwo s={sheet} map={pic !== null} />
        {pic && <RouteMapAnnex s={sheet} pic={pic} />}
      </div>
    </div>
  );
}
