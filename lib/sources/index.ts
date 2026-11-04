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

/** 登録簿。並びは docs/SOURCES.md の並び（制度 → 機器 → 透析 → 薬 → 認知症 → 血栓 → 記録 → 気象 → 発災からの時間の目安〔T104〕→ 避難の経路〔T112〕） */
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
    scope:
      "安否を確かめる順を事業所が持つことの根拠（信号の行・並び・骨格の段 8・様式 9）。訓練の時間帯の目安で、行政の支援が始まる目安を被災後 3 日目とする備蓄の記述（lib/drill/time-odds.ts）",
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
    scope: "機器の時計（内蔵電池の時間）の行と、無事の報告のあとに電池が切れる行",
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
      "骨格の段 4、インスリンの時計（手元の残りの日数）の行。冷蔵が切れても時計を走らせず、暑さ・冷蔵を時計の確認の欄（頼り先 保管）に置く根拠",
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
      "骨格の段 5（抗血小板薬・抗凝固薬。抗血小板薬は期間中に足した）と薬の時計の行。車中泊の血栓は本人の 1 枚・訓練の講評で引く予定",
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
  {
    id: "jma-h30-july-rain-2018",
    publisher: "気象庁",
    title: "平成30年7月豪雨（前線及び台風第7号による大雨等）",
    year: 2018,
    edition: "災害をもたらした気象事例（平成30年6月28日〜7月8日）",
    url: "https://www.data.jma.go.jp/obd/stats/data/bosai/report/2018/20180713/20180713.html",
    summary:
      "前線と台風第7号の影響で西日本を中心に長い期間続いた大雨のまとめ。四国では期間の雨量が 1,800 mm を超えた所があり、24・48・72 時間の雨量の多さの記録を塗り替えた地点が多かった。愛媛県を含む府県に大雨の特別警報",
    scope: "訓練の地図の想定の雨（lib/drill/rain.ts）の参考。発災の前後に強い雨が続き、1 日ほどかけて弱まる長さ。形と道筋は架空",
    note: "頁に各地方の気象台の資料（PDF）へのリンクがある。数字は頁の本文から。雨雲の画像・数値は使っていない",
    checkedOn: null,
  },
  // ---------- 発災からの時間の目安（T104。lib/drill/time-odds.ts と監督の根拠 DIRECTOR_SOURCES が引く） ----------
  {
    id: "soumu-iburi-2019",
    publisher: "総務省",
    title: "通信・放送の被害状況 平成30年北海道胆振東部地震",
    year: 2019,
    edition: "被害の数は平成31年1月16日現在",
    url: "https://www.soumu.go.jp/main_content/000585075.pdf",
    summary:
      "北海道の地震（2018 年 9 月）の通信の被害。発災から約 11 時間は全道で停電し、5 割が解けたのは約 30 時間後、電力会社の復旧の宣言は約 64 時間後。長い停電で携帯の基地局の予備電源が尽き、発災の日の夜に最大約 6,500 局が止まった",
    scope: "訓練の時間帯の目安（停電の続く時間と、停電が長引いて携帯がつながらなくなる時期。lib/drill/time-odds.ts）",
    quote: { text: "基地局の予備電源が枯渇し", where: "携帯電話の被害の頁" },
    note: "停電の時間は通信の資料の中の概況として載っている。一部の町の停電は約 1 か月続いた",
    checkedOn: null,
  },
  {
    id: "soumu-tsushin-2026",
    publisher: "総務省総合通信基盤局電気通信事業部",
    title: "災害時における通信の確保について",
    year: 2026,
    edition: "令和8年2月25日（総合通信局の防災セミナーの資料）",
    url: "https://www.soumu.go.jp/main_content/001060240.pdf",
    summary:
      "災害時の通信の対策のまとめ。情報通信ネットワーク安全・信頼性基準で、市町村役場などをカバーする携帯電話の基地局に少なくとも 24 時間の停電対策を義務とし、離島・半島の役場や国の機関をカバーする局は 72 時間を推奨する（令和 7 年 3 月の改正）",
    scope: "訓練の時間帯の目安（停電が 1 日を超えると基地局の電源が尽きうること。lib/drill/time-odds.ts）",
    quote: { text: "少なくとも24時間の停電対策", where: "携帯電話基地局等の停電対策の頁" },
    note: "セミナーの資料。基準の本体は告示（情報通信ネットワーク安全・信頼性基準）",
    checkedOn: null,
  },
  {
    id: "mhlw-water-2016",
    publisher: "厚生労働省",
    title: "平成28年熊本地震における主な対応（水道関係）",
    year: 2016,
    edition: "資料1-1（断水の数は平成28年5月20日現在）",
    url: "https://www.mhlw.go.jp/file/05-Shingikai-10601000-Daijinkanboukouseikagakuka-Kouseikagakuka/0000124972.pdf",
    summary:
      "熊本の地震の水道の被害と対応。断水は最大約 44.6 万戸。過去の主な地震と大雨の断水の戸数と最大断水日数の表があり、どの災害も断水は 3 日以上続いている",
    scope: "訓練の時間帯の目安（断水は 72 時間のうちには戻らないことが多い。lib/drill/time-odds.ts）",
    quote: { text: "最大断水日数", where: "主な地震による被害の表" },
    checkedOn: null,
  },
  {
    id: "cao-hinanjo-2016",
    publisher: "内閣府（防災担当）",
    title: "避難所運営ガイドライン",
    year: 2016,
    edition: "平成28年4月",
    url: "https://www.bousai.go.jp/taisaku/hinanjo/pdf/1604hinanjo_guideline.pdf",
    summary:
      "避難所の運営の手引き。災害の段階を初動（発災当日）・応急期（3 日目まで）・復旧期（1 週間まで）・復興期に分け、寝床は初動に毛布、応急期にマットや段ボール、4 日目以降に簡易ベッドと、時を追って環境を良くする",
    scope: "訓練の時間帯の目安（避難所の段階。lib/drill/time-odds.ts）",
    quote: { text: "初動（発災当日）", where: "本ガイドラインの使い方" },
    checkedOn: null,
  },
  {
    id: "cao-fukushi-2021",
    publisher: "内閣府（防災担当）",
    title: "福祉避難所の確保・運営ガイドライン",
    year: 2021,
    edition: "平成28年4月（令和3年5月改定）",
    url: "https://www.bousai.go.jp/taisaku/hinanjo/pdf/r3_hinanjo_guideline.pdf",
    summary:
      "福祉避難所の指定・確保・運営の手引き。直接の避難を進める一方で、支援者の到着が間に合わないなどで災害の初日に開設が間に合わない場合もあるとし、市町村に発災直後の要配慮者の避難先を考えておくよう求める",
    scope: "訓練の時間帯の目安（福祉避難所は初日に開かないことがある。lib/drill/time-odds.ts）",
    quote: { text: "初日に開設が間に合わない", where: "第1章 2.2.5（p.24）" },
    checkedOn: null,
  },
  {
    id: "fdma-tsunami-2013",
    publisher: "消防庁国民保護・防災部防災課",
    title: "津波避難対策推進マニュアル検討会報告書 第2章 市町村における津波避難計画策定指針",
    year: 2013,
    edition: "平成25年3月（第2章は令和8年1月16日改正の版を読んだ）",
    url: "https://www.fdma.go.jp/singi_kento/kento/2026/09/01/items/kento106_01_2syou2.pdf",
    page: "https://www.fdma.go.jp/singi_kento/kento/kento106.html",
    summary:
      "市町村が津波の避難計画を作るための指針。避難の歩く速さは老人の自由歩行なども含めて 1.0 m/秒を目安とし、歩行困難者・身体障がい者・重病人などは 0.5 m/秒に下がること、東日本大震災の平均の避難速度 0.62 m/秒も考えるとする。参考に、自力のみで行動しにくい人の水平の歩行 0.8 m/秒を挙げる",
    scope: "経路地図の徒歩の見込み時間（歩行 問題なし 1.0・一部 0.8・困難と未確認 0.5 m/秒。lib/map/transport.ts の walkSpeedOf）",
    quote: { text: "歩行速度は 1.0ｍ／秒", where: "2.3.2 の 3 (1) 歩行速度（p.25）" },
    note: "津波の避難の指針。ほかの災害の徒歩の見込みにも同じ速さを当てるのはこの作品の判断。0.8 m/秒は p.26 の【参考】の値",
    checkedOn: null,
  },
  {
    id: "mlit-kansui-2019",
    publisher: "国土交通省自動車局審査・リコール課",
    title: "水深が床面を超えたら、もう危険！ －自動車が冠水した道路を走行する場合に発生する不具合について－",
    year: 2019,
    edition: "令和元年11月27日（報道発表）",
    url: "https://www.mlit.go.jp/report/press/jidosha08_hh_003565.html",
    summary:
      "冠水した道路を車で走ると、水深が床面を超えたあたりからエンジンや電気装置が止まるおそれがあり、ドアの高さの半分を超えると車内からドアがほぼ開かなくなる",
    scope: "浸水のハザードがある人で手段が車のときの経路地図の「冠水注意」（色と連絡の順には使わない）",
    quote: { text: "水深が床面を超えたら", where: "報道発表の題" },
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
