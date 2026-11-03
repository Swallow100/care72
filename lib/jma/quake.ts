// 地震の電文（VXSE51 震度速報・VXSE52 震源に関する情報・VXSE53 震源・震度に関する情報）を読む（T72）。
// 発生時刻・震源の名前・規模・最大震度と、観測点ごと（市町村の名前・観測点の名前・震度）を電文のまま出す。
// 観測点の緯度経度は持たない（公式の資料が分からないので地図の点にしない）。推計震度分布は仕様が非公開なので作らない。
// 震度を利用者の家の震度と言い切らない（画面は観測点の名前を添えるだけ）。

import { child, children, childText, isoOf, parseXml, path, text } from "./xml.ts";

export type QuakePoint = {
  /** 市町村の名前（Intensity の City の Name。電文のまま） */
  areaName: string;
  /** 観測点の名前（「松山市北持田町＊」など。電文のまま） */
  pointName: string;
  /** 震度（1〜4・5-・5+・6-・6+・7。電文のまま） */
  intensity: string;
};

export type QuakeReport = {
  title: string;
  /** Control の Status（通常・訓練・試験）。通常のほかは写さない */
  status: string;
  /** Head の InfoType（発表・訂正・取消） */
  infoType: string;
  /** 地震の識別（Head の EventID。続報で同じ） */
  eventId: string;
  /** 発表時刻（Head の ReportDateTime を UTC の ISO に） */
  reportAt: string;
  /** 発生時刻（Earthquake の OriginTime。震度速報には無い） */
  originAt: string | null;
  /** 震源の名前（Hypocenter の Area の Name） */
  hypocenter: string | null;
  /** 規模（Magnitude の文字のまま。不明は「NaN」） */
  magnitude: string | null;
  /** 最大震度（Observation の MaxInt） */
  maxIntensity: string | null;
  points: QuakePoint[];
};

/** 電文を読む。地震の電文でない・時刻や識別が読めないときは投げる */
export function parseQuake(xml: string): QuakeReport {
  const doc = parseXml(xml);
  const report = child(doc, "Report");
  if (!report) throw new Error("Report が無い");
  const control = child(report, "Control");
  const head = child(report, "Head");
  const reportAt = isoOf(childText(head, "ReportDateTime"));
  const eventId = childText(head, "EventID");
  if (!control || !head || !reportAt || !eventId) throw new Error("Control・Head・発表時刻・EventID が無い");
  const infoType = childText(head, "InfoType");
  const body = child(report, "Body");
  const quake = child(body, "Earthquake");
  const observation = path(body, "Intensity", "Observation");
  if (infoType !== "取消" && !quake && !observation) throw new Error("震源も震度も無い");

  const points: QuakePoint[] = [];
  for (const pref of children(observation, "Pref")) {
    for (const area of children(pref, "Area")) {
      for (const city of children(area, "City")) {
        const areaName = childText(city, "Name");
        for (const st of children(city, "IntensityStation")) {
          const pointName = childText(st, "Name");
          const intensity = childText(st, "Int");
          if (areaName && pointName && intensity) points.push({ areaName, pointName, intensity });
        }
      }
    }
  }

  const magnitude = text(child(quake, "Magnitude"));
  return {
    title: childText(control, "Title"),
    status: childText(control, "Status"),
    infoType,
    eventId,
    reportAt,
    originAt: isoOf(childText(quake, "OriginTime")),
    hypocenter: childText(path(quake, "Hypocenter", "Area"), "Name") || null,
    magnitude: magnitude || null,
    maxIntensity: childText(observation, "MaxInt") || null,
    points,
  };
}
