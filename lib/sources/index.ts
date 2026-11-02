// 出典の登録簿（docs/tasks/T25.md）。Claude と画面が根拠として引けるのは、ここにある公開文書だけ。
//
// - ルールの表の行・足す言葉・優先の骨格の段（lib/triage）は sourceIds でここの id を指す。無い id はテストで落ちる。
// - docs/SOURCES.md はこの一覧と lib/triage から作る（npm run docs:triage が TRIAGE.md と一緒に書く。手で直さない）。
// - 作者が本文を読んで確かめたら、checkedOn に日付（"2026-11-03" の形）を入れる。null の間は画面と文書に「未確認」と出る。
// - 要旨・範囲は自分の言葉で書く。原文を写さない。引く（quote）のは 15 字まで、場所を添える。PDF はリポジトリに入れずリンクだけ。
// - 文書に載っている人の名前（委員・担当者）は書かない。団体名だけ。
//
// 時計の「出典」欄（lib/db/types.ts の ClockSource: 主治医の指示・機器の説明書…）とは別物。あちらは人が台帳に入れた値の出どころ。

/** 登録簿の 1 件。id は英小文字・数字・ハイフン（docs/SOURCES.md の見出しのアンカーと同じになる） */
type SourceFields = {
  readonly id: string;
  /** 発行元（団体名。人の名前は書かない） */
  readonly publisher: string;
  readonly title: string;
  /** 発行の年（読んだ版の元の年。改訂は edition に） */
  readonly year: number;
  /** 版と日付（読んだ物） */
  readonly edition: string;
  /** 文書そのもの（PDF なら PDF） */
  readonly url: string;
  /** 文書が載っている頁（url が PDF のとき） */
  readonly page?: string;
  /** 1 行の要旨（自分の言葉で） */
  readonly summary: string;
  /** この作品で使う範囲（1 行） */
  readonly scope: string;
  /** 短い引用（15 字まで）と場所 */
  readonly quote?: { readonly text: string; readonly where: string };
  /** 気を付ける所（古い・学会でなく協会の物など） */
  readonly note?: string;
  /** 作者が本文を確かめた日（YYYY-MM-DD）。null は未確認 */
  readonly checkedOn: string | null;
};

/** 引用の長さの上限（字） */
export const QUOTE_MAX = 15;

/** 登録簿。並びは docs/SOURCES.md の並び（制度 → 機器 → 透析 → 薬 → 認知症 → 血栓 → 記録） */
export const SOURCES = [
  {
    id: "cao-shishin-2021",
    publisher: "内閣府（防災担当）",
    title: "避難行動要支援者の避難行動支援に関する取組指針",
    year: 2021,
    edition: "令和3年5月改定（本文は令和7年6月更新）",
    url: "https://www.bousai.go.jp/taisaku/hisaisyagyousei/youengosya/r3/index.html",
    summary:
      "個別避難計画を市町村の努力義務にした法改正を受けた指針。優先度の高い人から作る、福祉専門職が加わる、避難を支える人を確保する、本人の同意で支援者に情報を渡す、作ったあとに訓練する",
    scope: "個別避難計画の枠と、支援者の有無を順に使うこと（骨格の段 7、「支援者なし」）",
    quote: { text: "福祉専門職の参画が極めて重要", where: "概要の PDF・改定のポイント" },
    note: "頁に概要・本文（第Ⅰ〜Ⅳ部）・参考資料（第Ⅴ部）の PDF がある",
    checkedOn: null,
  },
  {
    id: "mhlw-bcp-2020",
    publisher: "厚生労働省老健局",
    title: "介護施設・事業所における自然災害発生時の業務継続ガイドライン",
    year: 2020,
    edition: "第1版 令和2年12月11日、第1.1版 令和6年3月31日",
    url: "https://www.mhlw.go.jp/content/000749543.pdf",
    page: "https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/hukushi_kaigo/kaigo_koureisha/douga_00002.html",
    summary:
      "介護事業所の自然災害の BCP の作り方。居宅介護支援は、先に安否を確かめる利用者を台帳で分かるようにし、連絡手段を複数持つ。ひな形の様式 9 は災害時利用者一覧表（安否確認の優先順位）",
    scope: "安否を確かめる順を事業所が持つことの根拠（信号の行・並び・骨格の段 8・様式 9）",
    quote: { text: "優先的に安否確認が必要な利用者", where: "3-2-4 居宅介護支援サービス固有事項" },
    note: "ひな形（Excel）は同じ頁の「自然災害ひな形」",
    checkedOn: null,
  },
  {
    id: "nanbyo-shishin-2017",
    publisher: "厚生労働科学研究「難病患者の地域支援体制に関する研究」班",
    title: "災害時難病患者個別支援計画を策定するための指針（改訂版）",
    year: 2017,
    edition: "2017年8月（内閣府が令和4年7月に個別避難計画の参考資料②として掲載）",
    url: "https://www.bousai.go.jp/taisaku/hisaisyagyousei/pdf/r4_sanko02.pdf",
    summary:
      "在宅の人工呼吸器・吸引・在宅酸素・経管栄養の人の停電への備え（外部電池・手で使う吸引器・非常用の電源）と、中断できない薬（インスリン・ステロイド・抗てんかん薬など）と栄養剤を 1 週間分ほど備えること",
    scope: "骨格の段 1・2・4・5、機器の時計と薬・物の時計の行",
    quote: { text: "人工呼吸器停止の主因は停電", where: "在宅人工呼吸器療法患者への支援" },
    note: "対象は難病の人だが、難病でない在宅の人工呼吸器の人にも同じ備えが要ると本文が書いている",
    checkedOn: null,
  },
  {
    id: "nanbyo-tsuiho-2022",
    publisher: "厚生労働行政推進調査事業「難病患者の総合的地域支援体制に関する研究」班",
    title: "災害時難病患者個別避難計画を策定するための指針（追補版）",
    year: 2022,
    edition: "令和4年3月（内閣府が令和4年7月に参考資料③として掲載）",
    url: "https://www.bousai.go.jp/taisaku/hisaisyagyousei/pdf/r4_sanko03.pdf",
    summary:
      "2017 年の改訂版に、風水害と大規模な停電への備え（電気自動車での充電、医療用の電源の拠点）と、停電したら呼吸器の電池の残りを見積もって早めに避難する考えを足した",
    scope: "機器の時計（内蔵電池の時間）の行と、緑の報告のあとに電池が切れる行",
    quote: { text: "早めに避難することが望ましい", where: "予測できない災害における避難の時期と留意点・停電の場合" },
    checkedOn: null,
  },
  {
    id: "jrs-respiratory-2012",
    publisher: "日本呼吸器疾患患者団体連合会・日本呼吸器学会",
    title: "慢性呼吸器疾患患者さんの災害への備え",
    year: 2012,
    edition: "2012年10月",
    url: "https://www.jrs.or.jp/jrs_patient/file/23eed014b692f96fefc26e2e0ffd314232042acd.pdf",
    summary:
      "患者向けの 1 枚。酸素ボンベの使い方と持ち時間を家族も知っておく、ボンベを空にしない、停電したら濃縮器からボンベに替えて業者に連絡する、自家発電を持つ近くの病院を前もって探す",
    scope: "骨格の段 2、酸素の時計（予備ボンベ）の行",
    quote: { text: "所持ボンベをすべて空にしない", where: "停電に備えて" },
    note: "2012 年の物で古い。機器の細部は主治医と酸素の業者の資料で確かめる",
    checkedOn: null,
  },
  {
    id: "jadp-dialysis-2023",
    publisher: "日本透析医会",
    title: "透析患者の災害対策 〜災害時にすべきこと、起こる前の備え〜",
    year: 2023,
    edition: "2023年3月掲載（PDF の作成は 2023年1月）",
    url: "https://www.touseki-ikai.or.jp/htm/05_publish/doc/20230331_Disaster_countermeasures_for_dialysis_patients.pdf",
    page: "https://touseki-ikai.or.jp/saigai-kankei/saigai-shuppan/",
    summary:
      "血液透析は水と電気を大量に使い、断水・停電・施設の損傷でできなくなる。施設との災害時の連絡の方法を前もって確かめ、自施設で無理なら他の施設で受ける。日本透析医会の災害時情報ネットワークで施設の状況が分かることがある",
    scope: "骨格の段 3、透析の時計と「透析先 未確認」の行",
    quote: { text: "透析は災害に弱い治療", where: "冒頭の見出し" },
    checkedOn: null,
  },
  {
    id: "jadec-insulin-2023",
    publisher: "日本糖尿病協会（DiaMAT 推進委員会 監修）",
    title: "インスリンが必要な糖尿病患者さんのための災害時サポートマニュアル",
    year: 2023,
    edition: "2023年1月作成",
    url: "https://www.nittokyo.or.jp/uploads/files/disaster_manual_2023.02.pdf",
    summary:
      "患者向け。持ち出す物の一覧、持ち出せたインスリンの量で動き方が変わる（手元の分が尽きる前に次を手に入れる）、避難所での保管、低血糖・高血糖への注意",
    scope:
      "骨格の段 4、インスリンの時計（手元の残りの日数）の行。冷蔵が切れても時計を走らせず、暑さ・冷蔵を時計の確認の欄（頼り先 保管）に置く根拠（11/3 確定の 1）",
    note:
      "日本糖尿病学会の医療者向けのマニュアル（2024 年版）は書籍で、公開の PDF が無いため協会の患者向けを入れた。冷蔵できなくても未開封ならしばらく使える旨の記述がある（製品で違う）",
    checkedOn: null,
  },
  {
    id: "jcs-disaster-2014",
    publisher: "日本循環器学会・日本高血圧学会・日本心臓病学会",
    title: "2014年版 災害時循環器疾患の予防・管理に関するガイドライン",
    year: 2014,
    edition: "2014年版（JCS 2014/JSH 2014/JCC 2014。PDF は 2015年3月）",
    url: "https://www.j-circ.or.jp/cms/wp-content/uploads/2020/02/JCS2014_shimokawa_h.pdf",
    summary:
      "災害時の循環器の病気の予防と管理。抗血栓薬（抗血小板薬・抗凝固薬）や降圧薬を急にやめない、薬が分かれば同じ薬を続ける、車中泊などで脚を下げたまま動かないと深部静脈血栓から肺塞栓が起きる",
    scope:
      "骨格の段 5（抗血小板薬・抗凝固薬。抗血小板薬は 11/3 確定の 2 で足した）と薬の時計の行。車中泊の血栓は本人の 1 枚・訓練の講評で引く予定",
    quote: { text: "決して中断してはならない", where: "発症予防のポイント・薬の継続" },
    checkedOn: null,
  },
  {
    id: "mhlw-dementia-2018",
    publisher: "厚生労働省老健局（別添は認知症介護研究・研修仙台センター監修）",
    title:
      "平成30年7月豪雨により被災した認知症高齢者等及びその家族に対する避難所等における適切な支援について（別添「避難所での認知症の人と家族支援ガイド」）",
    year: 2018,
    edition: "事務連絡 平成30年7月11日（ガイドは平成24年度の事業の成果）",
    url: "https://www.mhlw.go.jp/content/10600000/000332789.pdf",
    summary:
      "西日本の豪雨（愛媛県を含む）のときに避難所へ送った資料。認知症の人は急な環境の変化についていけず、言葉が出にくくなる。静かで仕切った場所、なじみの人、急がせない接し方",
    scope: "骨格の段 6 と「本人の申告は参考」の足す言葉",
    quote: { text: "思うように言葉が出なくなります", where: "支援ガイド・認知症の人への接し方" },
    checkedOn: null,
  },
  {
    id: "jsth-pe-2020",
    publisher: "日本血栓止血学会",
    title: "被災地における肺血栓塞栓症の予防について",
    year: 2020,
    edition: "令和2年7月7日",
    url: "https://www.jsth.org/wordpress/wp-content/uploads/2020/07/teigen202007.pdf",
    summary:
      "狭い避難所や車中泊で血栓症が起きやすい。脚を動かす、水分をとる、車中泊では脚を伸ばす、循環器の薬は続ける、息切れ・胸の痛み・片脚のむくみは早めに医療者に相談する",
    scope: "車中泊・避難所の血栓の予防（本人の 1 枚の持ち物・訓練の講評で引く予定）",
    quote: { text: "必ず継続して下さい", where: "予防の要点 ④" },
    checkedOn: null,
  },
  {
    id: "mhlw-ecs-2018",
    publisher: "厚生労働省",
    title: "エコノミークラス症候群の予防のために（平成30年7月豪雨）",
    year: 2018,
    edition: "平成30年7月（リーフレットと事務連絡 平成30年7月8日）",
    url: "https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000212521_00001.html",
    summary:
      "水分や食事が足りないまま、車の中など狭い所で長く脚を動かさずにいると、血のかたまりが肺に詰まるおそれがある。予防のリーフレットと自治体への事務連絡",
    scope: "車中泊の血栓の予防の一般向けの言い方（本人の 1 枚・訓練で引く予定）",
    checkedOn: null,
  },
  {
    id: "saigai-kiroku-2018",
    publisher: "災害時の診療録のあり方に関する合同委員会（厚生労働省の頁に通知の別添として掲載）",
    title: "災害診療記録2018（一般診療版）",
    year: 2018,
    edition: "2018年版",
    url: "https://www.mhlw.go.jp/content/10600000/001684173.pdf",
    page: "https://www.mhlw.go.jp/stf/newpage_71340.html",
    summary:
      "避難所などで医療班が使う共通の診療記録。特記事項（常用薬等）に抗血小板薬・抗凝固薬・糖尿病の薬・ステロイド・抗てんかん薬・透析・在宅酸素の欄、要保護者に支援者のいない要配慮者の欄、メディカル ID の作り方",
    scope: "医療班の要約（T07）の順と欄、骨格の段 7、「支援者なし」",
    quote: { text: "支援者のいない要配慮者等", where: "【要保護者】の欄" },
    checkedOn: null,
  },
] as const satisfies ReadonlyArray<SourceFields>;

export type SourceId = (typeof SOURCES)[number]["id"];
export type SourceEntry = SourceFields & { readonly id: SourceId };

export const SOURCE_IDS: ReadonlyArray<SourceId> = SOURCES.map((s) => s.id);

const BY_ID: ReadonlyMap<string, SourceEntry> = new Map(SOURCES.map((s) => [s.id, s]));

export function isSourceId(id: string): id is SourceId {
  return BY_ID.has(id);
}

/** 登録簿の 1 件。無い id は投げる */
export function sourceById(id: string): SourceEntry {
  const s = BY_ID.get(id);
  if (!s) throw new Error(`出典の登録簿に無い id: ${id}`);
  return s;
}

/** 登録簿に無い id があれば投げる（Claude に渡す前・表を読むとき） */
export function assertSourceIds(ids: ReadonlyArray<string>): asserts ids is ReadonlyArray<SourceId> {
  const missing = ids.filter((id) => !isSourceId(id));
  if (missing.length > 0) throw new Error(`出典の登録簿に無い id: ${missing.join("、")}`);
}

/** 作者の確認の印。画面と文書はこの言葉を出す */
export type CheckMark = "確認済" | "未確認";

export function checkMark(id: string): CheckMark {
  return sourceById(id).checkedOn ? "確認済" : "未確認";
}
