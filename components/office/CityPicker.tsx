"use client";

// 事業所の地域の市を全国の市区町村の表から選ぶ部品（T154）。都道府県 → 市区町村（検索つき。よみでも探せる）。
// 都道府県を「全国」にすると全国の市区町村から探す（一覧の小さな字に都道府県）。
// - MainCityPicker: 主な市（name="city_code" の 1 つ）。表に当たらない前の形の文字なら「未選択」と前の文字
// - OtherCitiesPicker: 周りの市（選んだ物ごとに name="region_code" の隠しの欄。8 つまで）。表に当たらない前の形の文字は「未照合」で
//   残し（name="region_city"）、外すと次の保存で消える
// 選ぶ部品は components/ui/Select（中の <option> を読むので、この client の部品の中で <option> を書く。T148 の hydration の教訓）。
// 表の名前の側（lib/municipality/names.ts）だけを読む。緯度経度・気象庁のコードは画面に送らない。

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { AddIcon, RemoveIcon } from "@/components/ui/Icon";
import { Select } from "@/components/ui/Select";
import { PLACE_LABELS } from "@/lib/labels";
import { allMunicipalities, municipalityByCode, PREFECTURE_NAMES, type Municipality } from "@/lib/municipality/names";

const SELECT = "h-8 min-w-0 rounded bg-panel2 px-2 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";

/** 都道府県の選ぶ欄（"" は全国） */
function PrefSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={`${SELECT} w-24`} aria-label={label} scrollList data-city-pref>
      <option value="">{PLACE_LABELS.allPrefs}</option>
      {PREFECTURE_NAMES.map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
    </Select>
  );
}

/** 市区町村の選ぶ欄（都道府県の中か全国。よみ・都道府県でも探せる） */
function CitySelect({
  pref,
  value,
  onChange,
  name,
  label,
  exclude = [],
}: {
  pref: string;
  value: string;
  onChange: (v: string) => void;
  name?: string;
  label: string;
  exclude?: readonly string[];
}) {
  const list = useMemo(() => allMunicipalities().filter((m) => (pref === "" || m.pref === pref) && !exclude.includes(m.code)), [pref, exclude]);
  return (
    <Select
      name={name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${SELECT} w-36`}
      aria-label={label}
      searchable
      scrollList
      data-city-select
    >
      <option value="" data-placeholder>
        {PLACE_LABELS.unselected}
      </option>
      {list.map((m) => (
        <option key={m.code} value={m.code} data-sub={pref === "" ? `${m.pref} ${m.kana}` : m.kana}>
          {m.name}
        </option>
      ))}
    </Select>
  );
}

/** 主な市（name="city_code"）。legacyText は表に当たらない前の形の文字（未選択のときに添える） */
export function MainCityPicker({ defaultCode, defaultPref, legacyText }: { defaultCode: string | null; defaultPref: string | null; legacyText: string }) {
  const start = municipalityByCode(defaultCode);
  const [pref, setPref] = useState<string>(start?.pref ?? defaultPref ?? "");
  const [code, setCode] = useState<string>(start?.code ?? "");
  const choosePref = (p: string) => {
    setPref(p);
    if (p !== "" && municipalityByCode(code)?.pref !== p) setCode("");
  };
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" data-main-city-picker>
      <PrefSelect value={pref} onChange={choosePref} label={`${PLACE_LABELS.mainCity} ${PLACE_LABELS.pref}`} />
      <CitySelect pref={pref} value={code} onChange={setCode} name="city_code" label={`${PLACE_LABELS.mainCity} ${PLACE_LABELS.municipality}`} />
      {code === "" && (
        <span className="text-xs" data-main-city-unselected>
          <span className="font-bold text-danger">{PLACE_LABELS.unselected}</span>
          {legacyText && <span className="ml-1 text-muted">{legacyText}</span>}
          {/* 選び直すまでは前の文字のまま保存できる（周りの市・区域だけ直す時に区分の保存が断られないように。団体コードは NULL のまま） */}
          {legacyText && <input type="hidden" name="city" value={legacyText} />}
        </span>
      )}
    </div>
  );
}

/** 周りの市（選んだ物ごとに name="region_code"、未照合の文字は name="region_city"）。max は数の上限 */
export function OtherCitiesPicker({
  defaultCodes,
  defaultPref,
  unmatched,
  mainCode,
  max,
}: {
  defaultCodes: readonly string[];
  defaultPref: string | null;
  unmatched: readonly string[];
  mainCode: string | null;
  max: number;
}) {
  const [codes, setCodes] = useState<string[]>(() => defaultCodes.filter((c) => municipalityByCode(c)));
  const [texts, setTexts] = useState<string[]>(() => [...unmatched]);
  const [pref, setPref] = useState<string>(defaultPref ?? "");
  const [pick, setPick] = useState("");
  const chosen = codes.map((c) => municipalityByCode(c)).filter((m): m is Municipality => m !== null);
  const exclude = useMemo(() => [...codes, ...(mainCode ? [mainCode] : [])], [codes, mainCode]);
  const full = codes.length + texts.length >= max;
  const add = () => {
    if (!pick || full || codes.includes(pick)) return;
    setCodes([...codes, pick]);
    setPick("");
  };
  return (
    <div className="grid min-w-0 gap-1" data-other-cities-picker>
      {(chosen.length > 0 || texts.length > 0) && (
        <ul className="flex flex-wrap gap-1" data-other-cities>
          {chosen.map((m) => (
            <li key={m.code} className="flex items-center gap-1 rounded bg-panel2 py-0.5 pr-0.5 pl-2 text-sm" data-other-city={m.code}>
              <input type="hidden" name="region_code" value={m.code} />
              <span className="font-bold">{m.name}</span>
              {m.pref !== defaultPref && <span className="text-xs text-muted">{m.pref}</span>}
              <Button kind="danger" size="sm" icon={RemoveIcon} onClick={() => setCodes(codes.filter((c) => c !== m.code))} aria-label={`${m.name} ${PLACE_LABELS.remove}`}>
                {PLACE_LABELS.remove}
              </Button>
            </li>
          ))}
          {texts.map((t) => (
            <li key={`text:${t}`} className="flex items-center gap-1 rounded bg-panel2 py-0.5 pr-0.5 pl-2 text-sm" data-other-city-unmatched={t}>
              <input type="hidden" name="region_city" value={t} />
              <span className="text-xs font-bold text-danger">{PLACE_LABELS.unmatched}</span>
              <span>{t}</span>
              <Button kind="danger" size="sm" icon={RemoveIcon} onClick={() => setTexts(texts.filter((x) => x !== t))} aria-label={`${t} ${PLACE_LABELS.remove}`}>
                {PLACE_LABELS.remove}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <PrefSelect value={pref} onChange={(p) => { setPref(p); setPick(""); }} label={`${PLACE_LABELS.otherCities} ${PLACE_LABELS.pref}`} />
          <CitySelect pref={pref} value={pick} onChange={setPick} label={`${PLACE_LABELS.otherCities} ${PLACE_LABELS.municipality}`} exclude={exclude} />
          <Button kind="addIn" size="sm" icon={AddIcon} onClick={add} disabled={!pick} data-other-city-add>
            {PLACE_LABELS.add}
          </Button>
        </div>
      )}
    </div>
  );
}
