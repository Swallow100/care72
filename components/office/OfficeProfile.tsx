// 事業所の「事業所」の区分（docs/tasks/T148.md の 1）: 名称・所在地・電話・FAX・事業所番号。保存はフォームの POST（app/office/profile）。
// 名称は計画書・様式 9・本人の 1 枚・医療要約・様式の対応表の事業所名の欄にそのまま入る（前からの officeName の道）。
// 書けるのは地域と同じ人（管理者・試用事業所の審査員。lib/office/profile.ts）。ほか（審査員のケアマネの役など）は見るだけ。
// 自分で D1 を読む（事業所の画面 app/office/page.tsx には 1 行で置く。OfficePlace と同じ形）。

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { Panel, PanelHead } from "@/components/ui/Panel";
import { SubmitButton } from "@/components/ui/SubmitButton";
import {
  ADDRESS_MAX,
  loadOfficeProfile,
  OFFICE_NAME_MAX,
  OFFICE_PROFILE_ANCHOR,
  OFFICE_PROFILE_PATH,
  PHONE_MAX,
  PROFILE_LABELS as L,
  type OfficeProfile as Profile,
  type ProfileError,
} from "@/lib/office/profile";

const INPUT =
  "h-8 w-full min-w-0 rounded bg-panel2 px-2 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";
const FIELD = "flex min-w-0 flex-col gap-0.5";

export async function OfficeProfile({ officeId, admin, error }: { officeId: string; admin: boolean; error: ProfileError | null }) {
  let profile: Profile | null;
  try {
    const { env } = await getCloudflareContext({ async: true });
    profile = await loadOfficeProfile(env.DB, officeId);
  } catch (e) {
    console.error("事業所の情報を読めない", e);
    return null;
  }
  if (!profile) return null;
  return (
    <Panel aria-labelledby="office-profile-title">
      <form method="post" action={OFFICE_PROFILE_PATH} id={OFFICE_PROFILE_ANCHOR} className="scroll-mt-4" data-office-profile>
        <PanelHead id="office-profile-title" title={L.title} />
        {error && (
          <p role="alert" className="mt-1 text-sm font-bold text-danger" data-profile-error={error}>
            {L[error]} {L.bad}
          </p>
        )}
        {admin ? (
          <div className="mt-2 grid gap-x-3 gap-y-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <label className={FIELD}>
              <span className="text-xs text-muted">{L.name}</span>
              <input name="name" required maxLength={OFFICE_NAME_MAX} defaultValue={profile.name} autoComplete="organization" className={INPUT} />
            </label>
            <label className={FIELD}>
              <span className="text-xs text-muted">{L.address}</span>
              <input name="address" maxLength={ADDRESS_MAX} defaultValue={profile.address ?? ""} autoComplete="street-address" className={INPUT} />
            </label>
            <label className={FIELD}>
              <span className="text-xs text-muted">{L.phone}</span>
              <input name="phone" type="tel" inputMode="tel" maxLength={PHONE_MAX} defaultValue={profile.phone ?? ""} autoComplete="tel" className={`${INPUT} tabular-nums`} />
            </label>
            <label className={FIELD}>
              <span className="text-xs text-muted">{L.fax}</span>
              <input name="fax" type="tel" inputMode="tel" maxLength={PHONE_MAX} defaultValue={profile.fax ?? ""} autoComplete="off" className={`${INPUT} tabular-nums`} />
            </label>
            <label className={FIELD}>
              <span className="text-xs text-muted">{L.number}</span>
              <input
                name="number"
                inputMode="numeric"
                maxLength={13}
                defaultValue={profile.number ?? ""}
                autoComplete="off"
                className={`${INPUT} tabular-nums`}
              />
            </label>
          </div>
        ) : (
          <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
            <Read label={L.name} value={profile.name} />
            <Read label={L.address} value={profile.address} />
            <Read label={L.phone} value={profile.phone} />
            <Read label={L.fax} value={profile.fax} />
            <Read label={L.number} value={profile.number} />
          </dl>
        )}
        {admin && (
          <div className="mt-2">
            <SubmitButton kind="main" icon="SaveIcon">
              {L.save}
            </SubmitButton>
          </div>
        )}
      </form>
    </Panel>
  );
}

function Read({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={value ? "tabular-nums" : "text-muted"}>{value ?? L.none}</dd>
    </>
  );
}
