// 本人のページと入れる欄（T03）を並べる。面の幅が広ければ入れる欄は右の列、狭ければ上に出す（container query）。
// 単独のページ（/people/[id]）と担当一覧の右の面（/?open=<id>）で同じ形。入れる欄を持つのはケアマネの役だけ。
// 面の編集の基本の住所・位置（T68）に、事業所の市（既定）・町名の候補・地図の中心を事業所から読んで渡す（読めなければ渡さない）。
// 2 つのページ（app/page.tsx は触らない決め）を変えずに済むよう、ここで自分で D1 を読む（components/office/FormChoice.tsx と同じ形）。
// スマホの面（T149。スマホ入口の状態・本人と家族の ID と通知）も同じ理由でここで読み、同意の面のすぐ後に差し込む。

import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { EditPlace } from "@/lib/intake/edit";
import type { IntakeProps } from "@/lib/intake/props";
import { loadOfficePlace } from "@/lib/office/place";
import { nowSec } from "@/lib/auth/session";
import { loadPhoneSummary, type PhoneSummary } from "@/lib/phone/summary";
import { PhoneSection } from "@/components/phone/PhoneSection";
import { requestPanelOf, type RequestPanel } from "@/lib/custody/requests";
import { RequestSection } from "./RequestSection";
import type { PersonView as View } from "@/lib/person";
import { Intake } from "./Intake";
import type { Level } from "./parts";
import { PersonView } from "./PersonView";

/** 事業所の地域（市・中心・町名の候補）。読めなければ undefined（市の既定は空、真ん中は既定の地図） */
async function placeOf(officeId: string): Promise<EditPlace | undefined> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return (await loadOfficePlace(env.DB, officeId)) ?? undefined;
  } catch (e) {
    console.error("事業所の地域を読めない", e);
    return undefined;
  }
}

/** スマホの面（T149）の形。読めなければ null（面を出さない） */
async function phoneOf(personId: string): Promise<PhoneSummary | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return await loadPhoneSummary(env.DB, personId, nowSec());
  } catch (e) {
    console.error("スマホの面を読めない", e);
    return null;
  }
}

/**
 * 医療班への受入依頼の面（T163）の形。災害モードのときと、前に依頼したことがある人だけ（平時に送る物でないので面を作らない）。
 * 読めなければ null
 */
async function requestOf(personId: string, destination: string | undefined, disaster: boolean): Promise<RequestPanel | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const panel = await requestPanelOf(env.DB, personId, destination?.trim() ?? "");
    return disaster || panel.latest ? panel : null;
  } catch (e) {
    console.error("受入依頼の面を読めない", e);
    return null;
  }
}

export async function PersonWithIntake({
  view,
  level,
  intake,
  staffEntry = false,
  staffRole,
}: {
  view: View;
  level: Level;
  intake: IntakeProps | null;
  /** 役を選べる人（依頼中の面に受入一覧への入口。T166） */
  staffEntry?: boolean;
  /** その入口の役の値（lib/auth/roles.ts の medicalChoiceOf。新規事業所の中では新規事業所の医療班、T180） */
  staffRole?: string;
}) {
  if (!intake) return <PersonView view={view} level={level} />;
  // スマホの面（T149）はケアマネの役だけ（入れる欄を持つ人と同じ）。同意の面のすぐ後
  // 受入依頼の面（T163）も同じ理由でここで読み、頭のすぐ下に差し込む
  const [place, phone, request] = await Promise.all([
    placeOf(intake.officeId),
    phoneOf(intake.personId),
    requestOf(intake.personId, intake.ledger.evacuation?.destination1, view.mode === "disaster"),
  ]);
  return (
    <div className="@container">
      <div className="grid gap-2 @[56rem]:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="order-2 min-w-0 @[56rem]:order-1">
          {/* 面の右上の「編集」で手で直す（T45）。手入力は右の欄から左の面へ移した */}
          <PersonView
            view={view}
            level={level}
            edit={place ? { ...intake.edit, place } : intake.edit}
            phone={phone ? <PhoneSection summary={phone} level={level} /> : null}
            request={request ? <RequestSection personId={intake.personId} panel={request} level={level} staffEntry={staffEntry} staffRole={staffRole} /> : null}
          />
        </div>
        {/* 内側で送らない（送るのは画面全体の縦 1 本）。右の列はページの流れに置く */}
        <aside aria-label="入力" className="order-1 min-w-0 self-start @[56rem]:order-2">
          {/* 人ごとに作り直す（別の人を開いたら、前の人の文・変更点・話している途中を持ち越さない） */}
          <Intake key={intake.personId} {...intake} level={level} />
        </aside>
      </div>
    </div>
  );
}
