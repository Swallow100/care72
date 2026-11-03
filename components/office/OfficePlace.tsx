// 事業所の「地域」（docs/tasks/T68.md の 4）: 市と地図の中心。保存はフォームの POST（app/office/place）。
// - 市: 本人のページの住所の市の欄の既定（台帳に住所が無い人）。変えても今の利用者の市は変えない
// - 中心: 本人のページの位置を置く地図が、本人の位置が無いときに開く所（components/person/LocationPick.tsx を使い回す）
// 書けるのは事業所の管理者だけ。ほか（管理者でないケアマネ・審査員のケアマネの役）は見るだけ。事業所の経過には残さない。
// 自分で D1 を読む（事業所の画面 app/office/page.tsx には 1 行で置く。components/office/FormChoice.tsx と同じ形）。

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { LocationField } from "@/components/person/LocationPick";
import { Panel, PanelHead } from "@/components/ui/Panel";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { PLACE_LABELS } from "@/lib/labels";
import { DEFAULT_CENTER } from "@/lib/map/center";
import { CITY_MAX, loadOfficePlace, OFFICE_PLACE_ANCHOR, OFFICE_PLACE_PATH, type OfficePlace as Place } from "@/lib/office/place";

const ROW = "grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-x-2";
const ROW_TOP = "grid grid-cols-[3rem_minmax(0,1fr)] items-start gap-x-2";
const INPUT =
  "w-full min-w-0 rounded bg-panel2 px-2 py-1 text-sm outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";

export async function OfficePlace({ officeId, admin, error }: { officeId: string; admin: boolean; error?: boolean }) {
  let place: Place | null;
  try {
    const { env } = await getCloudflareContext({ async: true });
    place = await loadOfficePlace(env.DB, officeId);
  } catch (e) {
    console.error("事業所の地域を読めない", e);
    return null;
  }
  if (!place) return null;
  return (
    <Panel aria-labelledby="office-place-title">
      <form method="post" action={OFFICE_PLACE_PATH} id={OFFICE_PLACE_ANCHOR} data-office-place>
        <PanelHead id="office-place-title" title={PLACE_LABELS.region} />
        {error && (
          <p role="alert" className="mt-1 text-sm font-bold text-danger">
            {PLACE_LABELS.bad}
          </p>
        )}
        <div className="mt-2 grid gap-1.5 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] md:gap-x-4">
          {admin ? (
            <label className={`${ROW} self-start`}>
              <span className="text-xs text-muted">{PLACE_LABELS.city}</span>
              <input name="city" className={INPUT} required maxLength={CITY_MAX} defaultValue={place.city} autoComplete="off" data-office-city />
            </label>
          ) : (
            <div className={`${ROW} self-start`}>
              <span className="text-xs text-muted">{PLACE_LABELS.city}</span>
              <span className="text-sm" data-office-city>
                {place.city || PLACE_LABELS.none}
              </span>
            </div>
          )}
          <div className={ROW_TOP}>
            <span className="pt-1 text-xs text-muted">{PLACE_LABELS.center}</span>
            <LocationField name="center" defaultValue={place.center} center={place.center ?? DEFAULT_CENTER} label={PLACE_LABELS.center} readOnly={!admin} />
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
    </Panel>
  );
}
