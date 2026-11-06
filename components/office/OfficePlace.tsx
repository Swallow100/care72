// 事業所の「地域」（docs/tasks/T68.md の 4、T148 で複数の市に）: 主な市・周りの市・中心・広さ・区域。保存はフォームの POST（app/office/place）。
// - 主な市: 本人のページの住所の市の欄の既定（台帳に住所が無い人）。変えても今の利用者の市は変えない
// - 周りの市: 担当の利用者がいる隣の市など（「東温市・砥部町」と区切って入れる）。気象庁の欄・上の帯の警報・様式の一覧の初めの市に効く
// - 中心と広さ: 地図のピンが無いときの初めの表示と「地域」の表示（雨雲はその表示に重なる）。本人のページの位置の地図の真ん中
// - 区域: 事業所の建物のある所の浸水・土砂・津波（offices.hazards。訓練の区域の出来事が事業所に効くか）
// - 地域に追加: 利用者の住所の市で地域に入っていない市を 1 つずつ周りの市に足す
// 効く所の決まりは lib/office/region.ts。書けるのは事業所の管理者と試用事業所の審査員だけ。ほか（審査員のケアマネの役など）は見るだけ。
// T154: 主な市と周りの市は全国の市区町村の表から都道府県 → 市区町村で選ぶ（components/office/CityPicker.tsx。保存は団体コード）。
// T148 の文字の値は表で当てて選んだ形で開き、当たらない主な市は「未選択」、周りの市は「未照合」で選び直しを促す。
// 利用者の住所の市も表で当て、地域の外の市は「地域に追加」、表に当たらない住所は「未照合」で人数だけ。決まりは lib/office/area.ts。
// 事業所の経過には残さない。自分で D1 を読む（事業所の画面 app/office/page.tsx には 1 行で置く）。

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { LocationField } from "@/components/person/LocationPick";
import { Panel, PanelHead } from "@/components/ui/Panel";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { CHOICE_INPUT, CHOICE_LABEL } from "@/components/ui/choice";
import { HAZARD_LABELS, PLACE_LABELS } from "@/lib/labels";
import { DEFAULT_CENTER } from "@/lib/map/center";
import { loadOfficeRegion, type OfficeRegion } from "@/lib/office/area";
import { OFFICE_PLACE_ANCHOR, OFFICE_PLACE_PATH } from "@/lib/office/http-paths";
import { FLOOD_DEPTHS, OFFICE_ZONE_KINDS, REGION_CITY_MAX, REGION_KMS } from "@/lib/office/region";
import { MainCityPicker, OtherCitiesPicker } from "./CityPicker";
import { DepthSelect, ExtentSelect } from "./RegionSelects";

const ROW = "grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-2";
const ROW_TOP = "grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-x-2";

export async function OfficePlace({ officeId, admin, error }: { officeId: string; admin: boolean; error?: boolean }) {
  let region: OfficeRegion | null;
  try {
    const { env } = await getCloudflareContext({ async: true });
    region = await loadOfficeRegion(env.DB, officeId);
  } catch (e) {
    console.error("事業所の地域を読めない", e);
    return null;
  }
  if (!region) return null;
  const zone = new Map(region.zones.map((z) => [z.kind, z]));
  const flood = zone.get("flood");
  return (
    <Panel aria-labelledby="office-place-title">
      <form method="post" action={OFFICE_PLACE_PATH} id={OFFICE_PLACE_ANCHOR} className="scroll-mt-4" data-office-place>
        <input type="hidden" name="region" value="1" />
        <PanelHead
          id="office-place-title"
          title={PLACE_LABELS.region}
          sub={
            <span className="text-sm" data-office-region-cities>
              {region.cities.join("・") || PLACE_LABELS.none}
            </span>
          }
        />
        {error && (
          <p role="alert" className="mt-1 text-sm font-bold text-danger">
            {PLACE_LABELS.bad}
          </p>
        )}
        <div className="mt-2 grid gap-1.5 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] md:gap-x-4">
          <div className="grid content-start gap-1.5">
            {admin ? (
              <>
                <div className={ROW}>
                  <span className="text-xs text-muted">{PLACE_LABELS.mainCity}</span>
                  <MainCityPicker defaultCode={region.cityCode} defaultPref={region.pref} legacyText={region.cityCode ? "" : region.city} />
                </div>
                <div className={ROW_TOP}>
                  <span className="pt-2 text-xs text-muted">{PLACE_LABELS.otherCities}</span>
                  <OtherCitiesPicker
                    defaultCodes={region.otherCodes}
                    defaultPref={region.pref}
                    unmatched={region.unmatched}
                    mainCode={region.cityCode}
                    max={REGION_CITY_MAX}
                  />
                </div>
                <div className={ROW}>
                  <span className="text-xs text-muted">{PLACE_LABELS.extent}</span>
                  <ExtentSelect kms={REGION_KMS} value={region.km} autoKm={region.kmUsed} />
                </div>
                <fieldset className={ROW_TOP}>
                  <legend className="sr-only">{PLACE_LABELS.zones}</legend>
                  <span aria-hidden className="pt-2 text-xs text-muted">
                    {PLACE_LABELS.zones}
                  </span>
                  <div className="flex flex-wrap gap-1" data-office-zones>
                    {OFFICE_ZONE_KINDS.map((k) => (
                      <label key={k} className={CHOICE_LABEL}>
                        <input type="checkbox" name="zone" value={k} defaultChecked={zone.has(k)} className={CHOICE_INPUT} />
                        {HAZARD_LABELS[k]}
                      </label>
                    ))}
                    <DepthSelect depths={FLOOD_DEPTHS} value={flood?.depthM ?? null} />
                  </div>
                </fieldset>
              </>
            ) : (
              <dl className="grid gap-1 text-sm">
                <ReadRow
                  label={PLACE_LABELS.mainCity}
                  value={region.cityCode ? `${region.pref ?? ""}${region.city}` : `${PLACE_LABELS.unselected}${region.city ? ` ${region.city}` : ""}`}
                  data="city"
                />
                <ReadRow label={PLACE_LABELS.otherCities} value={region.others.join("・") || PLACE_LABELS.noneShort} data="others" />
                <ReadRow label={PLACE_LABELS.extent} value={`${region.kmUsed} km${region.km === null ? ` ${PLACE_LABELS.auto}` : ""}`} data="km" />
                <ReadRow
                  label={PLACE_LABELS.zones}
                  value={
                    region.zones.map((z) => (z.kind === "flood" && z.depthM != null ? `${HAZARD_LABELS[z.kind]} ${z.depthM} m` : HAZARD_LABELS[z.kind])).join("・") ||
                    PLACE_LABELS.noneShort
                  }
                  data="zones"
                />
              </dl>
            )}
          </div>
          <div className={ROW_TOP}>
            <span className="pt-1 text-xs text-muted">{PLACE_LABELS.center}</span>
            <LocationField name="center" defaultValue={region.center} center={region.center ?? DEFAULT_CENTER} label={PLACE_LABELS.center} readOnly={!admin} />
          </div>
        </div>
        {admin && (
          <div className="mt-2">
            <SubmitButton kind="main" icon="SaveIcon">
              {PLACE_LABELS.save}
            </SubmitButton>
          </div>
        )}
      </form>
      {/* 利用者の住所の市で地域に入っていない市（T148）。管理者は 1 つずつ周りの市に足せる */}
      {(region.suggestions.length > 0 || region.unmatchedPeople.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded bg-panel2 px-2.5 py-1.5 text-sm" data-region-suggest>
          <span className="text-xs text-muted">{PLACE_LABELS.outside}</span>
          {region.suggestions.map((s) => (
            <span key={s.code} className="flex items-center gap-1.5" data-region-suggest-city={s.city} data-region-suggest-code={s.code}>
              <span className="font-bold">{s.label.startsWith(region.pref ?? " ") ? s.city : s.label}</span>
              <span className="text-xs text-muted tabular-nums">{s.count} 人</span>
              {admin && (
                <form method="post" action={OFFICE_PLACE_PATH}>
                  <input type="hidden" name="add_code" value={s.code} />
                  <SubmitButton kind="addIn" size="sm" icon="AddIcon">
                    {PLACE_LABELS.addCity}
                  </SubmitButton>
                </form>
              )}
            </span>
          ))}
          {region.unmatchedPeople.map((s) => (
            <span key={`unmatched:${s.city}`} className="flex items-center gap-1.5" data-region-unmatched-city={s.city}>
              <span className="text-xs font-bold text-danger">{PLACE_LABELS.unmatched}</span>
              <span>{s.city}</span>
              <span className="text-xs text-muted tabular-nums">{s.count} 人</span>
            </span>
          ))}
        </div>
      )}
    </Panel>
  );
}

function ReadRow({ label, value, data }: { label: string; value: string; data: string }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-x-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd data-office-region-read={data}>{value}</dd>
    </div>
  );
}
