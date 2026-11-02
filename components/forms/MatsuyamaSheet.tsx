// 松山市の様式の紙面（A4 縦の 2 ページ）。欄の名前と順は lib/forms/matsuyama.ts の MATSUYAMA_FIELDS。
// 状態を持たない（Server Component のまま、テストで renderToStaticMarkup できる）。
// 大事な欄（同意・実施者・医薬品情報・避難場所・特記の医療）は太い枠と大きい文字、細かい欄は小さく詰める。
// 様式の文（同意の問い・注意書き）は短く言い換えて載せる。原本は市の PDF（MATSUYAMA_FORM_URL）。
// 見た目は components/forms/paper.css（読み込むのはページの側。テストでは読まない）。

import type { CSSProperties } from "react";
import {
  cellText,
  MATSUYAMA_FORM_VERSION,
  matsuyamaField,
  type MatsuyamaKey,
  type MatsuyamaSheet as Sheet,
} from "@/lib/forms/matsuyama";
import { FormCell } from "./FormCell";
import { PaperFoot } from "./PaperFoot";

type Size = "sm" | "lg" | "xl";

function F({
  s,
  k,
  label,
  size,
  bare,
  style,
}: {
  s: Sheet;
  k: MatsuyamaKey;
  label?: string;
  size?: Size;
  /** 見出しの段に名前があるときは欄の名前を出さない */
  bare?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div className={size} data-field={k} style={style}>
      {!bare && <span className="f-l">{label ?? matsuyamaField(k).label}</span>}
      <span className="f-v">
        <FormCell cell={s.cells[k]} />
      </span>
    </div>
  );
}

const cols = (template: string): CSSProperties => ({ gridTemplateColumns: template });
const span = (n: number): CSSProperties => ({ gridColumn: `span ${n}` });

const SUPPORTER_PARTS = ["kana", "relation", "name", "phone", "mobile", "address"] as const;

/**
 * 実施者 1 人の欄。左の細い列に縦書きで「実施者１」、右に 2 段（フリガナと氏名・関係・同意※ / 電話・携帯・住所）。
 * 1 段目のフリガナと氏名は 1 つの枠に重ねる（様式のフリガナ欄と同じ形）
 */
function Supporter({ s, n }: { s: Sheet; n: 1 | 2 }) {
  const k = <T extends string>(part: T) => `supporter${n}.${part}` as MatsuyamaKey;
  // 同意のない範囲は欄ごとに並べず 1 つにまとめる（同意※は出す）
  const withheld = s.cells[k("name")];
  if (withheld.kind === "withheld") {
    return (
      <div className="grid" style={cols("6mm 2fr 1fr")} data-sub={`supporter${n}`}>
        <div className="cap vcap">実施者{n === 1 ? "１" : "２"}</div>
        <div data-fields={SUPPORTER_PARTS.map(k).join(" ")}>
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
    <div className="grid" style={cols("6mm minmax(33mm, 1.4fr) 1fr 0.9fr")} data-sub={`supporter${n}`}>
      <div className="cap vcap" style={{ gridRow: "span 2" }}>
        実施者{n === 1 ? "１" : "２"}
      </div>
      <div className="stack">
        <F s={s} k={k("kana")} size="sm" />
        <F s={s} k={k("name")} size="xl" />
      </div>
      <F s={s} k={k("relation")} />
      <F s={s} k={k("consent")} size="lg" />
      <F s={s} k={k("phone")} />
      <F s={s} k={k("mobile")} />
      <F s={s} k={k("address")} />
    </div>
  );
}

function PageOne({ s }: { s: Sheet }) {
  return (
    <section className="paper form" aria-label="1 ページ" data-page="1">
      <div className="top">
        <span>（様式【{MATSUYAMA_FORM_VERSION}】）</span>
        <span data-field="head.number">
          番号【<span style={{ display: "inline-block", width: "28mm" }} />】
        </span>
      </div>
      <h1 className="title">松山市避難行動要支援者名簿登録申込書 兼 個別避難計画</h1>
      <div className="top">
        <span>（あて先）松山市長</span>
        <span data-field="head.date" className="nowrap">
          {cellText(s.cells["head.date"])} 作成
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
          <F s={s} k="target.name" size="xl" />
          <F s={s} k="target.address" size="lg" />
          <F s={s} k="target.phone" />
          <F s={s} k="target.mobile" />
        </div>
        <div className="grid" style={cols("1fr")}>
          <F s={s} k="target.category" />
        </div>
        <div className="grid" style={cols("1.5fr 1fr")}>
          <F s={s} k="target.household" />
          <F s={s} k="target.timeline" />
        </div>
        <div className="grid" style={cols("1fr 1fr")} data-block="local">
          <F s={s} k="local.welfare" />
          <F s={s} k="local.watcher" />
          <F s={s} k="local.office" />
          <F s={s} k="local.other" />
        </div>
      </div>

      <div className="blk key grow-last" data-block="consent">
        <div className="blk-h">同意</div>
        <div className="grid" style={cols("1fr 52mm")}>
          <div>
            市の避難行動要支援者名簿に登録し、平常時から避難支援等関係者（消防・警察・民生児童委員・社会福祉協議会・自主防災組織など）へ提供すること
          </div>
          <F s={s} k="consent.registry" size="lg" bare />
          <div>避難のための個別避難計画を作り、避難支援等関係者と事前に共有すること</div>
          <F s={s} k="consent.planShare" size="lg" bare />
        </div>
        <div className="grid" style={cols("1fr 1.4fr")} data-block="sign">
          <F s={s} k="sign.self" />
          <F s={s} k="sign.proxy" label="代理人 氏名・続柄・連絡先（本人が書けないとき）" />
        </div>
      </div>

      <div className="blk" data-block="kin">
        <div className="blk-h">
          近親者及緊急時の連絡先<span className="note">安否確認ができたときの連絡先</span>
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
        <div className="blk-h">
          避難支援等実施者（近隣協力員）<span className="note">避難支援等の実施に法的な責任や義務は負わない</span>
        </div>
        <div className="grid" style={cols("1fr 1fr")}>
          <Supporter s={s} n={1} />
          <Supporter s={s} n={2} />
        </div>
        <div className="grid" style={cols("1fr")}>
          <F s={s} k="supporter.night" />
        </div>
      </div>

      <div className="blk" data-block="org">
        <div className="blk-h">
          避難支援等実施組織<span className="note">実施者がいないときは自治会・自主防災組織などを記入</span>
        </div>
        <div className="grid" style={cols("2fr 1fr 1fr")}>
          <F s={s} k="org.name" />
          <F s={s} k="org.phone" />
          <F s={s} k="org.consent" />
        </div>
      </div>

      <div className="small-note">
        <p>※実施者・組織の同意：本人と避難支援に関わる人が話し合って作り、平常時から避難支援等関係者へ提供することに同意する</p>
      </div>
      <PaperFoot doc="個別避難計画" name={s.name} page={1} total={2} />
    </section>
  );
}

function ShelterRow({ s, id, label, note }: { s: Sheet; id: "pre" | "near" | "city"; label: string; note?: string }) {
  return (
    <>
      <div className="cap">
        {label}
        {note && <span className="f-l">{note}</span>}
      </div>
      <F s={s} k={`shelter.${id}.place`} label="場所" size="lg" />
      <F s={s} k={`shelter.${id}.means`} />
      <F s={s} k={`shelter.${id}.minutes`} />
    </>
  );
}

function PageTwo({ s }: { s: Sheet }) {
  return (
    <section className="paper form" aria-label="2 ページ" data-page="2">
      <div className="blk" data-block="plan">
        <div className="grid" style={cols("1fr 1.4fr")}>
          <F s={s} k="plan.author" />
          <F s={s} k="medical.doctor" />
        </div>
      </div>

      <div className="blk key" data-block="drugs">
        <div className="blk-h">
          医薬品情報<span className="note">機器は特記事項、詳細は別紙</span>
        </div>
        <div className="grid" style={cols("1fr")}>
          <F s={s} k="medical.drugs" size="lg" bare />
        </div>
      </div>

      <div className="blk" data-block="risk">
        <div className="grid" style={cols("1.6fr 1fr")}>
          <F s={s} k="risk.home" label="自宅のリスク（複数選択可）" />
          <F s={s} k="risk.timing" />
        </div>
        <div className="grid" style={cols("1fr")}>
          <F s={s} k="risk.issues" />
        </div>
      </div>

      <div className="blk key" data-block="shelter">
        <div className="blk-h">私の避難場所</div>
        <div className="grid" style={cols("34mm 1fr 1.1fr 20mm")}>
          <ShelterRow s={s} id="pre" label="事前避難場所" note="親戚宅や近くの安全な場所など" />
          <ShelterRow s={s} id="near" label="最寄りの避難場所" />
          <ShelterRow s={s} id="city" label="市指定避難所" />
        </div>
      </div>

      <div className="blk" data-block="housing">
        <div className="blk-h">住居</div>
        <div className="grid" style={cols("1fr 1.2fr 1.4fr 0.8fr 0.8fr")}>
          <F s={s} k="housing.type" />
          <F s={s} k="housing.structure" />
          <F s={s} k="housing.floors" />
          <F s={s} k="housing.room" />
          <F s={s} k="housing.bedroom" />
        </div>
        <div className="grid" style={cols("1fr")}>
          <F s={s} k="support.kinds" label="支援の内容（複数選択可）" />
        </div>
      </div>

      <div className="blk key grow" data-block="notes">
        <div className="blk-h">
          特記事項<span className="note">リスクや課題への対応、支援の方法、医療・福祉サービスの利用など</span>
          <span className="end" data-field="notes.annex">
            別紙 <FormCell cell={s.cells["notes.annex"]} />
          </span>
        </div>
        <div className="grid" style={cols("1fr")}>
          <F s={s} k="notes.medical" size="lg" />
          <F s={s} k="notes.words" />
          <F s={s} k="notes.other" />
        </div>
      </div>

      <div className="blk grow" data-block="route">
        <div className="blk-h">
          避難経路<span className="note">地図上または箇条書き</span>
          <span className="end" data-field="route.map">
            まつやま総合防災マップからの引用 <FormCell cell={s.cells["route.map"]} />
          </span>
        </div>
        <div className="grid" style={cols("1fr")}>
          <F s={s} k="route.text" bare />
        </div>
      </div>

      <div className="foot">
        <div className="small-note">
          <p>※自宅での訓練、地域の防災訓練への参加、物資の備蓄など、平常時からできる範囲で災害に備える</p>
          <p>
            ※この計画は避難に要る情報をまとめた物で、支援がなされることを保証せず、関係者に法的な責任や義務を負わせない。記載した情報は災害時の生命等の安全のためだけに使い、ほかの用途に使わない
          </p>
          <p>※欄は松山市 様式【{MATSUYAMA_FORM_VERSION}】による</p>
        </div>
        <div className="cap nowrap">松山市長</div>
        <div className="stamp" data-field="city.stamp">
          市受付印
        </div>
      </div>
      <PaperFoot doc="個別避難計画" name={s.name} page={2} total={2} />
    </section>
  );
}

export function MatsuyamaSheet({ sheet }: { sheet: Sheet }) {
  return (
    <div className="paper-scroll">
      <div className="paper-stack" data-paper-root data-sheet="matsuyama" data-person={sheet.personId}>
        <PageOne s={sheet} />
        <PageTwo s={sheet} />
      </div>
    </div>
  );
}
