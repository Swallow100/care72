// 気象警報・注意報の電文（VPWW53・54〔経過措置〕、VPWW55〜61〔2026-05-29 からの体系〕）を読む（T72）。
// 市町村（Area の Code と Name）ごとに、種類（Kind の Name。「レベル3大雨警報」「大雨注意報」など正式な名前のまま）・
// 状態（Kind の Status。発表・継続・解除など電文のまま）を出す。発表時刻は Head の ReportDateTime、発表官署は Control の PublishingOffice。
// 読み方は構造で決める（Body の Warning のうち type が市町村の物 → Item → Kind・Area）。電文の番号では分けない。
// VPWW55〜61 の本物の形はこの作業の中で見ていない（fixtures は文書の形式から作った見本）。違えば読めずに捨てる（記録に 1 行）。
// 何も読み替えない: 名前・状態・時刻・市町村は電文のまま写し、危険度や地点への当てはめを作らない。

import { attr, child, children, childText, isoOf, parseXml } from "./xml.ts";

export type WarningItem = {
  areaCode: string;
  areaName: string;
  /** 種類の名前。その市町村に発表中の物が無ければ "" */
  kind: string;
  status: string;
  /** 電文の中の並び（市町村の中の種類の順） */
  sort: number;
};

export type WarningReport = {
  /** Control の Title（「気象警報・注意報（Ｈ２７）」など） */
  title: string;
  /** Control の Status（通常・訓練・試験）。通常のほかは写さない */
  status: string;
  /** Head の InfoType（発表・訂正・取消） */
  infoType: string;
  /** 発表時刻（Head の ReportDateTime を UTC の ISO に） */
  issuedAt: string;
  /** 発表官署（Control の PublishingOffice） */
  officeName: string;
  items: WarningItem[];
};

/** 市町村ごとの区分か（「気象警報・注意報（市町村等）」。「市町村等をまとめた地域等」は除く） */
export function isMunicipalityWarning(type: string | undefined): boolean {
  return !!type && type.includes("市町村") && !type.includes("まとめた");
}

/** 電文を読む。警報の電文でない・市町村の区分が無い・時刻が読めないときは投げる */
export function parseWarning(xml: string): WarningReport {
  const doc = parseXml(xml);
  const report = child(doc, "Report");
  if (!report) throw new Error("Report が無い");
  const control = child(report, "Control");
  const head = child(report, "Head");
  const issuedAt = isoOf(childText(head, "ReportDateTime"));
  if (!control || !head || !issuedAt) throw new Error("Control・Head・発表時刻が無い");
  const infoType = childText(head, "InfoType");
  const base = {
    title: childText(control, "Title"),
    status: childText(control, "Status"),
    infoType,
    issuedAt,
    officeName: childText(control, "PublishingOffice") || childText(control, "EditorialOffice"),
  };
  // 取消は中身を持たない（前の発表を取り消す）。読んだことだけ返す
  if (infoType === "取消") return { ...base, items: [] };

  const body = child(report, "Body");
  const sections = children(body, "Warning").filter((w) => isMunicipalityWarning(attr(w, "type")));
  if (sections.length === 0) throw new Error("市町村の区分が無い");

  const items: WarningItem[] = [];
  for (const section of sections) {
    for (const item of children(section, "Item")) {
      const areas = children(item, "Area");
      const kinds = children(item, "Kind");
      for (const area of areas) {
        const areaCode = childText(area, "Code");
        const areaName = childText(area, "Name");
        if (!areaCode || !areaName) continue;
        const named = kinds.filter((k) => childText(k, "Name") !== "");
        if (named.length === 0) {
          // 発表している警報・注意報が無い市町村（「発表警報・注意報はなし」など）。前の発表の行を今と読まないために 1 行
          const status = kinds.map((k) => childText(k, "Status")).find(Boolean) ?? "";
          items.push({ areaCode, areaName, kind: "", status, sort: 0 });
          continue;
        }
        named.forEach((k, i) => items.push({ areaCode, areaName, kind: childText(k, "Name"), status: childText(k, "Status"), sort: i }));
      }
    }
  }
  if (items.length === 0) throw new Error("市町村の行が無い");
  return { ...base, items };
}
