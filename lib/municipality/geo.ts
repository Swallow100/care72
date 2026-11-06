// 全国の市区町村の表（T154）の位置と気象庁の側（サーバーだけ。画面に送らない。名前の側は lib/municipality/names.ts）。
// 代表の点は気象庁の市町村等（気象警報等）の区域の主な面の重心（面の外に出たら面の中へ寄せた点）、範囲は主な面の南西・北東の角。
// 小さな島は範囲に入れない（一番大きな面の 1 割より小さな面）。作り方は tools/municipality/build.ts。
// 気象庁のコード: 市町村等（警報・注意報の電文の Area の Code、7 桁）・市町村等をまとめた地域・一次細分区域・府県予報区（area.json の親子）。
// 政令指定都市の市の行は区ごとの市町村等を全部持ち、市で 1 つに発表する市の区の行は市の市町村等を持つ。

import type { GeoPoint } from "../db/types.ts";
import { MUNICIPALITY_GEO_TSV } from "./geo-data.ts";

export type MunicipalityGeo = {
  point: GeoPoint;
  /** 主な面の範囲（南西・北東） */
  box: { s: number; w: number; n: number; e: number };
  /** 気象庁の市町村等（警報・注意報の Area の Code。7 桁） */
  jmaCodes: string[];
  /** 市町村等をまとめた地域 */
  jmaGroups: string[];
  /** 一次細分区域 */
  jmaDivisions: string[];
  /** 府県予報区 */
  jmaOffices: string[];
};

let table: Map<string, MunicipalityGeo> | null = null;

function load(): Map<string, MunicipalityGeo> {
  if (table) return table;
  table = new Map();
  const list = (s: string | undefined) => (s ? s.split(",") : []);
  for (const line of MUNICIPALITY_GEO_TSV.split("\n")) {
    const f = line.split("\t");
    table.set(f[0], {
      point: { lat: Number(f[1]), lng: Number(f[2]) },
      box: { s: Number(f[3]), w: Number(f[4]), n: Number(f[5]), e: Number(f[6]) },
      jmaCodes: list(f[7]),
      jmaGroups: list(f[8]),
      jmaDivisions: list(f[9]),
      jmaOffices: list(f[10]),
    });
  }
  return table;
}

/** 団体コードの位置と気象庁のコード（無ければ null。北方領土の村は気象庁の区域が無く null） */
export function municipalityGeo(code: string | null | undefined): MunicipalityGeo | null {
  return code ? (load().get(code) ?? null) : null;
}

/** 表の行の数（テストと文書） */
export function municipalityGeoCount(): number {
  return load().size;
}
